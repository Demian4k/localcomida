import { db } from "../db.js";

export type StationTicketStatus = "pending" | "ready" | "dismissed";

export interface StationTicketItem {
  name: string;
  quantity: number;
  modifiers: string[];
}

export interface StationTicketPayload {
  zone_name: string;
  items: StationTicketItem[];
  other_zone_lines: string[];
}

export interface StationTicketRow {
  id: number;
  order_id: number;
  daily_number: number;
  zone_id: number;
  zone_name: string;
  status: StationTicketStatus;
  payload: StationTicketPayload;
  created_at: string;
  ready_at: string | null;
}

export interface ReadyFeedItem {
  id: number;
  daily_number: number;
  zone_id: number;
  zone_name: string;
  ready_at: string;
}

export function createStationTicket(input: {
  orderId: number;
  dailyNumber: number;
  zoneId: number;
  payload: StationTicketPayload;
}): number {
  const result = db
    .prepare(
      `INSERT INTO station_tickets (order_id, daily_number, zone_id, status, payload_json)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .run(input.orderId, input.dailyNumber, input.zoneId, JSON.stringify(input.payload));
  return Number(result.lastInsertRowid);
}

function parseRow(row: {
  id: number;
  order_id: number;
  daily_number: number;
  zone_id: number;
  zone_name: string;
  status: string;
  payload_json: string;
  created_at: string;
  ready_at: string | null;
}): StationTicketRow {
  let payload: StationTicketPayload;
  try {
    payload = JSON.parse(row.payload_json) as StationTicketPayload;
  } catch {
    payload = { zone_name: row.zone_name, items: [], other_zone_lines: [] };
  }
  return {
    id: row.id,
    order_id: row.order_id,
    daily_number: row.daily_number,
    zone_id: row.zone_id,
    zone_name: row.zone_name,
    status: row.status as StationTicketStatus,
    payload,
    created_at: row.created_at,
    ready_at: row.ready_at,
  };
}

export function listStationTickets(opts: {
  zoneId: number;
  status?: StationTicketStatus;
}): StationTicketRow[] {
  const status = opts.status ?? "pending";
  const rows = db
    .prepare(
      `SELECT t.id, t.order_id, t.daily_number, t.zone_id, z.name as zone_name,
              t.status, t.payload_json, t.created_at, t.ready_at
       FROM station_tickets t
       JOIN zones z ON z.id = t.zone_id
       WHERE t.zone_id = ? AND t.status = ?
       ORDER BY t.id ASC`,
    )
    .all(opts.zoneId, status) as {
    id: number;
    order_id: number;
    daily_number: number;
    zone_id: number;
    zone_name: string;
    status: string;
    payload_json: string;
    created_at: string;
    ready_at: string | null;
  }[];

  return rows.map(parseRow);
}

export function markStationTicketReady(
  ticketId: number,
  userId: number,
): StationTicketRow | null {
  const existing = db
    .prepare(
      `SELECT t.id, t.order_id, t.daily_number, t.zone_id, z.name as zone_name,
              t.status, t.payload_json, t.created_at, t.ready_at
       FROM station_tickets t
       JOIN zones z ON z.id = t.zone_id
       WHERE t.id = ?`,
    )
    .get(ticketId) as
    | {
        id: number;
        order_id: number;
        daily_number: number;
        zone_id: number;
        zone_name: string;
        status: string;
        payload_json: string;
        created_at: string;
        ready_at: string | null;
      }
    | undefined;

  if (!existing) return null;
  if (existing.status !== "pending") {
    return parseRow(existing);
  }

  const readyAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `UPDATE station_tickets
     SET status = 'ready', ready_at = ?, ready_by_user_id = ?
     WHERE id = ?`,
  ).run(readyAt, userId, ticketId);

  db.prepare("INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)").run(
    userId,
    "STATION_TICKET_READY",
    `id=${ticketId}; order=${existing.order_id}; zone=${existing.zone_id}`,
  );

  const updated = db
    .prepare(
      `SELECT t.id, t.order_id, t.daily_number, t.zone_id, z.name as zone_name,
              t.status, t.payload_json, t.created_at, t.ready_at
       FROM station_tickets t
       JOIN zones z ON z.id = t.zone_id
       WHERE t.id = ?`,
    )
    .get(ticketId) as typeof existing;

  return parseRow(updated);
}

/** Encomiendas marcadas listas desde `since` (ISO o sqlite datetime). */
export function listReadyFeed(since?: string): ReadyFeedItem[] {
  const sinceTs = since?.trim() || "1970-01-01 00:00:00";
  const rows = db
    .prepare(
      `SELECT t.id, t.daily_number, t.zone_id, z.name as zone_name, t.ready_at
       FROM station_tickets t
       JOIN zones z ON z.id = t.zone_id
       WHERE t.status = 'ready'
         AND t.ready_at IS NOT NULL
         AND t.ready_at > ?
       ORDER BY t.ready_at ASC
       LIMIT 50`,
    )
    .all(sinceTs) as {
    id: number;
    daily_number: number;
    zone_id: number;
    zone_name: string;
    ready_at: string;
  }[];

  return rows;
}

export function listPrepZones(): { id: number; name: string }[] {
  return db
    .prepare(
      `SELECT id, name FROM zones
       WHERE lower(name) NOT LIKE '%caja%'
       ORDER BY id`,
    )
    .all() as { id: number; name: string }[];
}
