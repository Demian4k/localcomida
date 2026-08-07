/**
 * Bootstrap host Android — API JSON ligera (sin sql.js / Express).
 */
"use strict";

process.on("uncaughtException", (err) => {
  console.error("[host] uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  console.error("[host] unhandledRejection", err && err.stack ? err.stack : err);
});

try {
  const bridge = require("bridge");
  if (bridge && bridge.app && typeof bridge.app.datadir === "function") {
    process.env.LC_DATA_DIR = bridge.app.datadir();
  }
  if (bridge && bridge.app && typeof bridge.app.on === "function") {
    bridge.app.on("pause", (pauseLock) => {
      try {
        pauseLock.release();
      } catch (_e) {
        /* ignore */
      }
    });
    bridge.app.on("resume", () => {});
  }
} catch (err) {
  console.error("[host] bridge:", err);
}

process.env.PORT = process.env.PORT || "8000";
process.env.LC_MOBILE_HOST = "1";
process.env.LOCALCOMIDA_PACKAGED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

setTimeout(() => {
  try {
    require("./server.cjs");
  } catch (err) {
    console.error("[host] server.cjs falló", err);
    const http = require("http");
    const port = Number(process.env.PORT) || 8000;
    http
      .createServer((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "error",
            service: "localcomida-pos",
            error: err && err.message ? err.message : String(err),
          }),
        );
      })
      .listen(port, "0.0.0.0");
  }
}, 100);
