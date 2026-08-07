import { useState, type FormEvent } from "react";
import { api, storeAuth } from "../api";
import type { AuthState, StoreSettings } from "../types";

interface Props {
  needsAdmin: boolean;
  needsStore: boolean;
  onComplete: (auth: AuthState) => void;
  /** Sesión ya creada en paso admin; solo falta el local. */
  existingAuth?: AuthState | null;
}

export function SetupWizard({ needsAdmin, needsStore, onComplete, existingAuth }: Props) {
  const [step, setStep] = useState<"admin" | "store">(
    needsAdmin ? "admin" : "store",
  );
  const [auth, setAuth] = useState<AuthState | null>(existingAuth ?? null);

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  const [store, setStore] = useState({
    name: "",
    address: "",
    optional_info: "",
    farewell_message: "¡Gracias por su compra!",
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitAdmin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<AuthState>("/auth/setup/admin", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          pin,
          pin_confirm: pinConfirm,
        }),
      });
      storeAuth(data);
      setAuth(data);
      if (needsStore) {
        setStep("store");
      } else {
        onComplete(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el perfil");
    } finally {
      setBusy(false);
    }
  }

  async function submitStore(e: FormEvent) {
    e.preventDefault();
    if (!store.name.trim()) {
      setError("Escribe el nombre de tu local");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<StoreSettings>("/auth/setup/store", {
        method: "PUT",
        body: JSON.stringify(store),
      });
      const session = auth;
      if (!session) {
        setError("Sesión no disponible. Vuelve a iniciar.");
        return;
      }
      onComplete(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el local");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <p className="text-4xl font-semibold tracking-tight">LocalComida</p>
          <p className="mt-2 text-muted text-sm">
            {step === "admin"
              ? "Bienvenido. Crea tu perfil de administrador."
              : "Ahora indica los datos de tu local."}
          </p>
        </div>

        {step === "admin" ? (
          <form
            onSubmit={(e) => void submitAdmin(e)}
            className="bg-white rounded-[2rem] border border-border p-6 shadow-sm space-y-4"
          >
            <p className="text-sm text-muted">
              Este usuario podrá configurar productos, impresoras y otros perfiles.
            </p>
            <div>
              <label className="block text-sm text-muted mb-1">Usuario</label>
              <input
                className="field-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ej. admin"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">PIN (4 a 12 dígitos)</label>
              <input
                className="field-input"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Repetir PIN</label>
              <input
                className="field-input"
                type="password"
                inputMode="numeric"
                value={pinConfirm}
                onChange={(e) =>
                  setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 12))
                }
                required
              />
            </div>
            {error ? <p className="text-danger text-sm">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || pin.length < 4}
              className="w-full min-h-12 rounded-2xl bg-ink text-white font-medium disabled:opacity-40"
            >
              {busy ? "Creando…" : "Continuar"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void submitStore(e)}
            className="bg-white rounded-[2rem] border border-border p-6 shadow-sm space-y-4"
          >
            <p className="text-sm text-muted">
              Estos datos aparecen en la boleta que recibe el cliente.
            </p>
            <div>
              <label className="block text-sm text-muted mb-1">Nombre del local</label>
              <input
                className="field-input"
                value={store.name}
                onChange={(e) => setStore((s) => ({ ...s, name: e.target.value }))}
                placeholder="Mi Restaurant"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Dirección</label>
              <input
                className="field-input"
                value={store.address}
                onChange={(e) => setStore((s) => ({ ...s, address: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Info adicional (opcional)</label>
              <textarea
                className="field-input min-h-20 py-3"
                value={store.optional_info}
                onChange={(e) =>
                  setStore((s) => ({ ...s, optional_info: e.target.value }))
                }
                placeholder="Teléfono, RUT…"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Mensaje de despedida</label>
              <input
                className="field-input"
                value={store.farewell_message}
                onChange={(e) =>
                  setStore((s) => ({ ...s, farewell_message: e.target.value }))
                }
              />
            </div>
            {error ? <p className="text-danger text-sm">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-12 rounded-2xl bg-ink text-white font-medium disabled:opacity-40"
            >
              {busy ? "Guardando…" : "Entrar a la app"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
