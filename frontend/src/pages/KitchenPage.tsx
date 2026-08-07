import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button } from "../components/Button";
import { clearAppMode } from "./ModeSelectPage";

export interface StationTicket {
  id: number;
  order_id: number;
  daily_number: number;
  zone_id: number;
  zone_name: string;
  status: string;
  payload: {
    zone_name: string;
    items: { name: string; quantity: number; modifiers: string[] }[];
    other_zone_lines: string[];
  };
  created_at: string;
  ready_at: string | null;
}

interface Props {
  zoneId: number;
  zoneName?: string;
  onChangeStation: () => void;
  onLogout: () => void;
}

function formatTime(createdAt: string): string {
  try {
    const d = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T"));
    return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function KitchenPage({ zoneId, zoneName, onChangeStation, onLogout }: Props) {
  const [tickets, setTickets] = useState<StationTicket[]>([]);
  const [name, setName] = useState(zoneName ?? "Estación");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());
  const seenRef = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    const list = await api<StationTicket[]>(
      `/stations/tickets?zone_id=${zoneId}&status=pending`,
    );
    const safe = Array.isArray(list) ? list : [];
    setTickets(safe);
    if (safe[0]?.zone_name) setName(safe[0].zone_name);

    if (firstLoad.current) {
      firstLoad.current = false;
      seenRef.current = new Set(safe.map((t) => t.id));
      return;
    }

    const newcomers = safe.filter((t) => !seenRef.current.has(t.id)).map((t) => t.id);
    if (newcomers.length > 0) {
      setFlashIds((prev) => new Set([...prev, ...newcomers]));
      window.setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          for (const id of newcomers) next.delete(id);
          return next;
        });
      }, 4000);
    }
    seenRef.current = new Set(safe.map((t) => t.id));
  }, [zoneId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar encomiendas");
    });
    const id = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(id);
  }, [load]);

  async function markReady(ticket: StationTicket) {
    setBusyId(ticket.id);
    setError(null);
    try {
      await api(`/stations/tickets/${ticket.id}/ready`, { method: "POST" });
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar como lista");
    } finally {
      setBusyId(null);
    }
  }

  function changeStation() {
    clearAppMode();
    onChangeStation();
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b border-border bg-white">
        <div>
          <p className="text-lg font-semibold tracking-tight">{name}</p>
          <p className="text-xs text-muted">Encomiendas en preparación</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={changeStation}>
            Cambiar estación
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            Salir
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto hide-scrollbar p-4 lg:p-6">
        {error ? <p className="text-danger text-sm mb-3">{error}</p> : null}

        {tickets.length === 0 ? (
          <div className="h-full min-h-[50vh] flex items-center justify-center">
            <p className="text-muted text-lg">Sin encomiendas por ahora</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {tickets.map((t) => {
              const isNew = flashIds.has(t.id);
              const payload = t.payload ?? { zone_name: "", items: [], other_zone_lines: [] };
              const items = Array.isArray(payload.items) ? payload.items : [];
              const otherLines = Array.isArray(payload.other_zone_lines)
                ? payload.other_zone_lines
                : [];
              return (
                <article
                  key={t.id}
                  className={`rounded-[1.75rem] border-2 bg-white p-5 flex flex-col min-h-[280px] transition ${
                    isNew
                      ? "border-ink animate-soft-pulse"
                      : "border-ink/25 shadow-sm"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-4">
                    <p className="text-4xl font-semibold tracking-tight text-ink">
                      #{t.daily_number}
                    </p>
                    <p className="text-base font-medium text-ink/70">{formatTime(t.created_at)}</p>
                  </div>

                  <ul className="flex-1 space-y-3 mb-5">
                    {items.map((item, idx) => {
                      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
                      return (
                        <li key={`${t.id}-${idx}`}>
                          <p className="text-xl font-semibold text-ink leading-snug">
                            <span className="tabular-nums">{item.quantity}</span>
                            <span className="mx-1 text-ink/50">×</span>
                            {item.name || "Producto"}
                          </p>
                          {modifiers.length > 0 ? (
                            <ul className="mt-1.5 space-y-0.5">
                              {modifiers.map((m) => (
                                <li key={m} className="text-base text-ink/80 pl-1 border-l-2 border-ink/20">
                                  {m}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {otherLines.length > 0 ? (
                    <div className="mb-4 pt-3 border-t-2 border-ink/10">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink/50 mb-1.5">
                        También en la orden
                      </p>
                      {otherLines.map((line, i) => (
                        <p key={i} className="text-sm text-ink/65">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <Button
                    size="lg"
                    className="w-full mt-auto min-h-14 text-lg"
                    disabled={busyId === t.id}
                    onClick={() => void markReady(t)}
                  >
                    {busyId === t.id ? "…" : "Lista"}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
