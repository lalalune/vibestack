import { DurableObject } from "cloudflare:workers";
import {
  type Event,
  type Order,
  type Role,
  enabled,
  parseEvent,
  parseSender,
} from "../gen/index.ts";
import { type Sent, balance, replay } from "../src/ledger.ts";
import type { OrderWorkerEnv } from "../alchemy.run.ts";

interface OrderSnapshot {
  readonly id: string;
  readonly order: Order;
  readonly balance: number;
  readonly log: readonly Sent[];
}

type DispatchResult =
  | { readonly ok: true; readonly snapshot: OrderSnapshot }
  | { readonly ok: false; readonly status: 400 | 409; readonly error: string; readonly snapshot?: OrderSnapshot };

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
    <title>Vibestack Order Example</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
      pre { background: #111; color: #eee; padding: 1rem; border-radius: 8px; overflow: auto; }
      code { font-family: ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <h1>Vibestack Order Example</h1>
    <p>Verified order state machine running on Cloudflare Workers + SQLite Durable Objects via Alchemy.</p>
    <ul>
      <li><code>GET /api/health</code></li>
      <li><code>GET /api/orders/:id</code></li>
      <li><code>POST /api/orders/:id/events</code> with <code>{"event":{"type":"addItem","qty":2},"by":"Shopper"}</code></li>
    </ul>
  </body>
</html>`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredLog = (raw: unknown): Sent[] => {
  if (!Array.isArray(raw)) return [];
  const valid: Sent[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const event = parseEvent(item.event);
    const by = parseSender(item.by);
    if (event !== undefined && by !== undefined) valid.push({ event, by });
  }
  return valid;
};

export class OrderBookDO extends DurableObject {
  private readLog(): Sent[] {
    return parseStoredLog(this.ctx.storage.kv.get<unknown>("log"));
  }

  private snapshotOf(id: string, log: readonly Sent[]): OrderSnapshot {
    const order = replay([...log]);
    return { id, order, balance: balance(order), log };
  }

  async getSnapshot(id: string): Promise<OrderSnapshot> {
    return this.snapshotOf(id, this.readLog());
  }

  async dispatch(id: string, payload: unknown): Promise<DispatchResult> {
    if (!isRecord(payload)) {
      return { ok: false, status: 400, error: "body must be a JSON object with event and by" };
    }
    const event: Event | undefined = parseEvent(payload.event);
    const by: Role | undefined = parseSender(payload.by);
    if (event === undefined || by === undefined) {
      return { ok: false, status: 400, error: "not a well-formed event or sender" };
    }
    const log = this.readLog();
    const current = replay(log);
    if (!enabled(current, event, by)) {
      return {
        ok: false,
        status: 409,
        error: `${event.type} is not allowed for a ${current.status} order`,
        snapshot: this.snapshotOf(id, log),
      };
    }
    const nextLog: Sent[] = [...log, { event, by }];
    this.ctx.storage.kv.put("log", nextLog);
    return { ok: true, snapshot: this.snapshotOf(id, nextLog) };
  }
}

const parseOrderPath = (pathname: string): { id: string; events: boolean } | undefined => {
  const match = /^\/api\/orders\/([^/]+)(\/events)?$/.exec(pathname);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  if (id.length === 0) return undefined;
  return { id, events: match[2] === "/events" };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(inspectorHtml, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true, example: "order" });
    }
    const route = parseOrderPath(url.pathname);
    if (!route) {
      return jsonResponse({ error: "not found" }, 404);
    }
    const stub = env.ORDER_BOOK.getByName(route.id);
    if (!route.events && request.method === "GET") {
      return jsonResponse(await stub.getSnapshot(route.id));
    }
    if (route.events && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
      }
      const result = await stub.dispatch(route.id, body);
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error, ...(result.snapshot ?? {}) },
          result.status,
        );
      }
      return jsonResponse({ ok: true, ...result.snapshot });
    }
    return jsonResponse({ error: "method not allowed" }, 405);
  },
} satisfies ExportedHandler<OrderWorkerEnv>;
