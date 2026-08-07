import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getNetworkInfo } from "../services/networkInfo.js";

export const pairingRouter = Router();

const TTL_MS = 8 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtIso(ms = TTL_MS): string {
  return new Date(Date.now() + ms).toISOString();
}

function generateCode(): string {
  // 6 dígitos fáciles de dictar; evita 000000
  const n = (crypto.randomInt(1_000_000) % 900_000) + 100_000;
  return String(n);
}

pairingRouter.post("/start", requireAuth, requireRole("Administrador"), (req, res) => {
  db.prepare(`DELETE FROM pairing_codes WHERE expires_at < ? OR consumed_at IS NOT NULL`).run(
    nowIso(),
  );

  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    const exists = db.prepare(`SELECT id FROM pairing_codes WHERE code = ?`).get(code);
    if (!exists) break;
    code = generateCode();
  }

  const expires_at = expiresAtIso();
  db.prepare(
    `INSERT INTO pairing_codes (code, created_by_user_id, expires_at) VALUES (?, ?, ?)`,
  ).run(code, req.user!.userId, expires_at);

  const net = getNetworkInfo(Number(process.env.PORT) || 8000);
  const primary = net.primary_url ?? net.urls[0] ?? null;

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    req.user!.userId,
    "PAIRING_START",
    `code=${code}`,
  );

  res.status(201).json({
    code,
    expires_at,
    ttl_sec: Math.floor(TTL_MS / 1000),
    primary_url: primary,
    /** Payload sugerido para QR: URL + código */
    qr_payload: primary ? `${primary}?pair=${code}` : code,
  });
});

const claimSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
  device_id: z.string().trim().min(8).max(128),
  device_label: z.string().trim().max(120).optional(),
  platform: z.enum(["android", "ios", "desktop", "web"]).optional(),
});

pairingRouter.post("/claim", (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Código o dispositivo inválido" });
    return;
  }

  const { code, device_id, device_label, platform } = parsed.data;
  const row = db
    .prepare(
      `SELECT id, expires_at, consumed_at FROM pairing_codes WHERE code = ?`,
    )
    .get(code) as
    | { id: number; expires_at: string; consumed_at: string | null }
    | undefined;

  if (!row) {
    res.status(404).json({ error: "Código no válido" });
    return;
  }
  if (row.consumed_at) {
    res.status(410).json({ error: "Código ya usado" });
    return;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(410).json({ error: "Código expirado" });
    return;
  }

  db.prepare(`UPDATE pairing_codes SET consumed_at = ? WHERE id = ?`).run(nowIso(), row.id);

  db.prepare(
    `INSERT INTO paired_devices (device_id, label, platform, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       label = COALESCE(excluded.label, paired_devices.label),
       platform = COALESCE(excluded.platform, paired_devices.platform),
       last_seen_at = excluded.last_seen_at`,
  ).run(device_id, device_label ?? null, platform ?? null, nowIso());

  const net = getNetworkInfo(Number(process.env.PORT) || 8000);
  const primary = net.primary_url ?? net.urls[0] ?? null;

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    null,
    "PAIRING_CLAIM",
    `code=${code};device=${device_id}`,
  );

  res.json({
    ok: true,
    primary_url: primary,
    urls: net.urls,
    device_id,
  });
});

pairingRouter.get("/status", requireAuth, requireRole("Administrador"), (_req, res) => {
  const active = db
    .prepare(
      `SELECT code, expires_at FROM pairing_codes
       WHERE consumed_at IS NULL AND expires_at > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(nowIso()) as { code: string; expires_at: string } | undefined;

  const devices = db
    .prepare(
      `SELECT device_id, label, platform, paired_at, last_seen_at
       FROM paired_devices ORDER BY last_seen_at DESC LIMIT 50`,
    )
    .all();

  res.json({ active: active ?? null, devices });
});
