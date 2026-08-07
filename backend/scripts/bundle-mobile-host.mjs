/**
 * El host Android usa server.cjs JSON (sin bundle esbuild).
 * Este script solo asegura package.json y limpia artefactos viejos de sql.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mobile", "nodejs");
const server = path.join(outDir, "server.cjs");
const index = path.join(outDir, "index.cjs");

if (!fs.existsSync(server) || !fs.existsSync(index)) {
  throw new Error("Faltan mobile/nodejs/index.cjs o server.cjs");
}

fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify({ name: "localcomida-mobile-host", private: true, main: "index.cjs" }, null, 2),
);

const nm = path.join(outDir, "node_modules");
if (fs.existsSync(nm)) {
  fs.rmSync(nm, { recursive: true, force: true });
}
for (const name of ["sql-wasm.wasm", "sql-wasm.js"]) {
  const p = path.join(outDir, name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log("Host Android JSON listo:", outDir);
console.log("  index.cjs", fs.statSync(index).size, "bytes");
console.log("  server.cjs", fs.statSync(server).size, "bytes");
