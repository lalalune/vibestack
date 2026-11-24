# my-vibestack-app

Built with [Vibestack](https://github.com/lalalune/vibestack): stories, rules and Quint state machines in `spec/`, verified TypeScript and Effect adapters out, and a React interface on `@repo/ui` and `@repo/design-system`.

## Getting started

Requires Node 26+, pnpm 10+, and Dafny 4.11 (`pnpm doctor --install-dafny` checks and installs Dafny automatically).

```sh
pnpm install
pnpm doctor
pnpm check
pnpm dev
```

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Runs the app and launches Vibestack Studio |
| `pnpm studio` | Opens Vibestack Studio (or run `pnpm dlx vibestack-studio`) |
| `pnpm check` | Runs the full verification pipeline: model, simulation, proofs, types, tests, traces, review |
| `pnpm gen` | Generates TypeScript, Effect adapters, and React hooks from `spec/` |
| `pnpm accept` | Records reviewed rules in `spec/lock.json` |
| `pnpm new <name>` | Scaffolds a new spec area |
| `pnpm quick` | Fast local check: typecheck, unit tests, and lint |
| `pnpm verify` | Full build, typecheck, tests, browser tests, `check`, and lint |
| `pnpm upgrade` | Upgrades Vibestack and refreshes managed agent skills |
| `pnpm doctor` | Checks Node, pnpm, Dafny, Quint, Chromium, and skill links |

## Layout

| Path | Role |
| --- | --- |
| `spec/` | Stories, rules, and Quint models (`spec/index.md` is the entry point) |
| `apps/app/` | Starter React + VibeLang application wired to `spec/app/` |
| `packages/design-system/` | Design tokens (`tokens.json`) and generated CSS theme |
| `packages/ui/` | Shared Radix + Tailwind component library with Storybook metadata |
