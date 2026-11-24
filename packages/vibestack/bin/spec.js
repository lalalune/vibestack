#!/usr/bin/env node
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import process from "node:process";

const compiled = module.enableCompileCache?.();
if (compiled?.directory) process.env.NODE_COMPILE_CACHE ??= compiled.directory;
const dist = path.resolve(import.meta.dirname, "../dist/pipeline.js");
const entry = fs.existsSync(dist) ? "../dist/pipeline.js" : "../src/pipeline.ts";
await (await import(entry)).main();
