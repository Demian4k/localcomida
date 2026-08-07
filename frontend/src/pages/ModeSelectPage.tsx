import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/Button";

export type AppMode = "caja" | "cocina";

const MODE_KEY = "lc_app_mode";
const ZONE_KEY = "lc_station_zone_id";

export function getStoredAppMode(): AppMode | null {
  const m = localStorage.getItem(MODE_KEY);
  if (m === "caja" || m === "cocina") return m;
  return null;
}

export function getStoredStationZoneId(): number | null {
  const raw = localStorage.getItem(ZONE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function storeAppMode(mode: AppMode, zoneId?: number | null): void {
  localStorage.setItem(MODE_KEY, mode);
  if (mode === "caja") {
    localStorage.removeItem(ZONE_KEY);
    return;
  }
  if (zoneId) {
    localStorage.setItem(ZONE_KEY, String(zoneId));
  } else {
    localStorage.removeItem(ZONE_KEY);
  }
}

export function clearAppMode(): void {
  localStorage.removeItem(MODE_KEY);
  localStorage.removeItem(ZONE_KEY);
}

interface Props {
  onChosen: (mode: AppMode, zoneId: number | null) => void;
  /** Solo elegir Caja/Preparación; la zona se pide después del login. */
  modeOnly?: boolean;
  /** Si true, solo el paso de zona (modo cocina ya elegido). */
  zoneOnly?: boolean;
}

export function ModeSelectPage({ onChosen, modeOnly = false, zoneOnly = false }: Props) {
  const [zones, setZones] = useState<{ id: number; name: string }[]>([]);
  const [step, setStep] = useState<"mode" | "zone">(zoneOnly ? "zone" : "mode");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== "zone") return;
    void api<{ id: number; name: string }[]>("/stations/zones")
      .then(setZones)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "No se pudieron cargar las estaciones");
      });
  }, [step]);

  function pickCaja() {
    storeAppMode("caja");
    onChosen("caja", null);
  }

  function pickCocina() {
    if (modeOnly) {
      storeAppMode("cocina");
      onChosen("cocina", null);
      return;
    }
    setStep("zone");
    setError(null);
  }

  function pickZone(zone: { id: number; name: string }) {
    storeAppMode("cocina", zone.id);
    onChosen("cocina", zone.id);
  }

  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg animate-fade-up">
        <div className="mb-8 text-center">
          <p className="text-3xl font-semibold tracking-tight">
            {step === "zone" ? "¿Qué estación?" : "¿Qué eres?"}
          </p>
          <p className="mt-2 text-muted text-sm">
            {step === "zone"
              ? "Elige la zona de preparación de esta pantalla"
              : "Caja (ventas) o Preparación (cocina / barra)"}
          </p>
        </div>

        {step === "mode" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" className="min-h-28 text-lg" onClick={pickCaja}>
              Caja
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="min-h-28 text-lg"
              onClick={pickCocina}
            >
              Preparación
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {error ? <p className="text-danger text-sm text-center">{error}</p> : null}
            {zones.length === 0 && !error ? (
              <p className="text-muted text-center text-sm">Cargando estaciones…</p>
            ) : null}
            {zones.map((z) => (
              <Button
                key={z.id}
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={() => pickZone(z)}
              >
                {z.name}
              </Button>
            ))}
            {!zoneOnly ? (
              <Button variant="ghost" className="w-full" onClick={() => setStep("mode")}>
                Volver
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
