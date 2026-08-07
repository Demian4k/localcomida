import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { createOrderTransactional } from "../services/orders.js";
import { db } from "../db.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

const modifierSchema = z.object({
  ingredient_id: z.number().int().positive(),
  action: z.enum(["add", "remove", "ADD", "REMOVE"]),
  extra_price: z.number().int().nonnegative().optional(),
  quantity_changed: z.number().positive().optional(),
});

const orderSchema = z.object({
  user_id: z.number().int().positive(),
  total_amount: z.number().int().nonnegative(),
  payment_method: z.string().min(1).max(50),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive(),
        unit_price: z.number().int().nonnegative(),
        modifiers: z.array(modifierSchema).default([]),
      }),
    )
    .min(1),
});

ordersRouter.post("/", requireRole("Administrador", "Cajero"), (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Orden inválida", details: parsed.error.flatten() });
    return;
  }

  // El user_id del body debe coincidir con el token (previene IDOR / A01 Broken Access Control)
  if (parsed.data.user_id !== req.user!.userId && req.user!.role !== "Administrador") {
    res.status(403).json({ error: "No puedes crear órdenes en nombre de otro usuario" });
    return;
  }

  try {
    const result = createOrderTransactional(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Error al procesar la orden",
    });
  }
});

ordersRouter.get("/", requireRole("Administrador", "Cajero"), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = db
    .prepare(
      `SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at,
              u.username
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.id DESC
       LIMIT ?`,
    )
    .all(limit);
  res.json(rows);
});
