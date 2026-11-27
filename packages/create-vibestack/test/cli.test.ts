import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const pkgDir = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(pkgDir, "dist", "cli.js");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "create-vibestack-test-")));
  tempDirs.push(dir);
  return dir;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expectDirectVibestackPin(target: string, expectedSpec: string): void {
  const workspace = fs.readFileSync(path.join(target, "pnpm-workspace.yaml"), "utf8");
  expect(workspace).not.toMatch(/^\s*vibestack:/m);
  for (const rel of ["package.json", "apps/app/package.json", "packages/cli/package.json", "packages/ui/package.json", "packages/design-system/package.json"]) {
    expect(readJson(path.join(target, rel))).toMatchObject({
      devDependencies: { vibestack: expectedSpec },
    });
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("create-vibestack CLI", () => {
  test("scaffolds the starter template with placeholders replaced and restores .gitignore", () => {
    const cwd = makeTempDir();
    const out = execFileSync(
      process.execPath,
      [cliPath, "My Cool App", "--no-install", "--vibestack-version", "0.2.0"],
      { cwd, encoding: "utf8" },
    );
    const target = path.join(cwd, "My Cool App");
    const workspace = fs.readFileSync(path.join(target, "pnpm-workspace.yaml"), "utf8");
    const readme = fs.readFileSync(path.join(target, "README.md"), "utf8");

    expect(readJson(path.join(target, "package.json"))).toMatchObject({
      name: "my-cool-app",
      scripts: { cli: "node packages/cli/src/main.ts" },
      devDependencies: { vibestack: "catalog:" },
    });
    expect(workspace).toContain("vibestack: 0.2.0");
    expect(workspace).toContain("effect: 4.1.1");
    expect(workspace).toContain("vibelang: 0.0.13");
    expect(readJson(path.join(target, "apps/app/package.json"))).toMatchObject({
      dependencies: { effect: "catalog:", "vibelang-runtime": "catalog:" },
      devDependencies: { "@effect/vitest": "catalog:", "@antithesishq/bombadil": "catalog:", vibelang: "catalog:", "vibelang-vite": "catalog:" },
    });
    expect(readJson(path.join(target, "packages/ui/package.json"))).toMatchObject({
      devDependencies: { vibelang: "catalog:" },
    });
    expect(readme).toContain("# my-cool-app");
    expect(readme).not.toContain("my-vibestack-app");
    expect(fs.existsSync(path.join(target, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(target, "_gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(target, "apps/app/.gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(target, "spec/index.md"))).toBe(true);
    expect(fs.existsSync(path.join(target, "packages/cli/src/main.ts"))).toBe(true);
    const cliStatus = execFileSync(process.execPath, [path.join(target, "packages/cli/src/main.ts"), "status", "--json"], {
      cwd: target,
      encoding: "utf8",
    });
    expect(JSON.parse(cliStatus)).toMatchObject({
      ok: true,
      command: "status",
      data: {
        project: "my-cool-app",
        packages: expect.arrayContaining([
          expect.objectContaining({ name: "@repo/app" }),
          expect.objectContaining({ name: "@repo/cli" }),
        ]),
      },
    });
    const cliHelp = execFileSync(process.execPath, [path.join(target, "packages/cli/src/main.ts"), "--help"], {
      cwd: target,
      encoding: "utf8",
    });
    expect(cliHelp).toContain("Usage: pnpm cli <command> [options]");
    expect(out).toContain("pnpm dev");
    expect(out).toContain("pnpm studio");
  });

  test("defaults vibestack dependency to the matching GitHub Release tarball URL", () => {
    const cwd = makeTempDir();
    execFileSync(
      process.execPath,
      [cliPath, "release-app", "--no-install"],
      { cwd, encoding: "utf8" },
    );
    expectDirectVibestackPin(
      path.join(cwd, "release-app"),
      "https://github.com/lalalune/vibestack/releases/download/v0.2.0/vibestack-0.2.0.tgz",
    );
  });

  test("rewrites catalog vibestack refs directly into manifests for file: version specs", () => {
    const cwd = makeTempDir();
    execFileSync(
      process.execPath,
      [cliPath, "local-tarball-app", "--no-install", "--vibestack-version", "./vibestack-0.2.0.tgz"],
      { cwd, encoding: "utf8" },
    );
    expectDirectVibestackPin(
      path.join(cwd, "local-tarball-app"),
      `file:${path.join(cwd, "vibestack-0.2.0.tgz")}`,
    );
  });

  test("writes vibestack.json when --mode is specified", () => {
    const cwd = makeTempDir();
    execFileSync(
      process.execPath,
      [cliPath, "plain-ts-app", "--mode", "typescript", "--no-install"],
      { cwd, encoding: "utf8" },
    );
    expect(readJson(path.join(cwd, "plain-ts-app", "vibestack.json"))).toEqual({ mode: "typescript" });
  });

  test("scaffolds an example from monorepo sibling and pins vibestack version", () => {
    const cwd = makeTempDir();
    execFileSync(
      process.execPath,
      [cliPath, "order-demo", "--example", "order", "--no-install", "--vibestack-version", "./local-vibestack.tgz"],
      { cwd, encoding: "utf8" },
    );
    const target = path.join(cwd, "order-demo");
    expect(readJson(path.join(target, "package.json"))).toMatchObject({
      name: "order-demo",
      devDependencies: { vibestack: `file:${path.join(cwd, "local-vibestack.tgz")}` },
    });
    expect(fs.existsSync(path.join(target, "pnpm-lock.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(target, "spec/index.md"))).toBe(true);
  });

  test("refuses non-empty target directory and unknown options", () => {
    const cwd = makeTempDir();
    const existing = path.join(cwd, "taken");
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, "file.txt"), "occupied\n");

    expect(() => execFileSync(process.execPath, [cliPath, "taken", "--no-install"], { cwd, stdio: "pipe" })).toThrow();
    expect(() => execFileSync(process.execPath, [cliPath, "app", "--example", "nonexistent", "--no-install"], { cwd, stdio: "pipe" })).toThrow();
  });

  test("help documents that default scaffolding runs install, init, and doctor", () => {
    const out = execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    expect(out).toContain("Skip pnpm install, init, and doctor");
  });
});
