import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { bootstrapDefaults, countUsers, isStoreConfigured } from "../bootstrap.js";
import { signToken, requireAuth, requireRole } from "../middleware/auth.js";
import {
  clearLoginFailures,
  getClientIp,
  loginRateLimitMiddleware,
  recordLoginFailure,
} from "../middleware/loginRateLimit.js";
import { getStoreSettings } from "../services/storeSettings.js";
import type { RoleName } from "../types.js";

export const authRouter = Router();

authRouter.get("/setup-status", (_req, res) => {
  bootstrapDefaults();
  res.json({
    needs_admin: countUsers() === 0,
    needs_store: !isStoreConfigured(),
  });
});

const setupAdminSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y _"),
  pin: z.string().min(4).max(12).regex(/^\d+$/, "PIN debe ser numérico"),
  pin_confirm: z.string().min(4).max(12).regex(/^\d+$/),
});

authRouter.post("/setup/admin", (req, res) => {
  bootstrapDefaults();

  if (countUsers() > 0) {
    res.status(409).json({ error: "Ya existe un perfil en el sistema" });
    return;
  }

  const parsed = setupAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  if (parsed.data.pin !== parsed.data.pin_confirm) {
    res.status(400).json({ error: "Los PIN no coinciden" });
    return;
  }

  const adminRole = db
    .prepare("SELECT id FROM roles WHERE name = ?")
    .get("Administrador") as { id: number } | undefined;

  if (!adminRole) {
    res.status(500).json({ error: "Roles no inicializados" });
    return;
  }

  const hash = bcrypt.hashSync(parsed.data.pin, 12);
  const result = db
    .prepare(
      `INSERT INTO users (username, pin_hash, role_id, is_active) VALUES (?, ?, ?, 1)`,
    )
    .run(parsed.data.username, hash, adminRole.id);

  const userId = Number(result.lastInsertRowid);
  const role: RoleName = "Administrador";
  const access_token = signToken({
    userId,
    username: parsed.data.username,
    role,
  });

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    userId,
    "SETUP_ADMIN",
    `username=${parsed.data.username}`,
  );

  res.status(201).json({
    access_token,
    role,
    user_id: userId,
    username: parsed.data.username,
  });
});

const setupStoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).default(""),
  optional_info: z.string().trim().max(500).default(""),
  farewell_message: z.string().trim().max(255).default("¡Gracias por su compra!"),
});

authRouter.put(
  "/setup/store",
  requireAuth,
  requireRole("Administrador"),
  (req, res) => {
    if (isStoreConfigured()) {
      res.status(409).json({ error: "El local ya está configurado" });
      return;
    }

    const parsed = setupStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    db.prepare(
      `UPDATE store_settings
       SET name = ?, address = ?, optional_info = ?, farewell_message = ?, configured = 1
       WHERE id = 1`,
    ).run(
      data.name,
      data.address,
      data.optional_info,
      data.farewell_message || "¡Gracias por su compra!",
    );

    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "SETUP_STORE",
      `name=${data.name}`,
    );

    res.json(getStoreSettings());
  },
);

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  pin: z.string().min(4).max(12).regex(/^\d+$/, "PIN debe ser numérico"),
});

authRouter.post("/login", loginRateLimitMiddleware, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de login inválidos", details: parsed.error.flatten() });
    return;
  }

  const { username, pin } = parsed.data;
  const ip = getClientIp(req);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.pin_hash, u.is_active, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.username = ?`,
    )
    .get(username) as
    | {
        id: number;
        username: string;
        pin_hash: string;
        is_active: number;
        role_name: RoleName;
      }
    | undefined;

  if (!row || !row.is_active) {
    recordLoginFailure(ip, username);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
    ).run(null, "LOGIN_FAILED", `user=${username};ip=${ip};reason=unknown_or_inactive`);
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  const ok = bcrypt.compareSync(pin, row.pin_hash);
  if (!ok) {
    recordLoginFailure(ip, username);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
    ).run(row.id, "LOGIN_FAILED", `pin incorrecto;ip=${ip}`);
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  clearLoginFailures(ip, username);

  const access_token = signToken({
    userId: row.id,
    username: row.username,
    role: row.role_name,
  });

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    row.id,
    "LOGIN_OK",
    `ip=${ip}`,
  );

  res.json({
    access_token,
    role: row.role_name,
    user_id: row.id,
    username: row.username,
  });
});
