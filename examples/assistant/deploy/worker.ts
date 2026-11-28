import { DurableObject } from "cloudflare:workers";
import * as Model from "../gen/assistant.ts";
import type { AssistantWorkerEnv } from "../alchemy.run.ts";

type RedactedEffect =
  | { readonly tag: "Said"; readonly text: string }
  | { readonly tag: "Filled"; readonly page: Model.Page; readonly cardRedacted: true }
  | { readonly tag: "Submitted"; readonly page: Model.Page; readonly amount: number };

interface PublicAssistantState {
  readonly seen: Model.Seen;
  readonly phase: Model.Phase;
  readonly budget: number;
  readonly page: Model.Page;
  readonly waiting: boolean;
  readonly bill: Model.Bill;
  readonly charged: number;
  readonly request: number;
  readonly answered: number;
  readonly pendingCount: number;
  readonly delivered: number;
  readonly cardSaved: boolean;
  readonly done: readonly RedactedEffect[];
}

type HearResult =
  | {
      readonly ok: true;
      readonly state: PublicAssistantState;
      readonly refused: readonly string[];
    }
  | {
      readonly ok: false;
      readonly status: 400 | 409;
      readonly error: string;
    };

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const inspectorHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vibestack Assistant Example</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
      code { font-family: ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <h1>Vibestack Assistant Example</h1>
    <p>Verified bounded-budget assistant with atomic delivery queue and secret isolation on Cloudflare Workers + SQLite Durable Objects via Alchemy.</p>
    <ul>
      <li><code>GET /api/health</code></li>
      <li><code>GET /api/state</code></li>
      <li><code>POST /api/hear</code> with <code>{"saveCard":"4242-...","said":"begin","page":"Genuine","bills":[42],"choices":["Lookup","Review","Speak"]}</code></li>
    </ul>
  </body>
</html>`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPage = (value: unknown): value is Model.Page =>
  value === "Unknown" || value === "Genuine" || value === "Lookalike";

const isSaid = (value: unknown): value is "begin" | "confirm" | "decline" | "restart" =>
  value === "begin" || value === "confirm" || value === "decline" || value === "restart";

const redactEffect = (effect: Model.Effect): RedactedEffect => {
  switch (effect.tag) {
    case "Said":
      return { tag: "Said", text: effect.text };
    case "Filled":
      return { tag: "Filled", page: effect.page, cardRedacted: true };
    case "Submitted":
      return { tag: "Submitted", page: effect.page, amount: effect.amount };
  }
};

const toPublicState = (
  state: Model.Assistant,
  done: readonly Model.Effect[],
): PublicAssistantState => ({
  seen: Model.seen(state),
  phase: state.phase,
  budget: state.budget,
  page: state.page,
  waiting: state.waiting,
  bill: state.bill,
  charged: state.charged,
  request: state.request,
  answered: state.answered,
  pendingCount: state.pending.length,
  delivered: state.delivered,
  cardSaved: state.card.length > 0,
  done: done.map(redactEffect),
});

export class AssistantDO extends DurableObject {
  private readState(): Model.Assistant {
    const raw = this.ctx.storage.kv.get<unknown>("state");
    return Model.parseState(raw) ?? Model.initial;
  }

  private readDone(): Model.Effect[] {
    const raw = this.ctx.storage.kv.get<unknown>("done");
    if (!Array.isArray(raw)) return [];
    const items: Model.Effect[] = [];
    for (const item of raw) {
      if (!isRecord(item)) continue;
      if (item.tag === "Said" && typeof item.text === "string") {
        items.push({ tag: "Said", text: item.text });
      } else if (item.tag === "Filled" && isPage(item.page) && typeof item.card === "string") {
        items.push({ tag: "Filled", page: item.page, card: item.card });
      } else if (
        item.tag === "Submitted" &&
        isPage(item.page) &&
        typeof item.amount === "number" &&
        Number.isSafeInteger(item.amount)
      ) {
        items.push({ tag: "Submitted", page: item.page, amount: item.amount });
      }
    }
    return items;
  }

  private readReceipts(): Set<number> {
    const raw = this.ctx.storage.kv.get<unknown>("receipts");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((item): item is number => typeof item === "number" && Number.isSafeInteger(item)));
  }

  private persist(state: Model.Assistant, done: readonly Model.Effect[], receipts: ReadonlySet<number>) {
    this.ctx.storage.kv.put("state", state);
    this.ctx.storage.kv.put("done", [...done]);
    this.ctx.storage.kv.put("receipts", [...receipts]);
  }

  private deliverPending(
    state: Model.Assistant,
    page: Model.Page,
    done: Model.Effect[],
    receipts: Set<number>,
  ): Model.Assistant {
    let current = state;
    while (current.pending.length > 0) {
      const first = current.pending[0];
      if (!first) break;
      if (first.tag !== "Said" && Model.enabled(current, { type: "load", page }, "World")) {
        current = Model.step(current, { type: "load", page }, "World").state;
      }
      const carried = current.pending[0];
      if (!carried) break;
      const delivery = current.delivered + 1;
      if (!Model.canAcknowledge(current, delivery, "World")) break;
      if (carried.tag !== "Said" && (page !== "Genuine" || carried.page !== page)) {
        break;
      }
      if (!receipts.has(delivery)) {
        done.push(carried);
        receipts.add(delivery);
      }
      if (Model.enabled(current, { type: "acknowledge", delivery }, "World")) {
        current = Model.step(current, { type: "acknowledge", delivery }, "World").state;
      } else {
        break;
      }
    }
    return current;
  }

  private observeWorld(
    state: Model.Assistant,
    page: Model.Page,
    bills: number[],
  ): Model.Assistant {
    let current = state;
    if (Model.enabled(current, { type: "load", page }, "World")) {
      current = Model.step(current, { type: "load", page }, "World").state;
    }
    if (current.waiting && bills.length > 0) {
      const amount = bills.shift();
      if (amount !== undefined && Number.isSafeInteger(amount)) {
        const replyEvent: Model.Event = { type: "reply", request: current.request, amount };
        if (Model.enabled(current, replyEvent, "World")) {
          current = Model.step(current, replyEvent, "World").state;
        }
      }
    }
    return current;
  }

  async getState(): Promise<PublicAssistantState> {
    return toPublicState(this.readState(), this.readDone());
  }

  async hear(payload: unknown): Promise<HearResult> {
    if (!isRecord(payload)) {
      return { ok: false, status: 400, error: "body must be a JSON object" };
    }
    let state = this.readState();
    const done = this.readDone();
    const receipts = this.readReceipts();
    const refused: string[] = [];

    if (payload.event !== undefined) {
      const event = Model.parseEvent(payload.event);
      const by = Model.parseSender(payload.by);
      if (event === undefined || by === undefined) {
        return { ok: false, status: 400, error: "not a well-formed event or sender" };
      }
      if (!Model.enabled(state, event, by)) {
        return { ok: false, status: 409, error: `${event.type} is not allowed in phase ${state.phase}` };
      }
      state = Model.step(state, event, by).state;
      this.persist(state, done, receipts);
      return { ok: true, state: toPublicState(state, done), refused };
    }

    if (typeof payload.saveCard === "string" && payload.saveCard.length > 0) {
      const saveEvent: Model.Event = { type: "saveCard", card: payload.saveCard };
      if (!Model.enabled(state, saveEvent, "Person")) {
        return { ok: false, status: 409, error: "saveCard is not allowed right now" };
      }
      state = Model.step(state, saveEvent, "Person").state;
    }

    const page: Model.Page = isPage(payload.page) ? payload.page : state.page;
    const bills = Array.isArray(payload.bills)
      ? payload.bills.filter((n): n is number => typeof n === "number" && Number.isSafeInteger(n))
      : [];
    const choices = Array.isArray(payload.choices) ? [...payload.choices] : [];

    if (payload.said !== undefined) {
      if (!isSaid(payload.said)) {
        return { ok: false, status: 400, error: "said must be begin, confirm, decline, or restart" };
      }
      state = this.deliverPending(state, page, done, receipts);
      state = this.observeWorld(state, page, bills);
      const personEvent: Model.Event = { type: payload.said };
      if (!Model.enabled(state, personEvent, "Person")) {
        this.persist(state, done, receipts);
        return {
          ok: false,
          status: 409,
          error: `${payload.said} is not allowed in phase ${state.phase}`,
        };
      }
      state = Model.step(state, personEvent, "Person").state;
      state = this.deliverPending(state, page, done, receipts);

      while (state.phase === "Planning") {
        const nextChoice = choices.shift();
        const parsed = Model.parseEvent({ type: "choose", choice: nextChoice });
        if (parsed !== undefined && Model.enabled(state, parsed, "Agent")) {
          state = Model.step(state, parsed, "Agent").state;
        } else {
          refused.push(String(nextChoice ?? "missing"));
          if (Model.enabled(state, { type: "choose", choice: "Finish" }, "Agent")) {
            state = Model.step(state, { type: "choose", choice: "Finish" }, "Agent").state;
          } else {
            break;
          }
        }
        state = this.deliverPending(state, page, done, receipts);
        state = this.observeWorld(state, page, bills);
      }
    }

    this.persist(state, done, receipts);
    return { ok: true, state: toPublicState(state, done), refused };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(inspectorHtml, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true, example: "assistant" });
    }
    const session = url.searchParams.get("session") ?? "default";
    const stub = env.ASSISTANT.getByName(session);
    if (request.method === "GET" && url.pathname === "/api/state") {
      return jsonResponse(await stub.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/hear") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
      }
      const result = await stub.hear(body);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.error }, result.status);
      }
      return jsonResponse(result);
    }
    return jsonResponse({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<AssistantWorkerEnv>;
