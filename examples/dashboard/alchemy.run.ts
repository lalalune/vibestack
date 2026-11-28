import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as Schedule from "effect/Schedule";
import type { TrackerDO } from "./deploy/worker.ts";

const resolveState = () =>
  process.env.ALCHEMY_STATE_STORE === "cloudflare"
    ? Cloudflare.state({
        ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      })
    : Alchemy.localState();

const DashboardWorker = Cloudflare.Worker("DashboardWorker", {
  main: "./deploy/worker.ts",
  workersDev: true,
  env: {
    TRACKER: Cloudflare.DurableObject<TrackerDO>("TrackerDO", {
      className: "TrackerDO",
    }),
  },
});

export type DashboardWorkerEnv = Cloudflare.InferEnv<typeof DashboardWorker>;

const requestJson = (url: string, method: "GET" | "POST", body?: unknown) =>
  Effect.gen(function* () {
    const response =
      method === "GET"
        ? yield* HttpClient.get(url)
        : yield* HttpClient.post(url, { body: HttpBody.jsonUnsafe(body) });
    const data = yield* response.json;
    return { status: response.status, data };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const VerifyDashboardDeploy = Alchemy.Action(
  "VerifyDashboardDeploy",
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
      const room = `smoke-${Date.now()}`;
      const endpoint = `${base}/api/events?room=${encodeURIComponent(room)}`;

      const created = yield* requestJson(endpoint, "POST", {
        event: { type: "create" },
        by: "ana",
      });
      if (created.status !== 200) {
        return yield* Effect.fail(new Error(`create failed with ${created.status}`));
      }
      const assigned = yield* requestJson(endpoint, "POST", {
        event: { type: "addOwner", id: 1, owner: "ben" },
        by: "ana",
      });
      if (assigned.status !== 200) {
        return yield* Effect.fail(new Error(`addOwner failed with ${assigned.status}`));
      }
      for (let i = 0; i < 3; i += 1) {
        const ticked = yield* requestJson(endpoint, "POST", {
          event: { type: "tick" },
          by: "clock",
        });
        if (ticked.status !== 200) {
          return yield* Effect.fail(new Error(`tick failed with ${ticked.status}`));
        }
      }
      const firstNotify = yield* requestJson(endpoint, "POST", {
        event: { type: "notify" },
        by: "notifier",
      });
      const firstBody = firstNotify.data as { readonly out?: readonly unknown[] };
      if (firstNotify.status !== 200 || !Array.isArray(firstBody.out) || firstBody.out.length === 0) {
        return yield* Effect.fail(
          new Error(`expected first notify to emit notes, got ${JSON.stringify(firstBody)}`),
        );
      }
      const secondNotify = yield* requestJson(endpoint, "POST", {
        event: { type: "notify" },
        by: "notifier",
      });
      const secondBody = secondNotify.data as { readonly out?: readonly unknown[] };
      if (secondNotify.status !== 200 || !Array.isArray(secondBody.out) || secondBody.out.length !== 0) {
        return yield* Effect.fail(
          new Error(`expected duplicate notify to emit 0 notes, got ${JSON.stringify(secondBody)}`),
        );
      }
      return {
        verified: true,
        healthStatus: health.status,
        emittedFirst: firstBody.out.length,
        emittedSecond: secondBody.out.length,
      };
    }),
);

export default Alchemy.Stack(
  "VibestackDashboardExample",
  {
    providers: Cloudflare.providers(),
    state: resolveState(),
  },
  Effect.gen(function* () {
    const worker = yield* DashboardWorker.pipe(Alchemy.AdoptPolicy.adopt(true));
    const verification = yield* VerifyDashboardDeploy({
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
