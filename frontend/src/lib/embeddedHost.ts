import { Capacitor } from "@capacitor/core";
import { setApiBase } from "../api";

const LOCAL_HOST = "http://127.0.0.1:8000";

let startInFlight: Promise<{ ok: boolean; error?: string }> | null = null;
let startSucceeded = false;

/**
 * Arranca el backend Node embebido en la tablet principal.
 * La misma tablet sigue siendo caja (UI local → 127.0.0.1:8000).
 */
export async function startEmbeddedHost(): Promise<{ ok: boolean; error?: string }> {
  if (!Capacitor.isNativePlatform()) {
    setApiBase("");
    return { ok: true };
  }

  if (startSucceeded) {
    setApiBase(LOCAL_HOST);
    const ok = await pingLocal();
    if (ok) return { ok: true };
    startSucceeded = false;
  }

  if (startInFlight) return startInFlight;

  startInFlight = (async () => {
    try {
      const { Nodejs } = await import("@capawesome/capacitor-nodejs");

      try {
        await Nodejs.start({
          script: "index.cjs",
          env: {
            PORT: "8000",
            LC_DB_DRIVER: "sqljs",
            LC_MOBILE_HOST: "1",
            LC_SKIP_UI_STATIC: "1",
            LOCALCOMIDA_PACKAGED: "1",
            NODE_ENV: "production",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (
          !/NODE_ALREADY_RUNNING|already running/i.test(msg) &&
          code !== "NODE_ALREADY_RUNNING"
        ) {
          throw err;
        }
      }

      setApiBase(LOCAL_HOST);

      // Esperar health: primero "starting" (bootstrap), luego "ok"
      const deadline = Date.now() + 120_000;
      let sawStarting = false;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${LOCAL_HOST}/api/v1/health`, {
            method: "GET",
            cache: "no-store",
          });
          if (res.ok) {
            const data = (await res.json()) as {
              status?: string;
              error?: string;
              boot_error?: string;
            };
            if (data.status === "ok") {
              startSucceeded = true;
              return { ok: true };
            }
            if (data.status === "starting") {
              sawStarting = true;
            }
            if (data.status === "error") {
              return {
                ok: false,
                error:
                  data.boot_error ||
                  data.error ||
                  "El servidor falló al iniciar en esta tablet",
              };
            }
          }
        } catch {
          // aún no hay socket
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return {
        ok: false,
        error: sawStarting
          ? "El servidor arrancó pero la API no terminó de cargar. Prueba de nuevo o usa un PC como principal."
          : "El servidor no llegó a abrir el puerto. Reinstala el APK.",
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "No se pudo iniciar el servidor en esta tablet",
      };
    } finally {
      startInFlight = null;
    }
  })();

  return startInFlight;
}

async function pingLocal(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_HOST}/api/v1/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}

export function primaryApiBase(): string {
  return Capacitor.isNativePlatform() ? LOCAL_HOST : "";
}

/** Tras un fallo grave, permite reintentar start en el próximo intento. */
export function resetEmbeddedHostState(): void {
  startSucceeded = false;
  startInFlight = null;
}
