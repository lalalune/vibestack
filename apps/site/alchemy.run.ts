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

const distDir = path.resolve(import.meta.dirname, "dist");

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
          prefix: process.env.R2_STATE_PREFIX ?? "alchemy/vibestack-site/",
          objects: Effect.succeed(objects),
        }).pipe(Scope.provide(scope), Effect.provideContext(context));
        return yield* Effect.cached(make);
      }),
    );
  }
  return Alchemy.localState();
}

const VerifySite = Alchemy.Action(
  "VerifySite",
  (input: { readonly url: string | undefined; readonly assetHash: string }) =>
    Effect.tryPromise(async () => {
      if (!input.url) throw new Error("Deployed site worker did not return a URL");
      return verifyDeploymentEndpoints(
        input.url,
        [
          { path: "/", expectedStatus: 200, bodyIncludes: ["Vibestack"] },
          { path: "/SKILL.md", expectedStatus: 200, bodyIncludes: ["Vibestack"] },
        ],
        { assetHash: input.assetHash },
      );
    }),
);

export default Alchemy.Stack(
  "VibestackSite",
  {
    providers: Cloudflare.providers(),
    state: resolveStateLayer(),
  },
  Effect.gen(function* () {
    const stageName = yield* Alchemy.Stage;
    const stageTarget = resolveStage({ stage: stageName, cwd: import.meta.dirname });
    const configuredDomain = process.env.SITE_DOMAIN?.trim();
    const bindDomain = stageTarget.kind === "production" && configuredDomain ? configuredDomain : undefined;

    assertStageGuard(stageTarget, {
      domains: bindDomain ? [bindDomain] : [],
      productionDomains: ["vibestack.fun", "www.vibestack.fun"],
    });

    const assets = hashAssetDirectory(distDir);
    const site = yield* Cloudflare.Worker("Site", {
      assets: {
        directory: assets.directory,
        hash: assets.hash,
        notFoundHandling: "single-page-application",
      },
      workersDev: true,
      ...(bindDomain ? { domain: bindDomain } : {}),
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    const receipt = yield* VerifySite({ url: site.url, assetHash: assets.hash });
    return { url: site.url, stage: stageTarget.stage, assetHash: assets.hash, receipt };
  }),
);
