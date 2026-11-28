import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dafnyVersion } from "./cache.ts";
import { evaluatorIdentity } from "./installed.ts";
import { cachedDafnyDir, exec, findBin, findDafny, onPath } from "./run.ts";
import { GENERATED_AGENT_DIRECTORIES } from "./skill-links.ts";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorOptions {
  installDafny?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const DAFNY_VERSION = "4.11.0";
const DAFNY_DOWNLOAD_TIMEOUT_MS = 120_000;
const MIN_NODE = 26;

interface DafnyAsset {
  readonly asset: string;
  readonly sha256: string;
}

function dafnyReleaseAsset(): DafnyAsset {
  const key = `${process.platform}:${process.arch}`;
  const assets: Record<string, DafnyAsset> = {
    "darwin:arm64": {
      asset: `dafny-${DAFNY_VERSION}-arm64-macos-13.zip`,
      sha256: "c90c75e7d5db9c6ccbb7127840dfe43f0ac938b039a7ebed146d8ead383a572f",
    },
    "darwin:x64": {
      asset: `dafny-${DAFNY_VERSION}-x64-macos-13.zip`,
      sha256: "5fc0de946c5b2fad33f16bd22a5b06f4fd0dfa7f6d770284237e3f1f3ca9f73d",
    },
    "linux:x64": {
      asset: `dafny-${DAFNY_VERSION}-x64-ubuntu-22.04.zip`,
      sha256: "a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179",
    },
    "win32:x64": {
      asset: `dafny-${DAFNY_VERSION}-x64-windows-2022.zip`,
      sha256: "3653f05a111ca21e234709ea7b25ce96083fd6c6f10484256ba54110dbc0654d",
    },
  };
  const entry = assets[key];
  if (!entry) throw new Error(`no official Dafny ${DAFNY_VERSION} release asset for ${key}`);
  return entry;
}

function psSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function makeExecutable(dir: string, binName: string): void {
  if (process.platform === "win32") return;
  fs.chmodSync(path.join(dir, binName), 0o755);
  const z3Dir = path.join(dir, "z3", "bin");
  if (!fs.existsSync(z3Dir)) return;
  for (const entry of fs.readdirSync(z3Dir)) {
    const file = path.join(z3Dir, entry);
    if (fs.statSync(file).isFile()) fs.chmodSync(file, 0o755);
  }
}

export async function installDafny(): Promise<string> {
  const { asset, sha256: expectedHash } = dafnyReleaseAsset();
  const url = `https://github.com/dafny-lang/dafny/releases/download/v${DAFNY_VERSION}/${asset}`;
  const targetDir = cachedDafnyDir();
  const binName = process.platform === "win32" ? "dafny.exe" : "dafny";
  const targetBin = path.join(targetDir, binName);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "vibestack-dafny-"));
  const archive = path.join(staging, asset);
  const extracted = path.join(staging, "out");
  let stagedTarget: string | undefined;
  let backupDir: string | undefined;
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DAFNY_DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`failed to download ${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(`checksum mismatch for ${asset}: expected ${expectedHash}, got ${actualHash}`);
    }
    fs.writeFileSync(archive, bytes);
    fs.mkdirSync(extracted, { recursive: true });
    const unzip = process.platform === "win32"
      ? await exec("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path ${psSingleQuote(archive)} -DestinationPath ${psSingleQuote(extracted)} -Force`], staging)
      : await exec("unzip", ["-q", archive, "-d", extracted], staging);
    if (unzip.status !== 0 || unzip.stopped) {
      throw new Error(`failed to extract ${asset}: ${unzip.stderr || unzip.stdout || unzip.stopped}`);
    }
    const inner = path.join(extracted, "dafny");
    const sourceDir = fs.existsSync(path.join(inner, binName)) ? inner : extracted;
    const stagedBin = path.join(sourceDir, binName);
    if (!fs.existsSync(stagedBin)) {
      throw new Error(`extracted ${asset} did not contain ${binName}`);
    }
    makeExecutable(sourceDir, binName);
    const verify = await exec(stagedBin, ["--version"], sourceDir);
    if (verify.status !== 0) throw new Error(`extracted Dafny failed to run: ${verify.stderr || verify.stdout}`);

    const parent = path.dirname(targetDir);
    fs.mkdirSync(parent, { recursive: true });
    stagedTarget = fs.mkdtempSync(path.join(parent, ".dafny-install-"));
    fs.cpSync(sourceDir, stagedTarget, { recursive: true });
    makeExecutable(stagedTarget, binName);
    if (fs.existsSync(targetDir)) {
      backupDir = `${targetDir}.bak-${process.pid}-${Date.now()}`;
      fs.renameSync(targetDir, backupDir);
    }
    try {
      fs.renameSync(stagedTarget, targetDir);
      stagedTarget = undefined;
    } catch (error) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(targetDir)) {
        fs.renameSync(backupDir, targetDir);
        backupDir = undefined;
      }
      throw error;
    }
    return targetBin;
  } finally {
    if (stagedTarget) fs.rmSync(stagedTarget, { recursive: true, force: true });
    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function checkPnpm(root: string): Promise<DoctorCheck> {
  const pnpm = onPath("pnpm");
  if (!pnpm) return { name: "pnpm", status: "fail", detail: "pnpm not found on PATH" };
  const res = await exec(pnpm, ["--version"], root).catch(() => undefined);
  if (!res || res.status !== 0) return { name: "pnpm", status: "fail", detail: `pnpm at ${pnpm} failed to run` };
  return { name: "pnpm", status: "ok", detail: `${res.stdout.trim()} (${pnpm})` };
}

async function checkDafny(install: boolean): Promise<DoctorCheck> {
  let dafny = findDafny();
  if (!dafny && install) {
    try {
      dafny = await installDafny();
    } catch (error) {
      return { name: "dafny", status: "fail", detail: `install failed: ${(error as Error).message}` };
    }
  }
  if (!dafny) {
    return {
      name: "dafny",
      status: "fail",
      detail: `Dafny 4.11 not found on PATH or in ${cachedDafnyDir()} (run \`vibestack doctor --install-dafny\`)`,
    };
  }
  const checked = await dafnyVersion();
  if (checked.problem) {
    const cachedDir = cachedDafnyDir();
    if (install && !dafny.startsWith(cachedDir + path.sep)) {
      try {
        const installed = await installDafny();
        const active = findDafny();
        if (active && active !== installed) {
          return {
            name: "dafny",
            status: "warn",
            detail: `installed Dafny ${DAFNY_VERSION} at ${installed}, but ${active} on PATH takes precedence; prepend ${cachedDir} to PATH or remove the older binary`,
          };
        }
        return { name: "dafny", status: "ok", detail: `installed Dafny ${DAFNY_VERSION} at ${installed}` };
      } catch (error) {
        return { name: "dafny", status: "fail", detail: `install failed: ${(error as Error).message}` };
      }
    }
    return { name: "dafny", status: "fail", detail: checked.problem };
  }
  return { name: "dafny", status: "ok", detail: `${checked.version} (${dafny})` };
}

function checkQuint(root: string): DoctorCheck {
  const quint = findBin("quint", root);
  if (!quint) return { name: "quint", status: "fail", detail: "quint CLI not found; run pnpm install" };
  const evaluator = evaluatorIdentity(root);
  if (!evaluator) {
    return { name: "quint", status: "warn", detail: `CLI found (${quint}), Rust evaluator not yet cached (will download on first check)` };
  }
  return { name: "quint", status: "ok", detail: `CLI and Rust evaluator ready (${quint})` };
}

async function checkChromium(): Promise<DoctorCheck> {
  try {
    const { chromium } = await import("playwright");
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) return { name: "chromium", status: "ok", detail: exe };
    return { name: "chromium", status: "warn", detail: "Chromium not installed (optional unless running browser tests/explore; run `spec ci chromium`)" };
  } catch {
    return { name: "chromium", status: "warn", detail: "Playwright not installed (optional unless running browser tests/explore)" };
  }
}

function checkSkillLinks(root: string): DoctorCheck {
  const canonical = path.join(root, ".agents/skills");
  if (!fs.existsSync(canonical)) {
    return { name: "skills", status: "warn", detail: ".agents/skills not present (run `vibestack init`)" };
  }
  const missing: string[] = [];
  for (const agent of GENERATED_AGENT_DIRECTORIES) {
    const dest = path.join(root, agent, "skills");
    if (!fs.lstatSync(dest, { throwIfNoEntry: false })) missing.push(`${agent}/skills`);
  }
  const claudeMd = path.join(root, "CLAUDE.md");
  if (fs.existsSync(path.join(root, "AGENTS.md")) && !fs.lstatSync(claudeMd, { throwIfNoEntry: false })) {
    missing.push("CLAUDE.md");
  }
  if (missing.length) {
    return { name: "skills", status: "warn", detail: `missing links: ${missing.join(", ")} (run \`vibestack link\`)` };
  }
  return { name: "skills", status: "ok", detail: `all ${GENERATED_AGENT_DIRECTORIES.length} agent skill links present` };
}

function checkManifest(root: string): DoctorCheck {
  const manifestFile = path.join(root, ".agents/.vibestack-manifest.json");
  if (!fs.existsSync(manifestFile)) {
    return { name: "manifest", status: "warn", detail: ".agents/.vibestack-manifest.json not present (run `vibestack init` to track managed assets)" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { version?: string; files?: Record<string, string> };
    if (!parsed || typeof parsed !== "object" || !parsed.files || typeof parsed.files !== "object") {
      return { name: "manifest", status: "fail", detail: ".agents/.vibestack-manifest.json is malformed" };
    }
    const modified: string[] = [];
    const missing: string[] = [];
    for (const [rel, expectedHash] of Object.entries(parsed.files)) {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) {
        missing.push(rel);
      } else {
        const currentHash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        if (currentHash !== expectedHash) modified.push(rel);
      }
    }
    if (missing.length) {
      return { name: "manifest", status: "warn", detail: `v${parsed.version ?? "?"}: ${missing.length} managed file(s) missing (${missing.slice(0, 3).join(", ")})` };
    }
    if (modified.length) {
      return { name: "manifest", status: "ok", detail: `v${parsed.version ?? "?"}: ${Object.keys(parsed.files).length} tracked (${modified.length} locally customized)` };
    }
    return { name: "manifest", status: "ok", detail: `v${parsed.version ?? "?"}: ${Object.keys(parsed.files).length} managed files clean` };
  } catch (error) {
    return { name: "manifest", status: "fail", detail: `.agents/.vibestack-manifest.json: ${(error as Error).message}` };
  }
}

function hasAlchemyProject(root: string): boolean {
  if (fs.existsSync(path.join(root, "alchemy.run.ts"))) return true;
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return Boolean(parsed.dependencies && "alchemy" in parsed.dependencies)
      || Boolean(parsed.devDependencies && "alchemy" in parsed.devDependencies);
  } catch {
    return false;
  }
}

export function checkAlchemy(root: string, env: Readonly<Record<string, string | undefined>> = process.env): DoctorCheck | undefined {
  if (!hasAlchemyProject(root)) return undefined;
  const alchemyBin = findBin("alchemy", root) ?? onPath("alchemy");
  if (!alchemyBin) {
    return {
      name: "alchemy",
      status: "warn",
      detail: "Alchemy project detected, but `alchemy` CLI is not installed (run `pnpm install`)",
    };
  }
  const hasEnvAuth = Boolean(env.CLOUDFLARE_API_TOKEN || (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL));
  const profilePath = path.join(os.homedir(), ".alchemy", "profiles.json");
  const hasProfile = fs.existsSync(profilePath);
  if (hasEnvAuth) {
    return { name: "alchemy", status: "ok", detail: `CLI ready (${alchemyBin}), Cloudflare env auth detected` };
  }
  if (hasProfile) {
    return { name: "alchemy", status: "ok", detail: `CLI ready (${alchemyBin}), profile found (${profilePath})` };
  }
  return {
    name: "alchemy",
    status: "warn",
    detail: `CLI ready (${alchemyBin}); local \`alchemy dev\` works offline — run \`alchemy profile edit --add Cloudflare\` or set CLOUDFLARE_API_TOKEN for live deploys`,
  };
}

export async function doctor(root: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeCheck: DoctorCheck = nodeMajor >= MIN_NODE
    ? { name: "node", status: "ok", detail: `v${process.versions.node} (${process.execPath})` }
    : { name: "node", status: "fail", detail: `v${process.versions.node} found; requires Node >=${MIN_NODE}` };

  const [pnpmCheck, dafnyCheck, chromiumCheck] = await Promise.all([
    checkPnpm(root),
    checkDafny(Boolean(options.installDafny)),
    checkChromium(),
  ]);

  const alchemyCheck = checkAlchemy(root);
  const checks: DoctorCheck[] = [
    nodeCheck,
    pnpmCheck,
    dafnyCheck,
    checkQuint(root),
    chromiumCheck,
    checkSkillLinks(root),
    checkManifest(root),
    ...(alchemyCheck ? [alchemyCheck] : []),
  ];
  return { ok: checks.every((c) => c.status !== "fail"), checks };
}

export function formatDoctorReport(report: DoctorReport): string {
  const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
  return report.checks.map((c) => `${icon[c.status]} ${c.name.padEnd(10)} ${c.detail}`).join("\n");
}
