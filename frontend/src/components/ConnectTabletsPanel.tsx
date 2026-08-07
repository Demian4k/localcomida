import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface NetworkInfo {
  port: number;
  urls: string[];
  primary_url: string | null;
  addresses: { address: string; iface: string }[];
}

interface PairingStart {
  code: string;
  expires_at: string;
  ttl_sec: number;
  primary_url: string | null;
  qr_payload: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConnectTabletsPanel({ open, onClose }: Props) {
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [pairing, setPairing] = useState<PairingStart | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPairing(null);
    void api<NetworkInfo>("/network/info")
      .then(async (data) => {
        setInfo(data);
        const url = data.primary_url ?? data.urls[0];
        if (!url) {
          setQrDataUrl(null);
          setError(
            "No se detectó una IP de red. Conecta este equipo a la Wi‑Fi del local.",
          );
          return;
        }
        const png = await QRCode.toDataURL(url, {
          width: 280,
          margin: 2,
          color: { dark: "#0a0a0a", light: "#ffffff" },
        });
        setQrDataUrl(png);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "No se pudo obtener la red");
      });
  }, [open]);

  async function startPairing() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<PairingStart>("/pairing/start", { method: "POST" });
      setPairing(data);
      const png = await QRCode.toDataURL(data.qr_payload, {
        width: 280,
        margin: 2,
        color: { dark: "#0a0a0a", light: "#ffffff" },
      });
      setQrDataUrl(png);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo crear el código");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Conectar tablets" onClose={onClose}>
      <div className="space-y-4 text-sm text-muted leading-relaxed">
        <p>
          El inventario es <span className="text-ink font-medium">único</span>: vive en el equipo
          principal. Todas las cajas y estaciones de la misma Wi‑Fi ven el mismo stock al momento.
        </p>
        <p>
          En otra tablet abre LocalComida → «Me conecto a otra» → Wi‑Fi, QR o código.
        </p>

        {error ? <p className="text-danger">{error}</p> : null}

        {pairing ? (
          <div className="rounded-2xl border border-border bg-surface p-4 text-center space-y-2">
            <p className="text-xs uppercase tracking-wide">Código (válido ~{pairing.ttl_sec / 60} min)</p>
            <p className="text-4xl font-semibold tracking-[0.35em] text-ink">{pairing.code}</p>
          </div>
        ) : null}

        {qrDataUrl ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <img
              src={qrDataUrl}
              alt="Código QR para tablets"
              className="rounded-2xl border border-border bg-white p-2 w-[280px] h-[280px]"
            />
            <p className="text-ink font-medium text-base break-all text-center">
              {pairing?.primary_url ?? info?.primary_url}
            </p>
          </div>
        ) : !error ? (
          <p className="text-center py-8">Generando código…</p>
        ) : null}

        {info && info.urls.length > 1 ? (
          <div>
            <p className="mb-1">Otras direcciones de este equipo:</p>
            <ul className="space-y-1">
              {info.urls.slice(1).map((u) => (
                <li key={u} className="text-ink text-xs break-all">
                  {u}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void startPairing()}>
            {busy ? "Generando…" : pairing ? "Nuevo código de emparejamiento" : "Generar código de emparejamiento"}
          </Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onClose}>
            Listo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
