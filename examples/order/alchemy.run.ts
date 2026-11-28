import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as Schedule from "effect/Schedule";
import type { OrderBookDO } from "./deploy/worker.ts";

const resolveState = () =>
  process.env.ALCHEMY_STATE_STORE === "cloudflare"
    ? Cloudflare.state({
        ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
      })
    : Alchemy.localState();

const OrderWorker = Cloudflare.Worker("OrderWorker", {
  main: "./deploy/worker.ts",
  workersDev: true,
  env: {
    ORDER_BOOK: Cloudflare.DurableObject<OrderBookDO>("OrderBookDO", {
      className: "OrderBookDO",
    }),
  },
});

export type OrderWorkerEnv = Cloudflare.InferEnv<typeof OrderWorker>;

const requestJson = (
  url: string,
  method: "GET" | "POST",
  body?: unknown,
) =>
  Effect.gen(function* () {
    const response =
      method === "GET"
        ? yield* HttpClient.get(url)
        : yield* HttpClient.post(url, {
            body: HttpBody.jsonUnsafe(body),
          });
    const data = yield* response.json;
    return { status: response.status, data };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const VerifyOrderDeploy = Alchemy.Action(
  "VerifyOrderDeploy",
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
      const orderId = `smoke-${Date.now()}`;
      const added = yield* requestJson(`${base}/api/orders/${orderId}/events`, "POST", {
        event: { type: "addItem", qty: 2 },
        by: "Shopper",
      });
      if (added.status !== 200) {
        return yield* Effect.fail(new Error(`addItem failed with ${added.status}`));
      }
      const submitted = yield* requestJson(`${base}/api/orders/${orderId}/events`, "POST", {
        event: { type: "submit" },
        by: "Shopper",
      });
      if (submitted.status !== 200) {
        return yield* Effect.fail(new Error(`submit failed with ${submitted.status}`));
      }
      const overpaid = yield* requestJson(`${base}/api/orders/${orderId}/events`, "POST", {
        event: { type: "pay", amount: 15 },
        by: "Shopper",
      });
      if (overpaid.status !== 409) {
        return yield* Effect.fail(new Error(`expected overpayment rejection 409, got ${overpaid.status}`));
      }
      const paid = yield* requestJson(`${base}/api/orders/${orderId}/events`, "POST", {
        event: { type: "pay", amount: 10 },
        by: "Shopper",
      });
      const paidBody = paid.data as {
        readonly ok?: boolean;
        readonly balance?: number;
        readonly order?: { readonly status?: string };
      };
      if (paid.status !== 200 || paidBody.order?.status !== "Paid" || paidBody.balance !== 0) {
        return yield* Effect.fail(new Error(`expected Paid with balance 0, got ${JSON.stringify(paidBody)}`));
      }
      return {
        verified: true,
        healthStatus: health.status,
        orderId,
        finalStatus: paidBody.order.status,
        finalBalance: paidBody.balance,
      };
    }),
);

export default Alchemy.Stack(
  "VibestackOrderExample",
  {
    providers: Cloudflare.providers(),
    state: resolveState(),
  },
  Effect.gen(function* () {
    const worker = yield* OrderWorker.pipe(Alchemy.AdoptPolicy.adopt(true));
    const verification = yield* VerifyOrderDeploy({
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
