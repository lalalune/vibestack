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
  "serves built React SPA assets and health check in local workerd",
  Effect.gen(function* () {
    const { url, verified } = yield* stack;
    expect(verified).toBe(true);
    const spa = yield* HttpClient.get(url);
    expect(spa.status).toBe(200);
    expect(yield* spa.text).toContain("<div id=\"root\">");
    const health = yield* HttpClient.get(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(yield* health.json).toMatchObject({ ok: true, example: "fullstack" });
  }),
);

test(
  "persists todos in SQLite DO, enforces protocol validation, and pushes SSE updates",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const base = url.replace(/\/$/, "");
    const room = `test-${Date.now()}`;
    const eventsUrl = `${base}/api/events?room=${encodeURIComponent(room)}`;
    const snapshotUrl = `${base}/api/snapshot?room=${encodeURIComponent(room)}`;
    const streamUrl = `${base}/api/stream?room=${encodeURIComponent(room)}`;

    const wrongContentType = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.text("plain"),
    });
    expect(wrongContentType.status).toBe(415);

    const malformed = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({ bogus: true }),
    });
    expect(malformed.status).toBe(400);

    const abort = new AbortController();
    const sseResponse = yield* Effect.promise(() => fetch(streamUrl, { signal: abort.signal }));
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    const readFrame = () =>
      Effect.promise(async () => {
        const chunk = await reader!.read();
        return decoder.decode(chunk.value);
      });

    const initialFrame = yield* readFrame();
    expect(initialFrame).toContain("\"version\":0");

    const create = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        type: "request",
        client: "alice",
        seq: 1,
        op: { tag: "Create", id: "item-1", title: "Ship Alchemy" },
      }),
    });
    expect(create.status).toBe(200);
    expect(yield* create.json).toEqual({
      ok: true,
      seq: 1,
      version: 1,
      todos: [{ id: "item-1", title: "Ship Alchemy", done: false, deleted: false }],
    });

    const pushedFrame = yield* readFrame();
    expect(pushedFrame).toContain("\"version\":1");
    expect(pushedFrame).toContain("Ship Alchemy");

    abort.abort();
    yield* Effect.promise(() => reader!.cancel().catch(() => undefined));

    const duplicate = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        type: "request",
        client: "alice",
        seq: 1,
        op: { tag: "Create", id: "item-1", title: "Ship Alchemy" },
      }),
    });
    expect(duplicate.status).toBe(200);
    expect(yield* duplicate.json).toMatchObject({ ok: true, seq: 1, version: 1 });

    const toggle = yield* HttpClient.post(eventsUrl, {
      body: HttpBody.jsonUnsafe({
        type: "request",
        client: "alice",
        seq: 2,
        op: { tag: "SetDone", id: "item-1", done: true },
      }),
    });
    expect(toggle.status).toBe(200);
    expect(yield* toggle.json).toMatchObject({
      ok: true,
      seq: 2,
      version: 2,
      todos: [{ id: "item-1", title: "Ship Alchemy", done: true, deleted: false }],
    });

    const snap = yield* HttpClient.get(snapshotUrl);
    expect(snap.status).toBe(200);
    expect(yield* snap.json).toEqual({
      version: 2,
      todos: [{ id: "item-1", title: "Ship Alchemy", done: true, deleted: false }],
    });
  }),
);
