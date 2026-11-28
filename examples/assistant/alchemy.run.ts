import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as Schedule from "effect/Schedule";
import { maxActions } from "./gen/assistant.ts";
import type { AssistantDO } from "./deploy/worker.ts";

const resolveState = () =>
  process.env.ALCHEMY_STATE_STORE === "cloudflare"
    ? Cloudflare.state({
        ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      })
    : Alchemy.localState();

const AssistantWorker = Cloudflare.Worker("AssistantWorker", {
  main: "./deploy/worker.ts",
  workersDev: true,
  env: {
    ASSISTANT: Cloudflare.DurableObject<AssistantDO>("AssistantDO", {
      className: "AssistantDO",
    }),
  },
});

export type AssistantWorkerEnv = Cloudflare.InferEnv<typeof AssistantWorker>;

const requestTextAndJson = (url: string, method: "GET" | "POST", body?: unknown) =>
  Effect.gen(function* () {
    const response =
      method === "GET"
        ? yield* HttpClient.get(url)
        : yield* HttpClient.post(url, { body: HttpBody.jsonUnsafe(body) });
    const text = yield* response.text;
    return { status: response.status, text, data: JSON.parse(text) as unknown };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const VerifyAssistantDeploy = Alchemy.Action(
  "VerifyAssistantDeploy",
  (input: { url: string; workerName: string }) =>
    Effect.gen(function* () {
      const base = input.url.replace(/\/$/, "");
      const health = yield* requestTextAndJson(`${base}/api/health`, "GET").pipe(
        Effect.filterOrFail(
          (res) => res.status === 200,
          (res) => new Error(`health returned ${res.status}`),
        ),
        Effect.retry({
          schedule: Schedule.exponential("250 millis"),
          times: 12,
        }),
      );
      const secret = "4242-SECRET-CARD-9999";
      const session = `smoke-${Date.now()}`;
      const hear = yield* requestTextAndJson(
        `${base}/api/hear?session=${encodeURIComponent(session)}`,
        "POST",
        {
          saveCard: secret,
          said: "begin",
          page: "Genuine",
          bills: [42],
          choices: ["Lookup", "Review", "Speak", "Speak", "Speak", "Speak"],
        },
      );
      const stateRes = yield* requestTextAndJson(
        `${base}/api/state?session=${encodeURIComponent(session)}`,
        "GET",
      );
      if (hear.text.includes(secret) || stateRes.text.includes(secret)) {
        return yield* Effect.fail(new Error("secret card leaked in HTTP response"));
      }
      const stateBody = stateRes.data as {
        readonly budget?: number;
        readonly phase?: string;
        readonly cardSaved?: boolean;
      };
      if (
        hear.status !== 200 ||
        stateRes.status !== 200 ||
        stateBody.cardSaved !== true ||
        typeof stateBody.budget !== "number" ||
        stateBody.budget < 0 ||
        stateBody.budget > maxActions ||
        stateBody.phase === "Planning"
      ) {
        return yield* Effect.fail(new Error(`unexpected assistant state: ${stateRes.text}`));
      }
      return {
        verified: true,
        healthStatus: health.status,
        budgetRemaining: stateBody.budget,
        phase: stateBody.phase,
      };
    }),
);

export default Alchemy.Stack(
  "VibestackAssistantExample",
  {
    providers: Cloudflare.providers(),
    state: resolveState(),
  },
  Effect.gen(function* () {
    const worker = yield* AssistantWorker.pipe(Alchemy.AdoptPolicy.adopt(true));
    const verification = yield* VerifyAssistantDeploy({
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
