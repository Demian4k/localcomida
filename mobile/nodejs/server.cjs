/**
 * API LocalComida para tablet-principal (Node embebido).
 * Persistencia JSON — sin sql.js ni addons nativos (evita crash en Android).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const { networkInterfaces } = require("os");

const PORT = Number(process.env.PORT) || 8000;
const DATA_DIR = process.env.LC_DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "pos-json.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
  } catch (err) {
    console.error("[json-api] load", err);
  }
  return {
    server_id: crypto.randomBytes(16).toString("hex"),
    jwt_secret: crypto.randomBytes(32).toString("hex"),
    users: [],
    store: {
      name: "LocalComida",
      address: "",
      optional_info: "",
      farewell_message: "¡Gracias por su compra!",
      configured: false,
    },
    roles: [
      { id: 1, name: "Administrador" },
      { id: 2, name: "Cajero" },
    ],
    zones: [
      { id: 1, name: "Cocina", print_enabled: 0 },
      { id: 2, name: "Coctelería", print_enabled: 0 },
      { id: 3, name: "Caja", print_enabled: 0 },
    ],
    next_ids: { user: 1, zone: 4, product: 1, ingredient: 1, order: 1, ticket: 1, closing: 1, printer: 1 },
    products: [],
    ingredients: [],
    recipes: [],
    orders: [],
    station_tickets: [],
    printers: [],
    cash_closings: [],
    pairing_codes: [],
    audit_logs: [],
    daily_counters: {},
  };
}

let db = loadDb();
if (!Array.isArray(db.cash_closings)) db.cash_closings = [];
if (!db.next_ids) db.next_ids = {};
if (!db.next_ids.closing) db.next_ids.closing = 1;
if (!db.next_ids.printer) db.next_ids.printer = 1;
for (const o of db.orders || []) {
  if (o.cash_closing_id === undefined) o.cash_closing_id = null;
}
// Si ya hay impresora asignada a una zona, activar impresión en papel (antes no se imprimía al vender).
for (const pr of db.printers || []) {
  if (pr.zone_id == null) continue;
  const z = db.zones.find((x) => x.id === pr.zone_id);
  if (z && !(z.print_enabled === 1 || z.print_enabled === true)) {
    z.print_enabled = 1;
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 0), "utf8");
  } catch (err) {
    console.error("[json-api] save", err);
  }
}

function zoneName(zoneId) {
  const z = db.zones.find((x) => x.id === zoneId);
  return z ? z.name : "Zona " + zoneId;
}

function enrichProduct(prod) {
  return {
    id: prod.id,
    name: prod.name,
    base_price: prod.base_price,
    zone_id: prod.zone_id,
    zone_name: zoneName(prod.zone_id),
    category: prod.category || "General",
    is_active: prod.is_active !== 0 && prod.is_active !== false,
    recipe: db.recipes
      .filter((r) => r.product_id === prod.id)
      .map((r) => {
        const ing = db.ingredients.find((i) => i.id === r.ingredient_id);
        return {
          ingredient_id: r.ingredient_id,
          name: ing ? ing.name : "?",
          quantity_required: Number(r.quantity_required) || 0,
          is_modifiable: !!(r.is_modifiable === 1 || r.is_modifiable === true),
          extra_price: Number(r.extra_price) || 0,
          unit: ing ? ing.unit : "",
        };
      }),
  };
}

function enrichIngredient(ing) {
  const unit = normalizeUnit(ing.unit);
  const stock = Number(ing.current_stock) || 0;
  const threshold = Number(ing.low_stock_threshold) || 0;
  // cost_per_unit: CLP por kg (gramos), por L (ml) o por unidad.
  // cost_per_base_unit: CLP por g / ml / unidad — listo para cálculos de receta.
  const cost = Number(ing.cost_per_unit) || 0;
  const costPerBase =
    unit === "gramos" || unit === "ml" ? cost / 1000 : cost;
  return {
    ...ing,
    unit,
    cost_basis: unit === "gramos" ? "kg" : unit === "ml" ? "l" : "unidad",
    cost_per_base_unit: costPerBase,
    is_low: stock <= threshold,
  };
}

function normalizeUnit(unit) {
  const u = String(unit || "unidades").toLowerCase();
  if (u === "g" || u === "gr" || u === "gramo" || u === "gramos") return "gramos";
  if (u === "ml" || u === "cc" || u === "mililitros") return "ml";
  if (u === "u" || u === "un" || u === "unidad" || u === "unidades") return "unidades";
  return "unidades";
}

function normalizeModAction(action) {
  const a = String(action || "").toLowerCase();
  if (a === "remove" || a === "sin") return "REMOVE";
  return "ADD";
}

function encodeEscPosSimple(text) {
  const init = Buffer.from([0x1b, 0x40]); // ESC @
  const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = Buffer.from(
    (normalized.endsWith("\n") ? normalized : normalized + "\n") + "\n\n",
    "latin1",
  );
  const cut = Buffer.from([0x1d, 0x56, 0x01]); // GS V
  return Buffer.concat([init, body, cut]);
}

function parsePrinterAddress(address) {
  const cleaned = String(address || "")
    .replace(/^tcp:\/\//i, "")
    .trim();
  const [host, portStr] = cleaned.split(":");
  if (!host) return null;
  const port = portStr ? Number(portStr) : 9100;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function printViaTcp(address, data) {
  const parsed = parsePrinterAddress(address);
  if (!parsed) return Promise.reject(new Error("Dirección de red inválida"));
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_e) {
        /* ignore */
      }
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(8000);
    socket.once("timeout", () => finish(new Error("Timeout al imprimir (red)")));
    socket.once("error", (err) => finish(err));
    socket.connect(parsed.port, parsed.host, () => {
      socket.write(data, (err) => {
        if (err) {
          finish(err);
          return;
        }
        socket.end(() => finish());
      });
    });
  });
}

function probeTcp(host, port, ms) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(ms);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function buildProductionTicketText(dailyNumber, zName, preparedItems, forZoneId) {
  const payload = buildStationPayload(preparedItems, forZoneId);
  const lines = [
    "================================",
    String(zName || "ZONA").toUpperCase(),
    "Orden #" + dailyNumber,
    new Date().toLocaleString("es-CL"),
    "--------------------------------",
  ];
  for (const item of payload.items || []) {
    lines.push(item.quantity + "x " + (item.name || "Producto"));
    for (const m of item.modifiers || []) lines.push("   " + m);
  }
  if ((payload.other_zone_lines || []).length > 0) {
    lines.push("--------------------------------");
    lines.push("Tambien en la orden:");
    for (const line of payload.other_zone_lines) lines.push(line);
  }
  lines.push("================================");
  return lines.join("\n");
}

function buildCajaReceiptText(order, preparedItems) {
  const store = db.store || {};
  const lines = ["================================", String(store.name || "LocalComida").toUpperCase()];
  if (store.address) lines.push(String(store.address));
  if (store.optional_info) lines.push(String(store.optional_info));
  lines.push("--------------------------------");
  lines.push("Orden #" + order.daily_number);
  lines.push(new Date().toLocaleString("es-CL"));
  lines.push("--------------------------------");
  for (const item of preparedItems) {
    const prod = db.products.find((p) => p.id === item.product_id);
    lines.push(item.quantity + "x " + (prod ? prod.name : "Producto"));
    for (const m of item.modifiers || []) {
      const action = normalizeModAction(m.action);
      const ing = db.ingredients.find((i) => i.id === m.ingredient_id);
      const name = ing ? ing.name : "Ingrediente";
      lines.push(action === "REMOVE" ? "   Sin " + name : "   Extra " + name);
    }
  }
  lines.push("--------------------------------");
  lines.push("Pago: " + (order.payment_method || ""));
  lines.push("TOTAL: $" + (order.total_amount || 0));
  if (store.farewell_message) {
    lines.push("--------------------------------");
    lines.push(String(store.farewell_message));
  }
  lines.push("================================");
  return lines.join("\n");
}

function printerForZone(zoneId) {
  return db.printers.find((p) => p.zone_id === zoneId && p.address);
}

function zoneAllowsPaper(zoneId) {
  const zone = db.zones.find((z) => z.id === zoneId);
  if (!zone) return false;
  return zone.print_enabled === 1 || zone.print_enabled === true;
}

async function tryPrintZone(zoneId, content) {
  const printer = printerForZone(zoneId);
  if (!printer || !printer.address) return false;
  if (!zoneAllowsPaper(zoneId)) return false;
  await printViaTcp(printer.address, encodeEscPosSimple(content));
  return true;
}

/** Escaneo Wi‑Fi de impresoras ESC/POS (puerto 9100). USB nativo no está en el host móvil. */
async function scanNetworkPrinters() {
  const prefixes = new Set();
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      const fam = a.family;
      if ((fam === "IPv4" || fam === 4) && !a.internal) {
        const parts = String(a.address).split(".");
        if (parts.length === 4) prefixes.add(parts.slice(0, 3).join("."));
      }
    }
  }
  const hosts = [];
  for (const pref of prefixes) {
    for (let i = 1; i <= 254; i++) hosts.push(pref + "." + i);
  }
  const found = [];
  const batch = 48;
  for (let i = 0; i < hosts.length; i += batch) {
    const chunk = hosts.slice(i, i + batch);
    const hits = await Promise.all(
      chunk.map(async (host) => ((await probeTcp(host, 9100, 180)) ? host : null)),
    );
    for (const host of hits) {
      if (!host) continue;
      found.push({
        type: "WIFI",
        address: host + ":9100",
        status: "reachable",
        label: "Red " + host,
      });
    }
    if (found.length >= 20) break;
  }
  return found;
}

function openOrders() {
  return (db.orders || []).filter(
    (o) => !o.cash_closing_id && o.status !== "CANCELLED",
  );
}

function soldByName(userId) {
  const u = db.users.find((x) => x.id === userId);
  return u ? u.username : "usuario";
}

function mapSaleSummary(o) {
  return {
    id: o.id,
    daily_number: o.daily_number,
    business_date: o.business_date || "",
    total_amount: o.total_amount,
    payment_method: o.payment_method,
    status: o.status || "PREPARING",
    created_at: o.created_at,
    cash_closing_id: o.cash_closing_id ?? null,
    sold_by: soldByName(o.user_id),
  };
}

function mapSaleDetail(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return {
    ...mapSaleSummary(o),
    items: items.map((item, idx) => {
      const prod = db.products.find((p) => p.id === item.product_id);
      const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
      return {
        id: idx + 1,
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || (prod ? prod.base_price : 0),
        subtotal:
          (Number(item.unit_price) || (prod ? prod.base_price : 0)) *
          (Number(item.quantity) || 1),
        product_name: prod ? prod.name : "Producto",
        modifiers: mods.map((m) => {
          const action = normalizeModAction(m.action);
          const ing = db.ingredients.find((i) => i.id === m.ingredient_id);
          const name = ing ? ing.name : m.name || "Ingrediente";
          return {
            action,
            ingredient_name: name,
            price_adjustment: Number(m.extra_price) || 0,
            label: action === "REMOVE" ? "Sin " + name : "+ Extra " + name,
          };
        }),
      };
    }),
  };
}

function modifierLabels(mods) {
  if (!Array.isArray(mods)) return [];
  return mods
    .map((m) => {
      if (typeof m === "string") return m;
      if (!m || typeof m !== "object") return "";
      const name = m.name || m.ingredient_name || "";
      if (m.action === "REMOVE") return name ? "Sin " + name : "";
      if (m.action === "ADD") return name ? "Extra " + name : "";
      return name || m.label || "";
    })
    .filter(Boolean);
}

/** Payload que espera KitchenPage: { zone_name, items[{name,quantity,modifiers}], other_zone_lines } */
function buildStationPayload(orderItems, forZoneId) {
  const ticketItems = orderItems.map((item) => {
    const prod = db.products.find((x) => x.id === item.product_id);
    return {
      name: prod ? prod.name : "Producto",
      quantity: Number(item.quantity) || 1,
      zoneId: prod ? prod.zone_id : forZoneId,
      modifiers: modifierLabels(item.modifiers),
    };
  });
  const zoneIds = Array.from(new Set(ticketItems.map((t) => t.zoneId)));
  const zName = zoneName(forZoneId);
  const zoneItems = ticketItems
    .filter((t) => t.zoneId === forZoneId)
    .map((t) => ({
      name: t.name,
      quantity: t.quantity,
      modifiers: t.modifiers,
    }));
  const otherZoneLines = [];
  for (const otherId of zoneIds) {
    if (otherId === forZoneId) continue;
    otherZoneLines.push(zoneName(otherId));
    for (const t of ticketItems.filter((item) => item.zoneId === otherId)) {
      otherZoneLines.push(t.quantity + "x " + t.name);
    }
  }
  return {
    zone_name: zName,
    items: zoneItems,
    other_zone_lines: otherZoneLines,
  };
}

function normalizeTicketPayload(raw, zName) {
  if (!raw || typeof raw !== "object") {
    return { zone_name: zName, items: [], other_zone_lines: [] };
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    zone_name: raw.zone_name || zName,
    items: items.map((item) => {
      if (!item || typeof item !== "object") {
        return { name: "Producto", quantity: 1, modifiers: [] };
      }
      let name = item.name;
      if (!name && item.product_id) {
        const prod = db.products.find((x) => x.id === item.product_id);
        name = prod ? prod.name : "Producto " + item.product_id;
      }
      return {
        name: name || "Producto",
        quantity: Number(item.quantity) || 1,
        modifiers: modifierLabels(item.modifiers),
      };
    }),
    other_zone_lines: Array.isArray(raw.other_zone_lines) ? raw.other_zone_lines : [],
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Version",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function hashPin(pin) {
  return crypto.createHash("sha256").update("lc|" + pin).digest("hex");
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600 * 1000 })).toString(
    "base64url",
  );
  const sig = crypto.createHmac("sha256", db.jwt_secret).update(body).digest("base64url");
  return body + "." + sig;
}

function verifyToken(header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", db.jwt_secret).update(body).digest("base64url");
  if (expect !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res) {
  const user = verifyToken(req.headers.authorization || "");
  if (!user) {
    json(res, 401, { error: "Token requerido" });
    return null;
  }
  return user;
}

function lanUrls() {
  const nets = networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push("http://" + net.address + ":" + PORT);
      }
    }
  }
  return urls;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nextDailyNumber() {
  const d = today();
  db.daily_counters[d] = (db.daily_counters[d] || 0) + 1;
  return db.daily_counters[d];
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  const p = url.pathname.replace(/\/$/, "") || "/";

  try {
    if (p === "/api/v1/health") {
      return json(res, 200, {
        status: "ok",
        service: "localcomida-pos",
        node: "single-local",
        role: "primary",
        host_platform: "android",
        storage: "json",
      });
    }

    if (p === "/api/v1/meta") {
      return json(res, 200, {
        service: "localcomida-pos",
        api_version: "1.1.0",
        server_version: "1.1.2",
        min_client_version: "1.1.0",
        server_id: db.server_id,
        server_name: db.store.name || "LocalComida",
        client_outdated: false,
        install_apk_path: "/api/v1/install/android.apk",
        host_platform: "android",
        inventory_sync: "single-writer",
      });
    }

    if (p === "/api/v1/network/info") {
      const urls = lanUrls();
      return json(res, 200, {
        port: PORT,
        urls,
        primary_url: urls[0] || null,
        addresses: urls.map((u) => ({ address: u, iface: "wlan" })),
      });
    }

    if (p === "/api/v1/auth/setup-status" && req.method === "GET") {
      return json(res, 200, {
        needs_admin: db.users.length === 0,
        needs_store: !db.store.configured,
      });
    }

    if (p === "/api/v1/auth/setup/admin" && req.method === "POST") {
      if (db.users.length > 0) return json(res, 409, { error: "Ya existe un perfil" });
      const body = await readBody(req);
      if (!body.username || !body.pin || body.pin !== body.pin_confirm) {
        return json(res, 400, { error: "Datos inválidos" });
      }
      const id = db.next_ids.user++;
      const user = {
        id,
        username: String(body.username).trim(),
        pin_hash: hashPin(String(body.pin)),
        role: "Administrador",
        is_active: 1,
      };
      db.users.push(user);
      saveDb();
      const access_token = signToken({
        userId: id,
        username: user.username,
        role: user.role,
      });
      return json(res, 201, {
        access_token,
        role: user.role,
        user_id: id,
        username: user.username,
      });
    }

    if (p === "/api/v1/auth/setup/store" && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      db.store = {
        name: String(body.name || "LocalComida").trim(),
        address: String(body.address || "").trim(),
        optional_info: String(body.optional_info || "").trim(),
        farewell_message: String(body.farewell_message || "¡Gracias por su compra!").trim(),
        configured: true,
      };
      saveDb();
      return json(res, 200, db.store);
    }

    if (p === "/api/v1/auth/login" && req.method === "POST") {
      const body = await readBody(req);
      const user = db.users.find((u) => u.username === body.username && u.is_active);
      if (!user || user.pin_hash !== hashPin(String(body.pin || ""))) {
        return json(res, 401, { error: "Credenciales inválidas" });
      }
      const access_token = signToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });
      return json(res, 200, {
        access_token,
        role: user.role,
        user_id: user.id,
        username: user.username,
      });
    }

    if (p === "/api/v1/settings/store" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(res, 200, db.store);
    }

    if (p === "/api/v1/settings/store" && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      db.store = { ...db.store, ...body, configured: true };
      saveDb();
      return json(res, 200, db.store);
    }

    if (p === "/api/v1/catalog/products" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const products = db.products
        .filter((x) => x.is_active !== 0 && x.is_active !== false)
        .map(enrichProduct);
      return json(res, 200, products);
    }

    if (p === "/api/v1/catalog/products" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      const id = db.next_ids.product++;
      const product = {
        id,
        name: String(body.name || "").trim(),
        base_price: Number(body.base_price) || 0,
        zone_id: Number(body.zone_id) || 1,
        is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
        category: body.category || "General",
      };
      db.products.push(product);
      if (Array.isArray(body.recipe)) {
        for (const r of body.recipe) {
          db.recipes.push({
            product_id: id,
            ingredient_id: Number(r.ingredient_id),
            quantity_required: Number(r.quantity_required) || 0,
            is_modifiable: r.is_modifiable ? 1 : 0,
            extra_price: Number(r.extra_price) || 0,
          });
        }
      }
      saveDb();
      return json(res, 201, enrichProduct(product));
    }

    if (p === "/api/v1/inventory/ingredients" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(res, 200, db.ingredients.map(enrichIngredient));
    }

    if (p === "/api/v1/inventory/ingredients" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      const id = db.next_ids.ingredient++;
      const unit = normalizeUnit(body.unit);
      const row = {
        id,
        name: String(body.name || "").trim(),
        category: body.category || "General",
        unit,
        // cost_per_unit = CLP/kg si gramos, CLP/L si ml, CLP/unidad si unidades
        cost_per_unit: Number(body.cost_per_unit) || 0,
        current_stock: Number(body.current_stock) || 0,
        low_stock_threshold: Number(body.low_stock_threshold) || 0,
      };
      db.ingredients.push(row);
      saveDb();
      return json(res, 201, enrichIngredient(row));
    }

    if (p.match(/^\/api\/v1\/inventory\/ingredients\/\d+\/stock$/) && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const body = await readBody(req);
      const ing = db.ingredients.find((i) => i.id === id);
      if (!ing) return json(res, 404, { error: "No encontrado" });
      const qty = Math.abs(Number(body.quantity) || 0);
      const sign = body.adjustment_type === "subtract" ? -1 : 1;
      const next = (Number(ing.current_stock) || 0) + sign * qty;
      if (next < 0) return json(res, 409, { error: "El stock no puede quedar negativo" });
      ing.current_stock = next;
      saveDb();
      return json(res, 200, enrichIngredient(ing));
    }

    if (p === "/api/v1/orders" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      const stockDeltas = new Map();
      let total = 0;
      const preparedItems = [];

      for (const item of items) {
        const prod = db.products.find((x) => x.id === item.product_id);
        if (!prod) return json(res, 400, { error: "Producto inválido" });
        const qty = Number(item.quantity) || 1;
        const recipes = db.recipes.filter((r) => r.product_id === prod.id);
        const recipeMap = new Map(recipes.map((r) => [r.ingredient_id, r]));
        let unitPrice =
          item.unit_price != null ? Number(item.unit_price) : Number(prod.base_price) || 0;

        for (const r of recipes) {
          const consume = (Number(r.quantity_required) || 0) * qty;
          stockDeltas.set(r.ingredient_id, (stockDeltas.get(r.ingredient_id) || 0) - consume);
        }

        const resolvedMods = [];
        for (const mod of item.modifiers || []) {
          const action = normalizeModAction(mod.action);
          const recipe = recipeMap.get(Number(mod.ingredient_id));
          if (!recipe) {
            return json(res, 400, { error: "Ingrediente no pertenece a la receta" });
          }
          if (!(recipe.is_modifiable === 1 || recipe.is_modifiable === true)) {
            return json(res, 400, { error: "Ingrediente no modificable" });
          }
          const baseQty = Number(recipe.quantity_required) || 0;
          if (action === "REMOVE") {
            // No descontar la base: reintegrar
            stockDeltas.set(
              recipe.ingredient_id,
              (stockDeltas.get(recipe.ingredient_id) || 0) + baseQty * qty,
            );
            resolvedMods.push({
              ingredient_id: recipe.ingredient_id,
              action: "REMOVE",
              extra_price: 0,
            });
          } else {
            // Extra: otra porción del mismo ingrediente
            const extraQty =
              mod.quantity_changed && Number(mod.quantity_changed) > 0
                ? Number(mod.quantity_changed)
                : baseQty;
            stockDeltas.set(
              recipe.ingredient_id,
              (stockDeltas.get(recipe.ingredient_id) || 0) - extraQty * qty,
            );
            const extraPrice =
              mod.extra_price != null ? Number(mod.extra_price) : Number(recipe.extra_price) || 0;
            // Si el cliente ya mandó unit_price con extras, no sumar de nuevo
            if (item.unit_price == null) unitPrice += extraPrice;
            resolvedMods.push({
              ingredient_id: recipe.ingredient_id,
              action: "ADD",
              extra_price: extraPrice,
            });
          }
        }

        total += unitPrice * qty;
        preparedItems.push({
          product_id: prod.id,
          quantity: qty,
          unit_price: unitPrice,
          modifiers: resolvedMods,
        });
      }

      for (const [ingId, delta] of stockDeltas) {
        const ing = db.ingredients.find((i) => i.id === ingId);
        if (!ing) continue;
        const next = (Number(ing.current_stock) || 0) + delta;
        if (next < 0) {
          return json(res, 409, {
            error: "Stock insuficiente de " + (ing.name || "ingrediente"),
          });
        }
        ing.current_stock = next;
      }

      const orderId = db.next_ids.order++;
      const daily = nextDailyNumber();
      const order = {
        id: orderId,
        user_id: auth.userId,
        total_amount: total,
        payment_method: body.payment_method || "efectivo",
        status: "PREPARING",
        daily_number: daily,
        business_date: today(),
        created_at: new Date().toISOString(),
        cash_closing_id: null,
        items: preparedItems,
      };
      db.orders.push(order);

      const zoneIds = new Set();
      for (const item of preparedItems) {
        const prod = db.products.find((x) => x.id === item.product_id);
        if (prod) zoneIds.add(prod.zone_id);
      }
      const printJobs = [];
      for (const zoneId of zoneIds) {
        const zName = zoneName(zoneId);
        const isCaja = zName.toLowerCase().includes("caja");
        if (!isCaja) {
          const ticketId = db.next_ids.ticket++;
          db.station_tickets.push({
            id: ticketId,
            order_id: orderId,
            daily_number: daily,
            zone_id: zoneId,
            status: "pending",
            payload_json: JSON.stringify(buildStationPayload(preparedItems, zoneId)),
            created_at: new Date().toISOString(),
            ready_at: null,
          });
        }
        // Ticket de producción / cocina en papel
        if (printerForZone(zoneId) && zoneAllowsPaper(zoneId)) {
          printJobs.push({
            zoneId,
            content: isCaja
              ? null
              : buildProductionTicketText(daily, zName, preparedItems, zoneId),
          });
        }
      }
      // Voucher de caja si la zona Caja tiene impresora + impresión activa
      const cajaZone = db.zones.find((z) =>
        String(z.name || "")
          .toLowerCase()
          .includes("caja"),
      );
      if (cajaZone && printerForZone(cajaZone.id) && zoneAllowsPaper(cajaZone.id)) {
        printJobs.push({
          zoneId: cajaZone.id,
          content: buildCajaReceiptText(order, preparedItems),
        });
      }
      saveDb();

      for (const job of printJobs) {
        if (!job.content) continue;
        try {
          await tryPrintZone(job.zoneId, job.content);
        } catch (err) {
          console.error("[json-api] print venta zona", job.zoneId, err);
        }
      }

      return json(res, 201, {
        id: orderId,
        order_id: orderId,
        daily_number: daily,
        total_amount: total,
        message: "Orden creada",
      });
    }

    if (p === "/api/v1/stations/zones" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.zones.filter((z) => !String(z.name || "").toLowerCase().includes("caja")),
      );
    }

    if (p === "/api/v1/stations/tickets" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const zoneId = Number(url.searchParams.get("zone_id") || 0);
      const status = url.searchParams.get("status") || "pending";
      const tickets = db.station_tickets
        .filter((t) => (!zoneId || t.zone_id === zoneId) && t.status === status)
        .sort((a, b) => a.id - b.id)
        .map((t) => {
          const zName = zoneName(t.zone_id);
          let raw = {};
          try {
            raw = JSON.parse(t.payload_json);
          } catch {
            raw = {};
          }
          return {
            id: t.id,
            order_id: t.order_id,
            daily_number: t.daily_number,
            zone_id: t.zone_id,
            zone_name: zName,
            status: t.status,
            payload: normalizeTicketPayload(raw, zName),
            created_at: t.created_at,
            ready_at: t.ready_at || null,
          };
        });
      return json(res, 200, tickets);
    }

    if (p.match(/^\/api\/v1\/stations\/tickets\/\d+\/ready$/) && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const ticket = db.station_tickets.find((t) => t.id === id);
      if (!ticket) return json(res, 404, { error: "No encontrado" });
      ticket.status = "ready";
      ticket.ready_at = new Date().toISOString();
      ticket.ready_by_user_id = auth.userId;
      saveDb();
      const zName = zoneName(ticket.zone_id);
      let raw = {};
      try {
        raw = JSON.parse(ticket.payload_json);
      } catch {
        raw = {};
      }
      return json(res, 200, {
        id: ticket.id,
        order_id: ticket.order_id,
        daily_number: ticket.daily_number,
        zone_id: ticket.zone_id,
        zone_name: zName,
        status: ticket.status,
        payload: normalizeTicketPayload(raw, zName),
        created_at: ticket.created_at,
        ready_at: ticket.ready_at,
      });
    }

    if (p === "/api/v1/stations/ready-feed" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const since = url.searchParams.get("since") || "";
      const items = db.station_tickets
        .filter((t) => t.status === "ready" && (!since || (t.ready_at && t.ready_at > since)))
        .slice(-30)
        .map((t) => ({
          id: t.id,
          daily_number: t.daily_number,
          zone_id: t.zone_id,
          zone_name: zoneName(t.zone_id),
          ready_at: t.ready_at,
        }));
      return json(res, 200, { items });
    }

    if (p === "/api/v1/catalog/products/manage" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(res, 200, db.products.map(enrichProduct));
    }

    if (p.match(/^\/api\/v1\/catalog\/products\/\d+$/) && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const body = await readBody(req);
      const prod = db.products.find((x) => x.id === id);
      if (!prod) return json(res, 404, { error: "No encontrado" });
      Object.assign(prod, {
        name: body.name != null ? String(body.name) : prod.name,
        base_price: body.base_price != null ? Number(body.base_price) : prod.base_price,
        zone_id: body.zone_id != null ? Number(body.zone_id) : prod.zone_id,
        category: body.category != null ? body.category : prod.category,
        is_active: body.is_active != null ? body.is_active : prod.is_active,
      });
      if (Array.isArray(body.recipe)) {
        db.recipes = db.recipes.filter((r) => r.product_id !== id);
        for (const r of body.recipe) {
          db.recipes.push({
            product_id: id,
            ingredient_id: Number(r.ingredient_id),
            quantity_required: Number(r.quantity_required) || 0,
            is_modifiable: r.is_modifiable ? 1 : 0,
            extra_price: Number(r.extra_price) || 0,
          });
        }
      }
      saveDb();
      return json(res, 200, enrichProduct(prod));
    }

    if (p.match(/^\/api\/v1\/inventory\/ingredients\/\d+$/) && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const body = await readBody(req);
      const ing = db.ingredients.find((i) => i.id === id);
      if (!ing) return json(res, 404, { error: "No encontrado" });
      if (body.name != null) ing.name = String(body.name).trim();
      if (body.category != null) ing.category = body.category;
      if (body.unit != null) ing.unit = normalizeUnit(body.unit);
      if (body.cost_per_unit != null) ing.cost_per_unit = Number(body.cost_per_unit) || 0;
      if (body.low_stock_threshold != null) {
        ing.low_stock_threshold = Number(body.low_stock_threshold) || 0;
      }
      saveDb();
      return json(res, 200, enrichIngredient(ing));
    }

    if (p === "/api/v1/sales" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.orders
          .slice()
          .reverse()
          .slice(0, 100)
          .map(mapSaleSummary),
      );
    }

    if (p === "/api/v1/sales/cash-closings/current" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const open = openOrders();
      let total_efectivo = 0;
      let total_tarjeta = 0;
      let total_other = 0;
      for (const o of open) {
        const m = String(o.payment_method || "").toLowerCase();
        if (m === "efectivo") total_efectivo += o.total_amount || 0;
        else if (m === "tarjeta") total_tarjeta += o.total_amount || 0;
        else total_other += o.total_amount || 0;
      }
      const last = db.cash_closings.length
        ? db.cash_closings[db.cash_closings.length - 1]
        : null;
      return json(res, 200, {
        orders_count: open.length,
        total_amount: total_efectivo + total_tarjeta + total_other,
        total_efectivo,
        total_tarjeta,
        total_other,
        period_start: open[0] ? open[0].created_at : null,
        last_closing_id: last ? last.id : null,
        orders: open.map((o) => ({
          id: o.id,
          total_amount: o.total_amount,
          payment_method: o.payment_method,
          created_at: o.created_at,
          sold_by: soldByName(o.user_id),
        })),
      });
    }

    if (p === "/api/v1/sales/cash-closings/history" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.cash_closings
          .slice()
          .reverse()
          .map((c) => ({
            id: c.id,
            closed_at: c.closed_at,
            total_efectivo: c.total_efectivo,
            total_tarjeta: c.total_tarjeta,
            total_other: c.total_other,
            total_amount: c.total_amount,
            orders_count: c.orders_count,
            period_start: c.period_start,
            closed_by: c.closed_by,
          })),
      );
    }

    if (p === "/api/v1/sales/cash-closings" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const open = openOrders();
      if (open.length === 0) {
        return json(res, 400, { error: "No hay ventas pendientes de cierre" });
      }
      let total_efectivo = 0;
      let total_tarjeta = 0;
      let total_other = 0;
      for (const o of open) {
        const m = String(o.payment_method || "").toLowerCase();
        if (m === "efectivo") total_efectivo += o.total_amount || 0;
        else if (m === "tarjeta") total_tarjeta += o.total_amount || 0;
        else total_other += o.total_amount || 0;
      }
      const total_amount = total_efectivo + total_tarjeta + total_other;
      const closingId = db.next_ids.closing++;
      const closed_by = soldByName(auth.userId);
      const closing = {
        id: closingId,
        user_id: auth.userId,
        closed_by,
        closed_at: new Date().toISOString(),
        total_efectivo,
        total_tarjeta,
        total_other,
        total_amount,
        orders_count: open.length,
        period_start: open[0].created_at,
      };
      db.cash_closings.push(closing);
      for (const o of open) o.cash_closing_id = closingId;
      saveDb();
      return json(res, 201, {
        message: "Cierre registrado",
        id: closingId,
        total_amount,
        closed_by,
      });
    }

    if (p.match(/^\/api\/v1\/sales\/\d+$/) && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[4]);
      const order = db.orders.find((o) => o.id === id);
      if (!order) return json(res, 404, { error: "Venta no encontrada" });
      return json(res, 200, mapSaleDetail(order));
    }

    if (p === "/api/v1/hardware/scan" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      try {
        const devices = await scanNetworkPrinters();
        return json(res, 200, devices);
      } catch (err) {
        console.error("[json-api] scan", err);
        return json(res, 200, []);
      }
    }

    if (p === "/api/v1/hardware/print-queue" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(res, 200, { alerts: [], jobs: [] });
    }

    if (p === "/api/v1/hardware/zones" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.zones.map((z) => ({
          ...z,
          print_enabled: z.print_enabled === 1 || z.print_enabled === true,
          products_count: db.products.filter((p) => p.zone_id === z.id).length,
          printers_count: db.printers.filter((pr) => pr.zone_id === z.id).length,
        })),
      );
    }

    if (p === "/api/v1/hardware/zones" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      const id = db.next_ids.zone++;
      const row = {
        id,
        name: String(body.name || "Zona").trim(),
        print_enabled: 0,
      };
      db.zones.push(row);
      saveDb();
      return json(res, 201, {
        ...row,
        print_enabled: false,
        products_count: 0,
        printers_count: 0,
      });
    }

    if (p.match(/^\/api\/v1\/hardware\/zones\/\d+$/) && req.method === "PUT") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const body = await readBody(req);
      const z = db.zones.find((x) => x.id === id);
      if (!z) return json(res, 404, { error: "Zona no encontrada" });
      if (body.name != null) z.name = String(body.name).trim();
      if (body.print_enabled != null) {
        z.print_enabled = body.print_enabled ? 1 : 0;
      }
      saveDb();
      return json(res, 200, {
        ...z,
        print_enabled: z.print_enabled === 1 || z.print_enabled === true,
        products_count: db.products.filter((p) => p.zone_id === z.id).length,
        printers_count: db.printers.filter((pr) => pr.zone_id === z.id).length,
      });
    }

    if (p === "/api/v1/hardware/printers" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.printers.map((pr) => ({
          ...pr,
          zone_name: pr.zone_id != null ? zoneName(pr.zone_id) : null,
        })),
      );
    }

    if (p === "/api/v1/hardware/printers" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = await readBody(req);
      const id = db.next_ids.printer++;
      const row = {
        id,
        name: String(body.name || body.label || "Impresora").trim(),
        connection_type: body.connection_type || body.type || "WIFI",
        address: String(body.address || "").trim(),
        zone_id: body.zone_id != null ? Number(body.zone_id) : null,
      };
      db.printers.push(row);
      saveDb();
      return json(res, 201, { ...row, zone_name: row.zone_id != null ? zoneName(row.zone_id) : null });
    }

    // Frontend usa PUT; aceptar también POST por compatibilidad
    if (
      p.match(/^\/api\/v1\/hardware\/printers\/\d+\/assign$/) &&
      (req.method === "PUT" || req.method === "POST")
    ) {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const body = await readBody(req);
      const pr = db.printers.find((x) => x.id === id);
      if (!pr) return json(res, 404, { error: "No encontrado" });
      const zoneId =
        body.zone_id === null || body.zone_id === "" || body.zone_id === undefined
          ? null
          : Number(body.zone_id);
      if (zoneId != null && !Number.isInteger(zoneId)) {
        return json(res, 400, { error: "zone_id inválido" });
      }
      if (zoneId != null && !db.zones.some((z) => z.id === zoneId)) {
        return json(res, 400, { error: "Zona no encontrada" });
      }
      // Una impresora por zona (igual que en PC)
      if (zoneId != null) {
        for (const other of db.printers) {
          if (other.id !== id && other.zone_id === zoneId) other.zone_id = null;
        }
      }
      pr.zone_id = zoneId;
      // Al asignar impresora, activar «Imprimir también en papel» en esa zona
      if (zoneId != null) {
        const z = db.zones.find((x) => x.id === zoneId);
        if (z) z.print_enabled = 1;
      }
      saveDb();
      return json(res, 200, {
        ...pr,
        zone_name: pr.zone_id != null ? zoneName(pr.zone_id) : null,
      });
    }

    if (p.match(/^\/api\/v1\/hardware\/printers\/\d+\/test$/) && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      const pr = db.printers.find((x) => x.id === id);
      if (!pr) return json(res, 404, { error: "Impresora no encontrada" });
      const content = [
        "================================",
        "LOCALCOMIDA — PRUEBA",
        pr.name,
        String(pr.connection_type || "") + " " + String(pr.address || ""),
        new Date().toLocaleString("es-CL"),
        "--------------------------------",
        "Si lees esto, la impresora",
        "esta correctamente conectada.",
        "================================",
      ].join("\n");
      try {
        const type = String(pr.connection_type || "").toUpperCase();
        if (type === "WIFI" || type === "ETHERNET" || String(pr.address || "").includes(":")) {
          await printViaTcp(pr.address, encodeEscPosSimple(content));
        } else {
          return json(res, 501, {
            error:
              "En tablet/teléfono solo se puede probar impresión por Wi‑Fi (IP:9100). USB usa el PC como principal.",
          });
        }
        return json(res, 200, { message: "Prueba enviada", printer_id: id });
      } catch (err) {
        return json(res, 502, {
          error: err instanceof Error ? err.message : "Falló la prueba de impresión",
        });
      }
    }

    if (p.match(/^\/api\/v1\/hardware\/printers\/\d+$/) && req.method === "DELETE") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const id = Number(p.split("/")[5]);
      db.printers = db.printers.filter((x) => x.id !== id);
      saveDb();
      return json(res, 200, { ok: true });
    }

    if (p === "/api/v1/users" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(
        res,
        200,
        db.users.map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          is_active: u.is_active,
        })),
      );
    }

    if (p === "/api/v1/users/roles" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      return json(res, 200, db.roles);
    }

    if (p === "/api/v1/pairing/start" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const code = String(100000 + Math.floor(Math.random() * 900000));
      const expires_at = new Date(Date.now() + 8 * 60 * 1000).toISOString();
      db.pairing_codes = db.pairing_codes.filter((c) => !c.consumed_at);
      db.pairing_codes.push({ code, expires_at, consumed_at: null });
      saveDb();
      const urls = lanUrls();
      return json(res, 201, {
        code,
        expires_at,
        ttl_sec: 480,
        primary_url: urls[0] || null,
        qr_payload: (urls[0] || "") + "?pair=" + code,
      });
    }

    if (p === "/api/v1/pairing/claim" && req.method === "POST") {
      const body = await readBody(req);
      const row = db.pairing_codes.find((c) => c.code === body.code && !c.consumed_at);
      if (!row) return json(res, 404, { error: "Código no válido" });
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return json(res, 410, { error: "Código expirado" });
      }
      row.consumed_at = new Date().toISOString();
      saveDb();
      const urls = lanUrls();
      return json(res, 200, {
        ok: true,
        primary_url: urls[0] || null,
        urls,
        device_id: body.device_id,
      });
    }

    if (p === "/api/v1/sales/summary" && req.method === "GET") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const total = db.orders.reduce((s, o) => s + (o.total_amount || 0), 0);
      return json(res, 200, { orders_count: db.orders.length, total_amount: total, orders: db.orders.slice(-50).reverse() });
    }

    if (p === "/api/v1/install/android/info") {
      return json(res, 200, { available: false });
    }

    return json(res, 404, { error: "Endpoint no encontrado" });
  } catch (err) {
    console.error("[json-api]", err);
    return json(res, 500, { error: "Error interno" });
  }
}

const server = http.createServer((req, res) => {
  handler(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[json-api] LocalComida tablet-host en 0.0.0.0:" + PORT);
  console.log("[json-api] data=", DB_FILE);
});
