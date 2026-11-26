import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const pkgRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pkgRoot, "../..");
const srcDir = path.join(pkgRoot, "src");
const distDir = path.join(pkgRoot, "dist");
const cacheDir = path.join(pkgRoot, ".cache");
const stageDist = path.join(cacheDir, "dist-stage");
const buildInfo = path.join(cacheDir, "build.tsbuildinfo");
const assetsDir = path.join(pkgRoot, "assets");

const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function filesEqual(a, b) {
  if (!fs.existsSync(b)) return false;
  const statA = fs.statSync(a);
  const statB = fs.statSync(b);
  if (!statB.isFile() || statA.size !== statB.size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function syncFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!filesEqual(from, to)) {
    fs.copyFileSync(from, to);
  }
}

function collectFiles(rootDir, filter = () => true, rel = "", out = new Map()) {
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const srcPath = path.join(rootDir, entry.name);
    if (!filter(srcPath, entry)) continue;
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      collectFiles(srcPath, filter, nextRel, out);
    } else if (entry.isFile()) {
      out.set(nextRel, srcPath);
    }
  }
  return out;
}

function pruneExtras(targetDir, expected, rel = "") {
  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    const full = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      pruneExtras(full, expected, nextRel);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (!expected.has(nextRel)) {
      fs.rmSync(full, { force: true });
    }
  }
}

function syncTree(filesMap, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const [rel, srcPath] of filesMap) {
    syncFile(srcPath, path.join(destDir, rel));
  }
  pruneExtras(destDir, filesMap);
}

function pruneStaleStageOutputs(dir, rel = "") {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? path.join(rel, entry.name) : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneStaleStageOutputs(full, nextRel);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      const stem = nextRel.replace(/(?:\.d\.ts|\.js)$/, ".ts");
      if (!fs.existsSync(path.join(srcDir, stem))) {
        fs.rmSync(full, { force: true });
      }
    }
  }
}

fs.mkdirSync(stageDist, { recursive: true });
pruneStaleStageOutputs(stageDist);

execFileSync(
  process.execPath,
  [
    tscBin,
    "-p",
    path.join(pkgRoot, "tsconfig.build.json"),
    "--outDir",
    stageDist,
    "--incremental",
    "--tsBuildInfoFile",
    buildInfo,
  ],
  { cwd: pkgRoot, stdio: "inherit" },
);

const distFiles = collectFiles(stageDist);
distFiles.set(path.join("proof", "lib.dfy"), path.join(srcDir, "proof/lib.dfy"));
distFiles.set("conformance.ts", path.join(srcDir, "conformance.ts"));
for (const [rel, srcPath] of collectFiles(path.join(srcDir, "std"))) {
  distFiles.set(path.join("std", rel), srcPath);
}
syncTree(distFiles, distDir);

const specOut = path.join(distDir, "spec.js");
if ((fs.statSync(specOut).mode & 0o777) !== 0o755) {
  fs.chmodSync(specOut, 0o755);
}

function syncFromRepo() {
  const canonicalSkills = path.join(repoRoot, ".agents/skills");
  if (!fs.existsSync(canonicalSkills)) return;

  const targetSkills = path.join(assetsDir, "skills");
  const skillFiles = collectFiles(canonicalSkills, (source) => path.basename(source) !== ".DS_Store");
  syncTree(skillFiles, targetSkills);

  for (const [from, to] of [
    [path.join(repoRoot, ".agents/claude-settings.json"), path.join(assetsDir, "claude-settings.json")],
    [path.join(repoRoot, "AGENTS.md"), path.join(assetsDir, "AGENTS.md")],
    [path.join(repoRoot, "SPEC.md"), path.join(assetsDir, "SPEC.md")],
    [path.join(repoRoot, "README.md"), path.join(pkgRoot, "README.md")],
    [path.join(repoRoot, "LICENSE"), path.join(pkgRoot, "LICENSE")],
  ]) {
    if (fs.existsSync(from)) syncFile(from, to);
  }
}

syncFromRepo();
