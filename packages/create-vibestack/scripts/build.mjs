import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
]);

function resolveTsc(pkgDir) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(pkgDir, "node_modules", ".bin", `tsc${ext}`),
    path.resolve(pkgDir, "..", "..", "node_modules", ".bin", `tsc${ext}`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return `tsc${ext}`;
}

function copyTemplateTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destName = entry.name === ".gitignore" ? "_gitignore" : entry.name;
    const destPath = path.join(destDir, destName);
    if (entry.isDirectory()) {
      copyTemplateTree(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const pkgDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(pkgDir, "dist");
const bundledTemplateDir = path.join(pkgDir, "template");
const sourceTemplateDir = path.resolve(pkgDir, "..", "..", "template");

fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(bundledTemplateDir, { recursive: true, force: true });

execFileSync(resolveTsc(pkgDir), ["-p", "tsconfig.build.json"], {
  cwd: pkgDir,
  stdio: "inherit",
});

const cliOut = path.join(distDir, "cli.js");
fs.chmodSync(cliOut, 0o755);

if (!fs.existsSync(sourceTemplateDir)) {
  throw new Error(`Starter template directory not found: ${sourceTemplateDir}`);
}
copyTemplateTree(sourceTemplateDir, bundledTemplateDir);
