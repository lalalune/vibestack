import type { Schema } from "effect";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { manifest as readManifest, packageFiles, packageManager, workspacePackages, writeWhole } from "../util.ts";
import type * as PropertiesModule from "./properties.ts";

export const VERSION = 1;
const OUT = ".cache/generated/tests";

export interface Skipped { file: string; export: string; reason: string }
export interface Generated { written: string[]; unchanged: string[]; removed: string[]; skipped: Skipped[] }

interface ManifestFileEntry { source: string; hash: string; tests: number; size?: number }
interface Manifest { generator: number; inputHash?: string; files: Record<string, ManifestFileEntry>; skipped: Skipped[] }

const posix = (file: string) => file.split(path.sep).join("/");
const sha = (...texts: string[]) => createHash("sha256").update(texts.join("\0")).digest("hex").slice(0, 16);
const isFixture = (file: string) => /(?:^|\/)test\/fixtures?\//.test(file);

function resolveTestingSpecifier(root: string): string | undefined {
  try {
    createRequire(path.join(root, "package.json")).resolve("vibestack/testing");
    return "vibestack/testing";
  } catch {
    return undefined;
  }
}

function generationFingerprint(root: string, testingPackage: string | undefined, testingEntry: string): { hash?: string; hasVibe: boolean } {
  const hash = createHash("sha256").update(JSON.stringify([
    "gen-tests-v1", VERSION, process.versions.node, testingPackage ?? testingEntry,
  ]));
  let hasVibe = false;
  let linkFound = false;
  const updateFile = (abs: string, label: string) => {
    const bytes = fs.readFileSync(abs);
    hash.update(`${label}\0${bytes.length}\0`).update(bytes);
  };
  for (const { directory: from, name } of workspacePackages(root)) {
    const pkg = readManifest(from);
    if ([pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies].some((deps) =>
      Object.values(deps ?? {}).some((version) => typeof version === "string" && version.startsWith("link:")))) {
      linkFound = true;
    }
    hash.update(JSON.stringify(name));
    const own = name === ".";
    const keep = (file: string) => /\.(?:[cm]?[jt]sx?|vibex?|json)$/.test(file) && !/(?:^|\/)\.|\.d(?:\.vibe)?\.[cm]?ts$/.test(file) && (own
      ? (file === "package.json" || file === "tsconfig.json" || (file.startsWith("src/") && !isFixture(file)))
      : (!file.startsWith("test/") && !file.startsWith("spec/") && !file.startsWith("gen/")));
    for (const file of packageFiles(from, keep, "", false)) {
      if (/\.vibex?$/.test(file)) hasVibe = true;
      if (!linkFound) updateFile(path.join(from, file), file);
    }
    const genDir = path.join(from, "gen");
    if (fs.existsSync(genDir)) {
      const top = fs.readdirSync(genDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.endsWith(".qnt"))
        .map((e) => `gen/${e.name}`)
        .sort();
      for (const file of top) {
        if (/\.vibex?$/.test(file)) hasVibe = true;
        if (!linkFound) updateFile(path.join(from, file), file);
      }
    }
  }
  if (!linkFound) {
    const { lock } = packageManager(root);
    if (lock) updateFile(lock, "__lock__");
  }
  return { hash: linkFound ? undefined : hash.digest("hex"), hasVibe };
}

function readCachedResult(out: string, manifestFile: string, inputHash: string | undefined): Generated | undefined {
  if (!inputHash || !fs.existsSync(manifestFile)) return undefined;
  let saved: Manifest;
  try {
    saved = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Manifest;
  } catch {
    return undefined;
  }
  if (saved.generator !== VERSION || saved.inputHash !== inputHash || !saved.files || !Array.isArray(saved.skipped)) return undefined;
  if (saved.skipped.some((entry) => entry.export === "*")) return undefined;
  const expected = Object.keys(saved.files).sort();
  const actual = fs.globSync("**/*.test.ts", { cwd: out }).map(posix).sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) return undefined;
  for (const file of expected) {
    const stat = fs.statSync(path.join(out, file), { throwIfNoEntry: false });
    const entry = saved.files[file];
    if (!stat?.isFile() || (entry.size !== undefined && stat.size !== entry.size)) return undefined;
  }
  return { written: [], unchanged: expected, removed: [], skipped: saved.skipped };
}

export async function generateTests(packageDir: string): Promise<Generated> {
  const root = path.resolve(packageDir), out = path.join(root, OUT);
  const manifestFile = path.join(out, "manifest.json");
  const testingPackage = resolveTestingSpecifier(root);
  const testingEntry = path.join(import.meta.dirname, `index${path.extname(import.meta.filename)}`);
  const { hash: inputHash, hasVibe } = generationFingerprint(root, testingPackage, testingEntry);
  const cached = readCachedResult(out, manifestFile, inputHash);
  if (cached) return cached;

  const result: Generated = { written: [], unchanged: [], removed: [], skipped: [] };
  const glob = (pattern: string) => fs.globSync(pattern, { cwd: root }).map(posix).filter((file) => !isFixture(file)).sort();
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const files = new Map<string, ManifestFileEntry>();

  const emit = (file: string, source: string, hash: string, tests: number, lines: (from: From) => string[]) => {
    const target = path.join(out, file);
    const from = (to: string) => posix(path.relative(path.dirname(target), to));
    const text = [`// Generated by vibestack/testing/generate.ts v${VERSION} from ${source} (sha256 ${hash}); do not edit.`, ...lines(from), ""].join("\n");
    files.set(file, { source, hash, tests, size: Buffer.byteLength(text, "utf8") });
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === text) return void result.unchanged.push(file);
    writeWhole(target, text);
    result.written.push(file);
  };
  type From = (file: string) => string;
  const importing = (from: From, what: string, file: string) => `import ${what} from ${JSON.stringify(from(file))};`;
  const importingTesting = (from: From, what: string) =>
    testingPackage ? `import ${what} from ${JSON.stringify(testingPackage)};` : importing(from, what, testingEntry);

  const sources = glob("src/**/*.{schema,contract}.{ts,vibe}");
  if (sources.length) {
    if (hasVibe) {
      let register: string | undefined;
      try {
        register = createRequire(path.join(root, "package.json")).resolve("vibelang/register");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND")) throw error;
      }
      if (register) await import(pathToFileURL(register).href);
    }
    const { Arbitrary, Effect, Schema: EffectSchema } = await import("effect");
    let propertiesModule: typeof PropertiesModule | undefined;
    const arbitraryOf = (schema: Schema.Schema<unknown>, skip: (reason: string) => void) => {
      try {
        Effect.runSync(Arbitrary.sampleEffect(Arbitrary.schema(schema), { count: 1, seed: 1 }).pipe(Effect.mapError((refused) =>
          new Error(`its filters refused all ${refused.discards} values tried`))));
        return true;
      } catch (error) {
        skip(`no value can be generated for it: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    };
    const cacheBust = inputHash ?? String(Date.now());
    for (const source of sources) {
      const hash = sha(read(source));
      const skip = (name: string, reason: string) => void result.skipped.push({ file: source, export: name, reason });
      const module: Record<string, unknown> | undefined = await import(`${pathToFileURL(path.join(root, source)).href}?${cacheBust}`).catch((error) =>
        skip("*", `the module does not load: ${error instanceof Error ? error.message : String(error)}`));
      if (!module) continue;
      const names = Object.keys(module).sort(), testFile = `${source.replace(/\.\w+$/, "")}.test.ts`;
      const subject = (from: From) => importing(from, "* as subject", path.join(root, source));
      if (/\.schema\.\w+$/.test(source)) {
        const schemas = names.filter((name) => EffectSchema.isSchema(module[name]) && arbitraryOf(module[name] as Schema.Schema<unknown>, (reason) => skip(name, reason)));
        if (!schemas.length) skip("*", names.some((name) => EffectSchema.isSchema(module[name])) ? "no value can be generated for any schema it exports" : "the module exports no Effect Schema");
        else emit(testFile, source, hash, schemas.length * 2, (from) => [
          `import { describe } from "vitest";`, importingTesting(from, "{ schemaTests }"), subject(from), "",
          `describe(${JSON.stringify(source)}, () => {`, ...schemas.map((name) => `  schemaTests(${JSON.stringify(name)}, subject[${JSON.stringify(name)}]);`), "});",
        ]);
      } else {
        propertiesModule ??= await import("./properties.ts");
        const { declared, isContract } = propertiesModule;
        const contracts = names.filter((name) => isContract(module[name]));
        const tests = contracts.flatMap((name) => {
          const properties = Object.entries(declared(module[name] as never)).flatMap(([property, check]) => check ? [property] : []);
          if (!properties.length) skip(name, "the contract declares no property: deterministic, idempotent, invariant or inverse");
          return properties.map((property) => `  contractTest(${JSON.stringify(name)}, subject[${JSON.stringify(name)}], ${JSON.stringify(property)});`);
        });
        if (!tests.length) skip("*", contracts.length ? "no contract it exports declares a property" : "the module exports no contract({ … })");
        else emit(testFile, source, hash, tests.length, (from) => [
          `import { describe } from "vitest";`, importingTesting(from, "{ contractTest }"), subject(from), "",
          `describe(${JSON.stringify(source)}, () => {`, ...tests, "});",
        ]);
      }
    }
  }

  if (fs.existsSync(out)) for (const file of fs.globSync("**/*.test.ts", { cwd: out }).map(posix).sort()) {
    if (files.has(file)) continue;
    fs.rmSync(path.join(out, file));
    result.removed.push(file);
  }
  for (const list of [result.written, result.unchanged]) list.sort();
  const manifest = `${JSON.stringify({ generator: VERSION, ...(inputHash ? { inputHash } : {}), files: Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : 1)), skipped: result.skipped }, null, 2)}\n`;
  if (!fs.existsSync(manifestFile) || fs.readFileSync(manifestFile, "utf8") !== manifest) writeWhole(manifestFile, manifest);
  return result;
}

export async function main(packageDir = ".") {
  const { written, unchanged, removed, skipped } = await generateTests(packageDir);
  const said = (s: Skipped) => `  ${s.file}${s.export === "*" ? "" : `, ${s.export}`}: ${s.reason}`;
  const modules = skipped.filter((s) => s.export === "*"), exports = skipped.filter((s) => s.export !== "*");
  if (modules.length) throw new Error(`generated tests: ${modules.length} ${modules.length === 1 ? "module gets" : "modules get"} no test; make each declare what can be tested, or rename it:\n${modules.concat(exports).map(said).join("\n")}`);
  console.log(`generated tests: ${written.length} written, ${unchanged.length} unchanged, ${removed.length} removed, ${exports.length} skipped${exports.length ? ", which get no test:" : ""}`);
  for (const s of exports) console.log(said(s));
}
