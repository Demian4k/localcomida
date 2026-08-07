import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { AuthState } from "../types";

interface Props {
  onSuccess: (auth: AuthState) => void;
  /** Volver a elegir principal/cliente y modo. */
  onBackToSetup?: () => void;
}

export function LoginPage({ onSuccess, onBackToSetup }: Props) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(null);
  }, [username, pin]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await api<AuthState>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, pin }),
      });
      onSuccess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  function appendDigit(d: string) {
    if (pin.length >= 6) return;
    setPin((p) => p + d);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-10 text-center">
          <p className="text-4xl font-semibold tracking-tight">LocalComida</p>
          <p className="mt-2 text-muted">Ingresa con tu usuario y PIN</p>
        </div>

        <form
          onSubmit={submit}
          className="bg-white rounded-[2rem] border border-border p-6 shadow-sm"
        >
          <label className="block text-sm text-muted mb-2">Usuario</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full min-h-12 rounded-2xl border border-border px-4 mb-6 bg-surface outline-none focus:border-ink"
            autoComplete="username"
          />

          <label className="block text-sm text-muted mb-2">PIN</label>
          <div className="min-h-14 rounded-2xl border border-border bg-surface flex items-center justify-center gap-2 mb-4 tracking-[0.4em] text-2xl font-semibold">
            {pin.length === 0 ? (
              <span className="text-muted tracking-normal text-base font-normal">••••</span>
            ) : (
              pin.replace(/./g, "•")
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "⏎"].map((key) => (
              <button
                key={key}
                type={key === "⏎" ? "submit" : "button"}
                disabled={loading || (key === "⏎" && pin.length < 4)}
                onClick={() => {
                  if (key === "⌫") backspace();
                  else if (key !== "⏎") appendDigit(key);
                }}
                className="min-h-14 rounded-2xl bg-white border border-border text-xl font-medium hover:bg-surface active:scale-[0.98] disabled:opacity-40"
              >
                {key === "⏎" ? (loading ? "…" : "OK") : key}
              </button>
            ))}
          </div>

          {error ? <p className="text-danger text-sm text-center mb-2">{error}</p> : null}
        </form>

        {onBackToSetup ? (
          <button
            type="button"
            className="mt-6 w-full min-h-12 text-sm text-muted hover:text-ink"
            onClick={onBackToSetup}
          >
            ← Volver a la configuración inicial
          </button>
        ) : null}
      </div>
    </div>
  );
}
