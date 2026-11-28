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
| `pnpm dev:cf` | Runs the app locally inside Cloudflare `workerd` via Alchemy (`alchemy dev`) |
| `pnpm deploy` / `pnpm deploy:plan` | Deploys or previews Cloudflare infrastructure via `pnpm cli deploy` |
| `pnpm test:deploy` | Verifies the built app inside offline local `workerd` |
| `pnpm studio` | Opens Vibestack Studio |
| `pnpm cli <command>` | Runs project CLI subcommands (`pnpm cli --help` lists commands; pass `--json` for structured output) |
| `pnpm check` | Runs the full verification pipeline: model, simulation, proofs, types, tests, traces, explore, review |
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
| `alchemy.run.ts` | Alchemy v2 Cloudflare deployment stack and post-deploy verification |
| `apps/app/` | Starter React + VibeLang application wired to `spec/app/` |
| `packages/cli/` | Project CLI (`pnpm cli <command>`) for verification, inspection, and operational subcommands |
| `packages/design-system/` | Design tokens (`tokens.json`) and generated CSS theme |
| `packages/ui/` | Shared Radix + Tailwind component library with Storybook metadata |
