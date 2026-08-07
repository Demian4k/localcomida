import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { printQueue } from "../services/printQueue.js";
import {
  isPrivateIp,
  printRaw,
  scanAllPrinters,
} from "../services/printerHardware.js";

export const hardwareRouter = Router();

hardwareRouter.use(requireAuth);

function isCajaZoneName(name: string): boolean {
  return name.toLowerCase().includes("caja");
}

/** Otra zona de caja distinta a `excludeId`, o null si no hay respaldo. */
function findOtherCajaZone(excludeId: number): { id: number; name: string } | null {
  const row = db
    .prepare(
      `SELECT id, name FROM zones
       WHERE id != ? AND lower(name) LIKE '%caja%'
       ORDER BY id ASC LIMIT 1`,
    )
    .get(excludeId) as { id: number; name: string } | undefined;
  return row ?? null;
}

hardwareRouter.get("/scan", requireRole("Administrador"), async (_req, res) => {
  try {
    const known = db
      .prepare(
        `SELECT address FROM printers WHERE connection_type IN ('WIFI','ETHERNET')`,
      )
      .all() as { address: string }[];

    const extraHosts = known
      .map((r) => r.address.split(":")[0])
      .filter((h): h is string => Boolean(h) && isPrivateIp(h));

    const found = await scanAllPrinters(extraHosts);
    res.json(found);
  } catch (err) {
    console.error("[hardware/scan]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al escanear impresoras",
    });
  }
});

hardwareRouter.get("/printers", requireRole("Administrador", "Cajero"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.connection_type, p.address, p.zone_id, z.name as zone_name
       FROM printers p
       LEFT JOIN zones z ON z.id = p.zone_id
       ORDER BY p.id`,
    )
    .all();
  res.json(rows);
});

hardwareRouter.get("/zones", requireRole("Administrador", "Cajero"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.print_enabled,
              (SELECT COUNT(*) FROM products p WHERE p.zone_id = z.id) AS products_count,
              (SELECT COUNT(*) FROM printers pr WHERE pr.zone_id = z.id) AS printers_count
       FROM zones z
       ORDER BY z.id`,
    )
    .all()
    .map((r) => {
      const row = r as {
        id: number;
        name: string;
        print_enabled: number;
        products_count: number;
        printers_count: number;
      };
      return {
        ...row,
        print_enabled: Boolean(row.print_enabled),
      };
    });
  res.json(rows);
});

const zoneNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const zoneUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  print_enabled: z.boolean().optional(),
});

hardwareRouter.post("/zones", requireRole("Administrador"), (req, res) => {
  const parsed = zoneNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Nombre inválido", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = db
      .prepare("INSERT INTO zones (name, print_enabled) VALUES (?, 0)")
      .run(parsed.data.name);

    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "ZONE_CREATE",
      `id=${id}; name=${parsed.data.name}`,
    );

    res.status(201).json({
      id,
      name: parsed.data.name,
      print_enabled: false,
      products_count: 0,
      printers_count: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ya existe una zona con ese nombre" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

hardwareRouter.put("/zones/:id", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = zoneUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }

  if (parsed.data.name === undefined && parsed.data.print_enabled === undefined) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }

  const existing = db.prepare("SELECT id, name, print_enabled FROM zones WHERE id = ?").get(id) as
    | { id: number; name: string; print_enabled: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "Zona no encontrada" });
    return;
  }

  const nextName = parsed.data.name ?? existing.name;
  const nextPrint =
    parsed.data.print_enabled !== undefined
      ? parsed.data.print_enabled
        ? 1
        : 0
      : existing.print_enabled;

  try {
    db.prepare("UPDATE zones SET name = ?, print_enabled = ? WHERE id = ?").run(
      nextName,
      nextPrint,
      id,
    );
    db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
      req.user!.userId,
      "ZONE_UPDATE",
      `id=${id}; name=${nextName}; print_enabled=${nextPrint}`,
    );

    const row = db
      .prepare(
        `SELECT z.id, z.name, z.print_enabled,
                (SELECT COUNT(*) FROM products p WHERE p.zone_id = z.id) AS products_count,
                (SELECT COUNT(*) FROM printers pr WHERE pr.zone_id = z.id) AS printers_count
         FROM zones z WHERE z.id = ?`,
      )
      .get(id) as {
      id: number;
      name: string;
      print_enabled: number;
      products_count: number;
      printers_count: number;
    };

    res.json({ ...row, print_enabled: Boolean(row.print_enabled) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    if (message.includes("UNIQUE")) {
      res.status(409).json({ error: "Ya existe una zona con ese nombre" });
      return;
    }
    res.status(500).json({ error: message });
  }
});

/** Vista previa antes de eliminar: zona destino y conteos. */
hardwareRouter.get(
  "/zones/:id/delete-preview",
  requireRole("Administrador"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const zone = db
      .prepare("SELECT id, name FROM zones WHERE id = ?")
      .get(id) as { id: number; name: string } | undefined;

    if (!zone) {
      res.status(404).json({ error: "Zona no encontrada" });
      return;
    }

    const totalZones = db.prepare("SELECT COUNT(*) AS c FROM zones").get() as { c: number };
    if (totalZones.c <= 1) {
      res.status(400).json({ error: "No se puede eliminar la única zona del sistema" });
      return;
    }

    const isCaja = isCajaZoneName(zone.name);
    const cajaBackup = isCaja ? findOtherCajaZone(id) : null;
    if (isCaja && !cajaBackup) {
      res.status(400).json({
        error:
          'No se puede eliminar «Caja» sin otra zona de respaldo. Crea o renombra otra zona que incluya «Caja» en el nombre (p. ej. «Caja 2») y vuelve a intentarlo.',
      });
      return;
    }

    const fallback = db
      .prepare("SELECT id, name FROM zones WHERE id != ? ORDER BY id ASC LIMIT 1")
      .get(id) as { id: number; name: string };

    const productsCount = db
      .prepare("SELECT COUNT(*) AS c FROM products WHERE zone_id = ?")
      .get(id) as { c: number };

    const printersCount = db
      .prepare("SELECT COUNT(*) AS c FROM printers WHERE zone_id = ?")
      .get(id) as { c: number };

    res.json({
      zone,
      fallback_zone: fallback,
      products_count: productsCount.c,
      printers_count: printersCount.c,
      is_caja_zone: isCaja,
      caja_backup_zone: cajaBackup,
    });
  },
);

hardwareRouter.delete("/zones/:id", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const zone = db
    .prepare("SELECT id, name FROM zones WHERE id = ?")
    .get(id) as { id: number; name: string } | undefined;

  if (!zone) {
    res.status(404).json({ error: "Zona no encontrada" });
    return;
  }

  const totalZones = db.prepare("SELECT COUNT(*) AS c FROM zones").get() as { c: number };
  if (totalZones.c <= 1) {
    res.status(400).json({ error: "No se puede eliminar la única zona del sistema" });
    return;
  }

  if (isCajaZoneName(zone.name) && !findOtherCajaZone(id)) {
    res.status(400).json({
      error:
        'No se puede eliminar «Caja» sin otra zona de respaldo. Crea o renombra otra zona que incluya «Caja» en el nombre y vuelve a intentarlo.',
    });
    return;
  }

  const fallback = db
    .prepare("SELECT id, name FROM zones WHERE id != ? ORDER BY id ASC LIMIT 1")
    .get(id) as { id: number; name: string };

  try {
    const result = db.transaction(() => {
      const productsMoved = db
        .prepare("UPDATE products SET zone_id = ? WHERE zone_id = ?")
        .run(fallback.id, id).changes;

      const printersMoved = db
        .prepare("UPDATE printers SET zone_id = ? WHERE zone_id = ?")
        .run(fallback.id, id).changes;

      db.prepare("DELETE FROM zones WHERE id = ?").run(id);

      db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
        req.user!.userId,
        "ZONE_DELETE",
        `id=${id}; name=${zone.name}; fallback=${fallback.id}; products=${productsMoved}; printers=${printersMoved}`,
      );

      return { productsMoved, printersMoved, fallback };
    })();

    res.json({
      message: "Zona eliminada",
      products_reassigned: result.productsMoved,
      printers_reassigned: result.printersMoved,
      fallback_zone: result.fallback,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Error al eliminar zona",
    });
  }
});

const createPrinterSchema = z.object({
  name: z.string().min(1).max(100),
  connection_type: z.enum(["USB", "WIFI", "ETHERNET"]),
  address: z.string().min(1).max(255),
  zone_id: z.number().int().positive().nullable().optional(),
});

hardwareRouter.post("/printers", requireRole("Administrador"), (req, res) => {
  const parsed = createPrinterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const { name, connection_type, address, zone_id } = parsed.data;

  if (connection_type === "WIFI" || connection_type === "ETHERNET") {
    const host = address.replace(/^tcp:\/\//i, "").split(":")[0];
    if (!host || !isPrivateIp(host)) {
      res.status(400).json({
        error: "Solo se permiten direcciones IP privadas de la red local",
      });
      return;
    }
  }

  const exists = db
    .prepare(`SELECT id FROM printers WHERE address = ? AND connection_type = ?`)
    .get(address, connection_type);
  if (exists) {
    res.status(409).json({ error: "Esa impresora ya está registrada" });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO printers (name, connection_type, address, zone_id) VALUES (?, ?, ?, ?)`,
    )
    .run(name, connection_type, address, zone_id ?? null);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...parsed.data });
});

const assignSchema = z.object({
  zone_id: z.number().int().positive(),
});

hardwareRouter.put("/printers/:id/assign", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }

  const zone = db.prepare("SELECT id FROM zones WHERE id = ?").get(parsed.data.zone_id);
  if (!zone) {
    res.status(404).json({ error: "Zona no encontrada" });
    return;
  }

  const printer = db.prepare("SELECT id FROM printers WHERE id = ?").get(id);
  if (!printer) {
    res.status(404).json({ error: "Impresora no encontrada" });
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE printers SET zone_id = NULL WHERE zone_id = ? AND id != ?").run(
      parsed.data.zone_id,
      id,
    );
    db.prepare("UPDATE printers SET zone_id = ? WHERE id = ?").run(parsed.data.zone_id, id);
  })();

  res.json({ message: "Impresora asignada", printer_id: id, zone_id: parsed.data.zone_id });
});

hardwareRouter.delete("/printers/:id", requireRole("Administrador"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const result = db.prepare("DELETE FROM printers WHERE id = ?").run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Impresora no encontrada" });
    return;
  }
  res.json({ message: "Impresora eliminada" });
});

/** Prueba de impresión real a una impresora registrada. */
hardwareRouter.post(
  "/printers/:id/test",
  requireRole("Administrador"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const printer = db
      .prepare(
        `SELECT id, name, connection_type, address FROM printers WHERE id = ?`,
      )
      .get(id) as
      | { id: number; name: string; connection_type: string; address: string }
      | undefined;

    if (!printer) {
      res.status(404).json({ error: "Impresora no encontrada" });
      return;
    }

    const content = [
      "================================",
      "LOCALCOMIDA — PRUEBA",
      printer.name,
      `${printer.connection_type} ${printer.address}`,
      new Date().toLocaleString("es-CL"),
      "--------------------------------",
      "Si lees esto, la impresora",
      "está correctamente conectada.",
      "================================",
    ].join("\n");

    try {
      await printRaw(printer.connection_type, printer.address, content);
      res.json({ message: "Prueba enviada", printer_id: id });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Falló la prueba de impresión",
      });
    }
  },
);

hardwareRouter.get("/print-queue", requireRole("Administrador", "Cajero"), (_req, res) => {
  res.json({
    jobs: printQueue.getJobs(),
    alerts: printQueue.getAlerts(),
  });
});

hardwareRouter.post("/print-alerts/clear", requireRole("Administrador", "Cajero"), (_req, res) => {
  printQueue.clearAlerts();
  res.json({ message: "Alertas limpiadas" });
});
