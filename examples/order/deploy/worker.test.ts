import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import Stack from "../alchemy.run.ts";

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
    expect(yield* page.text).toContain("Vibestack Order Example");
    const health = yield* HttpClient.get(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(yield* health.json).toEqual({ ok: true, example: "order" });
  }),
);

test(
  "persists verified order transitions and rejects overpayment in SQLite DO",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const base = url.replace(/\/$/, "");
    const id = `order-${Date.now()}`;

    const send = (event: unknown, by: string) =>
      HttpClient.post(`${base}/api/orders/${id}/events`, {
        body: HttpBody.jsonUnsafe({ event, by }),
      });

    const add = yield* send({ type: "addItem", qty: 3 }, "Shopper");
    expect(add.status).toBe(200);
    expect(yield* add.json).toMatchObject({
      ok: true,
      order: { status: "Draft", units: 3, due: 15, paid: 0 },
      balance: 15,
    });

    const submit = yield* send({ type: "submit" }, "Shopper");
    expect(submit.status).toBe(200);

    const hold = yield* send({ type: "hold" }, "Staff");
    expect(hold.status).toBe(200);
    expect(yield* hold.json).toMatchObject({
      ok: true,
      order: { status: "OnHold", units: 3, due: 15, paid: 0 },
      balance: 15,
    });

    const payWhileHeld = yield* send({ type: "pay", amount: 5 }, "Shopper");
    expect(payWhileHeld.status).toBe(409);

    const release = yield* send({ type: "release" }, "Staff");
    expect(release.status).toBe(200);

    const overpay = yield* send({ type: "pay", amount: 20 }, "Shopper");
    expect(overpay.status).toBe(409);

    const payFull = yield* send({ type: "pay", amount: 15 }, "Shopper");
    expect(payFull.status).toBe(200);
    expect(yield* payFull.json).toMatchObject({
      ok: true,
      order: { status: "Paid", units: 3, due: 15, paid: 15 },
      balance: 0,
    });

    const persisted = yield* HttpClient.get(`${base}/api/orders/${id}`);
    expect(persisted.status).toBe(200);
    expect(yield* persisted.json).toMatchObject({
      id,
      order: { status: "Paid", units: 3, due: 15, paid: 15 },
      balance: 0,
    });
  }),
);
