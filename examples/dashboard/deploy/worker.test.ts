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
    expect(yield* page.text).toContain("Vibestack Dashboard Example");
    const health = yield* HttpClient.get(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(yield* health.json).toEqual({ ok: true, example: "dashboard" });
  }),
);

test(
  "persists tracker and project transitions with at-most-once notify dedupe",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const base = url.replace(/\/$/, "");
    const room = `test-${Date.now()}`;
    const eventsUrl = `${base}/api/events?room=${encodeURIComponent(room)}`;

    const connect1 = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        target: "projects",
        event: { type: "connect", key: "alpha", sheet: "sheet-1", channel: "#alpha" },
      }),
    });
    expect(connect1.status).toBe(200);

    const conflict = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        target: "projects",
        event: { type: "connect", key: "beta", sheet: "sheet-2", channel: "#alpha" },
      }),
    });
    expect(conflict.status).toBe(409);

    const create = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({ event: { type: "create" }, by: "ana" }),
    });
    expect(create.status).toBe(200);

    const assign = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        event: { type: "addOwner", id: 1, owner: "ben" },
        by: "ana",
      }),
    });
    expect(assign.status).toBe(200);

    const status = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        event: { type: "setStatus", id: 1, status: "Doing" },
        by: "ana",
      }),
    });
    expect(status.status).toBe(200);

    for (let i = 0; i < 3; i += 1) {
      const tick = yield* HttpClient.post(eventsUrl, {
        body: HttpBody.jsonUnsafe({ event: { type: "tick" }, by: "clock" }),
      });
      expect(tick.status).toBe(200);
    }

    const first = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({ event: { type: "notify" }, by: "notifier" }),
    });
    expect(first.status).toBe(200);
    const firstJson = (yield* first.json) as { readonly out: readonly { readonly to: string }[] };
    expect(firstJson.out.length).toBeGreaterThan(0);
    expect(firstJson.out.every((note) => note.to !== "ana")).toBe(true);

    const second = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({ event: { type: "notify" }, by: "notifier" }),
    });
    expect(second.status).toBe(200);
    const secondJson = (yield* second.json) as { readonly out: readonly unknown[] };
    expect(secondJson.out).toEqual([]);

    const stateRes = yield* HttpClient.get(`${base}/api/state?room=${encodeURIComponent(room)}`);
    expect(stateRes.status).toBe(200);
    const stateJson = (yield* stateRes.json) as {
      readonly tracker: { readonly tasks: readonly { readonly id: number; readonly status: string }[] };
      readonly projects: { readonly entries: readonly { readonly key: string }[] };
    };
    expect(stateJson.tracker.tasks).toHaveLength(1);
    expect(stateJson.tracker.tasks[0]?.status).toBe("Doing");
    expect(stateJson.projects.entries.map((entry) => entry.key)).toEqual(["alpha"]);
  }),
);
