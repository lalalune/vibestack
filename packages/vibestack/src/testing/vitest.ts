import fs from "node:fs";
import path from "node:path";
import vibelang from "vibelang-vite";
import { defineConfig } from "vitest/config";
import type { Reporter } from "vitest/node";
import type { PluginOption } from "vite";
import { testInputs, testReceipt, writeWhole } from "../util.ts";

export interface Project {
  root: string;
  tests?: string[];
  plugins?: PluginOption[];
}

const GENERATED = ".cache/generated/tests";
const TESTS = ["test/**/*.test.{ts,tsx,vibe}", "generated/stories/stories.test.tsx"];
const BROWSER = ["test/**/*.browser.test.{ts,tsx,vibe}", "generated/stories/stories.browser.test.tsx"];

function wantsBrowserProject(argv: readonly string[]): boolean {
  if (!argv.some((arg) => /vitest/i.test(arg))) return true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--browser" || arg.startsWith("--browser=") || arg.startsWith("--browser.")) return true;
    if (arg === "--project" || arg === "-p") {
      const value = argv[++i];
      if (value && value !== "node" && value !== "!browser") return true;
    } else if (arg.startsWith("--project=") || arg.startsWith("-p=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      if (value && value !== "node" && value !== "!browser") return true;
    }
  }
  return false;
}

export const project = ({ root, tests = TESTS, plugins = [] }: Project): ReturnType<typeof defineConfig> =>
  defineConfig(async ({ mode }) => {
    const browser = wantsBrowserProject(process.argv) && fs.globSync(BROWSER, { cwd: root }).length > 0;
    const selected = mode === "nightly" ? "nightly" : "normal", receipt = testReceipt(root, selected);
    let fingerprint: string | undefined, complete = false;
    let vitestCtx: { filenamePattern?: readonly string[] } | undefined;
    const scheduled = new Set<string>();
    const record: Reporter = {
      onInit(ctx) {
        const config = ctx.config as typeof ctx.config & { _cliFilters?: readonly string[]; standalone?: boolean };
        vitestCtx = ctx as typeof ctx & { filenamePattern?: readonly string[] };
        if ((mode !== "test" && mode !== "nightly") || config.project.some((name) => name !== "node" && name !== "!browser")) return;
        fs.rmSync(receipt, { force: true });
        if (config.allowOnly || config.watch || config.standalone || config.filters?.length || config._cliFilters?.length || vitestCtx.filenamePattern?.length
          || config.testNamePattern || config.related?.length || config.changed || config.shard || config.cliExclude?.length || config.tagsFilter?.length) return;
        fingerprint = testInputs(root, selected);
      },
      onTestRunStart(specifications) {
        scheduled.clear();
        complete = fingerprint !== undefined && !vitestCtx?.filenamePattern?.length && specifications.every((specification) => specification.project.name === "node"
          && !specification.testLines && !specification.testNamePattern && !specification.testIds && !specification.testTagsFilter);
        for (const specification of specifications) scheduled.add(specification.moduleId);
      },
      onTestRunEnd(modules, errors, reason) {
        if (!complete || reason !== "passed" || errors.length || modules.length !== scheduled.size
          || modules.some((module) => !module.ok() || !scheduled.has(module.moduleId)) || fingerprint !== testInputs(root, selected)) return;
        writeWhole(receipt, JSON.stringify({ fingerprint }));
      },
    };
    const generatedTests = {
      name: "vibestack-generated-tests",
      async configureVitest() {
        if (fs.existsSync(path.join(root, GENERATED)) || fs.globSync("src/**/*.{schema,contract}.{ts,vibe}", { cwd: root }).some((file) => !/(?:^|\/)test\/fixtures?\//.test(file.split(path.sep).join("/"))))
          await (await import("./generate.ts")).main(root);
      },
    };
    return {
      root,
      plugins: [vibelang(), ...plugins],
      resolve: { dedupe: ["vitest"] },
      test: {
        server: { deps: { inline: ["@effect/vitest"] } },
        reporters: ["default", record],
        allowOnly: false,
        passWithNoTests: true,
        attachmentsDir: ".cache/vitest/attachments",
        fsModuleCachePath: ".cache/vitest/modules",
        project: ["!browser"],
        sequence: { shuffle: false, seed: 1 },
        retry: 0,
        maxConcurrency: 3,
        testTimeout: 60_000,
        hookTimeout: 60_000,
        projects: [
          {
            extends: true,
            plugins: [generatedTests],
            test: { name: "node", include: [...tests, `${GENERATED}/**/*.test.ts`], exclude: ["**/node_modules/**", ...BROWSER], environment: "node" },
          },
          ...browser ? [{
            extends: true,
            test: {
              name: "browser",
              include: BROWSER,
              fileParallelism: false,
              browser: {
                enabled: true, provider: (await import("@vitest/browser-playwright")).playwright(), headless: true,
                instances: [{ browser: "chromium" as const }], screenshotFailures: true, trace: "retain-on-failure" as const,
              },
            },
          }] : [],
        ],
      },
    };
  });
