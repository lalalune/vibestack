import fs from "node:fs";
import path from "node:path";
import { writeWhole } from "../vibestack/src/util.ts";

const manifest = (page: string) => page + ".files.json";

function publicFiles(root: string): string[] {
  return fs.readdirSync(root).flatMap((name) => {
    const file = path.join(root, name);
    return fs.statSync(file).isDirectory() ? publicFiles(file).map((child) => name + "/" + child) : [name];
  });
}

export function recordPageFiles(page: string, bundle: string[], publicDir: string): void {
  const copied = publicDir && fs.existsSync(publicDir) ? publicFiles(publicDir) : [];
  const files = [...new Set([...bundle, ...copied])].sort();
  writeWhole(manifest(page), JSON.stringify(files));
}

export function verifyPageFiles(page: string): string[] {
  const files: unknown = JSON.parse(fs.readFileSync(manifest(page), "utf8"));
  const relativeFile = (file: unknown): file is string => typeof file === "string" && !path.win32.parse(file).root
    && !file.includes("\\") && file.split("/").every((part) => part && part !== "." && part !== "..");
  if (!Array.isArray(files) || !files.every(relativeFile) || !files.includes("index.html")) {
    throw new Error("Invalid Studio page build manifest: " + manifest(page));
  }
  const root = fs.realpathSync(page) + path.sep;
  for (const file of files) {
    const source = fs.realpathSync(path.join(page, file));
    if (!source.startsWith(root)) throw new Error("Studio page file escapes its build directory: " + file);
  }
  return files;
}

if (import.meta.main) {
  verifyPageFiles(path.join(import.meta.dirname, "dist/page"));
}
