import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listPrepZones,
  listReadyFeed,
  listStationTickets,
  markStationTicketReady,
  type StationTicketStatus,
} from "../services/stationTickets.js";

export const stationsRouter = Router();

stationsRouter.use(requireAuth);

stationsRouter.get("/zones", requireRole("Administrador", "Cajero"), (_req, res) => {
  res.json(listPrepZones());
});

stationsRouter.get("/tickets", requireRole("Administrador", "Cajero"), (req, res) => {
  const zoneId = Number(req.query.zone_id);
  if (!Number.isInteger(zoneId) || zoneId <= 0) {
    res.status(400).json({ error: "zone_id requerido" });
    return;
  }

  const statusRaw = typeof req.query.status === "string" ? req.query.status : "pending";
  const allowed: StationTicketStatus[] = ["pending", "ready", "dismissed"];
  const status = allowed.includes(statusRaw as StationTicketStatus)
    ? (statusRaw as StationTicketStatus)
    : "pending";

  res.json(listStationTickets({ zoneId, status }));
});

stationsRouter.post(
  "/tickets/:id/ready",
  requireRole("Administrador", "Cajero"),
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const ticket = markStationTicketReady(id, req.user!.userId);
    if (!ticket) {
      res.status(404).json({ error: "Encomienda no encontrada" });
      return;
    }

    res.json(ticket);
  },
);

stationsRouter.get("/ready-feed", requireRole("Administrador", "Cajero"), (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json({ items: listReadyFeed(since) });
});
