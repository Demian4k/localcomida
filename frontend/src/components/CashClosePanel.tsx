import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./Button";
import { Modal } from "./Modal";
import type { CashClosingCurrent } from "../types";
import { formatMoney } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CashClosePanel({ open, onClose }: Props) {
  const [summary, setSummary] = useState<CashClosingCurrent | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function load() {
    const data = await api<CashClosingCurrent>("/sales/cash-closings/current");
    setSummary(data);
  }

  useEffect(() => {
    if (!open) return;
    setConfirmOpen(false);
    setDoneMsg(null);
    setError(null);
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar cierre");
    });
  }, [open]);

  async function confirmClose() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        message: string;
        id: number;
        total_amount: number;
        closed_by: string;
      }>("/sales/cash-closings", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setConfirmOpen(false);
      setDoneMsg(
        `${result.message} (#${result.id}) · ${formatMoney(result.total_amount)} · ${result.closed_by}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cerrar caja");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        title="Cierre de caja"
        onClose={onClose}
        footer={
          <Button
            size="lg"
            className="w-full"
            disabled={!summary || summary.orders_count === 0 || busy}
            onClick={() => setConfirmOpen(true)}
          >
            Confirmar cierre
          </Button>
        }
      >
        {error ? <p className="text-danger text-sm mb-3">{error}</p> : null}
        {doneMsg ? <p className="text-success text-sm mb-3">{doneMsg}</p> : null}

        {summary ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Resumen de lo vendido desde el último cierre
              {summary.period_start ? ` (desde ${summary.period_start})` : ""}.
            </p>

            <div className="rounded-[1.5rem] border border-border p-4 space-y-3">
              <Row label="Efectivo" value={formatMoney(summary.total_efectivo)} />
              <Row label="Tarjeta" value={formatMoney(summary.total_tarjeta)} />
              {summary.total_other > 0 ? (
                <Row label="Otros" value={formatMoney(summary.total_other)} />
              ) : null}
              <div className="border-t border-border pt-3 flex justify-between items-end">
                <span className="text-muted">Total</span>
                <span className="text-2xl font-semibold">
                  {formatMoney(summary.total_amount)}
                </span>
              </div>
              <p className="text-xs text-muted">{summary.orders_count} ventas en el período</p>
            </div>

            {summary.orders_count === 0 ? (
              <p className="text-sm text-muted text-center">
                No hay ventas pendientes de cierre
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Cargando…</p>
        )}
      </Modal>

      <Modal
        open={confirmOpen}
        title="¿Cerrar caja?"
        onClose={() => setConfirmOpen(false)}
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button className="flex-1" disabled={busy} onClick={() => void confirmClose()}>
              {busy ? "Cerrando…" : "Sí, cerrar"}
            </Button>
          </div>
        }
      >
        {summary ? (
          <p className="text-sm text-muted leading-relaxed">
            Se registrará el cierre con{" "}
            <span className="text-ink font-medium">
              {formatMoney(summary.total_amount)}
            </span>{" "}
            ({summary.orders_count} ventas: efectivo{" "}
            {formatMoney(summary.total_efectivo)}, tarjeta{" "}
            {formatMoney(summary.total_tarjeta)}). Quedará asociado a tu usuario.
          </p>
        ) : null}
        {error ? <p className="text-danger text-sm mt-3">{error}</p> : null}
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
