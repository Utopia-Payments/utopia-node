// Builds dist/index.js (ESM) with types, plus dist/index.cjs for require().
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const run = (...args) =>
  execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "inherit" });

rmSync(join(root, "dist"), { recursive: true, force: true });
run("-p", "tsconfig.json");

const cjs = join(root, ".cjs-build");
rmSync(cjs, { recursive: true, force: true });
mkdirSync(cjs);
run(
  "-p",
  "tsconfig.json",
  "--module",
  "commonjs",
  "--moduleResolution",
  "node10",
  "--declaration",
  "false",
  "--outDir",
  cjs,
);
// CommonJS consumers get the default export as module.exports.Utopia and .default.
writeFileSync(join(root, "dist", "index.cjs"), readFileSync(join(cjs, "index.js")));
copyFileSync(join(root, "dist", "index.d.ts"), join(root, "dist", "index.d.cts"));
rmSync(cjs, { recursive: true, force: true });
console.log("Built dist/index.js, dist/index.cjs and type declarations");
