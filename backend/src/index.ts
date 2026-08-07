import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { db, initDatabase, initSchema } from "./db.js";
import { bootstrapDefaults } from "./bootstrap.js";
import { getAppMeta, isClientOutdated } from "./appMeta.js";
import { corsOriginAllowlist } from "./middleware/corsPolicy.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { inventoryRouter } from "./routes/inventory.js";
import { ordersRouter } from "./routes/orders.js";
import { hardwareRouter } from "./routes/hardware.js";
import { settingsRouter } from "./routes/settings.js";
import { usersRouter } from "./routes/users.js";
import { salesRouter } from "./routes/sales.js";
import { stationsRouter } from "./routes/stations.js";
import { pairingRouter } from "./routes/pairing.js";
import { installRouter } from "./routes/install.js";
import { getNetworkInfo } from "./services/networkInfo.js";
import { getStoreSettings } from "./services/storeSettings.js";
import { backendDir } from "./paths.js";

dotenv.config();

if (
  process.env.LOCALCOMIDA_PACKAGED === "1" ||
  process.env.NODE_ENV === "production"
) {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
}

async function main(): Promise<void> {
  await initDatabase();
  initSchema();
  bootstrapDefaults();

  const root = path.resolve(backendDir(), "..");
  const app = express();
  const PORT = Number(process.env.PORT) || 8000;
  const isMobileHost =
    process.platform === "android" || process.env.LC_MOBILE_HOST === "1";

  app.use(
    cors({
      origin: corsOriginAllowlist,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "localcomida-pos",
      node: "single-local",
      role: "primary",
      host_platform: isMobileHost ? "android" : "desktop",
    });
  });

  app.get("/api/v1/meta", (req, res) => {
    let storeName = "LocalComida";
    try {
      storeName = getStoreSettings().name || storeName;
    } catch {
      // ignore
    }
    const meta = getAppMeta(storeName);
    const clientVersion =
      typeof req.query.client_version === "string"
        ? req.query.client_version
        : typeof req.headers["x-client-version"] === "string"
          ? req.headers["x-client-version"]
          : undefined;

    const outdated = isClientOutdated(clientVersion);
    if (outdated) {
      dbAuditVersionMismatch(clientVersion);
    }

    res.json({
      ...meta,
      client_outdated: outdated,
      install_apk_path: "/api/v1/install/android.apk",
      host_platform: isMobileHost ? "android" : "desktop",
      inventory_sync: "single-writer",
    });
  });

  function dbAuditVersionMismatch(clientVersion: string | undefined): void {
    try {
      db.prepare(
        "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
      ).run(null, "CLIENT_VERSION_MISMATCH", `client=${clientVersion ?? "?"}`);
    } catch {
      // ignore
    }
  }

  app.get("/api/v1/network/info", (_req, res) => {
    res.json(getNetworkInfo(PORT));
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/catalog", catalogRouter);
  app.use("/api/v1/inventory", inventoryRouter);
  app.use("/api/v1/orders", ordersRouter);
  app.use("/api/v1/hardware", hardwareRouter);
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/sales", salesRouter);
  app.use("/api/v1/stations", stationsRouter);
  app.use("/api/v1/pairing", pairingRouter);
  app.use("/api/v1/install", installRouter);

  app.use("/api/v1", (_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  const uiCandidates = [
    process.env.UI_DIST,
    path.join(root, "..", "frontend", "dist"),
    path.join(root, "ui"),
    path.join(process.cwd(), "frontend", "dist"),
    path.join(process.cwd(), "ui"),
  ].filter((p): p is string => Boolean(p));

  const uiDist = uiCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));

  if (uiDist && process.env.LC_SKIP_UI_STATIC !== "1") {
    app.use(express.static(uiDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(uiDist, "index.html"));
    });
  }

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("[ERROR]", err.message);
      res.status(500).json({ error: "Error interno del servidor" });
    },
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LocalComida API en http://0.0.0.0:${PORT} (nodo principal)`);
    if (uiDist && process.env.LC_SKIP_UI_STATIC !== "1") {
      console.log(`Interfaz: ${uiDist}`);
    }
  });
}

main().catch((err) => {
  console.error("[FATAL] No se pudo iniciar LocalComida:", err);
  if (process.env.LC_MOBILE_HOST === "1" || process.platform === "android") {
    // Evitar process.exit en Node embebido: tumba toda la app Android.
    return;
  }
  process.exit(1);
});
