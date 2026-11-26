import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { canonical, check, compareObservation, ConformanceError, departure, planModel, replay, transition, type Found, type Line, type Oracle, type Sent } from "./conformance.ts";
import type { Model } from "./gen.ts";
import { heading, type Spec } from "./parse.ts";
import { exec, startGroup } from "./run.ts";
import type { Step } from "./simulate.ts";
import { profile, type TestProfile } from "./testing/profile.ts";
import { COUNTEREXAMPLES, DRIVERS, filesUnder, indent, sha, testInputs, TRACES, type Remember, type Reported } from "./util.ts";

export type Simulated = Found<any> & { traces: Sent<any>[][] };
export interface Machine { domain: Oracle<any, any>; model: Model; found: Simulated }

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function conformanceFound(model: Model, spec: Spec, traces: Step[][], witnesses: { w: string; trace: Step[] }[]): Simulated {
  const events = new Map<string, any>();
  const sampleByType = new Map<string, any>();
  for (const trace of traces) {
    for (const { event } of trace) {
      if (!event) continue;
      const key = canonical(event, "scalar");
      if (!events.has(key)) events.set(key, event);
      const type = String(event.type ?? "");
      if (type && !sampleByType.has(type)) sampleByType.set(type, event);
    }
  }
  const transitionByGuard = new Map(model.transitions.filter((t) => t.guard).map((t) => [t.guard!, t]));
  for (const trace of traces) {
    for (const { evaluated } of trace) {
      if (!evaluated) continue;
      const t = transitionByGuard.get(evaluated.name);
      const sample = t ? sampleByType.get(t.name) : undefined;
      if (t && sample) {
        const event = { ...sample, ...evaluated.picks };
        const key = canonical(event, "scalar");
        if (!events.has(key)) events.set(key, event);
      }
    }
  }
  const rawTraces = traces.map((trace) => trace.flatMap((step) => step.event ? [step.event] : [])).filter((trace) => trace.length > 0);
  const byTransition = new Map<string, Sent<any>[]>();
  for (const trace of rawTraces) {
    for (let i = 0; i < trace.length; i++) {
      const type = String(trace[i]?.type ?? "");
      if (!type) continue;
      const existing = byTransition.get(type);
      if (!existing || i + 1 < existing.length) byTransition.set(type, trace.slice(0, i + 1));
    }
  }
  const keptTraces = new Map<string, Sent<any>[]>();
  for (const trace of [...byTransition.values(), ...rawTraces]) {
    if (keptTraces.size >= 100) break;
    keptTraces.set(canonical(trace, "scalar"), trace);
  }
  return {
    spec: model.name, source: model.source, sender: !!model.sender, shape: model.shape!, outputShape: model.outputShape,
    transitions: model.transitions.map((t) => t.name),
    events: [...events.entries()].sort(([a], [b]) => compareText(a, b)).map(([, event]) => event),
    journeys: witnesses.flatMap(({ w, trace }) => {
      const rule = spec.rules.find((r) => r.defs.includes(w));
      return rule ? [{ story: rule.story, rule: heading(rule), events: trace.flatMap((step) => step.event ? [step.event] : []) }] : [];
    }),
    traces: [...keptTraces.values()],
  };
}

/** gen/<name>.conformance.ts: the types a test/drivers/<name>.ts is written to, over a copy of conformance.ts. */
export function writeConformance(model: Model, write: (name: string, text: string) => void) {
  if (!model.stateType || !model.transitions.length) return;
  write("_conformance.ts", fs.readFileSync(path.join(import.meta.dirname, "conformance.ts"), "utf8"));
  write(`${model.name}.conformance.ts`, [
    `// Generated from ${model.source}; do not edit. What test/drivers/${model.name}.ts exports, as \`driver\` and \`options\`.`,
    `import type * as oracle from "./${model.name}.ts";`,
    `import type { Driver as Reaching, Options as Choosing } from "./_conformance.ts";`,
    `type State = typeof oracle.initial;`,
    `type Event = Parameters<typeof oracle.step>[1];`,
    `export type Driver<V = State> = Reaching<Event, V>;`,
    `export type Options<V = State> = Choosing<State, V>;`,
    "",
  ].join("\n"));
}

const ANSWER_WITHIN = 10_000;

/** A real program, one JSON answer for each reset/event request. */
function driver(root: string, command: string) {
  const { child, stop } = startGroup(command, root);
  let stderr = "";
  let launchError: Error | undefined;
  child.on("error", (error) => { launchError = error; });
  child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-65_536); });
  child.stdin.on("error", () => {});
  const lines = readline.createInterface({ input: child.stdout });
  const answers = lines[Symbol.asyncIterator]();
  const ask = async (request: Line): Promise<Pick<Line, "state" | "out">> => {
    if (launchError) throw launchError;
    child.stdin.write(`${JSON.stringify(request)}\n`);
    let timer: NodeJS.Timeout | undefined;
    const answer = await Promise.race([answers.next(), new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ANSWER_WITHIN); })]);
    clearTimeout(timer);
    const fail = (message: string): never => { throw new Error(`${message} to ${JSON.stringify(request)}${stderr ? `; stderr: ${stderr}` : ""}`); };
    if (!answer || answer.done) return fail((launchError as Error | undefined)?.message ?? (answer ? "the driver ended without an answer" : `the driver did not answer within ${ANSWER_WITHIN / 1000} seconds`));
    let value: any;
    try { value = JSON.parse(answer.value); } catch { return fail("the driver did not answer with JSON"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "state") || Object.keys(value).some((key) => key !== "state" && key !== "out"))
      return fail("the driver must answer with {state: ..., out?: ...}");
    return value;
  };
  return { ask, end: async () => { lines.close(); await stop(); } };
}

async function drive(root: string, machine: Machine, command: string): Promise<string | undefined> {
  const { domain, model, found } = machine;
  const plan = planModel(domain, found.events, found.shape, {
    strategy: "transitions",
    includeRefusals: false,
    transitions: found.transitions,
    hasOutput: !!found.outputShape,
    seedTraces: [...found.journeys.map((j) => j.events), ...found.traces],
  });
  const orderedTraces = new Map<string, readonly Sent<any>[]>();
  for (const trace of [...plan.paths.map((p) => p.events), ...found.traces]) {
    orderedTraces.set(canonical(trace, "scalar"), trace);
  }
  const requests = found.events.map(({ by, ...event }: any): Line => model.sender ? { event, by } : { event });
  const program = driver(root, command);
  let refusalOffset = 0;
  try {
    for (const [n, events] of [...orderedTraces.values()].entries()) {
      const initial = await program.ask({});
      const lines: Line[] = [{ state: initial.state }];
      const resetProblem = compareObservation(domain, found, domain.initial, initial.state);
      if (resetProblem) return `trace ${n + 1}: reset ${resetProblem}`;
      let current = domain.initial;
      const request = ({ by, ...event }: any): Line => model.sender ? { event, by } : { event };
      const sendAndCheck = async (input: Line): Promise<string | undefined> => {
        const answer = await program.ask(input);
        const line: Line = { ...input, ...answer };
        lines.push(line);
        const applied = transition(domain, found, current, input.event, input.by);
        if (typeof applied === "string") return applied;
        current = applied.after;
        if (Object.hasOwn(line, "out")) {
          if (!found.outputShape) return `trace ${n + 1}, line ${lines.length}: this spec does not emit effects\n${lines.map((l) => JSON.stringify(l)).join("\n")}`;
          if (canonical(line.out, found.outputShape) !== canonical(applied.out, found.outputShape)) {
            return `trace ${n + 1}, line ${lines.length}: emitted effects differ from the spec\n${lines.map((l) => JSON.stringify(l)).join("\n")}`;
          }
        }
        const problem = compareObservation(domain, found, current, line.state);
        if (problem) return `trace ${n + 1}, line ${lines.length}: ${problem}\n${lines.map((l) => JSON.stringify(l)).join("\n")}`;
      };
      const refuse = async (): Promise<string | undefined> => {
        if (!requests.length) return undefined;
        let sentCount = 0;
        const seenTypes = new Set<string>();
        for (let k = 0; k < requests.length && sentCount < 2; k++) {
          const idx = (refusalOffset + k) % requests.length;
          const line = requests[idx];
          const type = String((line.event as { type?: unknown })?.type ?? "");
          if (seenTypes.has(type) || domain.enabled(current, line.event, line.by)) continue;
          seenTypes.add(type);
          refusalOffset = (idx + 1) % requests.length;
          sentCount++;
          const problem = await sendAndCheck(line);
          if (problem) return problem;
        }
      };
      for (const sent of events) {
        const refuseProblem = await refuse();
        if (refuseProblem) return refuseProblem;
        const stepProblem = await sendAndCheck(request(sent));
        if (stepProblem) return stepProblem;
      }
      const tailRefuse = await refuse();
      if (tailRefuse) return tailRefuse;
    }
  } finally { await program.end(); }
}

/**
 * The machines whose Effect adapter `apply` the package's `src/` imports: a shell that keeps the machine's state
 * itself, which only a driver compares with the spec. The generated `machine()` needs none: it is the spec's own.
 */
function shelled(root: string): Set<string> {
  const names = new Set<string>();
  for (const file of filesUnder(root, "src").filter((f) => /\.(?:[mc]?tsx?|vibex?)$/.test(f)))
    for (const [, imported, name] of fs.readFileSync(path.join(root, file), "utf8").matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'][^"']*\bgen\/(\w+)\.effect\.vibe["']/g))
      if (imported.split(",").some((part) => /^apply\b/.test(part.trim()))) names.add(name);
  return names;
}

/** What `check` writes where a shell has no driver yet: a driver that fails until a person fills it in. */
const stub = (name: string, model: Model) => `// The driver of ${model.source}: how \`pnpm check\` reaches the application to compare it with the spec
// (SPEC.md, "Conformance"). Written by \`spec check\` because src/ keeps the machine's state; fill it in. It imports
// gen/ as types only: the spec is the oracle it is compared with.
import type { Driver } from "../../gen/${name}.conformance.ts";

const todo = (): never => { throw new Error("${DRIVERS}/${name}.ts: fill in reset, dispatch and observe"); };

export const driver: Driver = {
  /** Start from a fresh application: empty storage, nothing created. */
  reset: todo,
  /** Send the event for the entity \`key\` through the application's own entry point: "accepted" or "refused". */
  dispatch: todo,
  /** What the application now holds for \`key\`, read back through its own storage or interface. */
  observe: todo,
};
`;

function resolveVibeRegister(root: string): string | undefined {
  try {
    return createRequire(path.join(root, "package.json")).resolve("vibelang/register");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") return undefined;
    throw error;
  }
}

async function driven(root: string, name: string, machine: Machine, mode: TestProfile, wrote: Map<string, string>): Promise<{ problem?: string; summary?: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-driver-")), found = path.join(dir, "found.json"), saved = `${COUNTEREXAMPLES}/${name}`;
  const before = new Set(filesUnder(root, saved));
  fs.writeFileSync(found, JSON.stringify(machine.found));
  const vibeRegister = resolveVibeRegister(root);
  const nodeArgs = [...(vibeRegister ? ["--import", pathToFileURL(vibeRegister).href] : []), import.meta.filename, name, found, mode];
  const r = await exec(process.execPath, nodeArgs, root).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of filesUnder(root, saved).filter((file) => !before.has(file))) wrote.set(path.join(root, file), fs.readFileSync(path.join(root, file), "utf8"));
  let verdict: { problem?: string; summary?: string } | undefined;
  if (!r.stopped) {
    const said = r.stdout.trimEnd().split("\n").at(-1) ?? "";
    try { verdict = JSON.parse(said); } catch { /* not the last line it writes, so the driver never finished */ }
  }
  return verdict ?? { problem: `${DRIVERS}/${name}.ts did not finish${r.stopped ? `: ${r.stopped}` : ""}\n${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-40).join("\n")}` };
}

/** In the driver's own Node, in its package: replay what was saved, then check; a new disagreement is saved. */
async function main(name: string, foundFile: string, mode: TestProfile) {
  const root = process.cwd(), saved = `${COUNTEREXAMPLES}/${name}`;
  const found: Found<any> = JSON.parse(fs.readFileSync(foundFile, "utf8"));
  const oracle: Oracle<any, any> = await import(pathToFileURL(path.join(root, "gen", `${name}.ts`)).href);
  const { driver, options = {} } = await import(pathToFileURL(path.join(root, DRIVERS, `${name}.ts`)).href);
  if (!driver) throw new Error(`${DRIVERS}/${name}.ts exports no \`driver\``);
  const { seed, runs } = profile(mode), walks = Math.min(options.walks ?? Infinity, runs);
  try {
    const files = fs.existsSync(path.join(root, saved)) ? fs.readdirSync(path.join(root, saved)).filter((f) => f.endsWith(".json")).sort() : [];
    for (const file of files) await replay(oracle, found, driver, JSON.parse(fs.readFileSync(path.join(root, saved, file), "utf8")).trace, options, `${saved}/${file}`);
    const { plans, journeys, probes, coverage } = await check(oracle, found, driver, { ...options, seed, walks });
    const parts = [
      [files.length, "saved counterexamples"],
      [plans, plans === 1 ? "model path" : "model paths"],
      [journeys, "journeys"],
      [probes, "malformed inputs"],
      [walks, `walks of seed ${seed}`],
    ].filter(([n]) => n).map((p) => p.join(" "));
    const cov = coverage.total
      ? `(${coverage.accepted.length}/${coverage.total} transitions accepted, ${coverage.refused.length}/${coverage.total} refused${coverage.uncovered.length ? `; uncovered: ${coverage.uncovered.join(", ")}` : ""})`
      : "";
    return [parts.join(", "), cov].filter(Boolean).join(" ");
  } catch (error) {
    if (!(error instanceof ConformanceError) || error.origin === "replay") throw error;
    const file = `${saved}/${createHash("sha256").update(JSON.stringify(error.trace)).digest("hex").slice(0, 12)}.json`;
    fs.mkdirSync(path.join(root, saved), { recursive: true });
    fs.writeFileSync(path.join(root, file), `${JSON.stringify({ origin: error.origin, seed, trace: error.trace }, null, 2)}\n`);
    throw new Error(`${error.message}\nSeed: ${seed}\nSaved as ${file}, which is replayed first from now on.`, { cause: error });
  } finally {
    await driver[Symbol.asyncDispose]?.();
  }
}

if (import.meta.main) {
  const verdict = await main(process.argv[2], process.argv[3], process.argv[4] === "nightly" ? "nightly" : "normal").then((summary) => ({ summary }), (error) => ({ problem: error instanceof Error ? error.message : String(error) }));
  // The last line is the verdict, whatever the driver wrote; a driver may leave a server or a timer running.
  process.stdout.write(`\n${JSON.stringify(verdict)}\n`, () => process.exit());
}

/**
 * Every driver, configured program and recorded trace of the package `root`. A driver's pass is remembered until what
 * its run reads changes: the package's tests, drivers, counterexamples and code (util.ts, `testInputs`), and the
 * events the simulator found; a failure runs again. A `driver:` program may be anything, so it runs every time. A shell
 * with no driver gets one to fill in; what the stage writes is added to `wrote`.
 */
export async function conformance(root: string, machines: Map<string, Machine>, scripts: Record<string, string>, remember: Remember, wrote: Map<string, string>, mode: TestProfile = "normal"): Promise<Reported<"traces">[]> {
  const results: Reported<"traces">[] = [];
  const add = (where: string, machine: Machine | undefined, problem: string | undefined, subject: string) => results.push([!problem, "traces",
    `${where}: ${problem ? /^(?:conformance to|trace|line) /.test(problem) ? "the program departs from the spec" : "the run did not get as far as comparing" : `${subject} agree with ${machine!.model.source}${machine!.found.outputShape ? "; effects checked where out is reported" : ""}`}`,
    problem ? indent(problem) : "", where]);
  for (const name of shelled(root)) {
    const file = path.join(root, DRIVERS, `${name}.ts`), model = machines.get(name)?.model;
    if (model && !fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const text = stub(name, model);
      fs.writeFileSync(file, text);
      wrote.set(file, text);
    }
  }
  const drivers = filesUnder(root, DRIVERS).filter((f) => /^test\/drivers\/\w+\.ts$/.test(f));
  const inputs = drivers.length ? testInputs(root, mode) : undefined;
  for (const file of drivers) {
    const name = path.basename(file, ".ts"), machine = machines.get(name);
    if (!machine) { add(file, undefined, "no state-machine spec has this name", ""); continue; }
    const run = () => driven(root, name, machine, mode, wrote);
    const { problem, summary } = await (inputs === undefined ? run() : remember(JSON.stringify([name, inputs, sha(JSON.stringify(machine.found))]), run, (r) => !r.problem));
    add(file, machine, problem, summary!);
  }
  const dir = path.join(root, TRACES);
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl")).sort() : []) {
    const machine = machines.get(file.split(".")[0]);
    const rawText = fs.readFileSync(path.join(dir, file), "utf8").trimEnd();
    const lines = rawText ? rawText.split("\n").map((line) => { try { return JSON.parse(line); } catch { return line; } }) : [];
    const off = machine && departure(machine.domain, machine.found, lines);
    add(`${TRACES}/${file}`, machine, machine ? off && `line ${off.line}: ${off.why}` : "no state-machine spec has this name", `${lines.length} recorded lines`);
  }
  for (const [name, command] of Object.entries(scripts).filter(([name]) => name.startsWith("driver:"))) {
    const machine = machines.get(name.slice("driver:".length));
    const problem = machine && typeof command === "string" ? await drive(root, machine, command).catch((error: Error) => error.message) : "no state-machine spec has this name, or its driver is not a command";
    add(`script ${name}`, machine, problem, "simulated states and refused events");
  }
  return results;
}
