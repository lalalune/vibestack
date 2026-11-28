import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const EXCLUDED_ENTRIES = new Set([
  "node_modules",
  "dist",
  "gen",
  ".cache",
  ".turbo",
  ".spec-cache",
  ".vibe",
  "generated",
  "storybook-static",
  ".DS_Store",
  ".studio",
  ".lemmascript",
  "_apalache-out",
  "__traces__",
  ".alchemy",
  ".wrangler",
]);

function syncDirectory(srcDir, destDir, options = {}) {
  const { exclude = new Set(), mapName = (name) => name } = options;
  fs.mkdirSync(destDir, { recursive: true });
  const keep = new Set();
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destName = mapName(entry.name);
    const destPath = path.join(destDir, destName);
    keep.add(destName);
    if (entry.isDirectory()) {
      syncDirectory(srcPath, destPath, options);
    } else if (entry.isFile()) {
      const same = fs.existsSync(destPath)
        && fs.statSync(destPath).isFile()
        && fs.statSync(destPath).size === fs.statSync(srcPath).size
        && fs.readFileSync(destPath).equals(fs.readFileSync(srcPath));
      if (!same) fs.copyFileSync(srcPath, destPath);
    }
  }
  for (const existing of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (!keep.has(existing.name)) {
      fs.rmSync(path.join(destDir, existing.name), { recursive: true, force: true });
    }
  }
}

const pkgDir = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(pkgDir, "src");
const distDir = path.join(pkgDir, "dist");
const cacheDir = path.join(pkgDir, ".cache");
const stageDist = path.join(cacheDir, "dist-stage");
const buildInfo = path.join(cacheDir, "build.tsbuildinfo");
const bundledTemplateDir = path.join(pkgDir, "template");
const sourceTemplateDir = path.resolve(pkgDir, "..", "..", "template");
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function removeOrphanedOutputs(dir, rootDir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) {
      removeOrphanedOutputs(abs, rootDir);
      if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
      continue;
    }
    if (!/\.(?:js|d\.ts)$/.test(item.name)) continue;
    const sourceRel = path.relative(rootDir, abs).replace(/(?:\.d\.ts|\.js)$/, ".ts");
    if (!fs.existsSync(path.join(srcDir, sourceRel))) fs.rmSync(abs, { force: true });
  }
}

fs.mkdirSync(stageDist, { recursive: true });
removeOrphanedOutputs(stageDist, stageDist);
execFileSync(
  process.execPath,
  [
    tscBin,
    "-p",
    path.join(pkgDir, "tsconfig.build.json"),
    "--outDir",
    stageDist,
    "--incremental",
    "--tsBuildInfoFile",
    buildInfo,
  ],
  { cwd: pkgDir, stdio: "inherit" },
);

syncDirectory(stageDist, distDir);

const cliOut = path.join(distDir, "cli.js");
if ((fs.statSync(cliOut).mode & 0o777) !== 0o755) {
  fs.chmodSync(cliOut, 0o755);
}

if (!fs.existsSync(sourceTemplateDir)) {
  throw new Error(`Starter template directory not found: ${sourceTemplateDir}`);
}
syncDirectory(sourceTemplateDir, bundledTemplateDir, {
  exclude: EXCLUDED_ENTRIES,
  mapName: (name) => (name === ".gitignore" ? "_gitignore" : name),
});
