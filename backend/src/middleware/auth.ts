import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import type { JwtPayload, RoleName } from "../types.js";
import { dataDir } from "../paths.js";

const DEV_FALLBACK = "localcomida-dev-secret-change-in-production";
const isPackaged =
  process.env.LOCALCOMIDA_PACKAGED === "1" ||
  process.env.NODE_ENV === "production";

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && fromEnv !== DEV_FALLBACK) {
    return fromEnv;
  }

  if (isPackaged) {
    const dir = dataDir();
    const secretFile = path.join(dir, "jwt_secret");
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(secretFile)) {
        const existing = fs.readFileSync(secretFile, "utf8").trim();
        if (existing && existing !== DEV_FALLBACK) {
          process.env.JWT_SECRET = existing;
          return existing;
        }
      }
      const generated = crypto.randomBytes(48).toString("hex");
      fs.writeFileSync(secretFile, generated, { encoding: "utf8", mode: 0o600 });
      process.env.JWT_SECRET = generated;
      console.log("[auth] JWT_SECRET generado y guardado en data/jwt_secret");
      return generated;
    } catch (err) {
      console.error(
        "[FATAL] JWT_SECRET obligatorio en producción y no se pudo generar:",
        err,
      );
      if (process.env.LC_MOBILE_HOST === "1" || process.platform === "android") {
        throw err instanceof Error ? err : new Error(String(err));
      }
      process.exit(1);
    }
  }

  if (!fromEnv) {
    console.warn(
      "[auth] Usando JWT_SECRET de desarrollo. Define JWT_SECRET en .env para producción.",
    );
  }
  return fromEnv || DEV_FALLBACK;
}

const JWT_SECRET = resolveJwtSecret();

export function signToken(payload: JwtPayload): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "12h";
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token requerido" });
    return;
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireRole(...roles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Permiso denegado" });
      return;
    }
    next();
  };
}

export function audit(userId: number | null | undefined, action: string, detail?: string): void {
  void userId;
  void action;
  void detail;
}
