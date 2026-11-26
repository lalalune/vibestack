#!/usr/bin/env node
import module from "node:module";

const compiled = module.enableCompileCache?.();
if (compiled?.directory) process.env.NODE_COMPILE_CACHE ??= compiled.directory;
const [command, ...rest] = process.argv.slice(2);
if (command === "stories" || command === "tokens") {
  process.argv.splice(2, 1);
  await (command === "stories" ? import("./stories/cli.ts") : import("./design/cli.ts"));
} else if (command === "tasks") {
  if (Number(process.versions.node.split(".")[0]) < 26) {
    console.error(`spec needs Node 26 or later; this is Node ${process.versions.node}`);
    process.exitCode = 1;
  } else {
    try {
      const code = await (await import("./tasks.ts")).runTasks(process.cwd(), rest);
      process.exitCode = code ?? 1;
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  }
} else if (command === "link" && rest.length <= 1 && !rest[0]?.startsWith("-")) {
  if (Number(process.versions.node.split(".")[0]) < 26) {
    console.error(`spec needs Node 26 or later; this is Node ${process.versions.node}`);
    process.exitCode = 1;
  } else {
    try {
      const [{ linkAgents }, { projectRoot }] = await Promise.all([import("./upgrade.ts"), import("./util.ts")]);
      const target = rest[0] ? projectRoot(rest[0]) : process.cwd();
      const linked = linkAgents(target, (message) => console.warn(`note: ${message}`));
      console.log(linked.length ? `linked: ${linked.join(", ")}` : "links are already up to date");
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  }
} else {
  await (await import("./pipeline.ts")).main();
}
