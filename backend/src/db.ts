import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { openSqlJsDatabase, type DbLike } from "./dbSqlJs.js";
import { backendDir, dataDir } from "./paths.js";

dotenv.config();

export function resolveDbPath(): string {
  if (process.env.DB_PATH) {
    return path.isAbsolute(process.env.DB_PATH)
      ? process.env.DB_PATH
      : path.resolve(backendDir(), "..", process.env.DB_PATH);
  }
  return path.join(dataDir(), "pos.db");
}

function shouldUseSqlJs(): boolean {
  if (process.env.LC_DB_DRIVER === "sqljs") return true;
  if (process.env.LC_DB_DRIVER === "native") return false;
  return process.platform === "android";
}

/** Instancia activa tras `await initDatabase()`. */
export let db: DbLike = null as unknown as DbLike;

let ready = false;

export async function initDatabase(): Promise<void> {
  if (ready) return;
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (shouldUseSqlJs()) {
    console.log("[db] driver=sqljs path=", dbPath);
    db = await openSqlJsDatabase(dbPath);
    db.pragma("foreign_keys = ON");
  } else {
    console.log("[db] driver=better-sqlite3 path=", dbPath);
    // Import dinámico: el bundle Android no carga el addon nativo al arrancar.
    const { default: Database } = await import("better-sqlite3");
    const native = new Database(dbPath);
    native.pragma("journal_mode = WAL");
    native.pragma("busy_timeout = 5000");
    native.pragma("foreign_keys = ON");
    db = native as unknown as DbLike;
  }

  ready = true;
}

export function initSchema(): void {
  if (!ready) {
    throw new Error("initDatabase() debe ejecutarse antes de initSchema()");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL,
      address TEXT NOT NULL,
      zone_id INTEGER REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'General',
      unit TEXT NOT NULL,
      current_stock INTEGER NOT NULL DEFAULT 0,
      cost_per_unit INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 1000
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_price INTEGER NOT NULL,
      zone_id INTEGER NOT NULL REFERENCES zones(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL DEFAULT 'General'
    );

    CREATE TABLE IF NOT EXISTS recipes (
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity_required INTEGER NOT NULL,
      is_modifiable INTEGER NOT NULL DEFAULT 0,
      extra_price INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, ingredient_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total_amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'efectivo',
      status TEXT NOT NULL DEFAULT 'PREPARING',
      daily_number INTEGER NOT NULL DEFAULT 1,
      business_date TEXT NOT NULL DEFAULT (date('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_item_modifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      action TEXT NOT NULL,
      quantity_changed INTEGER NOT NULL,
      price_adjustment INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      adjustment_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'LocalComida',
      address TEXT NOT NULL DEFAULT '',
      optional_info TEXT NOT NULL DEFAULT '',
      farewell_message TEXT NOT NULL DEFAULT '¡Gracias por su compra!'
    );

    CREATE TABLE IF NOT EXISTS cash_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      closed_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_efectivo INTEGER NOT NULL DEFAULT 0,
      total_tarjeta INTEGER NOT NULL DEFAULT 0,
      total_other INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      orders_count INTEGER NOT NULL DEFAULT 0,
      period_start TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS station_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      daily_number INTEGER NOT NULL,
      zone_id INTEGER NOT NULL REFERENCES zones(id),
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ready_at TEXT,
      ready_by_user_id INTEGER REFERENCES users(id)
    );

    INSERT OR IGNORE INTO store_settings (id, name, address, optional_info, farewell_message)
    VALUES (1, 'LocalComida', '', '', '¡Gracias por su compra!');
  `);

  migrateColumns();
}

function migrateColumns(): void {
  const ingredientCols = db
    .prepare("PRAGMA table_info(ingredients)")
    .all() as { name: string }[];
  const ingredientNames = new Set(ingredientCols.map((c) => c.name));

  if (!ingredientNames.has("category")) {
    db.exec(
      `ALTER TABLE ingredients ADD COLUMN category TEXT NOT NULL DEFAULT 'General'`,
    );
  }

  const orderCols = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  const orderNames = new Set(orderCols.map((c) => c.name));
  if (!orderNames.has("cash_closing_id")) {
    db.exec(
      `ALTER TABLE orders ADD COLUMN cash_closing_id INTEGER REFERENCES cash_closings(id)`,
    );
  }
  if (!orderNames.has("business_date")) {
    db.exec(
      `ALTER TABLE orders ADD COLUMN business_date TEXT NOT NULL DEFAULT ''`,
    );
  }
  if (!orderNames.has("daily_number")) {
    db.exec(
      `ALTER TABLE orders ADD COLUMN daily_number INTEGER NOT NULL DEFAULT 0`,
    );
  }

  const needsBackfill = db
    .prepare(
      `SELECT COUNT(*) as c FROM orders WHERE daily_number = 0 OR business_date = '' OR business_date IS NULL`,
    )
    .get() as { c: number };
  if (needsBackfill && needsBackfill.c > 0) {
    const rows = db
      .prepare(`SELECT id, created_at FROM orders ORDER BY id ASC`)
      .all() as { id: number; created_at: string }[];
    const counters = new Map<string, number>();
    const update = db.prepare(
      `UPDATE orders SET business_date = ?, daily_number = ? WHERE id = ?`,
    );
    for (const row of rows) {
      const raw = row.created_at ?? "";
      const datePart = raw.includes("T")
        ? raw.slice(0, 10)
        : raw.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const next = (counters.get(datePart) ?? 0) + 1;
      counters.set(datePart, next);
      update.run(datePart, next, row.id);
    }
  }

  const store = db.prepare("SELECT id FROM store_settings WHERE id = 1").get();
  if (!store) {
    db.prepare(
      `INSERT INTO store_settings (id, name, address, optional_info, farewell_message)
       VALUES (1, 'LocalComida', '', '', '¡Gracias por su compra!')`,
    ).run();
  }

  const storeCols = db
    .prepare("PRAGMA table_info(store_settings)")
    .all() as { name: string }[];
  const storeNames = new Set(storeCols.map((c) => c.name));
  if (!storeNames.has("configured")) {
    db.exec(
      `ALTER TABLE store_settings ADD COLUMN configured INTEGER NOT NULL DEFAULT 0`,
    );
    const existing = db
      .prepare("SELECT name, address FROM store_settings WHERE id = 1")
      .get() as { name: string; address: string } | undefined;
    if (existing && (existing.address.trim() || existing.name !== "LocalComida")) {
      db.prepare("UPDATE store_settings SET configured = 1 WHERE id = 1").run();
    }
  }

  const zoneCols = db.prepare("PRAGMA table_info(zones)").all() as { name: string }[];
  const zoneNames = new Set(zoneCols.map((c) => c.name));
  if (!zoneNames.has("print_enabled")) {
    db.exec(`ALTER TABLE zones ADD COLUMN print_enabled INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS station_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      daily_number INTEGER NOT NULL,
      zone_id INTEGER NOT NULL REFERENCES zones(id),
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ready_at TEXT,
      ready_by_user_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER REFERENCES users(id),
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS paired_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      label TEXT,
      platform TEXT,
      paired_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Stock and recipe quantities are stored as centi-units (value * 100). */
export function toCenti(value: number): number {
  return Math.round(value * 100);
}

export function fromCenti(value: number): number {
  return Math.round(value) / 100;
}
