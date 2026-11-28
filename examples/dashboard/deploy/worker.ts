import { DurableObject } from "cloudflare:workers";
import * as Projects from "../gen/projects.ts";
import * as TrackerModel from "../gen/tracker.ts";
import type { DashboardWorkerEnv } from "../alchemy.run.ts";

interface DashboardState {
  readonly tracker: TrackerModel.Tracker;
  readonly projects: Projects.Registry;
}

type EventResult =
  | {
      readonly ok: true;
      readonly target: "tracker";
      readonly tracker: TrackerModel.Tracker;
      readonly out: readonly TrackerModel.Note[];
    }
  | {
      readonly ok: true;
      readonly target: "projects";
      readonly projects: Projects.Registry;
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
    <title>Vibestack Dashboard Example</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
      code { font-family: ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <h1>Vibestack Dashboard Example</h1>
    <p>Verified task tracker and project registry running on Cloudflare Workers + SQLite Durable Objects via Alchemy.</p>
    <ul>
      <li><code>GET /api/health</code></li>
      <li><code>GET /api/state</code></li>
      <li><code>POST /api/events</code> with <code>{"event":{"type":"create"},"by":"ana"}</code> or <code>{"target":"projects","event":{"type":"connect","key":"p1","sheet":"s1","channel":"c1"}}</code></li>
    </ul>
  </body>
</html>`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class TrackerDO extends DurableObject {
  private readTracker(): TrackerModel.Tracker {
    const raw = this.ctx.storage.kv.get<unknown>("tracker");
    return TrackerModel.parseState(raw) ?? TrackerModel.initial;
  }

  private readProjects(): Projects.Registry {
    const raw = this.ctx.storage.kv.get<unknown>("projects");
    return Projects.parseState(raw) ?? Projects.initial;
  }

  async getState(): Promise<DashboardState> {
    return {
      tracker: this.readTracker(),
      projects: this.readProjects(),
    };
  }

  async applyEvent(payload: unknown): Promise<EventResult> {
    if (!isRecord(payload)) {
      return { ok: false, status: 400, error: "body must be a JSON object" };
    }
    const target = payload.target === undefined ? "tracker" : payload.target;
    if (target === "projects") {
      const event = Projects.parseEvent(payload.event);
      if (event === undefined) {
        return { ok: false, status: 400, error: "not a well-formed projects event" };
      }
      const current = this.readProjects();
      if (!Projects.enabled(current, event)) {
        return { ok: false, status: 409, error: `${event.type} is not allowed for projects` };
      }
      const next = Projects.step(current, event);
      this.ctx.storage.kv.put("projects", next);
      return { ok: true, target: "projects", projects: next };
    }
    if (target !== "tracker") {
      return { ok: false, status: 400, error: "target must be tracker or projects" };
    }
    const event = TrackerModel.parseEvent(payload.event);
    const by = TrackerModel.parseSender(payload.by);
    if (event === undefined || by === undefined) {
      return { ok: false, status: 400, error: "not a well-formed tracker event or sender" };
    }
    const current = this.readTracker();
    if (!TrackerModel.enabled(current, event, by)) {
      return { ok: false, status: 409, error: `${event.type} is not allowed` };
    }
    const notified = TrackerModel.step(current, event, by);
    this.ctx.storage.kv.put("tracker", notified.state);
    return { ok: true, target: "tracker", tracker: notified.state, out: notified.out };
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
      return jsonResponse({ ok: true, example: "dashboard" });
    }
    const room = url.searchParams.get("room") ?? "default";
    const stub = env.TRACKER.getByName(room);
    if (request.method === "GET" && url.pathname === "/api/state") {
      return jsonResponse(await stub.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/events") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
      }
      const result = await stub.applyEvent(body);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.error }, result.status);
      }
      return jsonResponse(result);
    }
    return jsonResponse({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<DashboardWorkerEnv>;
