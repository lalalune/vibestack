import { DurableObject } from "cloudflare:workers";
import {
  type Event,
  type Server,
  acceptedAs,
  enabled,
  initial,
  parseEvent,
  parseState,
  step,
} from "../gen/server.ts";
import type { Todo } from "../gen/todo.ts";
import type { FullstackWorkerEnv } from "../alchemy.run.ts";

interface Snapshot {
  readonly version: number;
  readonly todos: readonly Todo[];
}

interface Answer {
  readonly ok: boolean;
  readonly seq: number;
  readonly version: number;
  readonly todos: readonly Todo[];
}

const MAX_EVENT_BODY_BYTES = 65_536;
const encoder = new TextEncoder();

const noStoreHeaders = {
  "cache-control": "no-store",
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  ...noStoreHeaders,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const snapshotOf = (state: Server): Snapshot => ({
  version: state.version,
  todos: state.todos,
});

const sseFrame = (snapshot: Snapshot): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`);

export class TodoRoom extends DurableObject {
  private readonly subscribers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  private readState(): Server {
    const raw = this.ctx.storage.kv.get<unknown>("server");
    return parseState(raw) ?? initial;
  }

  private broadcast(snapshot: Snapshot): void {
    const frame = sseFrame(snapshot);
    for (const writer of this.subscribers) {
      void writer.write(frame).catch(() => {
        this.subscribers.delete(writer);
      });
    }
  }

  private handleEvent(event: Event): Answer {
    const current = this.readState();
    const next = enabled(current, event) ? step(current, event) : current;
    if (next !== current) {
      this.ctx.storage.kv.put("server", next);
    }
    const snap = snapshotOf(next);
    if (next.version !== current.version) {
      this.broadcast(snap);
    }
    return {
      ok: acceptedAs(next, event.client, event.seq, event.op),
      seq: event.seq,
      version: snap.version,
      todos: snap.todos,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      const state = this.readState();
      return jsonResponse({ ok: true, example: "fullstack", version: state.version });
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      return jsonResponse(snapshotOf(this.readState()));
    }
    if (request.method === "GET" && url.pathname === "/api/stream") {
      const initialSnap = snapshotOf(this.readState());
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      this.subscribers.add(writer);
      void writer.write(sseFrame(initialSnap)).catch(() => {
        this.subscribers.delete(writer);
      });
      request.signal.addEventListener("abort", () => {
        this.subscribers.delete(writer);
        void writer.close().catch(() => undefined);
      });
      return new Response(readable, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/events") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("application/json")) {
        return jsonResponse({ error: "send application/json" }, 415);
      }
      const rawText = await request.text();
      if (encoder.encode(rawText).byteLength > MAX_EVENT_BODY_BYTES) {
        return jsonResponse({ error: "not a well-formed request" }, 400);
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        return jsonResponse({ error: "not a well-formed request" }, 400);
      }
      const event = parseEvent(parsedJson);
      if (event === undefined) {
        return jsonResponse({ error: "not a well-formed request" }, 400);
      }
      return jsonResponse(this.handleEvent(event));
    }
    return jsonResponse({ error: "not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname === "/api/health" ||
      url.pathname === "/api/snapshot" ||
      url.pathname === "/api/events" ||
      url.pathname === "/api/stream"
    ) {
      const room = url.searchParams.get("room") ?? "default";
      const stub = env.ROOM.getByName(room);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<FullstackWorkerEnv>;
