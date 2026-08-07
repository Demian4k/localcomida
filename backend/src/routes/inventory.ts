import { Router } from "express";
import { z } from "zod";
import { db, fromCenti, toCenti } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

const UNITS = ["gramos", "ml", "unidades"] as const;

function mapIngredient(r: {
  id: number;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  cost_per_unit: number;
  low_stock_threshold: number;
}) {
  const unit = r.unit;
  const cost = r.cost_per_unit;
  const cost_basis = unit === "gramos" ? "kg" : unit === "ml" ? "l" : "unidad";
  const cost_per_base_unit = unit === "gramos" || unit === "ml" ? cost / 1000 : cost;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    unit,
    current_stock: fromCenti(r.current_stock),
    cost_per_unit: cost,
    cost_basis,
    cost_per_base_unit,
    low_stock_threshold: fromCenti(r.low_stock_threshold),
    is_low: r.current_stock < r.low_stock_threshold,
  };
}

inventoryRouter.get("/ingredients", requireRole("Administrador", "Cajero"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, category, unit, current_stock, cost_per_unit, low_stock_threshold
       FROM ingredients
       ORDER BY category, name`,
    )
    .all() as {
    id: number;
    name: string;
    category: string;
    unit: string;
    current_stock: number;
    cost_per_unit: number;
    low_stock_threshold: number;
  }[];

  res.json(rows.map(mapIngredient));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80).default("General"),
  unit: z.enum(UNITS),
  current_stock: z.number().nonnegative().default(0),
  cost_per_unit: z.number().int().nonnegative(),
  low_stock_threshold: z.number().nonnegative().default(10),
});

inventoryRouter.post("/ingredients", requireRole("Administrador"), (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  try {
    const result = db
      .prepare(
        `INSERT INTO ingredients
         (name, category, unit, current_stock, cost_per_unit, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.category,
        data.unit,
        toCenti(data.current_stock),
        data.cost_per_unit,
        toCenti(data.low_stock_threshold),
      );

    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "INGREDIENT_CREATE",
      `id=${id}; name=${data.name}`,
    );

    const row = db
      .prepare(
        `SELECT id, name, category, unit, current_stock, cost_per_unit, low_stock_threshold
         FROM ingredients WHERE id = ?`,
      )
      .get(id) as Parameters<typeof mapIngredient>[0];

    res.status(201).json(mapIngredient(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al crear";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ya existe un ingrediente con ese nombre" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80),
  unit: z.enum(UNITS),
  cost_per_unit: z.number().int().nonnegative(),
  low_stock_threshold: z.number().nonnegative(),
});

inventoryRouter.put("/ingredients/:id", requireRole("Administrador"), (req, res) => {
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

  const data = parsed.data;
  const existing = db.prepare("SELECT id FROM ingredients WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Ingrediente no encontrado" });
    return;
  }

  try {
    db.prepare(
      `UPDATE ingredients
       SET name = ?, category = ?, unit = ?, cost_per_unit = ?, low_stock_threshold = ?
       WHERE id = ?`,
    ).run(
      data.name,
      data.category,
      data.unit,
      data.cost_per_unit,
      toCenti(data.low_stock_threshold),
      id,
    );

    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "INGREDIENT_UPDATE",
      `id=${id}; name=${data.name}; cost=${data.cost_per_unit}`,
    );

    const row = db
      .prepare(
        `SELECT id, name, category, unit, current_stock, cost_per_unit, low_stock_threshold
         FROM ingredients WHERE id = ?`,
      )
      .get(id) as Parameters<typeof mapIngredient>[0];

    res.json(mapIngredient(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al actualizar";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ya existe un ingrediente con ese nombre" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

const adjustSchema = z.object({
  adjustment_type: z.enum(["add", "subtract"]),
  quantity: z.number().positive(),
  reason: z.string().min(1).max(255),
});

inventoryRouter.put(
  "/ingredients/:id/stock",
  requireRole("Administrador"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      return;
    }

    const { adjustment_type, quantity, reason } = parsed.data;
    const delta = toCenti(quantity) * (adjustment_type === "add" ? 1 : -1);

    try {
      const result = db.transaction(() => {
        const row = db
          .prepare("SELECT id, name, current_stock FROM ingredients WHERE id = ?")
          .get(id) as { id: number; name: string; current_stock: number } | undefined;

        if (!row) {
          throw Object.assign(new Error("Ingrediente no encontrado"), { status: 404 });
        }

        const next = row.current_stock + delta;
        if (next < 0) {
          throw Object.assign(new Error("El stock no puede quedar negativo"), { status: 409 });
        }

        db.prepare("UPDATE ingredients SET current_stock = ? WHERE id = ?").run(next, id);
        db.prepare(
          `INSERT INTO inventory_adjustments
           (ingredient_id, user_id, adjustment_type, quantity, reason)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(id, req.user!.userId, adjustment_type, toCenti(quantity), reason);

        db.prepare(
          "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
        ).run(
          req.user!.userId,
          "STOCK_ADJUST",
          `ingredient=${id}; type=${adjustment_type}; qty=${quantity}; reason=${reason}`,
        );

        return { name: row.name, current_stock: fromCenti(next) };
      })();

      res.json({ message: "Stock actualizado", ingredient_id: id, ...result });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Error al ajustar stock",
      });
    }
  },
);
