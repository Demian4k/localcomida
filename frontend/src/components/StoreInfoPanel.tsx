import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./Button";
import { Modal } from "./Modal";
import type { StoreSettings } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (store: StoreSettings) => void;
}

export function StoreInfoPanel({ open, onClose, onSaved }: Props) {
  const [form, setForm] = useState<StoreSettings>({
    name: "",
    address: "",
    optional_info: "",
    farewell_message: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api<StoreSettings>("/settings/store")
      .then(setForm)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Error al cargar");
      });
  }, [open]);

  async function save() {
    if (!form.name.trim()) {
      setError("El nombre del local es obligatorio");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api<StoreSettings>("/settings/store", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Información del local"
      onClose={onClose}
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={() => void save()}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
      }
    >
      <p className="text-sm text-muted mb-4">
        Nombre, dirección y mensaje que salen en la boleta del cliente.
      </p>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-muted">Nombre del local</label>
          <input
            className="field-input mt-1"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-sm text-muted">Dirección</label>
          <input
            className="field-input mt-1"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-sm text-muted">Información opcional</label>
          <textarea
            className="field-input mt-1 min-h-24 py-3"
            value={form.optional_info}
            onChange={(e) => setForm((f) => ({ ...f, optional_info: e.target.value }))}
            placeholder="RUT, teléfono, web…"
          />
        </div>
        <div>
          <label className="text-sm text-muted">Mensaje de despedida</label>
          <input
            className="field-input mt-1"
            value={form.farewell_message}
            onChange={(e) =>
              setForm((f) => ({ ...f, farewell_message: e.target.value }))
            }
          />
        </div>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    </Modal>
  );
}
