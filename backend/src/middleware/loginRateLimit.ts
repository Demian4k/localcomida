import type { Request, Response, NextFunction } from "express";

interface AttemptBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, AttemptBucket>();

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function key(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}

export function getClientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Middleware/helpers para limitar intentos de login por IP+usuario. */
export function assertLoginAllowed(ip: string, username: string): {
  ok: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const k = key(ip, username);
  const b = buckets.get(k);
  if (!b || now >= b.resetAt) {
    return { ok: true };
  }
  if (b.count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true };
}

export function recordLoginFailure(ip: string, username: string): void {
  const now = Date.now();
  const k = key(ip, username);
  const b = buckets.get(k);
  if (!b || now >= b.resetAt) {
    buckets.set(k, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
}

export function clearLoginFailures(ip: string, username: string): void {
  buckets.delete(key(ip, username));
}

/** Limpieza periódica de buckets vencidos. */
export function pruneLoginBuckets(): void {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

setInterval(pruneLoginBuckets, 60_000).unref?.();

export function loginRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    next();
    return;
  }
  const ip = getClientIp(req);
  const check = assertLoginAllowed(ip, username);
  if (!check.ok) {
    res.status(429).json({
      error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
      retry_after_sec: check.retryAfterSec,
    });
    return;
  }
  next();
}
