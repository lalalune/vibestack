import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as Schedule from "effect/Schedule";
import { hashAssetDirectory } from "vibestack/alchemy";
import type { TodoRoom } from "./deploy/worker.ts";

const resolveState = () =>
  process.env.ALCHEMY_STATE_STORE === "cloudflare"
    ? Cloudflare.state({
        ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      })
    : Alchemy.localState();

const webAssets = hashAssetDirectory(path.resolve(import.meta.dirname, "dist/web"));

const FullstackWorker = Cloudflare.Worker("FullstackTodoWorker", {
  main: "./deploy/worker.ts",
  workersDev: true,
  assets: {
    directory: webAssets.directory,
    hash: webAssets.hash,
    notFoundHandling: "single-page-application",
    runWorkerFirst: ["/api/*"],
  },
  env: {
    ROOM: Cloudflare.DurableObject<TodoRoom>("TodoRoom", {
      className: "TodoRoom",
    }),
  },
});

export type FullstackWorkerEnv = Cloudflare.InferEnv<typeof FullstackWorker>;

const requestJson = (url: string, method: "GET" | "POST", body?: unknown) =>
  Effect.gen(function* () {
    const response =
      method === "GET"
        ? yield* HttpClient.get(url)
        : yield* HttpClient.post(url, { body: HttpBody.jsonUnsafe(body) });
    const data = yield* response.json;
    return { status: response.status, data };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const requestText = (url: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(url);
    return { status: response.status, text: yield* response.text };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const VerifyFullstackDeploy = Alchemy.Action(
  "VerifyFullstackDeploy",
  (input: { url: string; workerName: string }) =>
    Effect.gen(function* () {
      const base = input.url.replace(/\/$/, "");
      const health = yield* requestJson(`${base}/api/health`, "GET").pipe(
        Effect.filterOrFail(
          (res) => res.status === 200,
          (res) => new Error(`health returned ${res.status}`),
        ),
        Effect.retry({
          schedule: Schedule.exponential("250 millis"),
          times: 12,
        }),
      );
      const spa = yield* requestText(`${base}/`);
      if (spa.status !== 200 || !spa.text.includes("<div id=\"root\">")) {
        return yield* Effect.fail(new Error(`SPA root check failed: status=${spa.status}`));
      }
      const room = `smoke-${Date.now()}`;
      const eventsUrl = `${base}/api/events?room=${encodeURIComponent(room)}`;
      const created = yield* requestJson(eventsUrl, "POST", {
        type: "request",
        client: "smoke",
        seq: 1,
        op: { tag: "Create", id: "t1", title: "Verify Alchemy deploy" },
      });
      const createdBody = created.data as { readonly ok?: boolean; readonly version?: number };
      if (created.status !== 200 || createdBody.ok !== true || createdBody.version !== 1) {
        return yield* Effect.fail(new Error(`create todo failed: ${JSON.stringify(createdBody)}`));
      }
      const toggled = yield* requestJson(eventsUrl, "POST", {
        type: "request",
        client: "smoke",
        seq: 2,
        op: { tag: "SetDone", id: "t1", done: true },
      });
      const toggledBody = toggled.data as {
        readonly ok?: boolean;
        readonly version?: number;
        readonly todos?: readonly { readonly id: string; readonly done: boolean }[];
      };
      if (
        toggled.status !== 200 ||
        toggledBody.ok !== true ||
        toggledBody.version !== 2 ||
        toggledBody.todos?.[0]?.done !== true
      ) {
        return yield* Effect.fail(new Error(`toggle todo failed: ${JSON.stringify(toggledBody)}`));
      }
      return {
        verified: true,
        healthStatus: health.status,
        spaStatus: spa.status,
        finalVersion: toggledBody.version,
      };
    }),
);

export default Alchemy.Stack(
  "VibestackFullstackExample",
  {
    providers: Cloudflare.providers(),
    state: resolveState(),
  },
  Effect.gen(function* () {
    const worker = yield* FullstackWorker.pipe(Alchemy.AdoptPolicy.adopt(true));
    const verification = yield* VerifyFullstackDeploy({
      url: worker.url.as<string>(),
      workerName: worker.workerName,
    });
    return {
      url: worker.url.as<string>(),
      workerName: worker.workerName,
      verified: verification.verified,
    };
  }),
);
