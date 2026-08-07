import { db, toCenti } from "./db.js";

/** Roles, zonas y catálogo de ejemplo en instalaciones nuevas (sin usuarios). */
export function bootstrapDefaults(): void {
  const roleCount = db.prepare("SELECT COUNT(*) as c FROM roles").get() as { c: number };
  if (roleCount.c === 0) {
    db.prepare("INSERT INTO roles (name) VALUES (?), (?)").run("Administrador", "Cajero");
  }

  const zoneCount = db.prepare("SELECT COUNT(*) as c FROM zones").get() as { c: number };
  if (zoneCount.c === 0) {
    const insertZone = db.prepare("INSERT INTO zones (name) VALUES (?)");
    insertZone.run("Cocina");
    insertZone.run("Coctelería");
    insertZone.run("Caja");
  }

  const productCount = db.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number };
  const ingredientCount = db.prepare("SELECT COUNT(*) as c FROM ingredients").get() as {
    c: number;
  };

  if (productCount.c > 0 || ingredientCount.c > 0) return;

  const cocina = db.prepare("SELECT id FROM zones WHERE name = ?").get("Cocina") as
    | { id: number }
    | undefined;
  const barra = db.prepare("SELECT id FROM zones WHERE name = ?").get("Coctelería") as
    | { id: number }
    | undefined;
  if (!cocina || !barra) return;

  db.transaction(() => {
    const insertIngredient = db.prepare(
      `INSERT INTO ingredients (name, category, unit, current_stock, cost_per_unit, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertIngredient.run("Pan brioche", "Panadería", "unidades", toCenti(40), 300, toCenti(8));
    insertIngredient.run("Carne 150g", "Proteínas", "unidades", toCenti(30), 1200, toCenti(8));

    const insertProduct = db.prepare(
      `INSERT INTO products (name, base_price, zone_id, is_active, category)
       VALUES (?, ?, ?, 1, ?)`,
    );
    insertProduct.run("Burger Clásica", 5500, cocina.id, "Comida");
    insertProduct.run("Papas fritas", 2500, cocina.id, "Comida");

    const insertRecipe = db.prepare(
      `INSERT INTO recipes (product_id, ingredient_id, quantity_required, is_modifiable, extra_price)
       VALUES (?, ?, ?, ?, ?)`,
    );
    // Burger: pan + carne
    insertRecipe.run(1, 1, toCenti(1), 0, 0);
    insertRecipe.run(1, 2, toCenti(1), 0, 0);
  })();
}

export function countUsers(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
}

export function isStoreConfigured(): boolean {
  const row = db
    .prepare("SELECT configured FROM store_settings WHERE id = 1")
    .get() as { configured: number } | undefined;
  return Boolean(row?.configured);
}
