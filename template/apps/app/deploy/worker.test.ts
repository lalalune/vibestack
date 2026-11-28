import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { hashAssetDirectory, resolveStage, verifyDeploymentEndpoints } from "vibestack/alchemy";

const distDir = path.resolve(import.meta.dirname, "../dist");
const stage = resolveStage({ mode: "test", cwd: path.resolve(import.meta.dirname, "..") }).stage;

const AppStack = Alchemy.Stack(
  "TemplateAppWorkerdTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const assets = hashAssetDirectory(distDir);
    const worker = yield* Cloudflare.Worker("App", {
      assets: {
        directory: assets.directory,
        hash: assets.hash,
        notFoundHandling: "single-page-application",
      },
      workersDev: true,
    });
    return { url: worker.url, assetHash: assets.hash };
  }),
);

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage,
});

const stack = beforeAll(deploy(AppStack));
afterAll(destroy(AppStack));

test("serves built SPA and falls back to index.html inside local workerd", Effect.gen(function* () {
  const outputs = yield* stack;
  expect(outputs?.url).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):/);
  const url = outputs?.url;
  if (!url) throw new Error("Missing local workerd URL");
  const receipt = yield* Effect.promise(() =>
    verifyDeploymentEndpoints(
      url,
      [
        { path: "/", expectedStatus: 200, bodyIncludes: ['id="root"'] },
        { path: "/deep-link/greeting", expectedStatus: 200, bodyIncludes: ['id="root"'] },
      ],
      { assetHash: outputs.assetHash },
    ),
  );
  expect(receipt.ok).toBe(true);
  expect(receipt.probes).toHaveLength(2);
}));
