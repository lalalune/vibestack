#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXAMPLES = ["order", "dashboard", "fullstack", "assistant"] as const;
const MODES = ["vibelang", "typescript", "specs-only"] as const;

type ExampleName = (typeof EXAMPLES)[number];
type ProjectMode = (typeof MODES)[number];

type ProjectSource =
  | { readonly kind: "template" }
  | { readonly kind: "example"; readonly name: ExampleName };

type CliCommand =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "create";
      readonly targetArg: string;
      readonly targetDir: string;
      readonly projectName: string;
      readonly source: ProjectSource;
      readonly mode: ProjectMode | undefined;
      readonly install: boolean;
      readonly vibestackVersion: string;
    };

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

const USAGE = [
  "Usage: create-vibestack <project-name> [options]",
  "",
  "Options:",
  "  --example <order|dashboard|fullstack|assistant>  Scaffold an official example",
  "  --mode <vibelang|typescript|specs-only>          Write vibestack.json with mode",
  "  --no-install                                     Skip pnpm install, init, and doctor",
  "  --vibestack-version <ver|path>                   Pin vibestack version or local path",
  "  -v, --version                                    Show CLI version",
  "  -h, --help                                       Show this help message",
  "",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExampleName(value: string): value is ExampleName {
  return EXAMPLES.some((item) => item === value);
}

function isProjectMode(value: string): value is ProjectMode {
  return MODES.some((item) => item === value);
}

function readPackageVersion(packageRoot: string): string {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (isRecord(raw) && typeof raw.version === "string" && raw.version.length > 0) {
    return raw.version;
  }
  return "0.2.0";
}

function sanitizeProjectName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[-.]+$/, "");
  return cleaned.length > 0 ? cleaned : "my-vibestack-app";
}

function normalizeVersionSpec(raw: string, cwd: string): string {
  if (raw.startsWith("file:")) {
    const rest = raw.slice("file:".length);
    return path.isAbsolute(rest) ? raw : `file:${path.resolve(cwd, rest)}`;
  }
  const looksLocal = raw.startsWith(".") || raw.startsWith("/") || path.isAbsolute(raw);
  const resolved = path.resolve(cwd, raw);
  if (looksLocal || fs.existsSync(resolved)) {
    return `file:${resolved}`;
  }
  return raw;
}

function formatYamlScalar(value: string): string {
  if (/[:\s#"'{}[\],&*?|>!%@`]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function takeFlagValue(argv: readonly string[], index: number, flag: string): { value: string; nextIndex: number } | undefined {
  const token = argv[index];
  if (token === undefined) return undefined;
  const eq = token.indexOf("=");
  if (eq >= 0) {
    const value = token.slice(eq + 1);
    return value.length > 0 ? { value, nextIndex: index } : undefined;
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) {
    return undefined;
  }
  if (token !== flag) return undefined;
  return { value: next, nextIndex: index + 1 };
}

function parseArgs(argv: readonly string[], cwd: string, defaultVersion: string): CliCommand {
  let targetArg: string | undefined;
  let source: ProjectSource = { kind: "template" };
  let mode: ProjectMode | undefined;
  let install = true;
  let vibestackVersion = `^${defaultVersion}`;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "-v" || arg === "--version") return { kind: "version" };
    if (arg === "--no-install") {
      install = false;
      continue;
    }
    if (arg === "--example" || arg.startsWith("--example=")) {
      const taken = takeFlagValue(argv, i, "--example");
      if (!taken) return { kind: "error", message: `Missing value for --example. Choose one of: ${EXAMPLES.join(", ")}.` };
      if (!isExampleName(taken.value)) {
        return { kind: "error", message: `Unknown example "${taken.value}". Choose one of: ${EXAMPLES.join(", ")}.` };
      }
      source = { kind: "example", name: taken.value };
      i = taken.nextIndex;
      continue;
    }
    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const taken = takeFlagValue(argv, i, "--mode");
      if (!taken) return { kind: "error", message: `Missing value for --mode. Choose one of: ${MODES.join(", ")}.` };
      if (!isProjectMode(taken.value)) {
        return { kind: "error", message: `Unknown mode "${taken.value}". Choose one of: ${MODES.join(", ")}.` };
      }
      mode = taken.value;
      i = taken.nextIndex;
      continue;
    }
    if (arg === "--vibestack-version" || arg.startsWith("--vibestack-version=")) {
      const taken = takeFlagValue(argv, i, "--vibestack-version");
      if (!taken) return { kind: "error", message: "Missing value for --vibestack-version." };
      vibestackVersion = normalizeVersionSpec(taken.value, cwd);
      i = taken.nextIndex;
      continue;
    }
    if (arg.startsWith("-")) {
      return { kind: "error", message: `Unknown option "${arg}".` };
    }
    if (targetArg !== undefined) {
      return { kind: "error", message: `Unexpected extra argument "${arg}".` };
    }
    targetArg = arg;
  }

  if (targetArg === undefined) {
    return { kind: "error", message: "Missing project name." };
  }

  const targetDir = path.resolve(cwd, targetArg);
  const projectName = sanitizeProjectName(path.basename(targetDir));
  return {
    kind: "create",
    targetArg,
    targetDir,
    projectName,
    source,
    mode,
    install,
    vibestackVersion,
  };
}

function validateTargetDir(targetDir: string): void {
  if (fs.existsSync(targetDir)) {
    const stats = fs.statSync(targetDir);
    if (!stats.isDirectory()) {
      throw new Error(`Target path exists and is not a directory: ${targetDir}`);
    }
    if (fs.readdirSync(targetDir).length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
}

function copyDirectory(srcDir: string, destDir: string, options: { readonly skipLockfile: boolean }): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue;
    if (options.skipLockfile && entry.name === "pnpm-lock.yaml") continue;
    const srcPath = path.join(srcDir, entry.name);
    const destName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
    const destPath = path.join(destDir, destName);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      const mode = fs.statSync(srcPath).mode;
      if ((mode & 0o111) !== 0) {
        fs.chmodSync(destPath, mode);
      }
    }
  }
}

function resolveTemplateDir(packageRoot: string): string {
  const candidates = [
    path.join(packageRoot, "template"),
    path.resolve(packageRoot, "..", "..", "template"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  throw new Error("Bundled template directory could not be found.");
}

async function downloadExampleFromGitHub(name: ExampleName, version: string, targetDir: string): Promise<void> {
  const urls = [
    `https://github.com/lalalune/vibestack/archive/refs/tags/v${version}.tar.gz`,
    "https://github.com/lalalune/vibestack/archive/refs/heads/main.tar.gz",
  ];
  let response: Response | undefined;
  for (const url of urls) {
    const attempt = await fetch(url, { redirect: "follow" });
    if (attempt.ok) {
      response = attempt;
      break;
    }
  }
  if (!response) {
    throw new Error(`Failed to download example "${name}" from GitHub.`);
  }
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-vibestack-"));
  const tarballPath = path.join(tmpDir, "vibestack.tar.gz");
  try {
    fs.writeFileSync(tarballPath, archiveBytes);
    const listed = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
    if (listed.status !== 0) {
      throw new Error(`Failed to read downloaded archive: ${listed.stderr.trim()}`);
    }
    const firstEntry = listed.stdout.split("\n").find((line) => line.includes(`/examples/${name}/`));
    if (!firstEntry) {
      throw new Error(`Example "${name}" was not found in the downloaded archive.`);
    }
    const archiveRoot = firstEntry.split("/", 1)[0];
    if (!archiveRoot) {
      throw new Error(`Unexpected archive layout for example "${name}".`);
    }
    const member = `${archiveRoot}/examples/${name}`;
    const extracted = spawnSync("tar", ["-xzf", tarballPath, "--strip-components=3", "-C", targetDir, member], {
      encoding: "utf8",
    });
    if (extracted.status !== 0) {
      throw new Error(`Failed to extract example "${name}": ${extracted.stderr.trim()}`);
    }
    fs.rmSync(path.join(targetDir, "pnpm-lock.yaml"), { force: true });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function populateTarget(source: ProjectSource, packageRoot: string, pkgVersion: string, targetDir: string): Promise<void> {
  if (source.kind === "template") {
    copyDirectory(resolveTemplateDir(packageRoot), targetDir, { skipLockfile: false });
    return;
  }
  const localExampleDir = path.resolve(packageRoot, "..", "..", "examples", source.name);
  if (fs.existsSync(path.join(localExampleDir, "package.json"))) {
    copyDirectory(localExampleDir, targetDir, { skipLockfile: true });
    return;
  }
  await downloadExampleFromGitHub(source.name, pkgVersion, targetDir);
}

function isCatalogAllowedVersion(spec: string): boolean {
  return !/^(?:file:|link:|workspace:|https?:|git\+|git:|github:)/i.test(spec);
}

function rewriteManifest(
  pkgPath: string,
  vibestackVersion: string,
  replaceCatalog: boolean,
  projectName?: string,
): void {
  if (!fs.existsSync(pkgPath)) return;
  const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!isRecord(parsed)) return;
  if (projectName !== undefined) {
    parsed.name = projectName;
  }
  for (const field of ["dependencies", "devDependencies"] as const) {
    const group = parsed[field];
    if (isRecord(group) && typeof group.vibestack === "string" && (replaceCatalog || group.vibestack !== "catalog:")) {
      group.vibestack = vibestackVersion;
    }
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function applyProjectCustomizations(
  targetDir: string,
  projectName: string,
  vibestackVersion: string,
  mode: ProjectMode | undefined,
): void {
  const useCatalog = isCatalogAllowedVersion(vibestackVersion);
  rewriteManifest(path.join(targetDir, "package.json"), vibestackVersion, !useCatalog, projectName);

  if (!useCatalog) {
    for (const container of ["apps", "packages"]) {
      const containerDir = path.join(targetDir, container);
      if (!fs.existsSync(containerDir)) continue;
      for (const entry of fs.readdirSync(containerDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        rewriteManifest(path.join(containerDir, entry.name, "package.json"), vibestackVersion, true);
      }
    }
  }

  const workspacePath = path.join(targetDir, "pnpm-workspace.yaml");
  if (fs.existsSync(workspacePath)) {
    const current = fs.readFileSync(workspacePath, "utf8");
    const updated = useCatalog
      ? current.replace(/^(\s*vibestack:\s*).+$/m, `$1${formatYamlScalar(vibestackVersion)}`)
      : current.replace(/^\s*vibestack:.*\r?\n/m, "");
    fs.writeFileSync(workspacePath, updated);
  }

  const readmePath = path.join(targetDir, "README.md");
  if (fs.existsSync(readmePath)) {
    const current = fs.readFileSync(readmePath, "utf8");
    const updated = current.replaceAll("my-vibestack-app", projectName);
    fs.writeFileSync(readmePath, updated);
  }

  if (mode !== undefined) {
    const configPath = path.join(targetDir, "vibestack.json");
    fs.writeFileSync(configPath, `${JSON.stringify({ mode }, null, 2)}\n`);
  }
}

function runCommand(command: string, args: readonly string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function installAndSetup(targetDir: string): void {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const hasWorkspace = fs.existsSync(path.join(targetDir, "pnpm-workspace.yaml"));
  const installArgs = hasWorkspace ? ["install"] : ["install", "--ignore-workspace"];

  const installStatus = runCommand(pnpm, installArgs, targetDir);
  if (installStatus !== 0) {
    throw new Error(`pnpm ${installArgs.join(" ")} exited with status ${installStatus}.`);
  }

  const initStatus = runCommand(pnpm, ["exec", "vibestack", "init", "--yes"], targetDir);
  if (initStatus !== 0) {
    throw new Error(`pnpm exec vibestack init --yes exited with status ${initStatus}.`);
  }

  runCommand(pnpm, ["exec", "vibestack", "doctor"], targetDir);
}

function printNextSteps(command: Extract<CliCommand, { kind: "create" }>): void {
  const lines = [
    "",
    `Created ${command.projectName} in ${command.targetDir}`,
    "",
    "Next steps:",
    `  cd ${command.targetArg}`,
  ];
  if (!command.install) {
    lines.push("  pnpm install");
  }
  if (command.source.kind === "template") {
    lines.push("  pnpm dev");
  }
  lines.push("  pnpm check");
  lines.push("  pnpm dlx vibestack-studio");
  lines.push("");
  process.stdout.write(lines.join("\n"));
}

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const pkgVersion = readPackageVersion(packageRoot);
  const command = parseArgs(process.argv.slice(2), process.cwd(), pkgVersion);

  switch (command.kind) {
    case "help":
      process.stdout.write(USAGE);
      return;
    case "version":
      process.stdout.write(`${pkgVersion}\n`);
      return;
    case "error":
      process.stderr.write(`Error: ${command.message}\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    case "create":
      validateTargetDir(command.targetDir);
      await populateTarget(command.source, packageRoot, pkgVersion, command.targetDir);
      applyProjectCustomizations(command.targetDir, command.projectName, command.vibestackVersion, command.mode);
      if (command.install) {
        installAndSetup(command.targetDir);
      }
      printNextSteps(command);
      return;
    default: {
      const _exhaustive: never = command;
      throw new Error(`Unhandled command: ${String(_exhaustive)}`);
    }
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
