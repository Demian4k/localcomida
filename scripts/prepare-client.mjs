import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-cliente");
const backendSrc = path.join(root, "backend");
const frontendDist = path.join(root, "frontend", "dist");
const NODE_VERSION = "v22.23.1";

const args = process.argv.slice(2);
function flag(name) {
  const pref = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  if (args.includes(`--${name}`)) return true;
  return null;
}

/** win | mac | linux — por defecto, la plataforma actual */
function resolveTargetPlatform() {
  const raw = flag("platform");
  if (raw === "win" || raw === "windows") return "win";
  if (raw === "mac" || raw === "darwin" || raw === "osx") return "mac";
  if (raw === "linux") return "linux";
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return "mac";
  return "linux";
}

const targetPlatform = resolveTargetPlatform();

function run(cmd, argsList, cwd, env = process.env) {
  console.log(`> ${cmd} ${argsList.join(" ")}`);
  const r = spawnSync(cmd, argsList, { cwd, stdio: "inherit", shell: true, env });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data" || entry.name === "dist") {
      continue;
    }
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed ${res.statusCode} ${url}`));
          return;
        }
        void pipeline(res, file).then(resolve).catch(reject);
      })
      .on("error", reject);
  });
}

function hostArchForMac() {
  // Apple Silicon → arm64; Intel → x64
  return process.arch === "arm64" ? "arm64" : "x64";
}

async function bundleWindowsNode() {
  const runtime = path.join(out, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const zipPath = path.join(out, zipName);
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${zipName}`;
  console.log(`\nDescargando Node ${NODE_VERSION} portable (Windows)…`);
  await download(url, zipPath);

  const extractDir = path.join(out, "_node_extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const ps = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );
  if (ps.status !== 0) {
    console.warn("No se pudo descomprimir Node portable; el .bat usará Node del sistema.");
    return;
  }

  const inner = path.join(extractDir, `node-${NODE_VERSION}-win-x64`);
  for (const name of ["node.exe", "npm.cmd", "npx.cmd", "npm", "npx"]) {
    const from = path.join(inner, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(runtime, name));
  }
  const npmDir = path.join(inner, "node_modules");
  if (fs.existsSync(npmDir)) {
    fs.cpSync(npmDir, path.join(runtime, "node_modules"), { recursive: true });
  }

  fs.rmSync(zipPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log("Node portable listo en runtime/");
}

async function bundleDarwinNode() {
  if (process.platform !== "darwin") {
    console.error(`
ERROR: El runtime de Mac (Node + better-sqlite3) debe prepararse EN un Mac.
En este PC estás en ${process.platform}; no se puede recompilar el nativo para Darwin.

En un Mac, clona/copia el proyecto y ejecuta:
  npm install
  npm run prepare-client:mac
  npm run dist:mac
`);
    process.exit(1);
  }

  const arch = hostArchForMac();
  const runtime = path.join(out, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const tarName = `node-${NODE_VERSION}-darwin-${arch}.tar.gz`;
  const tarPath = path.join(out, tarName);
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${tarName}`;
  console.log(`\nDescargando Node ${NODE_VERSION} (macOS ${arch})…`);
  await download(url, tarPath);

  const extractDir = path.join(out, "_node_extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  const tar = spawnSync("tar", ["-xzf", tarPath, "-C", extractDir], { stdio: "inherit" });
  if (tar.status !== 0) {
    console.warn("No se pudo descomprimir Node; se usará Node del sistema al arrancar.");
    fs.rmSync(tarPath, { force: true });
    return;
  }

  const inner = path.join(extractDir, `node-${NODE_VERSION}-darwin-${arch}`);
  const binDir = path.join(inner, "bin");
  for (const name of ["node", "npm", "npx"]) {
    const from = path.join(binDir, name);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(runtime, name));
      fs.chmodSync(path.join(runtime, name), 0o755);
    }
  }
  // npm/npx suelen ser scripts que necesitan lib/node_modules del tarball
  const libDir = path.join(inner, "lib");
  if (fs.existsSync(libDir)) {
    fs.cpSync(libDir, path.join(runtime, "lib"), { recursive: true });
  }

  fs.rmSync(tarPath, { force: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  console.log(`Node portable macOS (${arch}) listo en runtime/`);
}

function rebuildBetterSqlite3(nodeBinHint) {
  console.log("\nRecompilando better-sqlite3 para este runtime…");
  const outBackend = path.join(out, "backend");
  const runtimePath = path.join(out, "runtime");
  const env = {
    ...process.env,
    PATH: `${runtimePath}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["rebuild", "better-sqlite3"], {
    cwd: outBackend,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (r.status !== 0) {
    console.warn(
      `rebuild better-sqlite3 falló (hint: ${nodeBinHint}); se usará el binario actual si es compatible`,
    );
  }
}

console.log(`=== LocalComida · preparar paquete cliente (${targetPlatform}) ===\n`);

run("npm", ["run", "build"], path.join(root, "frontend"));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const outBackend = path.join(out, "backend");
copyDir(backendSrc, outBackend);
fs.copyFileSync(path.join(backendSrc, "package.json"), path.join(outBackend, "package.json"));
fs.copyFileSync(
  path.join(backendSrc, "package-lock.json"),
  path.join(outBackend, "package-lock.json"),
);

fs.cpSync(frontendDist, path.join(out, "ui"), { recursive: true });
fs.mkdirSync(path.join(out, "data"), { recursive: true });

const jwtSecret = `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
fs.writeFileSync(
  path.join(outBackend, ".env"),
  `PORT=8000
NODE_ENV=production
LOCALCOMIDA_PACKAGED=1
JWT_SECRET=${jwtSecret}
`,
);
fs.writeFileSync(path.join(out, "data", "jwt_secret"), jwtSecret, { encoding: "utf8" });
fs.mkdirSync(path.join(out, "releases"), { recursive: true });
const apkSrc = path.join(root, "releases", "LocalComida-android.apk");
const apkDebug = path.join(root, "dist-apk", "LocalComida-tablet-debug.apk");
if (fs.existsSync(apkSrc)) {
  fs.copyFileSync(apkSrc, path.join(out, "releases", "LocalComida-android.apk"));
} else if (fs.existsSync(apkDebug)) {
  fs.copyFileSync(apkDebug, path.join(out, "releases", "LocalComida-android.apk"));
}

console.log("\nInstalando dependencias de producción del backend…");
run("npm", ["install", "--omit=dev"], outBackend);
run("npm", ["install", "tsx", "--no-save"], outBackend);

if (targetPlatform === "win") {
  await bundleWindowsNode();
  const bundledNode = path.join(out, "runtime", "node.exe");
  if (fs.existsSync(bundledNode)) rebuildBetterSqlite3(bundledNode);
} else if (targetPlatform === "mac") {
  await bundleDarwinNode();
  const bundledNode = path.join(out, "runtime", "node");
  if (fs.existsSync(bundledNode)) rebuildBetterSqlite3(bundledNode);
} else {
  console.log("\nLinux: se usará Node del sistema (no se empaqueta runtime/).");
}

fs.writeFileSync(
  path.join(out, "Iniciar-LocalComida.bat"),
  `@echo off
setlocal
cd /d "%~dp0"

REM Fallback tecnico interno (sin abrir el navegador del sistema).
REM Entrega oficial al cliente: LocalComida portable (.exe Electron).

set "NODE_BIN=%~dp0runtime\\node.exe"
if not exist "%NODE_BIN%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo No se encontro Node.js.
    echo Usa el ejecutable LocalComida portable, o instala Node.js LTS.
    pause
    exit /b 1
  )
  set "NODE_BIN=node"
)

set PORT=8000
set "UI_DIST=%~dp0ui"
set "DB_PATH=%~dp0data\\pos.db"
set "PATH=%~dp0runtime;%PATH%"
set LOCALCOMIDA_PACKAGED=1
set NODE_ENV=production

echo.
echo  LocalComida (servidor API)
echo  -------------------------
echo  API en http://0.0.0.0:%PORT%  (tablets en la misma Wi-Fi)
echo  NO se abre el navegador. Usa el .exe Electron en el PC de caja.
echo  Cierra esta ventana para detener el servidor.
echo.

cd /d "%~dp0backend"
"%NODE_BIN%" ".\\node_modules\\tsx\\dist\\cli.mjs" "src\\index.ts"
pause
`,
);

fs.writeFileSync(
  path.join(out, "Iniciar-LocalComida.sh"),
  `#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
export PORT=8000
export UI_DIST="$DIR/ui"
export DB_PATH="$DIR/data/pos.db"
export LOCALCOMIDA_PACKAGED=1
export NODE_ENV=production
NODE_BIN="$DIR/runtime/node"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN=node
fi
echo "LocalComida API en http://0.0.0.0:8000 (sin abrir navegador)..."
cd "$DIR/backend"
exec "$NODE_BIN" ./node_modules/tsx/dist/cli.mjs src/index.ts
`,
  { mode: 0o755 },
);

fs.writeFileSync(
  path.join(out, "LEEME.txt"),
  `LocalComida — PC (Electron) + tablets (APK)
===========================================

NO uses el navegador del sistema como app del local.

Windows: LocalComida-*-portable.exe
macOS:   LocalComida-*-mac-*.dmg  (arrastrar a Aplicaciones)

Tablets Android: LocalComida-android.apk (misma Wi-Fi).
Flujo: Principal o cliente → Caja/Preparacion → Login.

Ver docs/MAC-BUILD.md y LEEME.txt en la raiz del proyecto.
`,
);

console.log(`
Listo: ${out}

Windows:  npm run dist:win
macOS:    npm run dist:mac   (solo en un Mac)
`);
