import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { commands, defineCommand, runCli, type CliIo } from "../src/index.ts";

const templateRoot = path.resolve(import.meta.dirname, "../../..");
const mainPath = path.resolve(import.meta.dirname, "../src/main.ts");

function createRecorder(): { readonly io: CliIo; readonly out: () => string; readonly err: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      writeOut: (text) => {
        stdout.push(text);
      },
      writeErr: (text) => {
        stderr.push(text);
      },
    },
    out: () => stdout.join(""),
    err: () => stderr.join(""),
  };
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

describe("project CLI", () => {
  test("lists registered commands in human and JSON help output", async () => {
    const human = createRecorder();
    expect(await runCli({ argv: ["--help"], commands, rootDir: templateRoot, cwd: templateRoot, io: human.io })).toBe(0);
    expect(human.out()).toContain("Usage: pnpm cli <command> [options]");
    expect(human.out()).toContain("status");

    const structured = createRecorder();
    expect(await runCli({ argv: ["help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: structured.io })).toBe(0);
    expect(parseJson(structured.out())).toEqual({
      ok: true,
      command: "help",
      data: {
        commands: [
          {
            name: "status",
            summary: "Inspect workspace packages, specs, and generated outputs",
            usage: "pnpm cli status [--package <name|path>] [--json]",
            flags: {
              package: {
                kind: "string",
                short: "p",
                description: "Filter to one workspace package by name or relative path",
              },
            },
          },
          {
            name: "deploy",
            summary: "Plan, deploy, verify, or destroy Cloudflare infrastructure via Alchemy",
            usage: "pnpm cli deploy [--stage <name>] [--dry-run] [--verify] [--destroy] [--url <url>] [--json]",
            flags: {
              stage: {
                kind: "string",
                short: "s",
                description: "Target stage (defaults to worktree-scoped dev_<user>_<worktree>)",
              },
              "dry-run": {
                kind: "boolean",
                description: "Run `alchemy plan` without mutating cloud resources",
              },
              verify: {
                kind: "boolean",
                description: "Verify live HTTP endpoints after deploy (or verify --url directly)",
              },
              destroy: {
                kind: "boolean",
                description: "Destroy resources for the target stage",
              },
              url: {
                kind: "string",
                description: "Explicit base URL to verify when running --verify",
              },
            },
          },
        ],
      },
    });

    const single = createRecorder();
    expect(await runCli({ argv: ["status", "--help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: single.io })).toBe(0);
    expect(parseJson(single.out())).toEqual({
      ok: true,
      command: "help",
      data: {
        name: "status",
        summary: "Inspect workspace packages, specs, and generated outputs",
        usage: "pnpm cli status [--package <name|path>] [--json]",
        flags: {
          package: {
            kind: "string",
            short: "p",
            description: "Filter to one workspace package by name or relative path",
          },
        },
      },
    });
  });

  test("status inspects workspace packages and specs and supports filtering", async () => {
    const all = createRecorder();
    expect(await runCli({ argv: ["status", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: all.io })).toBe(0);
    const parsed = parseJson(all.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly project: string;
        readonly specs: readonly string[];
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.specs).toContain("spec/index.md");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toEqual(["@repo/app", "@repo/cli", "@repo/design-system", "@repo/ui"]);

    const filtered = createRecorder();
    expect(await runCli({ argv: ["status", "-p", "@repo/app", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: filtered.io })).toBe(0);
    const filteredParsed = parseJson(filtered.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(filteredParsed.ok).toBe(true);
    expect(filteredParsed.command).toBe("status");
    expect(filteredParsed.data.packages.map((pkg) => ({ name: pkg.name, path: pkg.path }))).toEqual([
      { name: "@repo/app", path: "apps/app" },
    ]);

    const missing = createRecorder();
    expect(await runCli({ argv: ["status", "--package", "@repo/missing", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: missing.io })).toBe(1);
    const missingParsed = parseJson(missing.out()) as { readonly ok: boolean; readonly command: string; readonly error: string };
    expect(missingParsed.ok).toBe(false);
    expect(missingParsed.command).toBe("status");
    expect(missingParsed.error).toContain("@repo/missing");
  });

  test("returns exit code 2 on unknown commands and unknown flags", async () => {
    const unknownCmd = createRecorder();
    expect(await runCli({ argv: ["nope"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownCmd.io })).toBe(2);
    expect(unknownCmd.err()).toContain('Unknown command "nope"');

    const unknownFlag = createRecorder();
    expect(await runCli({ argv: ["status", "--bogus", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownFlag.io })).toBe(2);
    expect(parseJson(unknownFlag.out())).toMatchObject({
      ok: false,
      command: "status",
    });

    const failing = defineCommand({
      name: "boom",
      summary: "Throws at runtime",
      run: () => {
        throw new Error("corrupt state");
      },
    });

    const textFailure = createRecorder();
    expect(await runCli({ argv: ["boom"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: textFailure.io })).toBe(1);
    expect(textFailure.err()).toBe("error: corrupt state\n");

    const jsonFailure = createRecorder();
    expect(await runCli({ argv: ["boom", "--json"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: jsonFailure.io })).toBe(1);
    expect(parseJson(jsonFailure.out())).toEqual({
      ok: false,
      command: "boom",
      error: "corrupt state",
    });
  });

  test("defineCommand parses typed flags and positionals for custom levers", async () => {
    const custom = defineCommand({
      name: "echo",
      summary: "Echo input",
      flags: {
        upper: { kind: "boolean", short: "u", description: "Uppercase output" },
        prefix: { kind: "string", description: "Prefix text" },
      },
      run: ({ flags, positionals }) => {
        const joined = positionals.join(" ");
        const body = flags.upper ? joined.toUpperCase() : joined;
        const text = flags.prefix ? `${flags.prefix}:${body}` : body;
        return { ok: true, data: { text }, lines: [text] };
      },
    });

    const recorded = createRecorder();
    expect(await runCli({
      argv: ["echo", "-u", "--prefix", "ok", "hello", "world"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: recorded.io,
    })).toBe(0);
    expect(recorded.out()).toBe("ok:HELLO WORLD\n");

    const flagValue = createRecorder();
    expect(await runCli({
      argv: ["echo", "--prefix=--help", "hi"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: flagValue.io,
    })).toBe(0);
    expect(flagValue.out()).toBe("--help:hi\n");

    const ambiguousFlagValue = createRecorder();
    expect(await runCli({
      argv: ["echo", "--prefix", "--help", "hi"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: ambiguousFlagValue.io,
    })).toBe(2);
    expect(ambiguousFlagValue.out()).toBe("");

    const bundledHelp = createRecorder();
    expect(await runCli({
      argv: ["echo", "-uh"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: bundledHelp.io,
    })).toBe(0);
    expect(bundledHelp.out()).toContain("Usage: pnpm cli echo [options]");

    const passthrough = createRecorder();
    expect(await runCli({
      argv: ["echo", "--", "--help"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: passthrough.io,
    })).toBe(0);
    expect(passthrough.out()).toBe("--help\n");

    expect(() => defineCommand({ name: "help", summary: "Reserved", run: () => ({ ok: true, data: null }) })).toThrow();
    expect(() => defineCommand({
      name: "bad",
      summary: "Reserved flag",
      flags: { json: { kind: "boolean", description: "Reserved" } },
      run: () => ({ ok: true, data: null }),
    })).toThrow();
    expect(() => defineCommand({
      name: "bad-short",
      summary: "Reserved short",
      flags: { header: { kind: "string", short: "h", description: "Reserved" } },
      run: () => ({ ok: true, data: null }),
    })).toThrow();
    await expect(runCli({
      argv: ["echo"],
      commands: [custom, custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: createRecorder().io,
    })).rejects.toThrow(/Duplicate CLI command/);
  });

  test("executes directly on Node 26 via src/main.ts", () => {
    const stdout = execFileSync(process.execPath, [mainPath, "status", "--json"], {
      cwd: templateRoot,
      encoding: "utf8",
    });
    const parsed = parseJson(stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toContain("@repo/cli");
  });

  test("deploy validates conflicting flags and verifies explicit endpoints", async () => {
    const conflict = createRecorder();
    expect(await runCli({
      argv: ["deploy", "--dry-run", "--destroy", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: conflict.io,
    })).toBe(2);
    expect(parseJson(conflict.out())).toMatchObject({ ok: false, command: "deploy" });

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<div id="root">ok</div>');
    });
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    try {
      const { port } = server.address() as AddressInfo;
      const verified = createRecorder();
      expect(await runCli({
        argv: ["deploy", "--verify", "--url", `http://127.0.0.1:${String(port)}`, "--stage", "staging", "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: verified.io,
      })).toBe(0);
      expect(parseJson(verified.out())).toMatchObject({
        ok: true,
        command: "deploy",
        data: {
          stage: "staging",
          stageKind: "staging",
          receipt: { ok: true },
        },
      });
    } finally {
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    }
  });
});
