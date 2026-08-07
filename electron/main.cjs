const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = Number(process.env.PORT) || 8000;
let serverProcess = null;
let mainWindow = null;

function appRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.join(__dirname, "..", "dist-cliente");
}

function resolveNodeBinary(root) {
  const bundled = path.join(root, "runtime", process.platform === "win32" ? "node.exe" : "node");
  if (fs.existsSync(bundled)) return bundled;
  return "node";
}

function waitForServer(maxMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/v1/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - start > maxMs) reject(new Error("Timeout al iniciar el servidor"));
        else setTimeout(tryOnce, 400);
      });
      req.on("error", () => {
        if (Date.now() - start > maxMs) reject(new Error("Timeout al iniciar el servidor"));
        else setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

function startServer() {
  const root = appRoot();
  const backendDir = path.join(root, "backend");
  const entry = path.join(backendDir, "src", "index.ts");
  const tsxCli = path.join(backendDir, "node_modules", "tsx", "dist", "cli.mjs");
  const nodeBin = resolveNodeBinary(root);

  if (!fs.existsSync(entry)) {
    throw new Error(
      `No se encontró la app en:\n${root}\n\nEjecuta antes: npm run prepare-client`,
    );
  }

  if (nodeBin === "node") {
    console.warn("Usando Node del sistema (no hay runtime/ bundled)");
  }

  const env = {
    ...process.env,
    PORT: String(PORT),
    UI_DIST: path.join(root, "ui"),
    DB_PATH: path.join(root, "data", "pos.db"),
    LOCALCOMIDA_PACKAGED: "1",
    NODE_ENV: "production",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = fs.existsSync(tsxCli) ? [tsxCli, entry] : ["--import", "tsx", entry];

  serverProcess = spawn(nodeBin, args, {
    cwd: backendDir,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  serverProcess.on("exit", (code) => {
    if (code && code !== 0) {
      console.error("Servidor finalizó con código", code);
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "LocalComida",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function stopServer() {
  if (!serverProcess) return;
  try {
    if (process.platform === "win32" && serverProcess.pid) {
      spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"], {
        windowsHide: true,
      });
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
  serverProcess = null;
}

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    await createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "LocalComida",
      err instanceof Error ? err.message : "No se pudo iniciar la aplicación",
    );
    stopServer();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
    void createWindow().catch((err) => {
      dialog.showErrorBox(
        "LocalComida",
        err instanceof Error ? err.message : "No se pudo abrir la ventana",
      );
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    // En Mac la app puede seguir en el Dock; el servidor sigue activo.
    return;
  }
  stopServer();
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});
