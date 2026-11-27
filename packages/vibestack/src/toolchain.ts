import fs from "node:fs";
import path from "node:path";
import { executableDigest, InstallationChanged, lasting } from "./installed.ts";
import { exec, findDafny, formatStamp, NEEDS_DAFNY, onPath, stamp } from "./run.ts";
import { sha } from "./util.ts";

type Stamps = Iterable<readonly [string, string]>;
export type ParsedStamp = readonly [file: string, empty: boolean, dev: bigint, ino: bigint, size: bigint, mtimeNs: bigint, ctimeNs: bigint];

export function fileStamp(file: string, follow = true): string {
  try {
    const stat = (follow ? fs.statSync : fs.lstatSync)(file, { bigint: true, throwIfNoEntry: false });
    return stat ? formatStamp(stat) : "";
  } catch {
    return "";
  }
}

export function parseStamps(entries: Stamps): ParsedStamp[] {
  const out: ParsedStamp[] = [];
  for (const [file, expected] of entries) {
    if (!expected) {
      out.push([file, true, 0n, 0n, 0n, 0n, 0n]);
      continue;
    }
    const parts = expected.split(":");
    if (parts.length !== 5) out.push([file, false, -1n, -1n, -1n, -1n, -1n]);
    else out.push([file, false, BigInt(parts[0]), BigInt(parts[1]), BigInt(parts[2]), BigInt(parts[3]), BigInt(parts[4])]);
  }
  return out;
}

export function sameParsed(entries: readonly ParsedStamp[], follow: boolean): boolean {
  const statFn = follow ? fs.statSync : fs.lstatSync;
  for (let i = 0; i < entries.length; i++) {
    const [file, empty, dev, ino, size, mtimeNs, ctimeNs] = entries[i];
    let stat: fs.BigIntStats | undefined;
    try { stat = statFn(file, { bigint: true, throwIfNoEntry: false }); } catch { stat = undefined; }
    if (empty) { if (stat !== undefined) return false; }
    else if (!stat || stat.dev !== dev || stat.ino !== ino || stat.size !== size || stat.mtimeNs !== mtimeNs || stat.ctimeNs !== ctimeNs) return false;
  }
  return true;
}

export const sameFiles = (files: Stamps, links: Stamps) => sameParsed(parseStamps(files), true) && sameParsed(parseStamps(links), false);

export function cacheCredentials(env: NodeJS.ProcessEnv, args: string[], declared: string | undefined, credentials: { apiUrl: string; writeToken: string }): NodeJS.ProcessEnv {
  const options = args.slice(0, args.includes("--") ? args.indexOf("--") : args.length);
  const supplied = (name: string) => options.some((arg) => arg === name || arg.startsWith(`${name}=`));
  let endpoint = env.TURBO_API ?? declared;
  for (const [index, arg] of options.entries()) {
    if (arg === "--api") endpoint = options[index + 1];
    else if (arg.startsWith("--api=")) endpoint = arg.slice("--api=".length);
  }
  return { ...env, ...env.TURBO_TOKEN === undefined && !supplied("--token") && endpoint === credentials.apiUrl
    ? { TURBO_API: credentials.apiUrl, TURBO_TOKEN: credentials.writeToken } : {} };
}

const packageVersions = new Map<string, { file: string; stamp: string; version: string }>();
export function packageVersion(dep: string): string {
  const known = packageVersions.get(dep);
  if (known) {
    try {
      if (stamp([known.file]) === known.stamp) return known.version;
    } catch { /* search again below */ }
  }
  for (let dir = import.meta.dirname; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", dep, "package.json");
    if (fs.existsSync(file)) {
      const version = `${dep}@${JSON.parse(fs.readFileSync(file, "utf8")).version}`;
      packageVersions.set(dep, { file, stamp: stamp([file]), version });
      return version;
    }
  }
  return dep;
}

function treeFiles(directory: string, layout?: Map<string, string>): string[] {
  if (layout) {
    const real = fs.realpathSync(directory);
    layout.set(directory, fileStamp(directory, false));
    if (real !== directory) layout.set(real, fileStamp(real, false));
  }
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) layout?.set(file, fileStamp(file, false));
    const linked = entry.isSymbolicLink() && fs.statSync(file, { bigint: true });
    if (linked && linked.isDirectory()) layout?.set(fs.realpathSync(file), formatStamp(linked));
    return entry.isFile() || (linked && linked.isFile()) ? [path.relative(directory, file).split(path.sep).join("/")] : [];
  }).sort();
}

const treeDigest = (directory: string, files = treeFiles(directory), stamps?: ReadonlyMap<string, string>) =>
  sha(...files.map((file) => {
    const full = path.join(directory, file);
    return `${file}\0${executableDigest(full, stamps?.get(full))}`;
  }));

function dafnyInstallation() {
  const launcher = findDafny();
  if (!launcher) throw new Error("Dafny is not on PATH or in ~/.cache/vibestack/dafny/4.11; the task cache needs its toolchain fingerprint");
  const real = fs.realpathSync(launcher);
  const locations = [path.dirname(real), path.resolve(path.dirname(real), "../libexec")];
  const selectedFiles = [launcher, ...locations.map((dir) => path.join(dir, "Dafny.dll"))];
  const assemblies = locations.find((dir) => fs.existsSync(path.join(dir, "Dafny.dll")));
  if (!assemblies) throw new Error("Dafny.dll is not beside Dafny or in ../libexec; the task cache cannot fingerprint this installation");
  const launchers = [real];
  for (;;) {
    const bytes = fs.readFileSync(launchers[launchers.length - 1]);
    const next = bytes.subarray(0, 2).toString() === "#!" ? bytes.toString().match(/\bexec\s+"([^"\n]*[\\/]dotnet(?:\.exe)?)"/)?.[1] : undefined;
    if (!next) break;
    selectedFiles.push(next);
    launchers.push(fs.realpathSync(next));
    fs.accessSync(launchers[launchers.length - 1], fs.constants.X_OK);
    if (launchers.length > 5) throw new Error("Dafny's runtime launcher chain does not terminate");
  }
  const runtimeDirs = ["host", "shared"].map((dir) => path.join(path.dirname(launchers[launchers.length - 1]), dir));
  selectedFiles.push(...runtimeDirs);
  const runtime = runtimeDirs.filter((dir) => fs.existsSync(dir));
  if (!runtime.length && !fs.existsSync(path.join(assemblies, "System.Private.CoreLib.dll")))
    throw new Error("Dafny's external .NET runtime cannot be fingerprinted; use a self-contained release or an explicit dotnet launcher");
  return { launcher, launchers, assemblies, runtime, selectedFiles };
}

export interface DafnyInstall {
  launchers: string[];
  assemblies: string;
  runtime: string[];
  trees: Map<string, string[]>;
  files: string[];
  stamps: Map<string, string>;
  at: string;
  unchanged: () => boolean;
}

const dafnySaid = (version: string | undefined, stopped?: string, out = "") => {
  const problem = !version ? `Dafny could not be run (${out.trim().split("\n")[0] || "it printed no version"})`
    : !version.startsWith("4.11.") ? `this is Dafny ${version}, and LemmaScript targets Dafny 4.11.x` : undefined;
  return { version, problem: stopped ?? (problem && `${problem}: ${NEEDS_DAFNY}`) };
};

export function readDafnyInstallation(): DafnyInstall | { at: string; files?: undefined } {
  try {
    const { launcher, launchers, assemblies, runtime, selectedFiles } = dafnyInstallation();
    const layout = new Map<string, string>();
    for (const file of selectedFiles) {
      layout.set(file, fileStamp(file, false));
      for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
        const stat = fs.lstatSync(dir, { bigint: true, throwIfNoEntry: false });
        if (stat?.isSymbolicLink()) layout.set(dir, formatStamp(stat));
      }
    }
    const trees = new Map<string, string[]>([assemblies, ...runtime].map((dir) => [dir, treeFiles(dir, layout)]));
    const files = [...launchers, ...[...trees.entries()].flatMap(([dir, entries]) => entries.map((f) => path.join(dir, f)))];
    const stamps = new Map<string, string>();
    try {
      for (const file of files) stamps.set(file, formatStamp(fs.statSync(file, { bigint: true })));
      const parsedStamps = parseStamps(stamps);
      const parsedLayout = parseStamps(layout);
      return { launchers, assemblies, runtime, trees, files, stamps, at: JSON.stringify([...layout, ...stamps]),
        unchanged: () => findDafny() === launcher && sameParsed(parsedStamps, true) && sameParsed(parsedLayout, false) };
    } catch (e) {
      return { at: (e as Error).message };
    }
  } catch {
    return { at: "" };
  }
}

export async function readDafnyVersion(inst: DafnyInstall | undefined): Promise<{ version?: string; problem?: string }> {
  try {
    const installed = inst && lasting(`dafny --version ${inst.files[0]}`, [inst.files[0]], sha(...inst.files.map((f) => inst.stamps.get(f)!)));
    if (installed?.value) return dafnySaid(installed.value);
    const r = await exec(inst?.launchers[0] ?? findDafny() ?? "dafny", ["--version"], process.cwd());
    const version = r.status === 0 ? r.stdout.match(/\d+\.\d+\.\d+/)?.[0] : undefined;
    if (version && !r.stopped) installed?.keep(version);
    return dafnySaid(version, r.stopped, `${r.stdout}${r.stderr}`);
  } catch (e) {
    return { problem: `Dafny could not be run (${(e as Error).message}): ${NEEDS_DAFNY}` };
  }
}

export async function readDafnyIdentity(inst: DafnyInstall | undefined) {
  const { launchers, assemblies, runtime } = inst ?? dafnyInstallation();
  return {
    version: (await readDafnyVersion(inst)).version,
    launchers: launchers.map((file) => executableDigest(file, inst?.stamps.get(file))),
    assemblies: treeDigest(assemblies, inst?.trees.get(assemblies), inst?.stamps),
    runtime: runtime.map((dir) => [path.basename(dir), treeDigest(dir, inst?.trees.get(dir), inst?.stamps)]),
  };
}

class SolverUnavailable extends Error {}

export function solverCandidates(): string[] {
  const dafny = findDafny();
  const z3 = onPath("z3");
  const candidates: string[] = [];
  if (dafny) {
    const real = fs.realpathSync(dafny);
    for (const dir of [path.dirname(real), path.join(path.dirname(real), "..", "libexec")]) {
      const bundled = path.join(dir, "z3", "bin");
      if (!fs.existsSync(bundled)) continue;
      const preferred = (name: string) => name.includes("4.12.1") ? 0 : name.includes("4.8.5") ? 1 : 2;
      candidates.push(...fs.readdirSync(bundled).filter((name) => /^z3(-\d+(\.\d+)*)?(\.exe)?$/.test(name))
        .sort((a, b) => preferred(a) - preferred(b) || a.localeCompare(b)).map((name) => path.join(bundled, name)));
    }
  }
  if (z3) candidates.push(z3);
  return candidates;
}

export const solverStamp = (candidates: string[]) => JSON.stringify(candidates.map((file) => [file, fileStamp(file), fileStamp(file, false)]));

export async function resolveSolver(onCandidates?: (stampText: string) => void): Promise<{ path: string; version: string }> {
  const candidates = solverCandidates();
  onCandidates?.(solverStamp(candidates));
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      const { value, keep } = lasting(`z3 --version ${candidate}`, [candidate, real]);
      if (value) return { path: real, version: value };
      const result = await exec(candidate, ["--version"], path.dirname(candidate));
      const version = result.status === 0 && !result.stopped && result.stdout.match(/Z3 version (\d+\.\d+\.\d+)/)?.[1];
      if (version) return { path: real, version: keep(version) };
    } catch { /* try the next solver supplied by this installation */ }
  }
  throw new SolverUnavailable("the proof stage needs the Z3 solver bundled with Dafny or on the PATH");
}

export async function findVibelangBinary(): Promise<string | null> {
  try {
    const { findBinary } = await import("vibelang/binary");
    return findBinary();
  } catch {
    return null;
  }
}

export async function toolchainFingerprint() {
  let installed: DafnyInstall | { at: string; files?: undefined } | undefined;
  let solverAt: string | undefined;
  const z3 = await resolveSolver((at) => { solverAt = at; }).catch((error: unknown) => {
    if (error instanceof SolverUnavailable) return null;
    throw error;
  });
  const compiler = await findVibelangBinary();
  fs.accessSync(process.execPath, fs.constants.X_OK);
  if (compiler) fs.accessSync(compiler, fs.constants.X_OK);
  if (z3) fs.accessSync(z3.path, fs.constants.X_OK);
  const dafny = findDafny() ? await readDafnyIdentity((installed = readDafnyInstallation()).files ? installed : undefined) : null;
  if ((installed && (installed.files ? !installed.unchanged() : readDafnyInstallation().at !== installed.at))
    || (solverAt !== undefined && solverStamp(solverCandidates()) !== solverAt)) {
    throw new InstallationChanged();
  }
  return {
    platform: process.platform, arch: process.arch,
    node: { version: process.versions.node, digest: executableDigest(process.execPath) },
    dafny,
    z3: z3 && { version: z3.version, digest: executableDigest(z3.path) },
    vibelang: compiler ? { version: packageVersion("vibelang"), digest: executableDigest(compiler) } : null,
    packages: ["@informalsystems/quint", "lemmascript", "vibelang-runtime", "vibelang-vite", "typescript", "vitest", "effect", "@effect/platform-node", "@effect/vitest"].map(packageVersion),
  };
}
