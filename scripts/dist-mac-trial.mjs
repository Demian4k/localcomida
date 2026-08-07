/**
 * Empaqueta LocalComida versión de prueba para macOS (.dmg + .zip).
 * Incluye candado de 20 días (VITE_TRIAL=1). Solo en Darwin.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.error("dist:mac:trial solo puede ejecutarse en un Mac (o en GitHub Actions macos).");
  process.exit(1);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";
console.log(`=== LocalComida Prueba · dist Mac (${arch}) ===\n`);

function run(cmd, args, env = process.env) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    // En Unix shell:true parte mal los args con espacios (p. ej. productName).
    shell: process.platform === "win32",
    env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const trialEnv = { ...process.env, VITE_TRIAL: "1" };

run("npm", ["run", "prepare-client:mac"], trialEnv);

run(
  "npx",
  [
    "electron-builder",
    "--mac",
    `--${arch}`,
    "-c.appId=com.localcomida.pos.trial",
    "-c.productName=LocalComida Prueba",
    "-c.mac.artifactName=LocalComida-prueba-${version}-mac-${arch}.${ext}",
  ],
  {
    ...trialEnv,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
);

console.log(`
Listo (prueba 20 días). Busca el .dmg en:
  ${path.join(root, "dist-instalador")}
`);
