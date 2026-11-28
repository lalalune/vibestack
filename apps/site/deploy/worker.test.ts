import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { hashAssetDirectory, resolveStage, verifyDeploymentEndpoints } from "vibestack/alchemy";

const distDir = path.resolve(import.meta.dirname, "../dist");
const stage = resolveStage({ mode: "test", cwd: path.resolve(import.meta.dirname, "..") }).stage;

const SiteWorkerdStack = Alchemy.Stack(
  "VibestackSiteWorkerdTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const assets = hashAssetDirectory(distDir);
    const worker = yield* Cloudflare.Worker("Site", {
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

const stack = beforeAll(deploy(SiteWorkerdStack));
afterAll(destroy(SiteWorkerdStack));

test("serves marketing site, SKILL.md, and SPA fallback in local workerd", Effect.gen(function* () {
  const outputs = yield* stack;
  expect(outputs?.url).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):/);
  const url = outputs?.url;
  if (!url) throw new Error("Missing local workerd URL");
  const receipt = yield* Effect.promise(() =>
    verifyDeploymentEndpoints(
      url,
      [
        { path: "/", expectedStatus: 200, bodyIncludes: ["Vibestack"] },
        { path: "/SKILL.md", expectedStatus: 200, bodyIncludes: ["Vibestack"] },
        { path: "/unknown-spa-route", expectedStatus: 200, bodyIncludes: ["Vibestack"] },
      ],
      { assetHash: outputs.assetHash },
    ),
  );
  expect(receipt.ok).toBe(true);
  expect(receipt.probes).toHaveLength(3);
}));
