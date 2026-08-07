/**
 * Empaqueta LocalComida para macOS (.dmg + .zip).
 * Debe ejecutarse en un Mac (darwin). Desde Windows solo imprime instrucciones.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.error(`
═══════════════════════════════════════════════════════════
  LocalComida Mac — este comando solo funciona EN un Mac
═══════════════════════════════════════════════════════════

Estás en: ${process.platform} / ${process.arch}

Pasos en un Mac (Apple Silicon recomendado):

  1. Copia esta carpeta del proyecto al Mac
     (USB, zip, o git clone)

  2. Instala Node.js LTS si no lo tienes:
     https://nodejs.org

  3. En Terminal, dentro de la carpeta del proyecto:

       npm install
       npm run dist:mac

  4. El instalador queda en:
       dist-instalador/LocalComida-*-mac-arm64.dmg

  5. Abre el .dmg → arrastra LocalComida a Aplicaciones
     La primera vez: clic derecho → Abrir (Gatekeeper,
     porque aún no está notarizado por Apple).

Sincronización: igual que Windows/Android (misma Wi‑Fi,
un equipo principal, QR/código).

Detalle: docs/MAC-BUILD.md
`);
  process.exit(1);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";
console.log(`=== LocalComida · dist Mac (${arch}) ===\n`);

function run(cmd, args, env = process.env) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "prepare-client:mac"]);

// Sin certificado Apple: build local usable (Gatekeeper pide "Abrir" la 1ª vez)
run("npx", ["electron-builder", "--mac", `--${arch}`], {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
});

console.log(`
Listo. Busca el .dmg en:
  ${path.join(root, "dist-instalador")}
`);
