import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  apkDownloadUrl,
  checkHealth,
  fetchMeta,
  getApiBase,
  setApiBase,
  type ServerMeta,
} from "../api";
import { Button } from "../components/Button";
import { discoverLocalServers, type DiscoveredServer } from "../lib/lanDiscover";
import { CLIENT_VERSION, isNativeMobile } from "../lib/platform";
import { storageGetSync, storageSet } from "../lib/secureStorage";

interface Props {
  onConnected: () => void;
  /** Escritorio: mismo origen; no insistir en Wi‑Fi. */
  desktopHint?: boolean;
  /** Móvil: volver a elegir principal/cliente y modo. */
  onBackToSetup?: () => void;
}

function getOrCreateDeviceId(): string {
  const key = "lc_device_id";
  let id = storageGetSync(key);
  if (id && id.length >= 8) return id;
  id = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  void storageSet(key, id);
  return id;
}

export function ConnectServerPage({ onConnected, desktopHint, onBackToSetup }: Props) {
  const [host, setHost] = useState(() => {
    const current = getApiBase();
    if (current) return current.replace(/^https?:\/\//, "");
    return "";
  });
  const [pairCode, setPairCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [outdated, setOutdated] = useState<ServerMeta | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const qrHandledRef = useRef(false);

  useEffect(() => {
    if (!qrOpen) {
      qrHandledRef.current = false;
      return;
    }
    let scanner: { stop: () => Promise<void> } | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const qr = new Html5Qrcode("lc-qr-reader");
        scanner = qr;
        await qr.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (qrHandledRef.current || cancelled) return;
            qrHandledRef.current = true;
            let url = decoded.trim();
            const pairMatch = url.match(/[?&]pair=(\d{6})/);
            if (pairMatch) setPairCode(pairMatch[1]);
            if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
            try {
              const u = new URL(url);
              if (!u.port) u.port = "8000";
              url = `${u.protocol}//${u.host}`;
            } catch {
              qrHandledRef.current = false;
              setError("Código QR no válido");
              return;
            }
            // Parar cámara y desmontar el lector antes de cambiar de pantalla
            // (si no, WebView Android a veces queda en blanco).
            void (async () => {
              try {
                await qr.stop();
              } catch {
                // ignore
              }
              if (cancelled) return;
              setQrOpen(false);
              window.setTimeout(() => {
                void finishConnect(url);
              }, 200);
            })();
          },
          () => undefined,
        );
      } catch {
        setError("No se pudo abrir la cámara. Usa Wi‑Fi o el código.");
        setQrOpen(false);
      }
    })();
    return () => {
      cancelled = true;
      void scanner?.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOpen]);

  useEffect(() => {
    if (desktopHint) {
      void (async () => {
        const ok = await checkHealth("");
        if (ok) {
          setApiBase("");
          onConnected();
        }
      })();
      return;
    }

    const last = getApiBase();
    if (!last) {
      void autoScan();
      return;
    }
    void (async () => {
      setBusy(true);
      const ok = await checkHealth(last);
      if (ok) {
        const gate = await checkVersionGate(last);
        setBusy(false);
        if (gate) onConnected();
        return;
      }
      setBusy(false);
      void autoScan();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkVersionGate(base: string): Promise<boolean> {
    const meta = await fetchMeta(base);
    if (meta?.client_outdated) {
      setOutdated(meta);
      setError(
        `Esta app (${CLIENT_VERSION}) es antigua. Actualiza desde la caja (mínimo ${meta.min_client_version}).`,
      );
      return false;
    }
    setOutdated(null);
    return true;
  }

  async function autoScan() {
    setScanning(true);
    setScanNote("Buscando LocalComida en tu Wi‑Fi…");
    setError(null);
    setFound([]);
    try {
      const list = await discoverLocalServers(8000, (n) => {
        setScanNote(`Encontrado ${n}…`);
      });
      setFound(list);
      if (list.length === 1) {
        await finishConnect(list[0].url);
        return;
      }
      if (list.length === 0) {
        setScanNote(
          "No se encontró ningún equipo. Asegúrate de que la caja esté encendida en la misma Wi‑Fi, o usa el código / QR.",
        );
      } else {
        setScanNote("Elige el equipo al que conectar:");
      }
    } catch {
      setScanNote("No se pudo buscar en la red. Usa el código de emparejamiento de la caja.");
    } finally {
      setScanning(false);
    }
  }

  async function finishConnect(url: string) {
    setBusy(true);
    setError(null);
    const ok = await checkHealth(url);
    if (!ok) {
      setBusy(false);
      setError("Ese equipo no responde. Prueba de nuevo.");
      return;
    }
    const gate = await checkVersionGate(url);
    setBusy(false);
    if (!gate) return;
    setApiBase(url);
    onConnected();
  }

  async function connectTo(url: string) {
    await finishConnect(url);
  }

  async function claimPairing(e: FormEvent) {
    e.preventDefault();
    const code = pairCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("El código debe tener 6 dígitos");
      return;
    }
    setBusy(true);
    setError(null);

    // Necesitamos un host: último conocido, escaneo, o el campo IP
    let base = getApiBase();
    if (!base && host.trim()) {
      let input = host.trim();
      if (!/^https?:\/\//i.test(input)) input = `http://${input}`;
      try {
        const u = new URL(input);
        if (!u.port) u.port = "8000";
        base = u.toString().replace(/\/$/, "");
      } catch {
        setBusy(false);
        setError("IP inválida para canjear el código");
        return;
      }
    }
    if (!base) {
      const list = await discoverLocalServers(8000);
      if (list.length === 1) base = list[0].url;
      else if (list.length > 1) {
        setFound(list);
        setBusy(false);
        setError("Hay varias cajas. Elige una o escribe la IP, luego canjea el código.");
        return;
      }
    }
    if (!base) {
      setBusy(false);
      setError("No hay servidor. Busca en Wi‑Fi o escribe la IP de la caja.");
      return;
    }

    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/v1/pairing/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          device_id: getOrCreateDeviceId(),
          platform: isNativeMobile() ? "android" : "web",
          device_label: "Tablet LocalComida",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        primary_url?: string;
      };
      if (!res.ok) {
        setBusy(false);
        setError(data.error || "No se pudo emparejar");
        return;
      }
      const url = (data.primary_url || base).replace(/\/$/, "");
      await finishConnect(url);
    } catch {
      setBusy(false);
      setError("No se pudo contactar al servidor para emparejar");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    let input = host.trim();
    if (!input) {
      setApiBase("");
      const ok = await checkHealth("");
      if (ok) {
        const gate = await checkVersionGate("");
        setBusy(false);
        if (gate) onConnected();
        return;
      }
      setBusy(false);
      setError("No se pudo conectar. Pulsa «Buscar en Wi‑Fi» o escribe la IP.");
      return;
    }

    if (!/^https?:\/\//i.test(input)) {
      input = `http://${input}`;
    }
    try {
      const u = new URL(input);
      if (!u.port) {
        u.port = "8000";
        input = u.toString().replace(/\/$/, "");
      }
    } catch {
      setBusy(false);
      setError("Dirección inválida");
      return;
    }

    await connectTo(input);
  }

  if (outdated) {
    const url = apkDownloadUrl(getApiBase() || found[0]?.url);
    return (
      <div className="h-full flex items-center justify-center bg-surface p-6">
        <div className="w-full max-w-md bg-white rounded-[2rem] border border-border p-6 space-y-4 text-center">
          <p className="text-2xl font-semibold">Actualiza la app</p>
          <p className="text-sm text-muted">
            El local requiere versión {outdated.min_client_version} o superior. Tienes{" "}
            {CLIENT_VERSION}.
          </p>
          <a
            href={url}
            className="inline-flex w-full min-h-12 items-center justify-center rounded-2xl bg-ink text-white font-medium"
          >
            Descargar APK desde la caja
          </a>
          <Button variant="secondary" className="w-full" onClick={() => setOutdated(null)}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <p className="text-4xl font-semibold tracking-tight">LocalComida</p>
          <p className="mt-2 text-muted text-sm">
            {desktopHint
              ? "Conectando al servidor local…"
              : "Conecta esta tablet a la caja (misma Wi‑Fi)"}
          </p>
        </div>

        <div className="bg-white rounded-[2rem] border border-border p-6 shadow-sm space-y-4">
          {!desktopHint ? (
            <>
              <Button
                size="lg"
                className="w-full"
                disabled={scanning || busy}
                onClick={() => void autoScan()}
              >
                {scanning ? "Buscando en la Wi‑Fi…" : "Buscar en Wi‑Fi"}
              </Button>

              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setQrOpen(true);
                }}
              >
                Escanear código QR
              </Button>

              {qrOpen ? (
                <div className="space-y-2">
                  <div id="lc-qr-reader" className="overflow-hidden rounded-2xl" />
                  <Button variant="ghost" className="w-full" onClick={() => setQrOpen(false)}>
                    Cancelar cámara
                  </Button>
                </div>
              ) : null}

              {scanNote ? <p className="text-sm text-muted text-center">{scanNote}</p> : null}

              {found.length > 1 ? (
                <div className="space-y-2">
                  {found.map((s) => (
                    <Button
                      key={s.url}
                      variant="secondary"
                      size="lg"
                      className="w-full"
                      disabled={busy}
                      onClick={() => void connectTo(s.url)}
                    >
                      Conectar · {s.address}
                    </Button>
                  ))}
                </div>
              ) : null}

              <form onSubmit={(e) => void claimPairing(e)} className="space-y-2 border-t border-border pt-4">
                <p className="text-xs text-muted text-center">
                  Código de emparejamiento (menú → Conectar tablets en la caja)
                </p>
                <input
                  className="field-input text-center tracking-[0.3em] text-lg"
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                <Button type="submit" className="w-full" disabled={busy || pairCode.length !== 6}>
                  Emparejar con código
                </Button>
              </form>
            </>
          ) : null}

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs text-muted text-center">
              {desktopHint
                ? "Si el servidor no arranca, revisa el puerto 8000."
                : "También puedes escribir la IP si te la indican."}
            </p>
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <input
                className="field-input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.20"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button type="submit" variant="secondary" className="w-full" disabled={busy || scanning}>
                {busy ? "Conectando…" : "Conectar"}
              </Button>
            </form>
          </div>

          {error ? <p className="text-danger text-sm text-center">{error}</p> : null}

          {onBackToSetup ? (
            <button
              type="button"
              className="w-full min-h-12 text-sm text-muted pt-2"
              onClick={onBackToSetup}
            >
              ← Volver a la configuración inicial
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
