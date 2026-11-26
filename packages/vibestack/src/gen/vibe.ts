// The Effect face of a generated module, in VibeLang: gen/<name>.effect.vibe beside gen/<name>.ts. It is read off the
// generated TypeScript itself, so it cannot say anything that module does not.
import { HELPERS } from "./typescript.ts";
import { fail } from "./types.ts";

/** Helpers the generated module exports for its own use (typescript.ts), and the proof obligation of `initial`. */
const INTERNAL = new RegExp(`^(?:${HELPERS.join("|")})_|^initialHolds$`);
/** The adapter's typed failures. */
const FAILURES = ["Rejected", "NotAnEvent", "NotAState", "NotASender"];
/** What the adapter itself exports for a state machine; a spec that binds one of these cannot have an adapter. */
const OWN = [...FAILURES, "Machine", "machine", "machineOver", "stored", "apply", "decodeEvent", "decodeState", "decodeSender"];

interface ParsedParam { name: string; type: string }
interface ParsedConst { name: string; type: string; doc: string }
interface ParsedFun { name: string; params: ParsedParam[]; paramsText: string; returnType: string; doc: string }
interface ParsedModule { types: string[]; foreign: string[]; consts: ParsedConst[]; funs: ParsedFun[] }
interface CachedTemplate { readonly beforeKey: string; readonly afterKey?: string }

const TEMPLATE_CACHE_LIMIT = 64;
const templateCache = new Map<string, CachedTemplate>();

function scanUntil(text: string, start: number, stop: (ch: string, next: string) => boolean): number {
  let paren = 0, brace = 0, bracket = 0, angle = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "=" && next === ">") { i++; continue; }
    if (paren === 0 && brace === 0 && bracket === 0 && angle === 0 && stop(ch, next)) return i;
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    else if (ch === "<") angle++;
    else if (ch === ">" && angle > 0) angle--;
  }
  return text.length;
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = scanUntil(text, start, (ch) => ch === sep);
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = end + 1;
  }
  return parts;
}

function cleanJsDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGeneratedTs(text: string): ParsedModule {
  const types: string[] = [];
  const foreign: string[] = [];
  const consts: ParsedConst[] = [];
  const funs: ParsedFun[] = [];
  const lines = text.split(/\r?\n/);
  let pendingDoc = "";
  let inJsDoc = false;
  let jsDocLines: string[] = [];

  for (const line of lines) {
    if (inJsDoc) {
      jsDocLines.push(line);
      if (line.includes("*/")) {
        inJsDoc = false;
        pendingDoc = cleanJsDoc(jsDocLines.join("\n"));
        jsDocLines = [];
      }
      continue;
    }
    if (line.startsWith("/**")) {
      if (line.includes("*/")) {
        pendingDoc = cleanJsDoc(line);
      } else {
        inJsDoc = true;
        jsDocLines = [line];
      }
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line === "") { pendingDoc = ""; continue; }

    const imp = line.match(/^import \{ (.+) \} from (".+");$/);
    if (imp) {
      const items = splitTopLevel(imp[1], ",").filter((entry) => entry.startsWith("type ")).map((entry) => entry.slice(5).trim());
      if (items.length) foreign.push(`  import type { ${items.join(", ")} } from ${imp[2]}`);
      pendingDoc = "";
      continue;
    }

    const typeMatch = line.match(/^export (?:type|interface) ([A-Za-z_$][\w$]*)\b/);
    if (typeMatch) {
      types.push(typeMatch[1]);
      pendingDoc = "";
      continue;
    }

    const constMatch = line.match(/^export const ([A-Za-z_$][\w$]*):\s*/);
    if (constMatch) {
      const typeStart = constMatch[0].length;
      const eq = scanUntil(line, typeStart, (ch, next) => ch === "=" && next !== "=" && next !== ">");
      consts.push({ name: constMatch[1], type: line.slice(typeStart, eq).trim(), doc: pendingDoc });
      pendingDoc = "";
      continue;
    }

    const funMatch = line.match(/^export function ([A-Za-z_$][\w$]*)\(/);
    if (funMatch) {
      const fnName = funMatch[1];
      if (!INTERNAL.test(fnName)) {
        const paramsStart = funMatch[0].length;
        const paramsEnd = scanUntil(line, paramsStart, (ch) => ch === ")");
        const paramsText = line.slice(paramsStart, paramsEnd);
        const colon = line.indexOf(":", paramsEnd);
        const brace = scanUntil(line, colon + 1, (ch) => ch === "{");
        const returnType = line.slice(colon + 1, brace).trim();
        const params = splitTopLevel(paramsText, ",").map((param) => {
          const idx = scanUntil(param, 0, (ch) => ch === ":");
          return { name: param.slice(0, idx).trim(), type: param.slice(idx + 1).trim() };
        });
        funs.push({ name: fnName, params, paramsText, returnType, doc: pendingDoc });
      }
      pendingDoc = "";
      continue;
    }

    if (!line.startsWith(" ")) pendingDoc = "";
  }

  return { types, foreign, consts, funs };
}

function snapshotHelperLines(name: string): string[] {
  const freeze = `snapshot_${name}`;
  const capture = `snapshot_in_${name}`;
  const frozenSet = `snapshot_frozen_${name}`;
  const copyHelper = `snapshot_copy_${name}`;
  const cacheSet = `snapshot_cache_set_${name}`;
  return [
    `  const ${frozenSet} = new WeakSet<object>()`,
    `  /** @throws {never} */`,
    `  export function ${freeze}<A>(value: A): A {`,
    `    if (value === null || typeof value !== "object" || ${frozenSet}.has(value)) return value`,
    `    if (!Object.isFrozen(value)) Object.freeze(value)`,
    `    ${frozenSet}.add(value)`,
    `    if (Array.isArray(value)) {`,
    `      for (let i = 0; i < value.length; i++) ${freeze}(value[i])`,
    `    } else {`,
    `      for (const key of Object.keys(value)) ${freeze}((value as Record<string, unknown>)[key])`,
    `    }`,
    `    return value`,
    `  }`,
    `  function ${copyHelper}(value: unknown, seen: WeakMap<object, unknown>): unknown {`,
    `    if (value === null || typeof value !== "object" || ${frozenSet}.has(value)) return value`,
    `    const existing = seen.get(value)`,
    `    if (existing !== undefined) return existing`,
    `    if (Array.isArray(value)) {`,
    `      const copy: unknown[] = new Array(value.length)`,
    `      seen.set(value, copy)`,
    `      for (let i = 0; i < value.length; i++) copy[i] = ${copyHelper}(value[i], seen)`,
    `      Object.freeze(copy)`,
    `      ${frozenSet}.add(copy)`,
    `      return copy`,
    `    }`,
    `    const copy: Record<string, unknown> = {}`,
    `    seen.set(value, copy)`,
    `    for (const key of Object.keys(value)) {`,
    `      const item = ${copyHelper}((value as Record<string, unknown>)[key], seen)`,
    `      if (key === "__proto__") Object.defineProperty(copy, key, { value: item, enumerable: true, configurable: true, writable: true })`,
    `      else copy[key] = item`,
    `    }`,
    `    Object.freeze(copy)`,
    `    ${frozenSet}.add(copy)`,
    `    return copy`,
    `  }`,
    `  /** @throws {never} */`,
    `  export function ${capture}<A>(value: A): A {`,
    `    if (value === null || typeof value !== "object" || ${frozenSet}.has(value)) return value`,
    `    return ${copyHelper}(value, new WeakMap()) as A`,
    `  }`,
    `  /** @throws {never} */`,
    `  export function ${cacheSet}<S>(cache: Map<string, { readonly raw: string; readonly state: S }>, key: string, raw: string, state: S): void {`,
    `    cache.delete(key)`,
    `    cache.set(key, { raw, state })`,
    `    if (cache.size > 128) {`,
    `      const oldest = cache.keys().next().value`,
    `      if (oldest !== undefined) cache.delete(oldest)`,
    `    }`,
    `  }`,
  ];
}

function buildTemplate(name: string, source: string, text: string): CachedTemplate {
  const { types, foreign, consts, funs } = parseGeneratedTs(text);
  const doc = (said: string) => `  /** ${said ? `${said} ` : ""}@throws {never} */`;
  const wrapper = (f: ParsedFun) =>
    `${doc(f.doc)}\n  export function ${f.name}(${f.paramsText}): ${f.returnType} { return M.${f.name}(${f.params.map((p) => p.name).join(", ")}) }`;
  const names = [...consts.map((c) => c.name), ...funs.map((f) => f.name)];
  const freeze = `snapshot_${name}`;
  const capture = `snapshot_in_${name}`;
  const storedCache = `snapshot_cache_${name}`;
  const cacheSet = `snapshot_cache_set_${name}`;
  const step = funs.find((f) => f.name === "step");
  const body = names.length ? [
    `module pure {`,
    `  import * as M from "./${name}.ts"`,
    ...(types.length ? [`  import type { ${types.join(", ")} } from "./${name}.ts"`] : []),
    ...foreign,
    ...consts.map((c) => `${doc(c.doc)}\n  export const ${c.name}: ${c.type} = M.${c.name}`),
    ...funs.map(wrapper),
    ...(step ? snapshotHelperLines(name) : []),
    `}`,
    `import { ${[...names, ...step ? [freeze, capture, cacheSet] : []].join(", ")} } from pure`,
    `export { ${names.join(", ")} }`,
  ] : [];
  const out = [
    `// GENERATED from ${source} by vibestack/spec.ts. Do not edit: change the spec and run \`pnpm gen\`.`,
    `// gen/${name}.ts for Effect code: its definitions as functions that throw nothing${step ? ", and its state machine as typed failures and a service" : ""}.`,
    `export type * from "./${name}.ts"`,
    ``,
    ...body,
  ];
  if (!step) return { beforeKey: [...out, ``].join("\n") };

  const clash = OWN.find((n) => names.includes(n) || types.includes(n));
  if (clash) fail(`${source}: \`${clash}\` is a name of the generated Effect adapter (gen/${name}.effect.vibe); name the definition otherwise`);
  const typed = (typeText: string, otherwise: string) => (types.includes(typeText) ? `T.${typeText}` : otherwise);
  const state = typed(step.params[0].type, "Parameters<typeof step>[0]");
  const stepped = typed(step.returnType, "ReturnType<typeof step>");
  const sender = step.params[2] && typed(step.params[2].type, "Parameters<typeof step>[2]");
  const emits = step.returnType !== step.params[0].type;
  const by = sender ? `, by: ${sender}` : "";
  const passed = sender ? ", by" : "";
  const guard = `, isCurrent?: (state: ${state}) => boolean`;
  const beforeKey = [
    ...out,
    `import * as KeyValueStore from "effect/persistence/KeyValueStore"`,
    `import { PreventSchedulerYield } from "effect/References"`,
    `import type * as T from "./${name}.ts"`,
    ``,
    `/** The rules do not allow this event in this state${sender ? " from this sender" : ""}. */`,
    `export error Rejected { event: T.Event; state: ${state}${sender ? `; by: ${sender}` : ""} }`,
    `/** An untrusted value that is not an event. */`,
    `export error NotAnEvent { input: unknown }`,
    `/** An untrusted value that is not a state satisfying every \`always\` rule. */`,
    `export error NotAState { input: unknown }`,
    ...(sender ? [`/** An untrusted value that is not a sender. */`, `export error NotASender { input: unknown }`] : []),
    ``,
    `/** \`parseEvent\`, failing where it returns undefined. */`,
    `export effect function decodeEvent(input: unknown): T.Event!NotAnEvent {`,
    `  const event = parseEvent(input)`,
    `  if (event === undefined) throw new NotAnEvent({ input })`,
    `  return ${freeze}(event)`,
    `}`,
    ``,
    `/** \`parseState\`, failing where it returns undefined. */`,
    `export effect function decodeState(input: unknown): ${state}!NotAState {`,
    `  const parsed = parseState(input)`,
    `  if (parsed === undefined) throw new NotAState({ input })`,
    `  return ${freeze}(parsed)`,
    `}`,
    ...(sender ? [
      ``,
      `/** \`parseSender\`, failing where it returns undefined. */`,
      `export effect function decodeSender(input: unknown): ${sender}!NotASender {`,
      `  const parsed = parseSender(input)`,
      `  if (parsed === undefined) throw new NotASender({ input })`,
      `  return ${freeze}(parsed)`,
      `}`,
    ] : []),
    ``,
    `/** \`step\`, failing where \`enabled\` refuses the event instead of leaving the state unchanged. */`,
    `export effect function apply(current: ${state}, event: T.Event${by}): ${stepped}!Rejected {`,
    `  if (!enabled(current, event${passed})) throw new Rejected({ event, state: current${passed} })`,
    `  return step(current, event${passed})`,
    `}`,
    ``,
    `/** The state, and the one way to change it: an event the rules allow, applied before the next is looked at. */`,
    `export service Machine {`,
    `  static readonly key = `,
  ].join("\n");
  const afterKey = [
    ``,
    `  /** The state the Machine was made with, or the last one an event sent to it led to; then each one an event sent to it leads to. */`,
    `  readonly changes: Stream.Stream<${state}>`,
    `  /** The state as it is kept now. */`,
    `  get(): ${state}!!`,
    `  /** An event already parsed. An optional source check runs under the writer immediately before saving. A value from outside goes through \`receive\`. */`,
    `  send(event: T.Event${by}${guard}): ${stepped}!Rejected`,
    `  receive(input: unknown${by}): ${stepped}!(NotAnEvent | Rejected)`,
    `}`,
    ``,
    `/**`,
    ` * A Machine over a state kept elsewhere: \`load\` reads it and \`keep\` writes it. Each event is applied to what \`load\``,
    ` * reads when it is sent, so that a state another writer kept since is stepped from, never written over, and the state`,
    ` * it leads to goes to \`keep\` before \`send\` returns. It fails as the first \`load\` does; where a later \`load\` fails`,
    ` * or \`keep\` dies, \`send\` dies and the state stays as it was. It never shares a state with its callers.`,
    ` */`,
    `export effect function machineOver<E>(load: () => ${state}!E, keep: (next: ${state}) => void!!): Machine.Shape!E {`,
    `  const shown = try SubscriptionRef.make(${capture}(try load()))`,
    `  effect function send(event: T.Event${by}${guard}): ${stepped}!Rejected {`,
    `    const input = ${capture}({ event${passed} })`,
    `    uninterruptible {`,
    `      return try SubscriptionRef.modifyEffect(shown, effect () => {`,
    `        const current = ${capture}(try orDie(load()))`,
    `        const next = ${freeze}(try apply(current, input.event${sender ? ", input.by" : ""}))`,
    `        const nextState = ${emits ? "next.state" : "next"}`,
    `        const save = effect {`,
    `          if (isCurrent && !isCurrent(current)) throw new Rejected({ ...input, state: current })`,
    `          try keep(nextState)`,
    `        }`,
    `        try (isCurrent ? Effect.provideService(save, PreventSchedulerYield, true) : save)`,
    `        return [next, nextState] as const`,
    `      })`,
    `    }`,
    `  }`,
    `  return {`,
    `    changes: SubscriptionRef.changes(shown),`,
    `    effect get() { return ${capture}(try orDie(load())) },`,
    `    send,`,
    `    effect receive(input: unknown${by}) { return try send(try decodeEvent(input)${passed}) }`,
    `  }`,
    `}`,
    ``,
    `/** A Machine in memory, from \`initial\` or a state \`decodeState\` returned. */`,
    `export function machine(start: ${state} = initial) {`,
    `  return Layer.effect(Machine, effect {`,
    `    const kept = try Ref.make(start === initial ? ${freeze}(start) : ${capture}(start))`,
    `    return try machineOver(() => Ref.get(kept), (next) => Ref.set(kept, next))`,
    `  })`,
    `}`,
    ``,
    `const ${storedCache} = new WeakMap<object, Map<string, { readonly raw: string; readonly state: ${state} }>>()`,
    ``,
    `/**`,
    ` * A Machine kept in the KeyValueStore under \`key\`, as JSON: each event is applied to what is stored there when it`,
    ` * is sent, read through \`decodeState\`, or to \`start\` where nothing is, so that a state another page or program`,
    ` * stored since is stepped from, never written over. What is stored and is not a state fails the layer with NotAState,`,
    ` * and a later \`send\` dies on it, so that it is never written over either. Each state an event leads to is stored`,
    ` * before \`send\` returns: where the store does not take it, \`send\` dies and the state stays as it was.`,
    ` */`,
    `export function stored(key: string, start: ${state} = initial) {`,
    `  return Layer.effect(Machine, effect {`,
    `    const store = try KeyValueStore.KeyValueStore`,
    `    const fallback = start === initial ? ${freeze}(start) : ${capture}(start)`,
    `    let entries = ${storedCache}.get(store)`,
    `    if (entries === undefined) {`,
    `      entries = new Map()`,
    `      ${storedCache}.set(store, entries)`,
    `    }`,
    `    const cache = entries`,
    `    let loadedRaw: string | undefined = undefined`,
    `    effect function load() {`,
    `      const found = try store.get(key)`,
    `      if (found === undefined) {`,
    `        loadedRaw = undefined`,
    `        cache.delete(key)`,
    `        return fallback`,
    `      }`,
    `      const cached = cache.get(key)`,
    `      if (cached !== undefined && cached.raw === found) {`,
    `        loadedRaw = found`,
    `        ${cacheSet}(cache, key, found, cached.state)`,
    `        return cached.state`,
    `      }`,
    `      loadedRaw = undefined`,
    `      cache.delete(key)`,
    `      const decoded = try decodeState(try Effect.try({ try: () => JSON.parse(found) as unknown, catch: () => new NotAState({ input: found }) }))`,
    `      loadedRaw = found`,
    `      ${cacheSet}(cache, key, found, decoded)`,
    `      return decoded`,
    `    }`,
    `    effect function keep(next: ${state}) {`,
    `      const cached = cache.get(key)`,
    `      if (loadedRaw !== undefined && cached !== undefined && cached.raw === loadedRaw && Object.is(cached.state, next)) return`,
    `      const raw = JSON.stringify(next)`,
    `      if (loadedRaw !== undefined && loadedRaw === raw) {`,
    `        ${cacheSet}(cache, key, raw, next)`,
    `        return`,
    `      }`,
    `      try orDie(store.set(key, raw))`,
    `      loadedRaw = raw`,
    `      ${cacheSet}(cache, key, raw, next)`,
    `    }`,
    `    return try machineOver(load, keep)`,
    `  })`,
    `}`,
    ``,
  ].join("\n");
  return { beforeKey, afterKey };
}

/**
 * `text` is gen/<name>.ts. Every constant and function comes back under its own name from a TypeScript `module` body,
 * the one place a `.vibe` file states what a function throws: effect code may then call them bare. They throw nothing
 * the program should handle: the one exception generated code raises, a RangeError past 2^53, is a defect.
 * A state machine also gets typed failures for what `parseEvent`, `parseState` and `enabled` refuse, and a `Machine`
 * service that applies one event at a time to the state where it is kept: in memory (`machine`), in a store
 * (`stored`) or wherever the shell loads and keeps it (`machineOver`).
 */
export function effectAdapter(name: string, source: string, text: string, namespace: string): string {
  const cacheKey = `${name}\0${source}\0${text}`;
  let entry = templateCache.get(cacheKey);
  if (entry === undefined) {
    entry = buildTemplate(name, source, text);
    if (templateCache.size >= TEMPLATE_CACHE_LIMIT) {
      const oldest = templateCache.keys().next().value;
      if (oldest !== undefined) templateCache.delete(oldest);
    }
    templateCache.set(cacheKey, entry);
  }
  return entry.afterKey === undefined
    ? entry.beforeKey
    : `${entry.beforeKey}${JSON.stringify(`${namespace}/${source}#Machine`)}${entry.afterKey}`;
}
