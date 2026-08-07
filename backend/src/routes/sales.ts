import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const salesRouter = Router();

salesRouter.use(requireAuth);

function normalizePayment(method: string): "efectivo" | "tarjeta" | "otro" {
  const m = method.trim().toLowerCase();
  if (m === "efectivo") return "efectivo";
  if (m === "tarjeta") return "tarjeta";
  return "otro";
}

function getOrderDetail(orderId: number) {
  const order = db
    .prepare(
      `SELECT o.id, o.daily_number, o.business_date, o.total_amount, o.payment_method, o.status, o.created_at,
              o.cash_closing_id, u.username as sold_by
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`,
    )
    .get(orderId) as
    | {
        id: number;
        daily_number: number;
        business_date: string;
        total_amount: number;
        payment_method: string;
        status: string;
        created_at: string;
        cash_closing_id: number | null;
        sold_by: string;
      }
    | undefined;

  if (!order) return null;

  const items = db
    .prepare(
      `SELECT oi.id, oi.quantity, oi.unit_price, oi.subtotal, p.name as product_name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
    )
    .all(orderId) as {
    id: number;
    quantity: number;
    unit_price: number;
    subtotal: number;
    product_name: string;
  }[];

  const modStmt = db.prepare(
    `SELECT m.action, m.price_adjustment, i.name as ingredient_name
     FROM order_item_modifiers m
     JOIN ingredients i ON i.id = m.ingredient_id
     WHERE m.order_item_id = ?`,
  );

  return {
    ...order,
    items: items.map((item) => {
      const mods = modStmt.all(item.id) as {
        action: string;
        price_adjustment: number;
        ingredient_name: string;
      }[];
      return {
        ...item,
        modifiers: mods.map((m) => ({
          action: m.action,
          ingredient_name: m.ingredient_name,
          price_adjustment: m.price_adjustment,
          label:
            m.action === "REMOVE"
              ? `Sin ${m.ingredient_name}`
              : `+ Extra ${m.ingredient_name}`,
        })),
      };
    }),
  };
}

/** Resumen del período abierto (desde último cierre). */
salesRouter.get(
  "/cash-closings/current",
  requireRole("Administrador", "Cajero"),
  (_req, res) => {
    const last = db
      .prepare(`SELECT id, closed_at FROM cash_closings ORDER BY id DESC LIMIT 1`)
      .get() as { id: number; closed_at: string } | undefined;

    const openOrders = db
      .prepare(
        `SELECT o.id, o.daily_number, o.total_amount, o.payment_method, o.created_at, u.username as sold_by
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.cash_closing_id IS NULL AND o.status != 'CANCELLED'
         ORDER BY o.id ASC`,
      )
      .all() as {
      id: number;
      daily_number: number;
      total_amount: number;
      payment_method: string;
      created_at: string;
      sold_by: string;
    }[];

    let total_efectivo = 0;
    let total_tarjeta = 0;
    let total_other = 0;
    for (const o of openOrders) {
      const kind = normalizePayment(o.payment_method);
      if (kind === "efectivo") total_efectivo += o.total_amount;
      else if (kind === "tarjeta") total_tarjeta += o.total_amount;
      else total_other += o.total_amount;
    }

    res.json({
      period_start: last?.closed_at ?? openOrders[0]?.created_at ?? null,
      last_closing_id: last?.id ?? null,
      orders_count: openOrders.length,
      total_efectivo,
      total_tarjeta,
      total_other,
      total_amount: total_efectivo + total_tarjeta + total_other,
      orders: openOrders,
    });
  },
);

salesRouter.get(
  "/cash-closings/history",
  requireRole("Administrador"),
  (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const rows = db
      .prepare(
        `SELECT c.id, c.closed_at, c.total_efectivo, c.total_tarjeta, c.total_other,
                c.total_amount, c.orders_count, c.period_start, u.username as closed_by
         FROM cash_closings c
         JOIN users u ON u.id = c.user_id
         ORDER BY c.id DESC
         LIMIT ?`,
      )
      .all(limit);
    res.json(rows);
  },
);

const closeSchema = z.object({
  notes: z.string().trim().max(255).optional(),
});

salesRouter.post(
  "/cash-closings",
  requireRole("Administrador", "Cajero"),
  (req, res) => {
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Datos inválidos" });
      return;
    }

    try {
      const result = db.transaction(() => {
        const openOrders = db
          .prepare(
            `SELECT id, total_amount, payment_method, created_at
             FROM orders
             WHERE cash_closing_id IS NULL AND status != 'CANCELLED'
             ORDER BY id ASC`,
          )
          .all() as {
          id: number;
          total_amount: number;
          payment_method: string;
          created_at: string;
        }[];

        if (openOrders.length === 0) {
          throw Object.assign(new Error("No hay ventas pendientes de cierre"), {
            status: 400,
          });
        }

        let total_efectivo = 0;
        let total_tarjeta = 0;
        let total_other = 0;
        for (const o of openOrders) {
          const kind = normalizePayment(o.payment_method);
          if (kind === "efectivo") total_efectivo += o.total_amount;
          else if (kind === "tarjeta") total_tarjeta += o.total_amount;
          else total_other += o.total_amount;
        }

        const total_amount = total_efectivo + total_tarjeta + total_other;
        const period_start = openOrders[0].created_at;

        const insert = db
          .prepare(
            `INSERT INTO cash_closings
             (user_id, total_efectivo, total_tarjeta, total_other, total_amount, orders_count, period_start, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            req.user!.userId,
            total_efectivo,
            total_tarjeta,
            total_other,
            total_amount,
            openOrders.length,
            period_start,
            parsed.data.notes ?? null,
          );

        const closingId = Number(insert.lastInsertRowid);
        const update = db.prepare(`UPDATE orders SET cash_closing_id = ? WHERE id = ?`);
        for (const o of openOrders) {
          update.run(closingId, o.id);
        }

        db.prepare(
          "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
        ).run(
          req.user!.userId,
          "CASH_CLOSING",
          `id=${closingId}; total=${total_amount}; orders=${openOrders.length}`,
        );

        return {
          id: closingId,
          total_efectivo,
          total_tarjeta,
          total_other,
          total_amount,
          orders_count: openOrders.length,
          closed_by: req.user!.username,
        };
      })();

      res.status(201).json({
        message: "Cierre de caja registrado",
        ...result,
      });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Error al cerrar caja",
      });
    }
  },
);

/** Listado de ventas (admin). */
salesRouter.get("/", requireRole("Administrador"), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const rows = db
    .prepare(
      `SELECT o.id, o.daily_number, o.business_date, o.total_amount, o.payment_method, o.status, o.created_at,
              o.cash_closing_id, u.username as sold_by
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.status != 'CANCELLED'
       ORDER BY o.id DESC
       LIMIT ?`,
    )
    .all(limit);
  res.json(rows);
});

salesRouter.get("/:id", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const detail = getOrderDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Venta no encontrada" });
    return;
  }
  res.json(detail);
});
