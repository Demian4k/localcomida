import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getStoreSettings } from "../services/storeSettings.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get("/store", requireRole("Administrador", "Cajero"), (_req, res) => {
  res.json(getStoreSettings());
});

const storeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).default(""),
  optional_info: z.string().trim().max(500).default(""),
  farewell_message: z.string().trim().max(255).default(""),
});

settingsRouter.put("/store", requireRole("Administrador"), (req, res) => {
  const parsed = storeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  db.prepare(
    `UPDATE store_settings
     SET name = ?, address = ?, optional_info = ?, farewell_message = ?, configured = 1
     WHERE id = 1`,
  ).run(data.name, data.address, data.optional_info, data.farewell_message);

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    req.user!.userId,
    "STORE_UPDATE",
    `name=${data.name}`,
  );

  res.json(getStoreSettings());
});
