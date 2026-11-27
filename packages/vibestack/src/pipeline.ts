import { InstallationChanged } from "./installed.ts";
// The spec pipeline and command line, which spec.ts runs. Parsing, review, generation, simulation and proof each have one implementation.
import { channel } from "node:diagnostics_channel";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Model } from "./gen.ts";
import { conformance, type Machine } from "./conform.ts";
import { explore } from "./explore.ts";
import { abandonedProof, ensuresOf, LIB_FILE, libraryFor, proofPaths, prove, type Offered, type Proof } from "./prove.ts";
import { run } from "./run.ts";
import { cacheDirectory, loadConfig, type VibestackMode } from "./config.ts";
import { doctor, formatDoctorReport } from "./doctor.ts";
import { launchCreate, launchStudio, runCiCommand, runConformanceCommand, runExploreCommand, startPhaseTimings } from "./commands.ts";
import { formatUpgradeResult, initProject, linkAgents, upgradeProject, type InitOptions } from "./upgrade.ts";
import { readSpecs, badSpecName, specFiles, specName, isStd, located, type Spec } from "./parse.ts";
import { citationLookup, pending, pendingKey, pendingContracts, acceptAllReviews, pendingSpecs, moved, showPending, ledgerFile, readReviewLock, writeLedger, type Pending, type Accepted, type ReviewLock } from "./review.ts";
import { dafnyVersion, entry, recall, remembered, store, certifyInstallation, collectGarbage, isActionEntry, withStableInstallation, type Memory } from "./cache.ts";
import { generated, mirrorGen, publishGen, typecheckAll, proofUnits, proofFiles, strayProofFiles } from "./units.ts";
import { simulation, type Simulation } from "./simulate.ts";
import { runTasks } from "./tasks.ts";
import { tests } from "./testing/check.ts";
import { sha, indent, packageScripts, pruneSidecars, configuredSnapshot, watchStamp, testInputs, readSrc, codeDirs, codeDirOf, owner, specOwnerPaths, projectRoot, allDone, UNREAD, workspacePackages, fileDigestIfExists, withSpecDir, type Reported, type SrcFile, type WatchedPath } from "./util.ts";
import { profile, type TestProfile } from "./testing/profile.ts";

export { readSpecs, parseSpec, expandListHelpers, type Spec, type Rule, type Story } from "./parse.ts";
export { pending, pendingKey, pendingContracts, acceptReviews, acceptContracts, dependencies, type Lock, type Pending } from "./review.ts";
export { generated, typecheckAll, checkVerifiedSource } from "./units.ts";
export { replay, type Step } from "./simulate.ts";
export { danglingCitations } from "./util.ts";
export { scanSpec } from "./scan.ts";

export interface Result { ok: boolean; stage: "model" | "always" | "sometimes" | "replay" | "types" | "proof" | "tests" | "traces" | "explore" | "review" | "skipped"; summary: string; detail: string; where?: string; /** The rules the result concerns, each by its spec and key. */ rules?: { file: string; key: string }[] }
/** The Node these tools run on: the major release .nvmrc pins, and the root's `engines` floor. */
export const NODE = 26;
export const show = ({ ok, stage, summary, detail }: Result) => `${stage === "skipped" ? "-" : ok ? "✓" : "✗"} ${stage.padEnd(9)} ${summary}${detail ? "\n" + detail.trimEnd() : ""}`;

/** Whether `accept` can record a check: every stage but review passed, every story has rules and every rule has Quint. */
export const acceptable = (results: Result[]) => results.every((r) => r.ok || r.stage === "review") && !results.some((r) => !r.ok && /story has no rules|not formalized/.test(r.detail));

/** The one most useful thing to do after a check, given what it found. */
export function nextStep(results: Result[]): string {
  const first = results.find((r) => !r.ok && r.stage !== "review");
  const about = first?.where ? ` (${first.where})` : "";
  if (first) {
    const what: Record<string, string> = {
      model: "fix the spec where the model stage points",
      always: "read the trace: fix the model, or add the rule that forbids it",
      sometimes: "make the goal reachable: loosen the guard, add the transition, or define <param>Values",
      replay: "the generated TypeScript disagrees with Quint, a bug in the tools: report it",
      types: "update src/ and test/ to the generated contract",
      proof: "prove what is listed in the unit's proof file, or fix what Dafny could not check",
      tests: "fix the application or its tests",
      traces: "fix the program where it departs from the spec, or the spec if the program is right",
      explore: "fix the page where it breaks the property, or test/bombadil.ts if the property no longer says what the rules ask",
    };
    // A counterexample the traces stage saved is replayed first from now on, until one side changes.
    const saved = first.stage === "traces" && first.detail.match(/Saved as (\S+), which/)?.[1];
    if (saved) return `${first.stage}${about} is the first ✗: it saved the counterexample ${saved}. Decide which side is wrong: fix the application if the spec says what the user wants, or else the spec; then run \`pnpm check\` again, which replays it first`;
    return `${first.stage}${about} is the first ✗: ${what[first.stage]}, then run \`pnpm check\` again`;
  }
  if (results.every((r) => r.ok)) return "all green";
  if (!acceptable(results)) return "write the rules and Quint the review items ask for, then run `pnpm check` again";
  return "read each review item above; when prose and Quint agree, the user runs `pnpm accept`";
}

/** Take the project's lock for one check, accept or gen at a time; returns what releases it. A lock left by a process that has ended is taken over. */
function lockProject(root: string, cache = cacheDirectory(root)): () => void {
  const file = path.join(cache, "lock");
  fs.mkdirSync(cache, { recursive: true });
  const alive = (pid: number) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const holderOf = (lock: string) => { try { return parseInt(fs.readFileSync(lock, "utf8"), 10); } catch { return NaN; /* removed in the meantime */ } };
  const refuse = (holder: number): never => { throw new Error(`another check or accept is running in this project (process ${holder}); wait for it to finish. If no such process is running, delete ${path.relative(root, file)}`); };
  for (let attempt = 0; ; attempt++) {
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      fs.writeFileSync(tmp, `${process.pid}\n`);
      fs.linkSync(tmp, file);
      return () => fs.rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    const holder = holderOf(file);
    if (alive(holder) || attempt) refuse(holder);
    // A rename moves the stale lock away for one process only. One that moved the lock of a process that had just
    // taken over instead puts it back.
    const stale = `${file}.${process.pid}.stale`;
    try { fs.renameSync(file, stale); } catch { continue; }
    const moved = holderOf(stale);
    if (alive(moved)) {
      try { fs.linkSync(stale, file); } catch { /* taken again in the meantime */ }
      fs.rmSync(stale, { force: true });
      refuse(moved);
    }
    fs.rmSync(stale, { force: true });
  }
}

/**
 * Each spec's module written to gen/: its model as it is generated, or why it has none. The owners' gen/ follows once
 * every module is written (units.ts, `mirrorGen`).
 */
async function* generating(memory: Memory, specs: Spec[], output = memory.root, staged?: Map<string, string>): AsyncGenerator<{ spec: Spec; model: Model; error?: undefined } | { spec: Spec; model?: undefined; error: Error }> {
  const models = new Map<string, Model>();
  const typed = typecheckAll(memory, specs, output, staged);
  try {
    for (const spec of specs) {
      const missing = spec.imports.find((i) => !models.has(i));
      yield missing ? { spec, error: new Error(`it imports ${missing}, which is not a valid model`) }
        : await typed.get(spec.name)!.then((ir) => ({ spec, model: generated(output, spec, ir, models, staged) })).catch((error: Error) => ({ spec, error }));
    }
  } finally {
    // A caller that stops early must not restore gen/ while a typecheck still writes into it.
    await Promise.allSettled(typed.values());
  }
}

const canSimulate = (model: Model) => !!model.stateType || !!model.laws.length || !!model.evals.length;

/** Warm the normal simulation actions for these module names in a disposable project, using a snapshot from readSpecs. */
export async function precomputeSimulations(root: string, specs: Spec[], targets: readonly string[]): Promise<Result[]> {
  return (await precomputedSimulations(root, specs, targets)).results;
}

interface SimulationPreparation { results: Result[]; seedDirectory?: string; partialDirectory?: string }
interface CapturedSimulation { complete: boolean; receipts: Map<string, Uint8Array> }

/** Prepare the selected simulations and capture certified receipts for a trusted runner. */
export async function prepareSimulationReceipts(root: string, specs: Spec[], targets: readonly string[], seedParent: string): Promise<SimulationPreparation> {
  const { results, captured } = await precomputedSimulations(root, specs, targets, true);
  if (!captured?.receipts.size) return { results };
  const directory = writeSimulationSeed(seedParent, captured.receipts);
  return captured.complete ? { results, seedDirectory: directory } : { results, partialDirectory: directory };
}

function writeSimulationSeed(parent: string, receipts: ReadonlyMap<string, Uint8Array>): string {
  const owned = fs.mkdtempSync(path.join(path.resolve(parent), "simulation-receipts-"));
  const writing = path.join(owned, "writing");
  const seed = path.join(owned, "seed");
  try {
    fs.mkdirSync(writing);
    for (const [name, bytes] of receipts) fs.writeFileSync(path.join(writing, name), bytes, { flag: "wx" });
    fs.renameSync(writing, seed);
    return seed;
  } catch (error) {
    fs.rmSync(owned, { recursive: true, force: true });
    throw error;
  }
}

async function precomputedSimulations(root: string, specs: Spec[], targets: readonly string[], capture = false): Promise<{ results: Result[]; captured?: CapturedSimulation }> {
  const requested = new Set(targets);
  if (!requested.size) return { results: [] };
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const selected = new Map<string, Spec>();
  const include = (name: string) => {
    if (selected.has(name)) return;
    const spec = byName.get(name);
    if (!spec) throw new Error(`no spec has the module name "${name}"`);
    for (const imported of spec.imports) include(imported);
    selected.set(name, spec);
  };
  for (const name of requested) include(name);

  const release = lockProject(root);
  try {
    return await withStableInstallation(async () => {
      const memory: Memory = { root, fresh: false, used: new Set() };
      const receipts = capture ? { typechecks: new Map<string, Uint8Array>(), simulations: new Map<string, Uint8Array>() } : undefined;
      const generation: Memory = receipts ? { ...memory, captureReceipt: ({ name, bytes }) => {
        if (isActionEntry(name)) receipts.typechecks.set(name, bytes);
      } } : memory;
      const simulators: Memory = receipts ? { ...memory, captureReceipt: ({ name, bytes }) => {
        if (name.startsWith("simulate-")) receipts.simulations.set(name, bytes);
      } } : memory;
      const loaded = fs.mkdtempSync(path.join(cacheDirectory(root), "precompute-"));
      const started = new Map<string, Promise<Simulation>>();
      const { seed } = profile("normal");
      try {
        fs.writeFileSync(path.join(loaded, "package.json"), '{"type":"module"}\n');
        for await (const { spec, model, error } of generating(generation, [...selected.values()], root, new Map())) {
          if (!model) throw error;
          const file = path.join(loaded, `${spec.name}.ts`);
          fs.writeFileSync(file, model.ts);
          if (!requested.has(spec.name) || !canSimulate(model)) continue;
          const domain = await import(pathToFileURL(file).href);
          const result = simulation(simulators, spec, specs, model, domain, seed);
          void result.catch(() => {});
          started.set(spec.name, result);
        }
        const simulations = await allDone([...requested].map((name) => started.get(name)).filter((result) => result !== undefined));
        certifyInstallation();
        const results = simulations.flatMap(({ said }) => said);
        if (!receipts) return { results };
        const complete = receipts.typechecks.size === selected.size && receipts.simulations.size === started.size && results.every((row) => row.ok);
        return { results, captured: { complete, receipts: new Map([...receipts.typechecks, ...receipts.simulations]) } };
      } finally {
        await Promise.allSettled(started.values());
        fs.rmSync(loaded, { recursive: true, force: true });
      }
    });
  } finally {
    release();
  }
}

// One sequence even when an application loads more than one copy of the tools.
const CHECK_RUN = Symbol.for("vibestack.checkRun");
const checkRuns = globalThis as typeof globalThis & { [CHECK_RUN]?: number };

/**
 * Run every check, cheapest first, and return what each found and the next
 * thing to do; `log` hears of each result as it arrives. Stages after a broken
 * model are skipped, and said to be, because their failures would only restate
 * the first one. `accept` is "reviews" to record reconciled stories, rules and
 * contracts, or "unproved" to record the obligations that are simulated but not
 * proved; either way nothing remembered from an earlier run is used. Only one
 * check or accept runs in a project at a time; another is refused.
 */
export async function check(root: string, accept: false | "reviews" | "unproved" = false, log?: (result: Result) => void, mode: TestProfile = "normal"): Promise<{ ok: boolean; results: Result[]; next: string; wrote: Map<string, string> }> {
  // The tests stage names the project that is checking: checking it again from its tests, or from an owner's, which are
  // below it, would wait on its lock or rewrite the gen/ those tests read.
  const fromTests = process.env.SPEC_TESTS ? path.relative(process.env.SPEC_TESTS, fs.realpathSync(root)) : undefined;
  if (fromTests !== undefined && fromTests.split(path.sep)[0] !== ".." && !path.isAbsolute(fromTests)) throw new Error("a test script cannot run spec check or accept: the check already runs the tests");
  const wrote = new Map<string, string>();
  let cache: string;
  try {
    cache = cacheDirectory(root);
  } catch (error) {
    const result: Result = { ok: false, stage: "model", summary: error instanceof Error ? error.message : String(error), detail: "" };
    const results = [result];
    log?.(result);
    return { ok: false, results, next: nextStep(results), wrote };
  }
  const release = lockProject(root, cache);
  const phases = observePhases(root);
  // A retry must reproduce every row already streamed before it can report another.
  const reported: Result[] = [];
  const attempt = async () => {
    // Separate module instances in this process, with repeatable paths for Node's on-disk compile cache across processes.
    const run = (checkRuns[CHECK_RUN] ?? 0) + 1;
    checkRuns[CHECK_RUN] = run;
    const loaded = path.join(cache, `run-${run}`);
    const results: Result[] = [];
    let diverged = false;
    const report = (result: Result) => {
      if (results.length < reported.length) diverged ||= !isDeepStrictEqual(result, reported[results.length]);
      else if (!diverged && log) {
        reported.push(result);
        log(result);
      }
      results.push(result);
    };
    const confirmReported = () => {
      if (diverged || results.length < reported.length) throw new InstallationChanged();
    };
    try {
      fs.rmSync(loaded, { recursive: true, force: true });
      await checkLocked(root, accept, loaded, report, mode, wrote, confirmReported, phases?.start);
      confirmReported();
      return { ok: results.every((r) => r.ok), results, next: nextStep(results), wrote };
    } finally {
      phases?.finish();
      fs.rmSync(loaded, { recursive: true, force: true });
    }
  };
  try {
    return await withStableInstallation(attempt);
  } finally {
    release();
  }
}

/**
 * The proof stage, run while the simulations and the typechecks do: what it reports, in order, and the proposed ledger if it passes.
 */
async function proofStage(root: string, memory: Memory, specs: Spec[], models: Model[], srcFiles: SrcFile[], accepted: Record<string, Accepted | undefined>, accept: false | "reviews" | "unproved", stopped: AbortSignal): Promise<{ results: Result[]; ledger?: Record<string, Accepted> }> {
  const results: Result[] = [];
  const said = (ok: boolean, summary: string, detail = "", where?: string, rules: Result["rules"] = []) =>
    results.push({ ok, stage: "proof", summary, detail, ...(where ? { where } : {}), ...(rules.length ? { rules } : {}) });
  if (stopped.aborted) return { results };
  const proofMemory: Memory = { ...memory, actionSignal: stopped };
  try {
    const ledger: Record<string, Accepted> = {};
    const units = proofUnits(root, models, srcFiles);
    const specDir = loadConfig(root).spec.dir;
    for (const { file, emptySpec } of strayProofFiles(root, units, models))
      said(false, emptySpec ? `${file} has nothing to prove: ${emptySpec} defines no type or value; delete the proof file, or write in ${emptySpec} the rules it proves`
        : `${file} belongs to no proof unit: ${specDir}/<name>.proof.dfy belongs to ${specDir}/<name>.md, and src/<path>.proof.dfy to src/<path>.ts if that file contains //@`, "", file);
    const dafnyProblem = units.length > 0 && (await dafnyVersion()).problem;
    if (dafnyProblem) throw new Error(dafnyProblem);
    const lib = fs.readFileSync(LIB_FILE, "utf8");
    const proved = new Map<string, Proof>();
    // Units are proved at the same time and reported in order. One with a proof file is offered the clauses of each
    // `_ensures` lemma of the units it imports that those units proved in this run. While one of them is still being
    // proved, it is proved meanwhile with all of them offered, and keeps that result only if they proved them all;
    // otherwise it is proved again with the clauses they did prove.
    const running = new Map<string, Promise<Proof | undefined>>();
    const remembering = new Map<string, Promise<boolean>>();
    const proofTexts = new Map<string, string | undefined>();
    for (const u of units) {
      const proofPath = located(root, u.proofFile);
      const proofText = fs.existsSync(proofPath) ? fs.readFileSync(proofPath, "utf8") : undefined;
      proofTexts.set(u.unit, proofText);
      let recalled!: (hit: boolean) => void;
      remembering.set(u.unit, new Promise((settle) => { recalled = settle; }));
      const proving = (axioms: Offered[], discarded?: () => boolean) => remembered<Proof | typeof abandonedProof>(proofMemory, entry(root, "prove", [JSON.stringify({ ...u, text: undefined }), proofText ?? "", proofText === undefined ? "" : libraryFor(lib, proofText) ?? "", JSON.stringify(axioms)]),
        (memory) => {
          recalled(false);
          if (stopped.aborted) return abandonedProof;
          return prove(memory, u, { proof: proofText === undefined ? undefined : { file: u.proofFile, text: proofText }, lib, axioms }, () => stopped.aborted || !!discarded?.());
        }, (p) => !stopped.aborted && p !== abandonedProof && !p.errors.length);
      running.set(u.unit, (async () => {
        const imports = proofText === undefined ? [] : u.imports.lemmas;
        const offered = imports.map(({ fn }) => ({ fn }));
        const settled = (await Promise.all(imports.map(({ from }) => remembering.get(from) ?? Promise.resolve(false)))).every(Boolean);
        let discarded = false;
        const first = settled ? undefined : proving(offered, () => discarded);
        // A clause of an imported lemma is offered only if its own unit proved it, in this run; none of them is if
        // one of the lemma's failures is not one of its clauses. A lemma its unit does not generate has none.
        const resolving = Promise.all(imports.map(async ({ fn, def, from }) => {
          const p = await running.get(from)?.catch(() => undefined);
          if (!p || p.errors.length) {
            discarded = true;
            return undefined;
          }
          const clauses = ensuresOf(p.dfy, `${def}_ensures`).map((c) => `${def}: ${c}`);
          const failed = p.unproved.filter((x) => x.startsWith(`${def}: `));
          const known = failed.every((x) => clauses.includes(x));
          const clausesProved = clauses.map((c) => known && !failed.includes(c));
          discarded ||= clausesProved.includes(false);
          return { fn, proved: clausesProved };
        }));
        await Promise.allSettled(first ? [first, resolving] : [resolving]);
        if (stopped.aborted) return;
        const resolved = await resolving;
        const proof = discarded ? await proving(resolved.filter((r): r is Required<Offered> => !!r?.proved.length))
          : await (first ?? proving(offered));
        if (stopped.aborted) return;
        if (proof === abandonedProof) throw new Error(`the selected proof of ${u.unit} was abandoned`);
        proved.set(u.unit, proof);
        return proof;
      })().finally(() => recalled(true)));
    }
    // Every unit finishes, whatever another one does, before anything is reported.
    await allDone(units.map((u) => running.get(u.unit)!));
    if (stopped.aborted) return { results };
    const writeIfChanged = (file: string, text: string) => {
      let existing: string | undefined;
      try { existing = fs.readFileSync(file, "utf8"); } catch { existing = undefined; }
      if (existing !== text) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
    };
    const proofRoot = path.join(root, "gen/proof");
    const keptProofFiles = new Set<string>();
    const keptProofDirs = new Set<string>();
    for (const u of units) {
      const proofText = proofTexts.get(u.unit);
      const proof = proved.get(u.unit)!;
      const { dir: unitDir, log: logFile, dfy, scaffold } = proofPaths(u.unit);
      // The final Dafny stays on disk even when the result was remembered, so that it can be read.
      const absDir = path.join(root, unitDir);
      const absLog = path.join(root, logFile);
      const dfyFile = path.join(root, dfy);
      const absScaffold = path.join(root, scaffold);
      keptProofDirs.add(absDir);
      keptProofFiles.add(absLog);
      writeIfChanged(absLog, proof.log);
      if (proof.dfy) {
        keptProofFiles.add(dfyFile);
        writeIfChanged(dfyFile, proof.dfy);
      }
      if (proof.scaffold) {
        keptProofFiles.add(absScaffold);
        writeIfChanged(absScaffold, proof.scaffold);
      } else if (fs.existsSync(absScaffold)) {
        fs.rmSync(absScaffold, { force: true });
      }
      // What was accepted is tied to the Quint and the proof file it was accepted for, as the proof's cache entry is.
      const meaning = sha(u.meaning, proofText ?? "").slice(0, 12);
      const was = accepted[u.unit];
      const valid = !u.src && was?.text === meaning ? was.unproved : [];
      const outdated = was && was.text !== meaning ? `; the ${was.unproved.length} accepted earlier were accepted for another text of this unit or its proof file, and no longer count` : "";
      const fresh = proof.unproved.filter((x) => !valid.includes(x));
      const retained = accept === "unproved" ? proof.unproved : valid.filter((x) => proof.unproved.includes(x));
      if (!u.src && retained.length) ledger[u.unit] = { text: meaning, unproved: retained };
      const start = proof.scaffold ? `\n      their lemmas without a body yet, each with one to start from: ${scaffold}` : "";
      /** The rules the obligations name: the transition or law each is of, and every definition its clause mentions. */
      const named = (xs: string[]) => {
        const spec = specs.find((s) => `${s.name}.ts` === u.unit);
        const words = new Set(xs.join(" ").match(/[A-Za-z_]\w*/g));
        return spec?.rules.filter((r) => r.defs.some((d) => words.has(d))).map((r) => ({ file: spec.file, key: r.key }));
      };
      const listed = (xs: string[]) => indent(xs.map((x) => x + (proof.exhausted.includes(x) ? "   [the prover ran out of resources]" : "") + (proof.resting[x] ? `   [rests on ${proof.resting[x]}]` : "")).join("\n"));
      // Hand-written code proved against a module that is only partly proved rests on what is not.
      const assumed = u.rests.flatMap((r) => (proved.get(r)?.unproved.length ? [`${proved.get(r)!.unproved.length} of ${r}`] : []));
      const assuming = (assumed.length ? `, assuming the obligations that are simulated only (${assumed.join(", ")})` : "")
        // A precondition is assumed by the proof and checked by no one: callers outside verified code must meet it.
        + (u.requires ? `, under ${u.requires} //@ requires that its unverified callers must meet` : "");
      if (proof.errors.length) {
        said(false, `${u.unit}: Dafny could not check it (full output in ${logFile}, final Dafny in ${dfy})`, indent(proof.errors.join("\n")), u.unit);
      } else if (u.src && proof.unproved.length) {
        said(false, `${u.unit}: ${proof.unproved.length} of ${proof.total} obligations not proved. Hand-written code is not simulated, so they must be proved in ${u.proofFile}. Full output in ${logFile}, final Dafny in ${dfy}`, listed(proof.unproved) + start, u.unit);
      } else if (fresh.length && accept !== "unproved") {
        said(false, `${u.unit}: ${fresh.length} of ${proof.total} obligations not proved${outdated}. Prove them in ${u.proofFile}, or add the rule that makes them provable; if simulation is enough for them, that is the user's decision (\`pnpm accept unproved\`). Full output in ${logFile}, final Dafny in ${dfy}`, listed(fresh) + start, u.unit, named(fresh));
      } else {
        said(true, `${u.unit}: ${proof.unproved.length ? `${proof.total} obligations, of which ${proof.unproved.length} are simulated only (accepted) and the rest proved` : `all ${proof.total} obligations proved`} for all states and inputs${assuming}`, [
            ...(proof.unproved.length ? [`    simulated only, accepted in spec/lock.json:\n${listed(proof.unproved)}`] : []),
            ...(assumed.length ? [`    assumed from the module it is proved against, simulated only there:\n${indent(u.rests.flatMap((name) => (proved.get(name)?.unproved ?? []).map((clause) => `${name}: ${clause}`)).join("\n"))}`] : []),
          ].join("\n"), u.unit);
      }
    }
    if (fs.existsSync(proofRoot)) {
      if (!units.length) fs.rmSync(proofRoot, { recursive: true, force: true });
      else {
        for (const item of fs.readdirSync(proofRoot, { withFileTypes: true })) {
          const full = path.join(proofRoot, item.name);
          if (item.isDirectory()) {
            if (!keptProofDirs.has(full)) fs.rmSync(full, { recursive: true, force: true });
          } else if (!keptProofFiles.has(full)) {
            fs.rmSync(full, { force: true });
          }
        }
      }
    }
    return { results, ...(results.every((r) => r.ok) ? { ledger } : {}) };
  } catch (e) {
    if (e instanceof InstallationChanged) throw e;
    if (!stopped.aborted) said(false, (e as Error).message);
    return { results };
  }
}

interface TypecheckCache {
  read: [string, string][];
  configured: [string, string][];
  safeSkip: boolean;
  watched: [string, string, boolean?][];
}

function sameEntries(a: readonly [string, string][], b: readonly [string, string][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

/**
 * VibeLang's typecheck of one of `codeDirs`, remembered after a pass until what it read changes: the package's inputs
 * but its prose (util.ts, `testInputs`), its tsconfig.json, the configurations it extends and the files they include,
 * and each file outside node_modules that the passing compile read. Installed packages are the lock file's, and the
 * compiler and its library are the stage's toolchain (cache.ts).
 */
async function typecheck(memory: Memory, root: string, dir: string, compiler: "vibelang" | "tsc" = "vibelang"): Promise<{ ok: boolean; out: string }> {
  const at = path.join(root, dir);
  if (compiler === "vibelang") pruneSidecars(at);
  const contents = (files: string[]) => files.map((file): [string, string] => [path.relative(root, file), fileDigestIfExists(file)]);
  const matches = (saved: [string, string][]) => saved.every(([rel, expected]) => fileDigestIfExists(path.join(root, rel)) === expected);
  const stamps = (paths: readonly WatchedPath[]) => paths.map((entry): [string, string, boolean?] =>
    entry.shallow ? [path.relative(root, entry.path), watchStamp(entry.path, true), true] : [path.relative(root, entry.path), watchStamp(entry.path)]);
  const inputs = testInputs(at, "normal", "types");
  const kept = inputs === undefined ? undefined : await entry(root, "types", ["types-v4", compiler, dir, inputs]);
  const passed = kept && recall<TypecheckCache>(memory, kept);
  if (passed && matches(passed.read)) {
    if (passed.safeSkip
      && matches(passed.configured)
      && passed.watched.every(([rel, expected, shallow]) => watchStamp(path.join(root, rel), shallow) === expected)) {
      return { ok: true, out: "" };
    }
    const snapshot = configuredSnapshot(at);
    if (sameEntries(passed.configured, contents(snapshot.files))) return { ok: true, out: "" };
  }
  const r = await run(compiler, ["--noEmit", "--listFiles", "-p", "."], at);
  const lines = r.out.split("\n");
  const local = (line: string) => path.isAbsolute(line) && fs.existsSync(line);
  if (r.ok && kept) {
    const snapshot = configuredSnapshot(at);
    store(memory, kept, {
      read: contents(lines.filter((line) => local(line) && !line.split(/[\\/]/).includes("node_modules"))),
      configured: contents(snapshot.files),
      safeSkip: snapshot.safeSkip,
      watched: stamps(snapshot.watched),
    } satisfies TypecheckCache);
  }
  return { ok: r.ok, out: lines.filter((line) => !line.startsWith("bundled:///") && !local(line)).join("\n") };
}

type CheckPhase = "generation" | "simulation" | "types" | "proof" | "tests" | "traces" | "explore" | "review";
type EndPhase = (at?: number) => void;
type StartPhase = (phase: CheckPhase) => EndPhase;
const checkPhases = channel("vibestack:check:phase");

function observePhases(root: string): { start: StartPhase; finish: () => void } | undefined {
  if (!checkPhases.hasSubscribers) return;
  const started = performance.now();
  const checkStartedAt = performance.timeOrigin + started;
  const open = new Set<EndPhase>();
  return {
    start(phase) {
      const publish = (event: "start" | "end", at: number) => checkPhases.publish({ root, checkStartedAt, phase, event, elapsedMs: at - started });
      const end = (at = performance.now()) => {
        if (open.delete(end)) publish("end", at);
      };
      open.add(end);
      publish("start", performance.now());
      return end;
    },
    finish: () => { for (const end of open) end(); },
  };
}

async function checkLocked(root: string, accept: false | "reviews" | "unproved", loaded: string, log: (result: Result) => void, mode: TestProfile, wrote: Map<string, string>, confirmReported: () => void, observe?: StartPhase) {
  const generated = observe?.("generation");
  const { seed } = profile(mode);
  let allOk = true;
  const report = (r: Result) => { allOk &&= r.ok; log(r); };
  const skip = (stages: string, why: string) => report({ ok: true, stage: "skipped", summary: `${stages}: ${why}`, detail: "" });
  const config = loadConfig(root);
  /** The cache entries this run uses stay; recent entries of other branches and profiles survive pruning. */
  const memory: Memory = { root, fresh: !!accept || mode === "nightly", used: new Set() };
  let specs: Spec[];
  let srcFiles: SrcFile[];
  const proofInputs = () => proofFiles(root).map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]);
  let proofsRead: string[][] = [];
  let lock: ReviewLock;
  /** The scripts of the root and of each owner, by its prefix (util.ts, `codeDirs`). */
  let scripts: Map<string, Record<string, string>>;
  try {
    srcFiles = readSrc(root);
    if (accept) proofsRead = proofInputs();
    specs = readSpecs(root);
    lock = readReviewLock(root);
    scripts = new Map(codeDirs(root).map((dir) => [dir, packageScripts(path.join(root, dir))]));
  } catch (e) {
    generated?.();
    report({ ok: false, stage: "model", summary: (e as Error).message, detail: "" });
    return;
  }
  const dirs = [...scripts.keys()];
  const valid: Spec[] = [];
  const models: Model[] = [];
  const machines = new Map<string, Machine>();
  /** Each spec's simulation starts once its model is generated; they run at once and are reported in the specs' order. */
  const simulations: { spec: Spec; model: Model; domain: any; simulated: Promise<Simulation> }[] = [];
  const proofWork = new AbortController();
  let loadedReady = false;
  let simulatedAll: EndPhase | undefined;
  let lastSimulation: number | undefined;
  const simulationSettled = observe && (() => { lastSimulation = performance.now(); });

  for await (const { spec, model, error } of generating(memory, specs)) {
    let domain: any;
    try {
      if (!model) throw error;
      models.push(model);
      if (!loadedReady) {
        fs.mkdirSync(loaded, { recursive: true });
        fs.copyFileSync(path.join(root, "gen", "package.json"), path.join(loaded, "package.json"));
        loadedReady = true;
      }
      fs.copyFileSync(path.join(root, "gen", `${spec.name}.ts`), path.join(loaded, `${spec.name}.ts`));
      domain = await import(pathToFileURL(path.join(loaded, `${spec.name}.ts`)).href);
    } catch (e) {
      if (e instanceof InstallationChanged) {
        await Promise.allSettled(simulations.map((s) => s.simulated));
        throw e;
      }
      report({ ok: false, stage: "model", summary: `${spec.file} is not a valid model`, detail: indent((e as Error).message.trim()), where: spec.file });
      skip(`always, sometimes and replay of ${spec.file}`, "it is not a valid model");
      continue;
    }
    valid.push(spec);
    const parts = [[model.transitions.length, "transitions"], [model.always.length, "always"], [model.steps.length, "step"], [model.leadsTo.length, "leadsTo"], [model.sometimes.length, "sometimes"], [model.laws.length, "laws"], [model.opaques.length, "opaque"]];
    report({ ok: true, stage: "model", summary: `${spec.file}: ${parts.filter(([n]) => n).map((p) => p.join(" ")).join(", ") || "definitions only"}`, detail: "", where: spec.file });
    if (!canSimulate(model)) continue;
    if (observe && !simulations.length) simulatedAll = observe("simulation");
    const simulated = simulation(memory, spec, specs, model, domain, seed).then((simulation) => {
      if (simulation.said.some((result) => !result.ok && result.stage === "sometimes")) proofWork.abort();
      return simulation;
    }, (error) => {
      proofWork.abort();
      throw error;
    });
    // Report a rejected simulation in the same order as other results.
    if (simulationSettled) void simulated.then(simulationSettled, simulationSettled);
    else simulated.catch(() => {});
    simulations.push({ spec, model, domain, simulated });
  }
  /** A result about an owner's code names its package; the root's own reads as it always has. */
  const within = (dir: string, r: Result): Result => (dir ? { ...r, summary: `${dir.slice(0, -1)}: ${r.summary}`, where: dir.slice(0, -1) } : r);
  const result = ([ok, stage, summary, detail = "", where]: Reported): Result => ({ ok, stage, summary, detail: ok ? "" : detail, ...(where ? { where } : {}) });
  const restates = "a stage above failed, and their failures would only restate it";
  let ledger: Record<string, Accepted> | undefined;
  // None is left writing into gen/ when the check goes on or returns.
  const running: Promise<unknown>[] = simulations.map((s) => s.simulated);
  if (simulatedAll) {
    const end = simulatedAll;
    void Promise.allSettled(running).then(() => end(lastSimulation));
  }
  try {
    mirrorGen(root, specs);
    generated?.();
    // The typechecks and the proofs read only what generation wrote, so they run while the simulations do.
    // VibeLang's compiler checks `.vibe`, `.ts` and `.tsx` as one program.
    // Each of the root and the owners is a program of its own, checked against its own gen/.
    const started = allOk ? (() => {
      const typed = config.stages.types === "skip" ? undefined : observe?.("types");
      const typechecks = config.stages.types === "skip"
        ? []
        : dirs.map(async (dir) => fs.existsSync(path.join(root, dir, "tsconfig.json")) ? typecheck(memory, root, dir, config.stages.types as "vibelang" | "tsc") : undefined);
      if (typed) void Promise.allSettled(typechecks).then(() => typed());
      const proved = observe?.("proof");
      const proving = proofStage(root, memory, specs, models, srcFiles, lock.unproved, accept, proofWork.signal);
      if (proved) void proving.then(() => proved(), () => proved());
      return { typechecks, proving };
    })() : undefined;
    if (started) for (const p of [...started.typechecks, started.proving]) running.push(p.catch(() => {}));
    for (const { spec, model, domain, simulated } of simulations) {
      const { said, tested } = await simulated;
      if (tested) machines.set(model.name, { domain, model, found: tested });
      said.forEach(report);
      const ran = new Set(said.map((r) => r.stage));
      const notRun = (["sometimes", "replay"] as const).filter((s) => !ran.has(s) && (s !== "sometimes" || model.sometimes.length));
      if (notRun.length && said.some((r) => !r.ok)) skip(`${notRun.join(" and ")} of ${spec.file}`, "simulation stopped at the failure above");
    }

    if (!started || !allOk) skip("types, proof, tests, traces and explore", restates);
    else {
      // The typechecks are reported first.
      if (config.stages.types === "skip") {
        skip("types", "disabled by vibestack config");
      } else {
        const typesResults = await Promise.allSettled(started.typechecks);
        const compilerLabel = config.stages.types === "tsc" ? "TypeScript" : "VibeLang";
        for (const [i, dir] of dirs.entries()) {
          const result = typesResults[i];
          const types = (ok: boolean, summary: string, detail = "") => report(within(dir, { ok, stage: "types", summary, detail: ok ? "" : detail, where: "src/ and test/" }));
          if (result.status === "rejected") {
            if (result.reason instanceof InstallationChanged) throw result.reason;
            types(false, `the ${compilerLabel} compiler could not run`, indent(String(result.reason)));
          }
          else if (result.value) types(result.value.ok, result.value.ok ? "application typechecks against the generated contract" : "application does not fit the generated contract", indent(result.value.out.trim()));
          else {
            const code = ["src", "test"].filter((d) => fs.existsSync(path.join(root, dir, d)));
            types(!code.length, code.length ? `${code.join(" and ")} exist but there is no tsconfig.json, so nothing checks them against the generated contract; run \`spec init\` to add one` : "skipped: there is no tsconfig.json and no src/ or test/");
          }
        }
      }
      const proofs = await started.proving;
      proofs.results.forEach(report);
      ledger = proofs.ledger;
      if (!allOk) skip("tests, traces and explore", restates);
      else {
        if (config.stages.tests === "skip") {
          skip("tests", "disabled by vibestack config");
        } else {
          const tested = observe?.("tests");
          const allTestRows = await withSpecDir(config.spec.dir, () => allDone(dirs.map((dir) =>
            tests(root, dir, specs, (key, ran, keep) => remembered(memory, entry(root, "tests", [dir, key]), ran, keep), mode, memory.fresh, config.stages.tests === "vitest"))));
          for (let i = 0; i < dirs.length; i++) for (const r of allTestRows[i]) report(within(dirs[i], result(r)));
          tested?.();
        }
        const traced = observe?.("traces");
        const allTraceRows = await allDone(dirs.map((dir) =>
          conformance(path.join(root, dir), machines, scripts.get(dir)!, (key, ran, keep) => remembered(memory, entry(root, "traces", [dir, key]), ran, keep), wrote, mode)));
        for (let i = 0; i < dirs.length; i++) for (const r of allTraceRows[i]) report(within(dirs[i], result(r)));
        traced?.();
        if (config.stages.explore === "skip") {
          skip("explore", "disabled by vibestack config");
        } else {
          const explored = observe?.("explore");
          const allExploreRows = await allDone(dirs.map((dir) =>
            explore(path.join(root, dir), (key, ran, keep) => remembered(memory, entry(root, "explore", [dir, key]), ran, keep), mode, root)));
          for (let i = 0; i < dirs.length; i++) for (const r of allExploreRows[i]) report(within(dirs[i], result(r)));
          explored?.();
        }
        // Every stage ran, so every entry still in use was read or written.
        if (memory.wrote || memory.fresh) collectGarbage(memory);
      }
    }
  } finally {
    await Promise.allSettled(running);
  }

  confirmReported();
  certifyInstallation();

  // A spec that is not a valid model has nothing to reconcile yet. Everything is recorded at once, or nothing is.
  const reviewed = observe?.("review");
  const locks = new Map(specs.map((spec) => [spec.file, lock.specs[spec.file] ?? {}]));
  const citedAt = citationLookup(root);
  const todos = valid.filter((spec) => !isStd(spec.file)).map((spec) => ({ spec, todo: pending(root, spec, specs, locks, citedAt) }));
  const contractsToDo = pendingContracts(root, srcFiles, lock);
  const removedSpecs = pendingSpecs(root, specs, lock);
  const review = (ok: boolean, summary: string, detail = "", where?: string, rules: Result["rules"] = []) =>
    report({ ok, stage: "review", summary, detail: ok ? "" : detail, ...(where ? { where } : {}), ...(rules.length ? { rules } : {}) });
  if (accept) {
    try {
      if (JSON.stringify(readSpecs(root)) !== JSON.stringify(specs) || JSON.stringify(readSrc(root)) !== JSON.stringify(srcFiles)
        || JSON.stringify(proofInputs()) !== JSON.stringify(proofsRead))
        review(false, "sources changed while the check ran; nothing was accepted", "      Run `pnpm check` again on the files now on disk.");
    } catch (e) {
      review(false, "sources changed while the check ran; nothing was accepted", indent((e as Error).message));
    }
  }
  const formal = todos.every(({ todo }) => !todo.some((t) => t.status === "story has no rules" || t.status === "not formalized"));
  const record = accept === "reviews" && allOk && formal;
  const recordExceptions = accept === "unproved" && allOk;
  if (record) acceptAllReviews(root, specs, srcFiles, { ...lock, unproved: ledger ?? lock.unproved });
  if (ledger && (record || recordExceptions)) {
    if (recordExceptions) writeLedger(root, ledger, lock);
    const entries = (l: Record<string, Accepted | undefined>) => Object.entries(l).flatMap(([unit, a]) => (a?.unproved ?? []).map((x) => `${unit}: ${x}  [${a!.text}]`));
    const [before, after] = [entries(lock.unproved), entries(ledger)];
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const line = (sign: string) => (x: string) => `    ${sign} ${x.replace(/  \[[^\]]*\]$/, "")}`;
    if (recordExceptions || removed.length) report({ ok: true, stage: "proof", summary: `${path.relative(root, ledgerFile(root))}: ${added.length} added, ${removed.length} removed`,
      detail: [...added.map(line("+")), ...removed.map(line("-"))].join("\n") });
  }
  const why = accept !== "reviews" ? "then run `pnpm accept`" : !allOk ? "nothing was accepted: fix the stages above first" : "every story needs rules and every rule a quint block before anything can be accepted";
  if (ledger && !record && accept !== "unproved") {
    const ledgerPath = path.relative(root, ledgerFile(root));
    for (const [unit, was] of Object.entries(lock.unproved)) {
      const stillUnproved = new Set(ledger[unit]?.unproved);
      const obsolete = was.unproved.filter((x) => !stillUnproved.has(x));
      if (obsolete.length) review(false, `${ledgerPath}: ${obsolete.length} obsolete simulated-only proof exception${obsolete.length === 1 ? "" : "s"} in ${unit}, ${why}`, indent(obsolete.join("\n")), ledgerPath);
    }
  }
  const items = (todo: Pending[], heading: string) => {
    const shown = moved(todo);
    return todo.map((t) => "    " + showPending(t)).join("\n") + (shown.length ? `\n\n    ${heading}:\n${shown.join("\n")}` : "");
  };
  for (const { spec, todo } of todos) {
    if (record && todo.length) review(true, `${spec.file}: recorded as reconciled: ${todo.map(pendingKey).join("; ")}`, "", spec.file);
    else review(!todo.length, todo.length ? `${spec.file}: ${todo.length} item(s) to reconcile, ${why}` : `${spec.file}: prose and model reconciled for all ${spec.rules.length} rules and ${spec.stories.length} stories`,
      items(todo, "What moved, in full"), spec.file, todo.flatMap((t) => (t.rule ? [{ file: spec.file, key: t.rule.key }] : [])));
  }
  if (removedSpecs.length) review(record, record ? "removed specs recorded as reconciled" : `${removedSpecs.length} removed spec(s) to reconcile, ${why}`,
    removedSpecs.map((p) => "    " + showPending(p)).join("\n"));
  // Contracts are reviewed package by package; one whose package is gone is still listed, under where it was.
  const proved = srcFiles.filter((u) => u.ts).map((u) => u.file);
  for (const dir of new Set([...dirs, ...contractsToDo.map((t) => codeDirOf(t.where))])) {
    const src = `${dir}src/`;
    const todo = contractsToDo.filter((t) => codeDirOf(t.where) === dir);
    const all = proved.filter((file) => codeDirOf(file) === dir).length;
    if (record && todo.length) review(true, `${src}: recorded as reconciled: ${todo.map((t) => t.where).join("; ")}`, "", src);
    else if (todo.length) review(false, `${src}: ${todo.length} contract(s) to reconcile, ${why}`, items(todo, "The contracts, in full"), src);
    else if (all) review(true, `${src}: the //@ contracts of all ${all} proved files reconciled`, "", src);
  }
  reviewed?.();
}

// --- init ----------------------------------------------------------------------------

/** Set up a project, preserving its content outside the marked Vibestack instructions. */
export function init(root: string, optionsOrWarn?: InitOptions | ((message: string) => void)): string[] {
  const options: InitOptions = typeof optionsOrWarn === "function" ? { warn: optionsOrWarn } : (optionsOrWarn ?? {});
  return initProject(root, options);
}


// --- new -----------------------------------------------------------------------------

/** A spec that passes every check as it is: one story, the state, one guarded transition, an `always` and a `sometimes` rule. */
const starter = (name: string, fence = "`".repeat(3)) => `# ${name}

What the application is for, in a sentence or two. Replace the story and its
rules with your own; SPEC.md says how to write them.

## Story: Keep a tally

> As a user, I want to add to a tally, never past its limit, so that I can
> count things up to a known number.

### A new tally is empty

${fence}quint
type Tally = { count: int }
pure val initial: Tally = { count: 0 }
${fence}

### Only a positive amount that keeps the tally within its limit can be added

The limit is ten, and the tally never passes it.

${fence}quint
pure val limit = 10
pure def canAdd(t: Tally, n: int): bool = n > 0 and t.count + n <= limit
pure def add(t: Tally, n: int): Tally = { count: t.count + n }
pure def alwaysWithinLimit(t: Tally): bool = 0 <= t.count and t.count <= limit
${fence}

### A tally can reach its limit

${fence}quint
pure def sometimesFull(t: Tally): bool = t.count == limit
${fence}
`;

/** Write a directory's index without replacing an existing specification. */
export function newSpec(root: string, name = ""): string {
  const parts = name === "index" || !name ? [] : name.split("/");
  for (const part of parts) {
    const bad = badSpecName(part);
    if (bad) throw new Error(`spec new ${name}: ${bad}`);
  }
  const specDir = loadConfig(root).spec.dir;
  const file = [specDir, ...parts, "index.md"].join("/");
  const collision = specFiles(root).find((existing) => existing !== file && specName(existing, specDir) === specName(file, specDir));
  if (collision) throw new Error(`${file} and ${collision} would have the same module name; nothing was written`);
  let directory = root;
  for (const part of [...specDir.split("/"), ...parts]) {
    directory = path.join(directory, part);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error(`${file}: spec directories may not be symlinks`);
    fs.mkdirSync(directory, { recursive: true });
  }
  const target = path.join(root, file);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || parts.length || fs.readFileSync(target, "utf8") !== "")
      throw new Error(`${file} already exists; nothing was written`);
    fs.writeFileSync(target, starter("Application"));
  } else fs.writeFileSync(target, starter(parts.at(-1) ?? "Application"), { flag: "wx" });
  return file;
}

// --- CLI -----------------------------------------------------------------------------

/** Every command: what follows its name, and what it does. */
const COMMANDS = [
  ["check", "[<directory>] [--json] [--nightly] [--timings]", "run every stage; --json prints JSON lines; --nightly uses nightly profile; --timings prints phase durations"],
  ["watch", "[<directory>]", "check again whenever spec/, src/, test/ or tsconfig.json changes"],
  ["gen", "[<directory>] [--if-valid] or --owner <name> [<directory>] or --install [--skip-gen-on-pack] [//#task…]", "write gen/ from the spec; --install prepares a checkout"],
  ["accept", "[<directory>] [unproved]", "record what was reviewed, or the obligations that are simulated only"],
  ["new", "[<path>]", "fill an empty spec/index.md, or write a starter spec/<path>/index.md"],
  ["init", "[<directory>] [--mode vibelang|typescript|specs-only] [--exclude <dirs>] [--yes]", "set up Vibestack in a project"],
  ["link", "[<directory>]", "create or refresh gitignored agent skill symlinks (postinstall-safe)"],
  ["upgrade", "[version] [--dry-run] [--from <path>] [--force]", "upgrade Vibestack, managed assets, and aligned toolchain pins"],
  ["doctor", "[<directory>] [--install-dafny]", "check Node, pnpm, Dafny 4.11, Quint, Chromium, skills, and manifest"],
  ["conformance", "[<module>] [--nightly]", "run conformance drivers and traces for one or all modules"],
  ["explore", "[<directory>] [--nightly]", "run Bombadil page exploration"],
  ["studio", "[<directory>] [--port <n>]", "open standalone Vibestack Studio"],
  ["create", "[<args>…]", "scaffold a new Vibestack project via create-vibestack"],
  ["ci", "precompute-simulations|chromium [options]", "run CI helper commands"],
  ["tests", "[<directory>]", "generate tests from a package's declared contracts"],
  ["stories", "gen [--watch] [--check]", "generate component stories"],
  ["tokens", "build|check|apply", "build, check or change design tokens"],
  ["tasks", "[<task>…]", "run the workspace's tasks through Turborepo and its cache"],
];
const USAGE = `usage: spec <command>\n\n${COMMANDS.map(([name, args, does]) => `  ${`${name} ${args}`.padEnd(40)}  ${does}`).join("\n")}`;

/**
 * Check, then check again whenever a file changes in the root or an owner, outside its gen/ and the directories no stage
 * reads (util.ts, `UNREAD`): a missed change would leave a stale pass on screen, and a run that finds nothing changed
 * comes from the cache. One process stays warm between runs
 * (the compiler, the toolchain's fingerprint and the cache are already loaded), edits that arrive during a run start
 * one more run after it, and what is unchanged comes from the cache as in any check.
 */
async function watch(root: string) {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What changed since the last run began, by path, or undefined where a watcher could not say; and what that run wrote itself. */
  const pending = new Set<string | undefined>([undefined]);
  let wrote = new Map<string, string>();
  const text = (file: string) => { try { return fs.readFileSync(file, "utf8"); } catch { return undefined; } };
  const once = async () => {
    if (running) return;
    running = true;
    while ([...pending].some((file) => file === undefined || !wrote.has(file) || wrote.get(file) !== text(file))) {
      pending.clear();
      const started = Date.now();
      console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
      attach(); // a package that came to own part of the spec tree is watched from the next run
      try {
        const checked = await check(root, false, (r) => console.log(show(r)));
        wrote = checked.wrote;
        console.log(`\nnext: ${checked.next}\n(${((Date.now() - started) / 1000).toFixed(1)}s; watching what the check reads, here and in the packages the spec names; Ctrl-C to stop)`);
      } catch (e) {
        wrote = new Map();
        console.error((e as Error).message);
      }
    }
    pending.clear();
    running = false;
  };
  const changed = (file?: string) => {
    if (file && path.relative(root, file).split(path.sep).some((part) => UNREAD.test(part))) return;
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(once, 200);
  };
  // Watch each package's directories when they exist, the workspace packages they depend on whole, and the package itself for its files and for creation, replacement and atomic saves.
  const watched = new Map<string, { watcher: fs.FSWatcher; ino: number }>();
  const inode = (dir: string) => { try { return fs.statSync(path.join(root, dir)).ino; } catch { return undefined; } };
  const read = (dir: string) => { try { return fs.readdirSync(path.join(root, dir || "."), { withFileTypes: true }); } catch { return []; } };
  const containers = ["apps", "packages"];
  const dependencies = (dir: string) => { try { return workspacePackages(path.join(root, dir)); } catch { return []; } };
  const attach = () => {
    let packages: string[];
    let owners: string[];
    let specDir: string;
    try {
      specDir = loadConfig(root).spec.dir;
      const areas = read(specDir).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      owners = codeDirs(root);
      const ownedPaths = new Set(owners.filter(Boolean).map((d) => d.slice(0, -1)));
      packages = [...containers, ...areas.flatMap((area) => specOwnerPaths(root, area)).filter((d) => !ownedPaths.has(d))];
    } catch { return; }
    const own = (dir: string) => read(dir).filter((e) => e.isDirectory() && !UNREAD.test(e.name) && e.name !== "gen" && !(dir === "" && containers.includes(e.name))
      && !fs.existsSync(path.join(root, dir, e.name, "package.json"))).map((e): [string, boolean] => [`${dir}${e.name}`, true]);
    const depended = owners.flatMap((dir) => dependencies(dir).map(({ directory }) => path.relative(root, directory)))
      .filter((dir) => dir && !dir.startsWith("..") && !path.isAbsolute(dir) && !owners.includes(`${dir}/`)).map((dir): [string, boolean] => [dir, true]);
    const dirs = new Map([...packages.map((dir): [string, boolean] => [dir, false]), ...owners.flatMap((dir): [string, boolean][] => [[dir ? dir.slice(0, -1) : ".", false], ...own(dir)]), ...depended]);
    const packageSet = new Set(packages);
    for (const dir of new Set([...dirs.keys(), ...watched.keys()])) {
      const ino = dirs.has(dir) ? inode(dir) : undefined;
      const had = watched.get(dir);
      if (had && had.ino === ino) continue;
      if (had) { had.watcher.close(); watched.delete(dir); }
      if (ino === undefined) continue;
      try {
        const watcher = fs.watch(path.join(root, dir), { recursive: dirs.get(dir) }, (_, file) => {
          if (dirs.get(dir)) changed(file ? path.join(root, dir, file) : undefined);
          else if (packageSet.has(dir)) {
            if (file && (UNREAD.test(file) || file === "gen")) return;
            const child = file && `${dir}/${file}`;
            if (child && inode(child) !== watched.get(child)?.ino) { attach(); changed(); }
          } else if (!file || (!UNREAD.test(file) && file !== "gen")) { attach(); changed(file ? path.join(root, dir, file) : undefined); }
        });
        watcher.on("error", () => { watcher.close(); if (watched.get(dir)?.watcher === watcher) watched.delete(dir); });
        watched.set(dir, { watcher, ino });
      } catch { /* the directory was removed while attaching; its next parent event retries */ }
    }
  };
  attach();
  await once();
}

async function generateFiles(root: string, output = root, ownerName?: string) {
  const generated = await withStableInstallation(async () => {
    const specs = readSpecs(root, undefined, ownerName);
    const staged = new Map<string, string>();
    const errors: string[] = [];
    for await (const { spec, error } of generating({ root, fresh: false, used: new Set() }, specs, output, staged)) {
      if (!error) continue;
      if (error instanceof InstallationChanged) throw error;
      if (!ownerName) return { error: error.message.startsWith(spec.file) ? error : new Error(`${spec.file}: ${error.message}`) };
      errors.push(`${spec.file}:\n${error.message}`);
    }
    if (errors.length) return { error: new Error(errors.join("\n")) };
    return { specs, staged };
  });
  if (generated.error) throw generated.error;
  publishGen(output, generated.staged);
  return generated.specs;
}

async function generateOwner(root: string, name: string) {
  const specDir = loadConfig(root).spec.dir;
  const ownerDir = badSpecName(name) ? undefined : owner(root, `${specDir}/${name}/`);
  if (!ownerDir) throw new Error(`${name}: no package owns ${specDir}/${name}/`);
  const release = lockProject(root);
  try {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vibestack-owner-gen-"));
    try {
      const specs = await generateFiles(root, scratch, name);
      mirrorGen(root, specs, { scratch, ownerDir: `${ownerDir}/` });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  } finally {
    release();
  }
}

function parseInitArgs(args: string[]): { dir?: string; options: InitOptions } {
  const options: InitOptions = {};
  const exclude: string[] = [];
  let dir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--mode" || arg.startsWith("--mode=")) {
      const value = arg === "--mode" ? args[++i] : arg.slice("--mode=".length);
      if (value !== "vibelang" && value !== "typescript" && value !== "specs-only") {
        throw new Error(`init: --mode must be vibelang, typescript, or specs-only (got ${value ?? "nothing"})`);
      }
      options.mode = value as VibestackMode;
    } else if (arg === "--exclude" || arg.startsWith("--exclude=")) {
      const value = arg === "--exclude" ? args[++i] : arg.slice("--exclude=".length);
      if (!value) throw new Error("init: --exclude requires one or more comma-separated directory names");
      exclude.push(...value.split(",").map((part) => part.trim()).filter(Boolean));
    } else if (!arg.startsWith("-") && !dir) {
      dir = arg;
    } else {
      throw new Error(`init: unexpected argument ${arg}`);
    }
  }
  if (exclude.length) options.exclude = exclude;
  return { dir, options };
}

function parseUpgradeArgs(args: string[]): { version?: string; dryRun: boolean; from?: string; force: boolean } {
  let version: string | undefined;
  let dryRun = false;
  let from: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg === "--from" || arg.startsWith("--from=")) {
      from = arg === "--from" ? args[++i] : arg.slice("--from=".length);
      if (!from) throw new Error("upgrade: --from requires a path");
    } else if (!arg.startsWith("-") && !version) {
      version = arg;
    } else {
      throw new Error(`upgrade: unexpected argument ${arg}`);
    }
  }
  return { version, dryRun, from, force };
}

/** The `spec` command, on `process.argv`. */
export async function main(argv = process.argv.slice(2)) {
  let root = process.cwd();
  let [command, ...args] = argv;
  if (command && !["tasks", "create", "stories", "tokens"].includes(command)) {
    const sep = args.indexOf("--");
    if (sep >= 0) args.splice(sep, 1);
  }
  const skipGenOnPack = args[1] === "--skip-gen-on-pack";
  const installTasks = args.slice(skipGenOnPack ? 2 : 1);
  const installing = command === "gen" && args[0] === "--install" && installTasks.every((task) => /^(?:[\w@./-]+|\/\/)#[\w.:-]+$/.test(task));
  const takes = (...allowed: string[][]) => allowed.some((a) => a.length === args.length && a.every((x, i) => x === "*" || x === args[i]));
  try {
    if (Number(process.versions.node.split(".")[0]) < NODE) throw new Error(`spec needs Node ${NODE} or later; this is Node ${process.versions.node}`);
    if (installing) {
      const hosted = process.env.GITHUB_ACTIONS === "true";
      const job = hosted ? process.env.GITHUB_JOB : undefined;
      const fixture = job === "vibestack-fixture-selftests";
      const preparing = process.env.npm_lifecycle_event === "prepare";
      const precomputeInstall = preparing && job === "vibestack-precompute-simulations" && process.env.npm_command === "install"
        && process.env.GITHUB_WORKSPACE === root
        && process.env.GITHUB_WORKFLOW_REF?.startsWith(`${process.env.GITHUB_REPOSITORY}/.github/workflows/ci.yml@`);
      const prerequisites = precomputeInstall ? [] : installTasks.filter((task) => !fixture || task.endsWith("#build"));
      if (prerequisites.length) {
        const code = await runTasks(root, prerequisites);
        if (code !== 0) { process.exitCode = code ?? 1; return; }
      }
      const packingTools = preparing && skipGenOnPack && process.env.npm_command === "pack";
      const nightlyCheck = preparing && hosted && process.env.npm_command === "install"
        && process.env.GITHUB_JOB === "vibestack-nightly-check" && process.env.GITHUB_WORKSPACE === root
        && process.env.GITHUB_WORKFLOW_REF?.startsWith(`${process.env.GITHUB_REPOSITORY}/.github/workflows/fuzz.yml@`);
      if (fixture || precomputeInstall || packingTools || nightlyCheck) return;
      const genTarget = !fs.existsSync(path.join(root, "spec")) && fs.existsSync(path.join(root, "template", "spec")) ? ["template"] : [];
      [command, ...args] = hosted ? ["tasks", "//#gen"] : ["gen", "--if-valid", ...genTarget];
    }
    if (command === "gen" && args[0] === "--owner" && (args.length === 2 || args.length === 3)) {
      await generateOwner(args[2] === undefined ? root : projectRoot(args[2]), args[1]);
      return;
    }
    const options: Record<string, string[]> = {
      check: ["--json", "--nightly", "--timings"],
      gen: ["--if-valid"],
      accept: ["unproved"],
      watch: [],
      link: [],
      doctor: ["--install-dafny"],
      explore: ["--nightly"],
    };
    if (Object.hasOwn(options, command)) {
      const directories = args.filter((arg) => !options[command].includes(arg));
      if (directories.length === 1 && !directories[0].startsWith("-")) {
        root = projectRoot(directories[0]);
        args.splice(args.indexOf(directories[0]), 1);
      }
    }
    if ((command === "--help" || command === "-h") && takes([])) console.log(USAGE);
    else if (command === "tasks") {
      const code = await runTasks(root, args);
      if (installing && code) console.log("note: gen/ was not generated; `pnpm check` says why");
      else process.exitCode = code ?? 1;
    } else if (command === "gen" && takes([], ["--if-valid"])) {
      // --if-valid is for `pnpm install`: a spec in the middle of an edit, or a check running, must not make installing fail.
      let release = () => {};
      try {
        release = lockProject(root);
        const specs = await generateFiles(root);
        mirrorGen(root, specs);
      } catch (e) {
        if (!args.length) throw e;
        console.log(`note: gen/ was not generated (${(e as Error).message.split("\n")[0]}); \`pnpm check\` says why`);
      } finally {
        release();
      }
    } else if ((command === "check" && args.every((arg) => ["--json", "--nightly", "--timings"].includes(arg))) || (command === "accept" && takes([], ["unproved"]))) {
      const json = args.includes("--json");
      const timings = command === "check" && args.includes("--timings");
      const accept = command === "check" ? false : args[0] === "unproved" ? "unproved" : "reviews";
      const finishTimings = timings ? startPhaseTimings() : undefined;
      try {
        const { ok, results, next } = await check(root, accept, (r) => console.log(json ? JSON.stringify(r) : show(r)), args.includes("--nightly") ? "nightly" : "normal");
        console.log(json ? JSON.stringify({ ok, results, next }) : `\nnext: ${next}`);
        if (finishTimings) {
          const summary = finishTimings();
          if (summary) (json ? console.error : console.log)(summary);
        }
        process.exitCode = ok ? 0 : 1;
      } finally {
        finishTimings?.();
      }
    } else if (command === "init") {
      const { dir, options: initOpts } = parseInitArgs(args);
      const targetRoot = dir ? projectRoot(dir) : root;
      const done = initProject(targetRoot, initOpts);
      console.log(done.length ? `added: ${done.join(", ")}` : "nothing to add: everything is already there");
    } else if (command === "link" && takes([])) {
      const linked = linkAgents(root, (message) => console.warn(`note: ${message}`));
      console.log(linked.length ? `linked: ${linked.join(", ")}` : "links are already up to date");
    } else if (command === "upgrade") {
      const upgradeOpts = parseUpgradeArgs(args);
      const summary = await upgradeProject(root, upgradeOpts);
      console.log(formatUpgradeResult(summary));
      if (summary.doctor && !summary.doctor.ok) process.exitCode = 1;
    } else if (command === "doctor" && args.every((arg) => arg === "--install-dafny")) {
      const report = await doctor(root, { installDafny: args.includes("--install-dafny") });
      console.log(formatDoctorReport(report));
      process.exitCode = report.ok ? 0 : 1;
    } else if (command === "conformance" && args.every((arg) => arg === "--nightly" || !arg.startsWith("-"))) {
      const nightly = args.includes("--nightly");
      const moduleName = args.find((arg) => !arg.startsWith("-"));
      const ok = await runConformanceCommand(root, moduleName, nightly ? "nightly" : "normal", lockProject);
      process.exitCode = ok ? 0 : 1;
    } else if (command === "explore" && takes([], ["--nightly"])) {
      const ok = await runExploreCommand(root, args.includes("--nightly") ? "nightly" : "normal", lockProject);
      process.exitCode = ok ? 0 : 1;
    } else if (command === "ci") {
      process.exitCode = await runCiCommand(root, args, prepareSimulationReceipts);
    } else if (command === "create") {
      launchCreate(root, args);
    } else if (command === "watch" && takes([])) {
      await watch(root);
    } else if (command === "studio" && takes([], ["*"], ["--port", "*"], ["*", "--port", "*"])) {
      launchStudio(root, args);
    } else if (command === "stories" || command === "tokens") {
      // Each is a command line of its own, reading its arguments after its name (stories/cli.ts, design/cli.ts).
      process.argv.splice(2, 1);
      await (command === "stories" ? import("./stories/cli.ts") : import("./design/cli.ts"));
    } else if (command === "tests" && takes([], ["*"])) {
      await (await import("./testing/generate.ts")).main(args[0]);
    } else if (command === "new" && takes([], ["*"])) {
      console.log(`wrote ${newSpec(root, args[0])}; run \`pnpm check\``);
    } else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
