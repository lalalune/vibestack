import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const pkgRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pkgRoot, "../..");
const distDir = path.join(pkgRoot, "dist");
const assetsDir = path.join(pkgRoot, "assets");

const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

fs.rmSync(distDir, { recursive: true, force: true });
execFileSync(process.execPath, [tscBin, "-p", path.join(pkgRoot, "tsconfig.build.json")], {
  cwd: pkgRoot,
  stdio: "inherit",
});

fs.chmodSync(path.join(distDir, "spec.js"), 0o755);
fs.mkdirSync(path.join(distDir, "proof"), { recursive: true });
fs.copyFileSync(path.join(pkgRoot, "src/proof/lib.dfy"), path.join(distDir, "proof/lib.dfy"));
fs.cpSync(path.join(pkgRoot, "src/std"), path.join(distDir, "std"), { recursive: true });
fs.copyFileSync(path.join(pkgRoot, "src/conformance.ts"), path.join(distDir, "conformance.ts"));

function syncFromRepo() {
  const canonicalSkills = path.join(repoRoot, ".agents/skills");
  if (!fs.existsSync(canonicalSkills)) return;

  const targetSkills = path.join(assetsDir, "skills");

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.rmSync(targetSkills, { recursive: true, force: true });
  fs.cpSync(canonicalSkills, targetSkills, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".DS_Store",
  });

  for (const [from, to] of [
    [path.join(repoRoot, ".agents/claude-settings.json"), path.join(assetsDir, "claude-settings.json")],
    [path.join(repoRoot, "AGENTS.md"), path.join(assetsDir, "AGENTS.md")],
    [path.join(repoRoot, "SPEC.md"), path.join(assetsDir, "SPEC.md")],
    [path.join(repoRoot, "README.md"), path.join(pkgRoot, "README.md")],
    [path.join(repoRoot, "LICENSE"), path.join(pkgRoot, "LICENSE")],
  ]) {
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
}

syncFromRepo();
