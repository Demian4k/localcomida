import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

/** Versión de contrato API (aditiva). */
export const API_VERSION = "1.1.0";

/** Clientes por debajo de esto deben actualizar el APK. */
export const MIN_CLIENT_VERSION = "1.1.0";

/** Versión del servidor / UI empaquetada en el host. */
export const SERVER_VERSION = "1.1.0";

const SERVER_ID_FILE = path.join(dataDir(), "server_id");

export function getOrCreateServerId(): string {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    if (fs.existsSync(SERVER_ID_FILE)) {
      const id = fs.readFileSync(SERVER_ID_FILE, "utf8").trim();
      if (id) return id;
    }
    const id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(SERVER_ID_FILE, id, "utf8");
    return id;
  } catch {
    return "unknown";
  }
}

export function getAppMeta(storeName?: string) {
  return {
    service: "localcomida-pos",
    node: "single-local",
    api_version: API_VERSION,
    server_version: SERVER_VERSION,
    min_client_version: MIN_CLIENT_VERSION,
    server_id: getOrCreateServerId(),
    server_name: storeName || "LocalComida",
  };
}

/** Compara semver simple major.minor.patch. */
export function isClientOutdated(clientVersion: string | undefined): boolean {
  if (!clientVersion?.trim()) return false;
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => Number(n) || 0);
  const a = parse(clientVersion);
  const b = parse(MIN_CLIENT_VERSION);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
