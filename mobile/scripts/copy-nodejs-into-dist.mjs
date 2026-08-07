import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "nodejs");
const dest = path.resolve(root, "..", "frontend", "dist", "nodejs");

if (!fs.existsSync(path.join(src, "index.cjs"))) {
  console.error("Falta mobile/nodejs/index.cjs — ejecuta: npm run bundle:host --prefix backend");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("nodejs host → frontend/dist/nodejs");
