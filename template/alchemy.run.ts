import fs from "node:fs";
import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { makeBucketState } from "alchemy/State/BucketState";
import { State, StateStoreError } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import {
  assertStageGuard,
  hashAssetDirectory,
  makeR2BucketObjects,
  resolveStage,
  verifyDeploymentEndpoints,
} from "vibestack/alchemy";

const appDir = path.resolve(import.meta.dirname, "apps/app");
const distDir = path.join(appDir, "dist");

function resolveStateLayer() {
  if (process.env.ALCHEMY_STATE_STORE === "cloudflare") {
    return Cloudflare.state({
      ...(process.env.CLOUDFLARE_ACCOUNT_ID ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID } : {}),
    });
  }
  const bucket = process.env.R2_STATE_BUCKET;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_STATE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_STATE_SECRET_ACCESS_KEY;
  if (bucket && accountId && accessKeyId && secretAccessKey) {
    const objects = makeR2BucketObjects<StateStoreError>(
      { kind: "s3", accountId, bucket, accessKeyId, secretAccessKey },
      {
        tryPromise: Effect.tryPromise,
        makeError: ({ message, cause, status }) =>
          new StateStoreError({
            message,
            ...(cause ? { cause } : {}),
            ...(status !== undefined ? { http: { status } } : {}),
          }),
      },
    );
    return Layer.effect(
      State,
      Effect.gen(function* () {
        const context = yield* Effect.context();
        const scope = yield* Effect.scope;
        const make = makeBucketState({
          id: "r2",
          label: "Cloudflare R2",
          prefix: process.env.R2_STATE_PREFIX ?? "alchemy/",
          objects: Effect.succeed(objects),
        }).pipe(Scope.provide(scope), Effect.provideContext(context));
        return yield* Effect.cached(make);
      }),
    );
  }
  return Alchemy.localState();
}

const VerifyApp = Alchemy.Action(
  "VerifyApp",
  (input: { readonly url: string | undefined; readonly assetHash: string }) =>
    Effect.tryPromise(async () => {
      if (!input.url) throw new Error("Deployed worker did not return a URL");
      return verifyDeploymentEndpoints(
        input.url,
        [{ path: "/", expectedStatus: 200, bodyIncludes: ['id="root"'] }],
        { assetHash: input.assetHash },
      );
    }),
);

export default Alchemy.Stack(
  "VibestackApp",
  {
    providers: Cloudflare.providers(),
    state: resolveStateLayer(),
  },
  Effect.gen(function* () {
    const stageName = yield* Alchemy.Stage;
    const stageTarget = resolveStage({ stage: stageName, cwd: import.meta.dirname });
    const customDomain = stageTarget.kind === "production" ? process.env.APP_DOMAIN : undefined;
    assertStageGuard(stageTarget, {
      domains: customDomain ? [customDomain] : [],
      productionDomains: process.env.APP_DOMAIN ? [process.env.APP_DOMAIN] : [],
    });

    const usePrebuilt = (process.env.CI === "true" || process.env.VIBESTACK_PREBUILT === "1")
      && fs.existsSync(path.join(distDir, "index.html"));

    if (usePrebuilt) {
      const assets = hashAssetDirectory(distDir);
      const app = yield* Cloudflare.Worker("App", {
        assets: {
          directory: assets.directory,
          hash: assets.hash,
          notFoundHandling: "single-page-application",
        },
        workersDev: true,
        ...(customDomain ? { domain: customDomain } : {}),
      }).pipe(Alchemy.AdoptPolicy.adopt(true));
      const receipt = yield* VerifyApp({ url: app.url, assetHash: assets.hash });
      return { url: app.url, stage: stageTarget.stage, receipt };
    }

    const app = yield* Cloudflare.Website.Vite("App", {
      rootDir: appDir,
      assets: { notFoundHandling: "single-page-application" },
      workersDev: true,
      ...(customDomain ? { domain: customDomain } : {}),
    }).pipe(Alchemy.AdoptPolicy.adopt(true));
    const receipt = yield* VerifyApp({ url: app.url, assetHash: stageTarget.stage });
    return { url: app.url, stage: stageTarget.stage, receipt };
  }),
);
