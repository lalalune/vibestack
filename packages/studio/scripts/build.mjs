import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { verifyPageFiles } from "../pack-page.ts";

const studioDir = path.resolve(import.meta.dirname, "..");
const packagesDir = path.resolve(studioDir, "..");
const distDir = path.join(studioDir, "dist");
const pageDir = path.join(distDir, "page");
const serverOut = path.join(distDir, "server.mjs");
const scratchDir = path.join(studioDir, ".vibe", "server-build");
const compiledOutDir = path.join(scratchDir, "out");
const declarationsDir = path.join(scratchDir, "declarations");
const buildTsconfig = path.join(scratchDir, "tsconfig.json");

function findBin(name) {
  const exe = process.platform === "win32" ? `${name}.cmd` : name;
  for (let dir = studioDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ".bin", exe);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === path.dirname(dir)) break;
  }
  return exe;
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

await viteBuild({ configFile: path.join(studioDir, "vite.config.ts") });
verifyPageFiles(pageDir);

fs.rmSync(scratchDir, { recursive: true, force: true });
fs.mkdirSync(scratchDir, { recursive: true });

const tsconfig = {
  compilerOptions: {
    target: "es2023",
    module: "nodenext",
    strict: true,
    outDir: compiledOutDir,
    rootDir: packagesDir,
    rewriteRelativeImportExtensions: true,
    erasableSyntaxOnly: true,
    skipLibCheck: true,
    types: ["node"],
    lib: ["es2023", "dom", "dom.iterable"],
    rootDirs: [packagesDir, declarationsDir],
  },
  include: [
    path.join(studioDir, "src", "main.vibe"),
    path.join(studioDir, "gen", "*.vibe"),
  ],
  vibe: {
    sidecarDir: declarationsDir,
  },
};
fs.writeFileSync(buildTsconfig, JSON.stringify(tsconfig, null, 2) + "\n");

execFileSync(findBin("vibelang"), ["-p", buildTsconfig], {
  cwd: studioDir,
  stdio: "inherit",
});

const mainEntry = path.join(compiledOutDir, "studio", "src", "main.js");
if (!fs.existsSync(mainEntry)) {
  throw new Error(`Expected compiled Studio entry at ${mainEntry}`);
}

await esbuild({
  entryPoints: [mainEntry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  outfile: serverOut,
  external: ["node:*"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __studioCreateRequire } from "node:module";',
      "const require = __studioCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "warning",
});

fs.chmodSync(serverOut, 0o755);

const stdSource = path.join(packagesDir, "vibestack", "src", "std");
if (fs.existsSync(stdSource)) {
  fs.cpSync(stdSource, path.join(distDir, "std"), { recursive: true });
}

fs.rmSync(scratchDir, { recursive: true, force: true });
