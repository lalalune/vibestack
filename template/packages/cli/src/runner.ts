import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

export type FlagKind = "boolean" | "string";

export interface FlagSpec {
  readonly kind: FlagKind;
  readonly short?: string;
  readonly description: string;
}

export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

export type FlagValues<F extends FlagSpecs> = {
  readonly [K in keyof F]: F[K]["kind"] extends "boolean" ? boolean : string | undefined;
};

export interface CliIo {
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
}

export interface CliContext {
  readonly rootDir: string;
  readonly cwd: string;
  readonly json: boolean;
  readonly io: CliIo;
}

export type CommandResult<T = unknown> =
  | { readonly ok: true; readonly data: T; readonly lines?: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly exitCode?: number; readonly data?: T };

export interface CommandSpec<F extends FlagSpecs = FlagSpecs> {
  readonly name: string;
  readonly summary: string;
  readonly usage?: string;
  readonly flags?: F;
  readonly run: (
    args: { readonly flags: FlagValues<F>; readonly positionals: readonly string[] },
    ctx: CliContext,
  ) => CommandResult | Promise<CommandResult>;
}

export interface RegisteredCommand {
  readonly name: string;
  readonly summary: string;
  readonly usage?: string;
  readonly flags: FlagSpecs;
  readonly execute: (argv: readonly string[], ctx: CliContext) => Promise<CommandResult>;
}

export interface RunCliOptions {
  readonly argv: readonly string[];
  readonly commands: readonly RegisteredCommand[];
  readonly rootDir: string;
  readonly cwd: string;
  readonly io: CliIo;
}

function buildParseConfig(flags: FlagSpecs): ParseArgsOptionsConfig {
  const config: ParseArgsOptionsConfig = {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  };
  for (const [name, spec] of Object.entries(flags)) {
    config[name] = spec.short ? { type: spec.kind, short: spec.short } : { type: spec.kind };
  }
  return config;
}

function validateFlagSpecs(flags: FlagSpecs): void {
  const shorts = new Set<string>(["h"]);
  for (const [name, spec] of Object.entries(flags)) {
    if (name === "help" || name === "json") {
      throw new Error(`Flag "--${name}" is reserved by the CLI runner.`);
    }
    if (spec.short !== undefined) {
      if (shorts.has(spec.short)) {
        throw new Error(`Short flag "-${spec.short}" is duplicated or reserved.`);
      }
      shorts.add(spec.short);
    }
  }
}

function extractFlags<F extends FlagSpecs>(
  specs: F,
  values: Record<string, string | boolean | (string | boolean)[] | undefined>,
): FlagValues<F> {
  const parsed: Record<string, boolean | string | undefined> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const raw = values[name];
    if (spec.kind === "boolean") {
      parsed[name] = raw === true;
    } else {
      parsed[name] = typeof raw === "string" ? raw : undefined;
    }
  }
  return parsed as FlagValues<F>;
}

export function defineCommand<const F extends FlagSpecs = Record<never, never>>(
  spec: CommandSpec<F>,
): RegisteredCommand {
  if (spec.name === "help") {
    throw new Error('Command name "help" is reserved.');
  }
  const flags = (spec.flags ?? {}) as F;
  validateFlagSpecs(flags);
  const parseConfig = buildParseConfig(flags);
  return {
    name: spec.name,
    summary: spec.summary,
    ...(spec.usage !== undefined ? { usage: spec.usage } : {}),
    flags,
    execute: async (argv, ctx) => {
      let parsed: ReturnType<typeof parseArgs>;
      try {
        parsed = parseArgs({
          args: [...argv],
          options: parseConfig,
          allowPositionals: true,
          strict: true,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message, exitCode: 2 };
      }
      try {
        return await spec.run(
          {
            flags: extractFlags(flags, parsed.values),
            positionals: parsed.positionals,
          },
          ctx,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message, exitCode: 1 };
      }
    },
  };
}

function describeFlag(name: string, spec: FlagSpec): string {
  const shortPrefix = spec.short ? `-${spec.short}, ` : "    ";
  const valueSuffix = spec.kind === "string" ? " <value>" : "";
  return `  ${shortPrefix}--${name}${valueSuffix}`;
}

function formatGlobalHelp(commands: readonly RegisteredCommand[]): string {
  const width = Math.max(4, ...commands.map((cmd) => cmd.name.length)) + 2;
  const lines = [
    "Usage: pnpm cli <command> [options]",
    "",
    "Commands:",
    `  ${"help".padEnd(width)}List commands or show help for one command`,
    ...commands.map((cmd) => `  ${cmd.name.padEnd(width)}${cmd.summary}`),
    "",
    "Global options:",
    "      --json             Emit structured JSON output",
    "  -h, --help             Show help",
    "",
  ];
  return lines.join("\n");
}

function formatCommandHelp(command: RegisteredCommand): string {
  const flagEntries = Object.entries(command.flags);
  const flagRows: readonly [string, string][] = [
    ...flagEntries.map(([name, spec]): [string, string] => [describeFlag(name, spec), spec.description]),
    ["      --json", "Emit structured JSON output"],
    ["  -h, --help", "Show help"],
  ];
  const width = Math.max(...flagRows.map(([label]) => label.length)) + 2;
  const lines = [
    `Usage: ${command.usage ?? `pnpm cli ${command.name} [options]`}`,
    "",
    command.summary,
    "",
    "Options:",
    ...flagRows.map(([label, desc]) => `${label.padEnd(width)}${desc}`),
    "",
  ];
  return lines.join("\n");
}

function commandManifest(command: RegisteredCommand) {
  return {
    name: command.name,
    summary: command.summary,
    usage: command.usage ?? `pnpm cli ${command.name} [options]`,
    flags: command.flags,
  };
}

function emitJson(io: CliIo, payload: unknown): void {
  io.writeOut(`${JSON.stringify(payload, null, 2)}\n`);
}

function emitHelp(
  io: CliIo,
  json: boolean,
  commands: readonly RegisteredCommand[],
  target?: RegisteredCommand,
): void {
  if (json) {
    emitJson(io, {
      ok: true,
      command: "help",
      data: target ? commandManifest(target) : { commands: commands.map(commandManifest) },
    });
    return;
  }
  io.writeOut(target ? formatCommandHelp(target) : formatGlobalHelp(commands));
}

function emitFailure(io: CliIo, json: boolean, command: string | undefined, message: string, data?: unknown): void {
  if (json) {
    emitJson(io, {
      ok: false,
      ...(command !== undefined ? { command } : {}),
      error: message,
      ...(data !== undefined ? { data } : {}),
    });
    return;
  }
  io.writeErr(`error: ${message}\n`);
}

function indexCommands(commands: readonly RegisteredCommand[]): ReadonlyMap<string, RegisteredCommand> {
  const byName = new Map<string, RegisteredCommand>();
  for (const cmd of commands) {
    if (cmd.name === "help") {
      throw new Error('Command name "help" is reserved.');
    }
    if (byName.has(cmd.name)) {
      throw new Error(`Duplicate CLI command "${cmd.name}".`);
    }
    byName.set(cmd.name, cmd);
  }
  return byName;
}

function extractLeadingGlobalFlags(argv: readonly string[]): {
  readonly json: boolean;
  readonly help: boolean;
  readonly rest: readonly string[];
} {
  let json = false;
  let help = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--json") {
      json = true;
      index += 1;
      continue;
    }
    if (token === "-h" || token === "--help") {
      help = true;
      index += 1;
      continue;
    }
    break;
  }
  return { json, help, rest: argv.slice(index) };
}

function detectCommandGlobalFlags(
  flags: FlagSpecs,
  argv: readonly string[],
): { readonly json: boolean; readonly help: boolean; readonly positionals: readonly string[] } {
  const parsed = parseArgs({
    args: [...argv],
    options: buildParseConfig(flags),
    allowPositionals: true,
    strict: false,
  });
  return {
    json: parsed.values.json === true,
    help: parsed.values.help === true,
    positionals: parsed.positionals,
  };
}

export async function runCli(options: RunCliOptions): Promise<number> {
  const byName = indexCommands(options.commands);
  const leading = extractLeadingGlobalFlags(options.argv);
  const [first, ...tail] = leading.rest;

  if (first === undefined) {
    emitHelp(options.io, leading.json, options.commands);
    return 0;
  }

  if (first === "help") {
    const helpArgs = detectCommandGlobalFlags({}, tail);
    const json = leading.json || helpArgs.json;
    const targetName = helpArgs.positionals[0];
    if (leading.help || helpArgs.help || targetName === undefined) {
      emitHelp(options.io, json, options.commands);
      return 0;
    }
    const target = byName.get(targetName);
    if (!target) {
      emitFailure(options.io, json, "help", `Unknown command "${targetName}". Run "pnpm cli --help" to list commands.`);
      return 2;
    }
    emitHelp(options.io, json, options.commands, target);
    return 0;
  }

  const command = byName.get(first);
  if (!command) {
    const tailFlags = detectCommandGlobalFlags({}, tail);
    emitFailure(
      options.io,
      leading.json || tailFlags.json,
      undefined,
      `Unknown command "${first}". Run "pnpm cli --help" to list commands.`,
    );
    return 2;
  }

  const cmdFlags = detectCommandGlobalFlags(command.flags, tail);
  const json = leading.json || cmdFlags.json;
  if (leading.help || cmdFlags.help) {
    emitHelp(options.io, json, options.commands, command);
    return 0;
  }

  const ctx: CliContext = {
    rootDir: options.rootDir,
    cwd: options.cwd,
    json,
    io: options.io,
  };
  const result = await command.execute(tail, ctx);
  if (!result.ok) {
    emitFailure(options.io, json, command.name, result.message, result.data);
    return result.exitCode ?? 1;
  }
  if (json) {
    emitJson(options.io, { ok: true, command: command.name, data: result.data });
  } else if (result.lines) {
    options.io.writeOut(`${result.lines.join("\n")}\n`);
  }
  return 0;
}
