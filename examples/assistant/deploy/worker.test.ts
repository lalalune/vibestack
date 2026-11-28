import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import Stack from "../alchemy.run.ts";
import { maxActions } from "../gen/assistant.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const stack = beforeAll(deploy(Stack));
afterAll(destroy(Stack));

test(
  "serves inspector page and health check in local workerd",
  Effect.gen(function* () {
    const { url, verified } = yield* stack;
    expect(verified).toBe(true);
    const page = yield* HttpClient.get(url);
    expect(page.status).toBe(200);
    expect(yield* page.text).toContain("Vibestack Assistant Example");
    const health = yield* HttpClient.get(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(yield* health.json).toEqual({ ok: true, example: "assistant" });
  }),
);

test(
  "enforces bounded budget, secret non-leakage, and genuine-page payment confirmation in SQLite DO",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const base = url.replace(/\/$/, "");
    const session = `test-${Date.now()}`;
    const secretCard = "4111-SECRET-DO-NOT-LEAK";

    const turn1 = yield* HttpClient.post(`${base}/api/hear?session=${encodeURIComponent(session)}`, {
      body: HttpBody.jsonUnsafe({
        saveCard: secretCard,
        said: "begin",
        page: "Lookalike",
        bills: [75],
        choices: ["Lookup", "Review", "Fill", "Finish"],
      }),
    });
    expect(turn1.status).toBe(200);
    const turn1Text = yield* turn1.text;
    expect(turn1Text).not.toContain(secretCard);
    const turn1Body = JSON.parse(turn1Text) as {
      readonly ok: boolean;
      readonly state: {
        readonly phase: string;
        readonly budget: number;
        readonly cardSaved: boolean;
        readonly bill: { readonly amount: number; readonly reviewed: boolean; readonly paid: boolean };
        readonly done: readonly { readonly tag: string }[];
      };
    };
    expect(turn1Body.ok).toBe(true);
    expect(turn1Body.state.cardSaved).toBe(true);
    expect(turn1Body.state.budget).toBeGreaterThanOrEqual(0);
    expect(turn1Body.state.budget).toBeLessThanOrEqual(maxActions);
    expect(turn1Body.state.bill.reviewed).toBe(true);
    expect(turn1Body.state.bill.paid).toBe(false);
    expect(turn1Body.state.done.some((entry) => entry.tag === "Filled")).toBe(false);

    const turn2 = yield* HttpClient.post(`${base}/api/hear?session=${encodeURIComponent(session)}`, {
      body: HttpBody.jsonUnsafe({
        said: "begin",
        page: "Genuine",
        choices: ["Fill", "Pay"],
      }),
    });
    expect(turn2.status).toBe(200);
    const turn2Text = yield* turn2.text;
    expect(turn2Text).not.toContain(secretCard);
    const turn2Body = JSON.parse(turn2Text) as {
      readonly state: { readonly phase: string };
    };
    expect(turn2Body.state.phase).toBe("Asking");

    const confirm = yield* HttpClient.post(
      `${base}/api/hear?session=${encodeURIComponent(session)}`,
      {
        body: HttpBody.jsonUnsafe({
          said: "confirm",
          page: "Genuine",
          choices: ["Finish"],
        }),
      },
    );
    expect(confirm.status).toBe(200);
    const confirmText = yield* confirm.text;
    expect(confirmText).not.toContain(secretCard);

    const persisted = yield* HttpClient.get(
      `${base}/api/state?session=${encodeURIComponent(session)}`,
    );
    expect(persisted.status).toBe(200);
    const persistedText = yield* persisted.text;
    expect(persistedText).not.toContain(secretCard);
    const persistedBody = JSON.parse(persistedText) as {
      readonly bill: { readonly paid: boolean; readonly amount: number };
      readonly charged: number;
      readonly delivered: number;
      readonly done: readonly { readonly tag: string }[];
    };
    expect(persistedBody.bill.paid).toBe(true);
    expect(persistedBody.bill.amount).toBe(75);
    expect(persistedBody.charged).toBe(1);
    expect(persistedBody.delivered).toBeGreaterThanOrEqual(2);
    expect(persistedBody.done.some((entry) => entry.tag === "Submitted")).toBe(true);
  }),
);
