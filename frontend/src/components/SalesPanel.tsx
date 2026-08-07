import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";
import type { CashClosingHistory, SaleDetail, SaleSummary } from "../types";
import { formatMoney } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "ventas" | "cierres";

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) {
    const [datePart, timePart] = iso.split(" ");
    return { date: datePart ?? iso, time: timePart ?? "" };
  }
  return {
    date: d.toLocaleDateString("es-CL"),
    time: d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }),
  };
}

export function SalesPanel({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("ventas");
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [closings, setClosings] = useState<CashClosingHistory[]>([]);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("ventas");
    setDetail(null);
    void Promise.all([
      api<SaleSummary[]>("/sales"),
      api<CashClosingHistory[]>("/sales/cash-closings/history"),
    ])
      .then(([s, c]) => {
        setSales(s);
        setClosings(c);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Error al cargar ventas");
      });
  }, [open]);

  async function openDetail(id: number) {
    try {
      const data = await api<SaleDetail>(`/sales/${id}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar detalle");
    }
  }

  return (
    <>
      <Modal open={open && !detail} title="Ventas" onClose={onClose}>
        <div className="flex gap-2 mb-4">
          {(
            [
              ["ventas", "Ventas"],
              ["cierres", "Cierres de caja"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 min-h-11 rounded-2xl border text-sm ${
                tab === id ? "bg-ink text-white border-ink" : "bg-white border-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <p className="text-danger text-sm mb-3">{error}</p> : null}

        {tab === "ventas" ? (
          <div className="space-y-2">
            {sales.length === 0 ? (
              <p className="text-sm text-muted text-center py-6">Sin ventas registradas</p>
            ) : (
              sales.map((sale) => {
                const { date, time } = formatDateTime(sale.created_at);
                return (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => void openDetail(sale.id)}
                    className="w-full text-left rounded-2xl border border-border p-3 hover:bg-surface"
                  >
                    <div className="flex justify-between gap-2">
                      <p className="font-medium">Orden #{sale.daily_number}</p>
                      <p className="font-semibold">{formatMoney(sale.total_amount)}</p>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {date} · {time} · {sale.payment_method} · {sale.sold_by}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {closings.length === 0 ? (
              <p className="text-sm text-muted text-center py-6">Sin cierres registrados</p>
            ) : (
              closings.map((c) => {
                const { date, time } = formatDateTime(c.closed_at);
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-border p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <p className="font-medium">Cierre #{c.id}</p>
                      <p className="font-semibold">{formatMoney(c.total_amount)}</p>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {date} · {time} · {c.closed_by} · {c.orders_count} ventas
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Efectivo {formatMoney(c.total_efectivo)} · Tarjeta{" "}
                      {formatMoney(c.total_tarjeta)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={detail ? `Orden #${detail.daily_number}` : "Detalle"}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="space-y-4">
            {(() => {
              const { date, time } = formatDateTime(detail.created_at);
              return (
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-muted">Fecha:</span> {date}
                  </p>
                  <p>
                    <span className="text-muted">Hora:</span> {time}
                  </p>
                  <p>
                    <span className="text-muted">Nº del día:</span> #{detail.daily_number}
                  </p>
                  <p>
                    <span className="text-muted">Pago:</span> {detail.payment_method}
                  </p>
                  <p>
                    <span className="text-muted">Vendido por:</span> {detail.sold_by}
                  </p>
                  <p>
                    <span className="text-muted">Total:</span>{" "}
                    <span className="font-semibold">{formatMoney(detail.total_amount)}</span>
                  </p>
                </div>
              );
            })()}
            <div className="border-t border-border pt-3 space-y-2">
              <p className="font-medium text-sm">Contenido</p>
              {detail.items.map((item) => (
                <div key={item.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span>
                      {item.quantity}x {item.product_name}
                    </span>
                    <span>{formatMoney(item.subtotal)}</span>
                  </div>
                  {item.modifiers.map((m, i) => (
                    <p key={i} className="text-xs text-muted pl-3">
                      {m.label}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
