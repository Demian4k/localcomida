import { Router } from "express";
import { z } from "zod";
import { db, fromCenti, toCenti } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { CatalogProduct, RecipeIngredient } from "../types.js";

export const catalogRouter = Router();

catalogRouter.use(requireAuth);

function getRecipe(productId: number): RecipeIngredient[] {
  const recipeRows = db
    .prepare(
      `SELECT r.ingredient_id, i.name, r.is_modifiable, r.extra_price, r.quantity_required, i.unit
       FROM recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.product_id = ?
       ORDER BY i.name`,
    )
    .all(productId) as {
    ingredient_id: number;
    name: string;
    is_modifiable: number;
    extra_price: number;
    quantity_required: number;
    unit: string;
  }[];

  return recipeRows.map((r) => ({
    ingredient_id: r.ingredient_id,
    name: r.name,
    is_modifiable: Boolean(r.is_modifiable),
    extra_price: r.extra_price,
    quantity_required: fromCenti(r.quantity_required),
    unit: r.unit,
  }));
}

function mapProduct(p: {
  id: number;
  name: string;
  base_price: number;
  zone_id: number;
  zone_name: string;
  category: string;
  is_active: number;
}): CatalogProduct & { is_active: boolean } {
  return {
    id: p.id,
    name: p.name,
    base_price: p.base_price,
    zone_id: p.zone_id,
    zone_name: p.zone_name,
    category: p.category,
    is_active: Boolean(p.is_active),
    recipe: getRecipe(p.id),
  };
}

/** Catálogo de caja: solo productos activos. */
catalogRouter.get("/products", (_req, res) => {
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.base_price, p.zone_id, z.name as zone_name, p.category, p.is_active
       FROM products p
       JOIN zones z ON z.id = p.zone_id
       WHERE p.is_active = 1
       ORDER BY p.category, p.name`,
    )
    .all() as {
    id: number;
    name: string;
    base_price: number;
    zone_id: number;
    zone_name: string;
    category: string;
    is_active: number;
  }[];

  res.json(products.map(mapProduct));
});

/** Gestión admin: todos los productos (activos e inactivos). */
catalogRouter.get(
  "/products/manage",
  requireRole("Administrador"),
  (_req, res) => {
    const products = db
      .prepare(
        `SELECT p.id, p.name, p.base_price, p.zone_id, z.name as zone_name, p.category, p.is_active
         FROM products p
         JOIN zones z ON z.id = p.zone_id
         ORDER BY p.category, p.name`,
      )
      .all() as {
      id: number;
      name: string;
      base_price: number;
      zone_id: number;
      zone_name: string;
      category: string;
      is_active: number;
    }[];

    res.json(products.map(mapProduct));
  },
);

const recipeItemSchema = z.object({
  ingredient_id: z.number().int().positive(),
  quantity_required: z.number().positive(),
  is_modifiable: z.boolean(),
  extra_price: z.number().int().nonnegative().default(0),
});

const productBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  base_price: z.number().int().nonnegative(),
  zone_id: z.number().int().positive(),
  category: z.string().trim().min(1).max(80).default("General"),
  is_active: z.boolean().default(true),
  recipe: z.array(recipeItemSchema).default([]),
});

function assertZoneExists(zoneId: number): void {
  const zone = db.prepare("SELECT id FROM zones WHERE id = ?").get(zoneId);
  if (!zone) {
    throw Object.assign(new Error("Zona no encontrada"), { status: 400 });
  }
}

function assertRecipeIngredients(recipe: z.infer<typeof recipeItemSchema>[]): void {
  const ids = new Set<number>();
  for (const item of recipe) {
    if (ids.has(item.ingredient_id)) {
      throw Object.assign(new Error("Ingrediente duplicado en la receta"), { status: 400 });
    }
    ids.add(item.ingredient_id);
    const ing = db.prepare("SELECT id FROM ingredients WHERE id = ?").get(item.ingredient_id);
    if (!ing) {
      throw Object.assign(new Error(`Ingrediente ${item.ingredient_id} no existe`), {
        status: 400,
      });
    }
  }
}

function replaceRecipe(
  productId: number,
  recipe: z.infer<typeof recipeItemSchema>[],
): void {
  db.prepare("DELETE FROM recipes WHERE product_id = ?").run(productId);
  const insert = db.prepare(
    `INSERT INTO recipes
     (product_id, ingredient_id, quantity_required, is_modifiable, extra_price)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const item of recipe) {
    insert.run(
      productId,
      item.ingredient_id,
      toCenti(item.quantity_required),
      item.is_modifiable ? 1 : 0,
      item.extra_price,
    );
  }
}

function fetchMappedProduct(id: number) {
  const row = db
    .prepare(
      `SELECT p.id, p.name, p.base_price, p.zone_id, z.name as zone_name, p.category, p.is_active
       FROM products p
       JOIN zones z ON z.id = p.zone_id
       WHERE p.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        name: string;
        base_price: number;
        zone_id: number;
        zone_name: string;
        category: string;
        is_active: number;
      }
    | undefined;
  return row ? mapProduct(row) : null;
}

catalogRouter.post("/products", requireRole("Administrador"), (req, res) => {
  const parsed = productBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  try {
    const data = parsed.data;
    assertZoneExists(data.zone_id);
    assertRecipeIngredients(data.recipe);

    const productId = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO products (name, base_price, zone_id, is_active, category)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          data.name,
          data.base_price,
          data.zone_id,
          data.is_active ? 1 : 0,
          data.category,
        );
      const id = Number(result.lastInsertRowid);
      replaceRecipe(id, data.recipe);
      db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
        req.user!.userId,
        "PRODUCT_CREATE",
        `id=${id}; name=${data.name}`,
      );
      return id;
    })();

    res.status(201).json(fetchMappedProduct(productId));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Error al crear producto",
    });
  }
});

catalogRouter.put("/products/:id", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = productBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Producto no encontrado" });
    return;
  }

  try {
    const data = parsed.data;
    assertZoneExists(data.zone_id);
    assertRecipeIngredients(data.recipe);

    db.transaction(() => {
      db.prepare(
        `UPDATE products
         SET name = ?, base_price = ?, zone_id = ?, is_active = ?, category = ?
         WHERE id = ?`,
      ).run(
        data.name,
        data.base_price,
        data.zone_id,
        data.is_active ? 1 : 0,
        data.category,
        id,
      );
      replaceRecipe(id, data.recipe);
      db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
        req.user!.userId,
        "PRODUCT_UPDATE",
        `id=${id}; name=${data.name}; price=${data.base_price}`,
      );
    })();

    res.json(fetchMappedProduct(id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Error al actualizar producto",
    });
  }
});
