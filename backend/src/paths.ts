import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directorio estable del backend (soporta bundle CJS en Android sin import.meta). */
export function backendDir(): string {
  if (process.env.LC_BACKEND_DIR) {
    return process.env.LC_BACKEND_DIR;
  }
  // En bundle CJS de esbuild, __dirname apunta al fichero generado
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cjsDir = typeof __dirname !== "undefined" ? __dirname : null;
    if (cjsDir) return cjsDir;
  } catch {
    // ignore
  }
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

export function dataDir(): string {
  if (process.env.LC_DATA_DIR) return process.env.LC_DATA_DIR;
  // En Android el proyecto Node se copia a un directorio escribible (cwd).
  if (process.env.LC_MOBILE_HOST === "1" || process.platform === "android") {
    return path.join(process.cwd(), "data");
  }
  return path.join(backendDir(), "..", "data");
}
