import { db, fromCenti, toCenti } from "../db.js";
import type { CreateOrderInput, ModifierAction } from "../types.js";
import { getStoreSettings } from "./storeSettings.js";
import { printQueue } from "./printQueue.js";
import { createStationTicket } from "./stationTickets.js";

interface ProductRow {
  id: number;
  name: string;
  base_price: number;
  zone_id: number;
  is_active: number;
}

interface RecipeRow {
  product_id: number;
  ingredient_id: number;
  quantity_required: number;
  is_modifiable: number;
  extra_price: number;
  name: string;
}

interface ZonePrinterRow {
  zone_id: number;
  zone_name: string;
  print_enabled: number;
  printer_id: number | null;
  printer_name: string | null;
  connection_type: "USB" | "WIFI" | "ETHERNET" | null;
  address: string | null;
}

interface StockDelta {
  ingredientId: number;
  delta: number; // centi-units; negative = consume
}

function normalizeAction(action: string): ModifierAction {
  const upper = action.toUpperCase();
  if (upper !== "ADD" && upper !== "REMOVE") {
    throw new Error(`Acción de modificador inválida: ${action}`);
  }
  return upper;
}

function businessDateLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextDailyNumber(businessDate: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(daily_number), 0) AS max_n
       FROM orders
       WHERE business_date = ?`,
    )
    .get(businessDate) as { max_n: number };
  return Number(row.max_n) + 1;
}

/** Comanda de zona de producción: solo nombre de zona, sin marca del local. */
function buildProductionTicket(
  dailyNumber: number,
  zoneName: string,
  items: {
    name: string;
    quantity: number;
    modifiers: string[];
    forThisZone: boolean;
  }[],
  otherZoneLines: string[],
): string {
  const lines: string[] = [];
  lines.push("================================");
  lines.push(zoneName.toUpperCase());
  lines.push(`Orden #${dailyNumber}`);
  lines.push(new Date().toLocaleString("es-CL"));
  lines.push("--------------------------------");

  for (const item of items.filter((i) => i.forThisZone)) {
    lines.push(`${item.quantity}x ${item.name}`);
    for (const mod of item.modifiers) {
      lines.push(`   ${mod}`);
    }
  }

  if (otherZoneLines.length > 0) {
    lines.push("--------------------------------");
    lines.push("Tambien en la orden:");
    for (const line of otherZoneLines) {
      lines.push(line);
    }
  }

  lines.push("================================");
  return lines.join("\n");
}

export function createOrderTransactional(input: CreateOrderInput): {
  order_id: number;
  daily_number: number;
  business_date: string;
  status: "PREPARING";
  message: string;
} {
  if (!input.items?.length) {
    throw Object.assign(new Error("La orden debe tener al menos un ítem"), { status: 400 });
  }
  if (!Number.isInteger(input.total_amount) || input.total_amount < 0) {
    throw Object.assign(new Error("total_amount inválido"), { status: 400 });
  }

  const run = db.transaction(() => {
    let computedTotal = 0;
    const stockDeltas = new Map<number, number>();
    const preparedItems: {
      product: ProductRow;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      modifiers: {
        ingredient_id: number;
        action: ModifierAction;
        quantity_changed: number;
        price_adjustment: number;
        ingredient_name: string;
      }[];
    }[] = [];

    const getProduct = db.prepare(
      "SELECT id, name, base_price, zone_id, is_active FROM products WHERE id = ?",
    );
    const getRecipes = db.prepare(
      `SELECT r.product_id, r.ingredient_id, r.quantity_required, r.is_modifiable, r.extra_price, i.name
       FROM recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.product_id = ?`,
    );
    const getIngredient = db.prepare(
      "SELECT id, name, current_stock FROM ingredients WHERE id = ?",
    );

    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw Object.assign(new Error("Cantidad de ítem inválida"), { status: 400 });
      }

      const product = getProduct.get(item.product_id) as ProductRow | undefined;
      if (!product || !product.is_active) {
        throw Object.assign(new Error(`Producto ${item.product_id} no disponible`), {
          status: 400,
        });
      }

      const recipes = getRecipes.all(product.id) as RecipeRow[];
      const recipeMap = new Map(recipes.map((r) => [r.ingredient_id, r]));

      let unitPrice = product.base_price;
      const resolvedModifiers: {
        ingredient_id: number;
        action: ModifierAction;
        quantity_changed: number;
        price_adjustment: number;
        ingredient_name: string;
      }[] = [];

      // Base recipe stock
      for (const recipe of recipes) {
        const key = recipe.ingredient_id;
        const consume = recipe.quantity_required * item.quantity;
        stockDeltas.set(key, (stockDeltas.get(key) ?? 0) - consume);
      }

      for (const mod of item.modifiers ?? []) {
        const action = normalizeAction(mod.action);
        const recipe = recipeMap.get(mod.ingredient_id);
        if (!recipe) {
          throw Object.assign(
            new Error(`Ingrediente ${mod.ingredient_id} no pertenece a la receta`),
            { status: 400 },
          );
        }
        if (!recipe.is_modifiable) {
          throw Object.assign(
            new Error(`Ingrediente ${recipe.name} no es modificable`),
            { status: 400 },
          );
        }

        if (action === "REMOVE") {
          // Reintegrar stock (no descontar la base)
          const restore = recipe.quantity_required * item.quantity;
          stockDeltas.set(
            recipe.ingredient_id,
            (stockDeltas.get(recipe.ingredient_id) ?? 0) + restore,
          );
          resolvedModifiers.push({
            ingredient_id: recipe.ingredient_id,
            action,
            quantity_changed: recipe.quantity_required,
            price_adjustment: 0,
            ingredient_name: recipe.name,
          });
        } else {
          // ADD: descuento extra (otra porción) + precio
          const qtyChanged = toCenti(
            mod.quantity_changed && mod.quantity_changed > 0
              ? mod.quantity_changed
              : fromCenti(recipe.quantity_required),
          );
          const extraPrice =
            typeof mod.extra_price === "number" ? Math.round(mod.extra_price) : recipe.extra_price;
          if (extraPrice < 0) {
            throw Object.assign(new Error("extra_price inválido"), { status: 400 });
          }

          stockDeltas.set(
            recipe.ingredient_id,
            (stockDeltas.get(recipe.ingredient_id) ?? 0) - qtyChanged * item.quantity,
          );
          unitPrice += extraPrice;
          resolvedModifiers.push({
            ingredient_id: recipe.ingredient_id,
            action,
            quantity_changed: qtyChanged,
            price_adjustment: extraPrice,
            ingredient_name: recipe.name,
          });
        }
      }

      const subtotal = unitPrice * item.quantity;
      computedTotal += subtotal;
      preparedItems.push({
        product,
        quantity: item.quantity,
        unitPrice,
        subtotal,
        modifiers: resolvedModifiers,
      });
    }

    if (computedTotal !== input.total_amount) {
      throw Object.assign(
        new Error(
          `Total inconsistente: calculado ${computedTotal}, recibido ${input.total_amount}`,
        ),
        { status: 400 },
      );
    }

    // Apply stock with validation (no negatives)
    const updateStock = db.prepare(
      "UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?",
    );
    for (const [ingredientId, delta] of stockDeltas) {
      const row = getIngredient.get(ingredientId) as
        | { id: number; name: string; current_stock: number }
        | undefined;
      if (!row) {
        throw Object.assign(new Error(`Ingrediente ${ingredientId} no existe`), { status: 400 });
      }
      if (row.current_stock + delta < 0) {
        throw Object.assign(
          new Error(`Stock insuficiente de ${row.name}`),
          { status: 409 },
        );
      }
      updateStock.run(delta, ingredientId);
    }

    const businessDate = businessDateLocal();
    const dailyNumber = nextDailyNumber(businessDate);

    const insertOrder = db
      .prepare(
        `INSERT INTO orders
         (user_id, total_amount, payment_method, status, daily_number, business_date)
         VALUES (?, ?, ?, 'PREPARING', ?, ?)`,
      )
      .run(
        input.user_id,
        input.total_amount,
        input.payment_method || "efectivo",
        dailyNumber,
        businessDate,
      );

    const orderId = Number(insertOrder.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertMod = db.prepare(
      `INSERT INTO order_item_modifiers
       (order_item_id, ingredient_id, action, quantity_changed, price_adjustment)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const prepared of preparedItems) {
      const itemResult = insertItem.run(
        orderId,
        prepared.product.id,
        prepared.quantity,
        prepared.unitPrice,
        prepared.subtotal,
      );
      const orderItemId = Number(itemResult.lastInsertRowid);
      for (const mod of prepared.modifiers) {
        insertMod.run(
          orderItemId,
          mod.ingredient_id,
          mod.action,
          mod.quantity_changed,
          mod.price_adjustment,
        );
      }
    }

    db.prepare(
      "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
    ).run(
      input.user_id,
      "ORDER_CREATED",
      `order_id=${orderId}; daily=#${dailyNumber}; date=${businessDate}; total=${input.total_amount}`,
    );

    return { orderId, dailyNumber, businessDate, preparedItems };
  });

  const { orderId, dailyNumber, businessDate, preparedItems } = run();

  // Impresión ASÍNCRONA — fuera de la transacción y sin bloquear la respuesta
  setImmediate(() => {
    routeAndPrint(orderId, dailyNumber, preparedItems);
  });

  return {
    message: "Orden procesada exitosamente",
    order_id: orderId,
    daily_number: dailyNumber,
    business_date: businessDate,
    status: "PREPARING",
  };
}

function routeAndPrint(
  orderId: number,
  dailyNumber: number,
  preparedItems: {
    product: ProductRow;
    quantity: number;
    modifiers: { action: ModifierAction; ingredient_name: string }[];
  }[],
): void {
  const zones = db
    .prepare(
      `SELECT z.id as zone_id, z.name as zone_name, z.print_enabled,
              p.id as printer_id, p.name as printer_name,
              p.connection_type, p.address
       FROM zones z
       LEFT JOIN printers p ON p.zone_id = z.id`,
    )
    .all() as ZonePrinterRow[];

  const involvedZoneIds = new Set(preparedItems.map((i) => i.product.zone_id));
  const zoneNameById = new Map(zones.map((z) => [z.zone_id, z.zone_name]));

  const ticketItems = preparedItems.map((item) => ({
    name: item.product.name,
    quantity: item.quantity,
    zoneId: item.product.zone_id,
    modifiers: item.modifiers.map((m) =>
      m.action === "REMOVE" ? `Sin ${m.ingredient_name}` : `+ Extra ${m.ingredient_name}`,
    ),
  }));

  for (const zoneId of involvedZoneIds) {
    const zoneMeta = zones.find((z) => z.zone_id === zoneId);
    const zoneName = zoneMeta?.zone_name ?? `Zona ${zoneId}`;
    const isCajaZone = zoneName.toLowerCase().includes("caja");

    const otherZoneLines: string[] = [];
    for (const otherId of involvedZoneIds) {
      if (otherId === zoneId) continue;
      const otherName = zoneNameById.get(otherId) ?? `Zona ${otherId}`;
      otherZoneLines.push(otherName);
      for (const t of ticketItems.filter((item) => item.zoneId === otherId)) {
        otherZoneLines.push(`${t.quantity}x ${t.name}`);
      }
    }

    const zoneItems = ticketItems
      .filter((t) => t.zoneId === zoneId)
      .map((t) => ({
        name: t.name,
        quantity: t.quantity,
        modifiers: t.modifiers,
      }));

    const content = buildProductionTicket(
      dailyNumber,
      zoneName,
      ticketItems.map((t) => ({
        name: t.name,
        quantity: t.quantity,
        modifiers: t.modifiers,
        forThisZone: t.zoneId === zoneId,
      })),
      otherZoneLines,
    );

    // Encomiendas de pantalla: zonas de preparación (no Caja)
    if (!isCajaZone) {
      createStationTicket({
        orderId,
        dailyNumber,
        zoneId,
        payload: {
          zone_name: zoneName,
          items: zoneItems,
          other_zone_lines: otherZoneLines,
        },
      });
    }

    // Impresión física opcional (print_enabled + impresora asignada)
    const shouldPrint =
      Boolean(zoneMeta?.print_enabled) && Boolean(zoneMeta?.address);
    if (shouldPrint) {
      printQueue.enqueue({
        zoneId,
        zoneName,
        orderId,
        printerAddress: zoneMeta?.address ?? null,
        connectionType: zoneMeta?.connection_type ?? null,
        content,
      });
    }
  }

  // Voucher de caja (cliente) — solo si la zona Caja tiene impresión activa
  const caja = zones.find((z) => z.zone_name.toLowerCase().includes("caja"));
  if (caja && caja.print_enabled && caja.address) {
    const store = getStoreSettings();
    const orderRow = db
      .prepare(`SELECT total_amount, payment_method FROM orders WHERE id = ?`)
      .get(orderId) as { total_amount: number; payment_method: string } | undefined;

    const lines = [
      "================================",
      store.name.toUpperCase(),
    ];
    if (store.address.trim()) lines.push(store.address.trim());
    if (store.optional_info.trim()) lines.push(store.optional_info.trim());
    lines.push("--------------------------------");
    lines.push(`Orden #${dailyNumber}`);
    lines.push(new Date().toLocaleString("es-CL"));
    lines.push("--------------------------------");
    for (const t of ticketItems) {
      lines.push(`${t.quantity}x ${t.name}`);
      for (const m of t.modifiers) lines.push(`   ${m}`);
    }
    if (orderRow) {
      lines.push("--------------------------------");
      lines.push(`Pago: ${orderRow.payment_method}`);
      lines.push(`TOTAL: $${orderRow.total_amount}`);
    }
    if (store.farewell_message.trim()) {
      lines.push("--------------------------------");
      lines.push(store.farewell_message.trim());
    }
    lines.push("================================");

    printQueue.enqueue({
      zoneId: caja.zone_id,
      zoneName: caja.zone_name,
      orderId,
      printerAddress: caja.address,
      connectionType: caja.connection_type,
      content: lines.join("\n"),
    });
  }
}

export type { StockDelta };
