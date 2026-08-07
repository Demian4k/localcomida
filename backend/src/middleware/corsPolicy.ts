import type { Request } from "express";
import { getNetworkInfo } from "../services/networkInfo.js";

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  if (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    return true;
  }
  return false;
}

/**
 * CORS para LAN + shells nativos.
 * - Sin Origin (apps nativas / same-origin fetch): permitir
 * - capacitor:// / ionic:// / http(s)://localhost: permitir
 * - http(s)://IP-privada:puerto: permitir
 * - Resto: rechazar
 */
export function corsOriginAllowlist(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (
    origin.startsWith("capacitor://") ||
    origin.startsWith("ionic://") ||
    origin === "http://localhost" ||
    origin.startsWith("http://localhost:") ||
    origin === "http://127.0.0.1" ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("https://localhost")
  ) {
    callback(null, true);
    return;
  }

  try {
    const u = new URL(origin);
    if ((u.protocol === "http:" || u.protocol === "https:") && isPrivateHost(u.hostname)) {
      callback(null, true);
      return;
    }
  } catch {
    callback(null, false);
    return;
  }

  callback(null, false);
}

export function isLikelyLocalRequest(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let allowed = false;
  corsOriginAllowlist(origin, (_e, allow) => {
    allowed = Boolean(allow);
  });
  return allowed;
}

export function hostLanOrigins(port: number): string[] {
  return getNetworkInfo(port).urls;
}
