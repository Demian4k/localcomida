import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { RoleName } from "../types.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);
usersRouter.use(requireRole("Administrador"));

function listUsers() {
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_active, r.id as role_id, r.name as role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.username`,
    )
    .all() as {
    id: number;
    username: string;
    is_active: number;
    role_id: number;
    role: RoleName;
  }[];
}

usersRouter.get("/", (_req, res) => {
  res.json(
    listUsers().map((u) => ({
      id: u.id,
      username: u.username,
      is_active: Boolean(u.is_active),
      role_id: u.role_id,
      role: u.role,
    })),
  );
});

usersRouter.get("/roles", (_req, res) => {
  const roles = db.prepare("SELECT id, name FROM roles ORDER BY id").all();
  res.json(roles);
});

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y _"),
  pin: z.string().min(4).max(12).regex(/^\d+$/),
  role_id: z.number().int().positive(),
  is_active: z.boolean().default(true),
});

usersRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const role = db
    .prepare("SELECT id, name FROM roles WHERE id = ?")
    .get(parsed.data.role_id) as { id: number; name: string } | undefined;
  if (!role) {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }

  try {
    const hash = bcrypt.hashSync(parsed.data.pin, 12);
    const result = db
      .prepare(
        `INSERT INTO users (username, pin_hash, role_id, is_active) VALUES (?, ?, ?, ?)`,
      )
      .run(
        parsed.data.username,
        hash,
        parsed.data.role_id,
        parsed.data.is_active ? 1 : 0,
      );

    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "USER_CREATE",
      `id=${result.lastInsertRowid}; username=${parsed.data.username}`,
    );

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      username: parsed.data.username,
      is_active: parsed.data.is_active,
      role_id: role.id,
      role: role.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ese nombre de usuario ya existe" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

const updateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y _"),
  pin: z
    .string()
    .min(4)
    .max(12)
    .regex(/^\d+$/)
    .optional()
    .or(z.literal("")),
  role_id: z.number().int().positive(),
  is_active: z.boolean(),
});

usersRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const role = db
    .prepare("SELECT id, name FROM roles WHERE id = ?")
    .get(parsed.data.role_id) as { id: number; name: string } | undefined;
  if (!role) {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }

  // No desactivar el último administrador activo
  if (
    (!parsed.data.is_active || role.name !== "Administrador") &&
    id === req.user!.userId
  ) {
    // Allow editing self except locking yourself out as sole admin
  }

  const activeAdmins = db
    .prepare(
      `SELECT COUNT(*) as c FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'Administrador' AND u.is_active = 1`,
    )
    .get() as { c: number };

  const targetIsAdmin = db
    .prepare(
      `SELECT r.name as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    )
    .get(id) as { role: string };

  const wouldLoseAdmin =
    targetIsAdmin.role === "Administrador" &&
    activeAdmins.c <= 1 &&
    (!parsed.data.is_active || role.name !== "Administrador");

  if (wouldLoseAdmin) {
    res.status(400).json({ error: "Debe quedar al menos un administrador activo" });
    return;
  }

  try {
    if (parsed.data.pin && parsed.data.pin.length >= 4) {
      const hash = bcrypt.hashSync(parsed.data.pin, 12);
      db.prepare(
        `UPDATE users SET username = ?, pin_hash = ?, role_id = ?, is_active = ? WHERE id = ?`,
      ).run(
        parsed.data.username,
        hash,
        parsed.data.role_id,
        parsed.data.is_active ? 1 : 0,
        id,
      );
    } else {
      db.prepare(
        `UPDATE users SET username = ?, role_id = ?, is_active = ? WHERE id = ?`,
      ).run(
        parsed.data.username,
        parsed.data.role_id,
        parsed.data.is_active ? 1 : 0,
        id,
      );
    }

    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "USER_UPDATE",
      `id=${id}; username=${parsed.data.username}`,
    );

    res.json({
      id,
      username: parsed.data.username,
      is_active: parsed.data.is_active,
      role_id: role.id,
      role: role.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ese nombre de usuario ya existe" });
      return;
    }
    res.status(500).json({ error: message });
  }
});
