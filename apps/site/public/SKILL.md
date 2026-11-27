---
name: vibestack
description: Create a new Vibestack application, adopt or upgrade Vibestack in an existing repository, and launch Vibestack Studio.
---

# Vibestack

Build formally verified full-stack applications in English. Stories and rules live in `spec/**/*.md` with formal Quint models underneath; `gen/` is derived, simulated, and proved with Dafny and LemmaScript; the shell is built in VibeLang on Effect 4 with a React + Tailwind + shadcn/ui interface.

Repository: https://github.com/lalalune/vibestack
Website: https://vibestack.fun

## Prerequisites

- **Node 26+**
- **pnpm** (`corepack enable` or https://pnpm.io)
- **Dafny 4.11** (checked and installed automatically by `pnpm exec vibestack doctor --install-dafny`)

---

## 1. Create a new project

1. If the user has not already described the product, ask what they want to build, who it is for, and its main workflows.
2. Scaffold a new project (or start from an example: `order`, `dashboard`, `fullstack`, `assistant`):

```bash
pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/create-vibestack.tgz create-vibestack <project-name>
# Or scaffold from a standalone example:
pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/create-vibestack.tgz create-vibestack <project-name> --example order
```

> Packages are installed from [GitHub Releases](https://github.com/lalalune/vibestack/releases) `.tgz` tarballs — do not run `pnpm add -D vibestack` or `pnpm create vibestack` against npm (the unscoped `vibestack` npm name belongs to an unrelated package).

3. Enter the project directory and verify/install Dafny 4.11 if missing (`create-vibestack` already runs `pnpm install`, `vibestack init --yes`, and `vibestack doctor`):

```bash
cd <project-name>
pnpm exec vibestack doctor --install-dafny
```

4. Read `AGENTS.md` and `SPEC.md` in full, and follow the skills in `.agents/skills/` (`sync`, `shell`, `prove`, `design`).
5. Write the product overview in `spec/index.md` and the application's stories, rules, and Quint models in `spec/app/index.md` (use `pnpm new <name>` for additional spec areas).
6. Build the application in `apps/app`:
   - Shell effects and I/O in VibeLang (`src/*.vibe`) over the generated `gen/<name>.effect.vibe` `Machine` service.
   - Interface in React (`src/*.tsx`) using `@repo/design-system` tokens and `@repo/ui` components.
   - Whole-journey tests (`test/*.test.{vibe,tsx}`) against real services, citing the story or rule heading each test verifies.
7. Run checks and iterate until only user review remains:

```bash
pnpm check
```

8. Never edit `gen/`, `.spec-cache/`, `.studio/`, or `spec/lock.json`, and never weaken or delete a rule to pass checks.
9. Show the user how to run the app (`pnpm dev`), summarize what needs review, and wait for their explicit confirmation before running `pnpm accept`.

---

## 2. Adopt or upgrade an existing project

### Adopt Vibestack in an existing repository

`vibestack init` is non-destructive and auto-detects `vibelang` vs. plain `typescript` mode:

```bash
pnpm add -D https://github.com/lalalune/vibestack/releases/latest/download/vibestack.tgz
pnpm exec vibestack init
pnpm exec vibestack doctor --install-dafny
```

Optional flags:

```bash
pnpm exec vibestack init --mode vibelang|typescript|specs-only
pnpm exec vibestack init --exclude <dirs>
pnpm exec spec new           # fill an empty spec/index.md
pnpm exec spec new <name>    # create a starter spec/<name>/index.md
```

### Upgrade an existing Vibestack repository

Preview or apply an upgrade to the latest release (updates unmodified managed skills, `AGENTS.md` block, `SPEC.md`, `.gitignore` block, and toolchain pins without clobbering custom edits):

```bash
pnpm exec vibestack upgrade --dry-run
pnpm vibestack upgrade
pnpm exec vibestack doctor --install-dafny
pnpm check
```

Read `AGENTS.md` and `SPEC.md` in full after initializing or upgrading, fix any check failures until only user review remains, and wait for the user before running `pnpm accept`.

---

## 3. Run Vibestack Studio

Launch the self-contained Vibestack Studio GUI (stories, live layout preview, interactive state graph, checks, and sign-off) on any project with `spec/`:

```bash
pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/vibestack-studio.tgz vibestack-studio
# Or with npx:
npx --yes --package=https://github.com/lalalune/vibestack/releases/latest/download/vibestack-studio.tgz vibestack-studio
# Or target a specific directory:
pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/vibestack-studio.tgz vibestack-studio ./path/to/project
```

Inside a scaffolded Vibestack project, `pnpm dev` runs Vibestack Studio alongside your application's dev server, and `pnpm studio` opens Vibestack Studio alone.

---

## Command reference

| Command | Does |
| --- | --- |
| `pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/create-vibestack.tgz create-vibestack <name> [--example order\|dashboard\|fullstack\|assistant]` | Scaffolds a new Vibestack project or standalone example |
| `pnpm add -D https://github.com/lalalune/vibestack/releases/latest/download/vibestack.tgz && pnpm exec vibestack init` | Non-destructively adds Vibestack to an existing repository |
| `pnpm vibestack upgrade` | Upgrades Vibestack, refreshes managed agent skills/docs, and aligns pins |
| `pnpm exec vibestack doctor --install-dafny` | Checks Node 26+, pnpm, Dafny 4.11, Quint, Chromium, and installs Dafny 4.11 if missing |
| `pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/vibestack-studio.tgz vibestack-studio [<dir>]` | Launches standalone Vibestack Studio on any project with `spec/` |
| `pnpm dev` | Starts Vibestack Studio and every workspace app dev server together |
| `pnpm check` | Generates core, simulates traces, runs Dafny/LemmaScript proofs, typechecks, runs tests, conformance, and Bombadil exploration |
| `pnpm gen` | Regenerates `gen/` only |
| `pnpm accept` | User sign-off: checks afresh and records reviewed rules in `spec/lock.json` |
