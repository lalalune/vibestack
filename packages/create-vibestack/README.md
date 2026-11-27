# create-vibestack

Create a new [Vibestack](https://github.com/lalalune/vibestack) project from the starter template or an official example.

## Usage

```sh
pnpm dlx --package=https://github.com/lalalune/vibestack/releases/latest/download/create-vibestack.tgz create-vibestack my-app
```

### Options

| Flag | Description |
| --- | --- |
| `--example <name>` | Scaffold an example instead of the starter template (`order`, `dashboard`, `fullstack`, `assistant`) |
| `--mode <mode>` | Write `vibestack.json` with `vibelang`, `typescript`, or `specs-only` |
| `--no-install` | Skip `pnpm install`, `vibestack init`, and `vibestack doctor` |
| `--vibestack-version <ver\|path>` | Pin `vibestack` to a specific release URL, `latest`, semver range, local directory, or tarball |
