import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type * as TS from "typescript";
import { cacheCredentials, steady, toolchainFingerprint } from "./cache.ts";
import { loadConfig } from "./config.ts";
import { evaluatorIdentity } from "./installed.ts";
import { specFiles } from "./parse.ts";
import { bin, exec } from "./run.ts";
import { codeDirs, digest, owner, packageScripts, projectRoot, tsApi, writeWhole } from "./util.ts";

type GenerationLayout = { kind: "ordinary" | "proof-directory"; owners: [string, string | null][]; dirs: string[] } | { kind: "invalid" };
const inProofDirectory = (file: string) => file.includes(".proof.dfy/");

function generationLayout(root: string): GenerationLayout {
  try {
    const specDir = loadConfig(root).spec.dir;
    const files = specFiles(root);
    const areas = [...new Set(files.map((file) => file.split("/")).filter((parts) => parts.length > 2).map((parts) => parts[1]))].sort();
    return {
      kind: files.some(inProofDirectory) ? "proof-directory" : "ordinary",
      owners: areas.map((area) => [area, owner(root, `${specDir}/${area}/`) ?? null]),
      dirs: codeDirs(root),
    };
  } catch {
    return { kind: "invalid" };
  }
}

function readGenerationConfig(file: string) {
  const config: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || !("tasks" in config)) return;
  const { tasks } = config;
  if (!tasks || typeof tasks !== "object" || !("//#gen" in tasks)) return;
  const gen = tasks["//#gen"];
  if (!gen || typeof gen !== "object" || !("inputs" in gen)) return;
  return { config, tasks, gen };
}

function isWorkspacePipeline(root: string): boolean {
  return [
    path.join(root, "vibestack", "tasks.ts"),
    path.join(root, "packages", "vibestack", "src", "tasks.ts"),
    path.join(root, "packages", "vibestack", "dist", "tasks.js"),
    path.join(root, "node_modules", "vibestack", "dist", "tasks.js"),
  ].includes(import.meta.filename);
}

function generationConfig(root: string, args: string[], env: NodeJS.ProcessEnv) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_JOB !== "verify" || env.GITHUB_WORKSPACE !== root ||
      !env.GITHUB_REPOSITORY || !env.GITHUB_WORKFLOW_REF?.startsWith(`${env.GITHUB_REPOSITORY}/.github/workflows/ci.yml@`) ||
      !isWorkspacePipeline(root) || args.includes("--") || env.TURBO_ROOT_TURBO_JSON !== undefined ||
      args.some((arg) => /^--cwd(?:=|$)/.test(arg))) return;
  const options = args.flatMap((arg, index) => /^--root-turbo-json(?:=|$)/.test(arg) ? [index] : []);
  if (options.length > 1 || (args.includes("--only") && (options.length || !args.includes("//#gen")))) return;
  const index = options[0] ?? args.length;
  const option = args[index];
  const separate = option === "--root-turbo-json";
  const file = separate ? args[index + 1] : option?.slice("--root-turbo-json=".length);
  if (option && (!file || (separate && file.startsWith("-")))) return;
  let selected: ReturnType<typeof readGenerationConfig>;
  try {
    const scripts = packageScripts(root);
    const validGenScripts = new Set(["node vibestack/spec.ts gen", "node packages/vibestack/src/spec.ts gen", "spec gen", "vibestack gen"]);
    if (!validGenScripts.has(scripts.gen) || scripts.pregen || scripts.postgen ||
        fs.lstatSync(path.join(root, "turbo.jsonc"), { throwIfNoEntry: false })) return;
    const stock = readGenerationConfig(path.join(root, "turbo.json"));
    if (!stock) return;
    selected = stock;
    if (file) {
      const resolved = path.resolve(root, file);
      if (!fs.statSync(resolved).isFile()) return;
      selected = readGenerationConfig(resolved);
      if (!selected || !isDeepStrictEqual(stock.gen, selected.gen)) return;
    }
  } catch {
    return;
  }
  const { config, tasks, gen } = selected;
  const inputs: unknown = gen.inputs;
  if (!Array.isArray(inputs) || !inputs.includes("spec/**") || inputs.some((input) => typeof input !== "string" || input.startsWith("!") || input.includes(".cache"))) return;
  const layout = generationLayout(root);
  const shape = JSON.stringify({ version: 1, layout });
  const layoutInput = ".cache/gen-layout-" + digest(shape) + ".json";
  const projected = JSON.stringify({
    ...config,
    tasks: { ...tasks, "//#gen": { ...gen, inputs: [...inputs, layoutInput, ...(layout.kind === "ordinary" ? ["!spec/**/*.proof.dfy"] : [])] } },
  });
  const projectedPath = path.join(root, ".cache", "gen-turbo-" + digest(projected) + ".json");
  for (const [file, text] of [[path.join(root, layoutInput), shape], [projectedPath, projected]]) {
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() || fs.readFileSync(file, "utf8") !== text) writeWhole(file, text);
  }
  return { path: projectedPath, index, count: separate ? 2 : option ? 1 : 0 };
}

const legacyProofInput = /^!(spec|(?:apps|packages)\/\*\/spec)\/\*\*\/\*\.proof\.dfy$/;

function turboOption(args: readonly string[], name: string): { index: number; count: number; value?: string } | undefined {
  const index = args.findLastIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (index < 0) return;
  const separate = args[index] === name;
  const value = separate ? args[index + 1] : args[index].slice(name.length + 1);
  return { index, count: separate ? 2 : 1, value: value && (!separate || !value.startsWith("-")) ? value : undefined };
}

async function sameTurboWorkspace(root: string, args: readonly string[]): Promise<boolean> {
  const cwd = turboOption(args, "--cwd");
  if (!cwd) return true;
  if (!cwd.value) return false;
  try {
    const workspace = fs.realpathSync(root);
    const directory = projectRoot(cwd.value, root);
    const relative = path.relative(workspace, directory);
    if (!relative) return true;
    if (path.isAbsolute(relative) || relative.split(path.sep)[0] === ".." || args.includes("--skip-infer")) return false;
    let member: string | undefined;
    for (let at = directory; path.relative(workspace, at); at = path.dirname(at)) {
      if ([".git", "pnpm-workspace.yaml"].some((file) => fs.existsSync(path.join(at, file)))) return false;
      if (!member && fs.existsSync(path.join(at, "package.json"))) member = at;
    }
    if (!member) return true;
    const listed = await exec("pnpm", ["list", "--recursive", "--depth", "-1", "--json"], root);
    const projects: unknown = listed.status === 0 ? JSON.parse(listed.stdout) : undefined;
    return Array.isArray(projects) && projects.some((project: unknown) =>
      typeof project === "object" && project !== null && "path" in project && project.path === member);
  } catch {
    return false;
  }
}

type LegacySpecInput = { directory: string; kind: "invalid" } | { directory: string; kind: "hidden"; models: [string, string][] };

function legacySpecInputs(root: string, scopes: readonly string[]): LegacySpecInput[] {
  const signature: LegacySpecInput[] = [];
  for (const scope of new Set(scopes)) {
    const [container] = scope.split("/");
    const directory = path.join(root, container);
    const entry = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!entry) continue;
    const projects = scope === "spec" ? [root] : entry.isDirectory()
      ? fs.readdirSync(directory, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => path.join(directory, item.name))
      : [];
    for (const project of projects.sort()) {
      const name = path.relative(root, path.join(project, "spec"));
      const spec = fs.lstatSync(path.join(root, name), { throwIfNoEntry: false });
      if (!spec) continue;
      if (!spec.isDirectory()) {
        signature.push({ directory: name, kind: "invalid" });
        continue;
      }
      try {
        const hidden = specFiles(project).filter(inProofDirectory);
        if (hidden.length) signature.push({ directory: name, kind: "hidden", models: hidden.map((file) => [file, digest(fs.readFileSync(path.join(project, file), "utf8"))]) });
      } catch {
        signature.push({ directory: name, kind: "invalid" });
      }
    }
  }
  return signature;
}

function configProperty(ts: typeof TS, node: TS.Expression | undefined, name: string): TS.Expression | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return;
  const matches = node.properties.filter((property): property is TS.PropertyAssignment =>
    ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && property.name.text === name);
  if (matches.length === 1) return matches[0].initializer;
}

function declaredRemoteApiUrl(root: string): string | undefined {
  const jsonFile = path.join(root, "turbo.json");
  if (fs.existsSync(jsonFile)) {
    try { return JSON.parse(fs.readFileSync(jsonFile, "utf8")).remoteCache?.apiUrl; } catch { /* fall through */ }
  }
  const jsoncFile = path.join(root, "turbo.jsonc");
  if (!fs.existsSync(jsoncFile)) return undefined;
  try {
    const ts = tsApi();
    const source = ts.parseJsonText(jsoncFile, fs.readFileSync(jsoncFile, "utf8"));
    const remoteCache = configProperty(ts, source.statements[0]?.expression, "remoteCache");
    const apiUrl = configProperty(ts, remoteCache, "apiUrl");
    return apiUrl && ts.isStringLiteral(apiUrl) ? apiUrl.text : undefined;
  } catch {
    return undefined;
  }
}

async function legacyGenerationConfig(root: string, args: string[], env: NodeJS.ProcessEnv) {
  const boundary = args.indexOf("--");
  const options = boundary < 0 ? args : args.slice(0, boundary);
  const explicit = turboOption(options, "--root-turbo-json");
  const selected = explicit?.value ?? env.TURBO_ROOT_TURBO_JSON;
  if ((explicit && !explicit.value) || selected === "") return;
  const files = selected === undefined ? ["turbo.json", "turbo.jsonc"].map((name) => path.join(root, name)).filter((file) => fs.existsSync(file)) : [path.resolve(root, selected)];
  if (files.length !== 1) return;
  const [file] = files;
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  if (!text.includes(".proof.dfy")) return;
  const ts = tsApi();
  const source = ts.parseJsonText(file, text);
  const tasks = configProperty(ts, source.statements[0]?.expression, "tasks");
  const gen = configProperty(ts, tasks, "//#gen");
  const inputs = configProperty(ts, gen, "inputs");
  if (!inputs || !ts.isArrayLiteralExpression(inputs)) return;
  const scopes = inputs.elements.flatMap((element) => ts.isStringLiteral(element) ? legacyProofInput.exec(element.text)?.slice(1) ?? [] : []);
  if (!scopes.length || !await sameTurboWorkspace(root, options)) return;
  const layout = JSON.stringify({ version: 1, hidden: legacySpecInputs(root, scopes), layout: generationLayout(root) });
  const input = `.cache/gen-legacy-${digest(layout)}.json`;
  const position = inputs.getStart(source) + 1;
  const overlay = text.slice(0, position) + `${JSON.stringify(input)},` + text.slice(position);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vibestack-turbo-"));
  const config = path.join(directory, path.basename(file));
  try {
    const marker = path.join(root, input);
    if (!fs.lstatSync(marker, { throwIfNoEntry: false })?.isFile() || fs.readFileSync(marker, "utf8") !== layout) writeWhole(marker, layout);
    fs.writeFileSync(config, overlay, { mode: 0o600 });
    return { args: args.toSpliced(explicit?.index ?? 0, explicit?.count ?? 0, `--root-turbo-json=${config}`), directory };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runTasks(root: string, args: string[]): Promise<number | null> {
  const fingerprint = path.join(root, ".cache", "toolchain.json");
  const text = JSON.stringify(await steady(toolchainFingerprint)) + "\n";
  if (!fs.existsSync(fingerprint) || fs.readFileSync(fingerprint, "utf8") !== text) writeWhole(fingerprint, text);
  let env: NodeJS.ProcessEnv = { ...process.env, TURBO_TELEMETRY_DISABLED: "1", VIBESTACK_QUINT_EVALUATOR: evaluatorIdentity(root) ?? randomUUID() };
  const credentials = path.join(os.homedir(), ".config", "vibestack", "turbo-cache.json");
  if (env.TURBO_TOKEN === undefined && fs.existsSync(credentials)) {
    const cache = JSON.parse(fs.readFileSync(credentials, "utf8"));
    const declared = declaredRemoteApiUrl(root);
    env = cacheCredentials(env, args, declared, cache);
  }
  const turboPackage = createRequire(bin("turbo", root)).resolve("turbo/package.json");
  const turboEntry = path.resolve(path.dirname(turboPackage), JSON.parse(fs.readFileSync(turboPackage, "utf8")).bin.turbo);
  const legacy = await legacyGenerationConfig(root, args, env);
  try {
    const config = legacy ? undefined : generationConfig(root, args, env);
    const options = legacy?.args ?? (config ? args.toSpliced(config.index, config.count, "--root-turbo-json", config.path) : args);
    const child = spawn(process.execPath, [turboEntry, "run", ...options], { cwd: root, env, stdio: "inherit" });
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    if (legacy) fs.rmSync(legacy.directory, { recursive: true, force: true });
  }
}
