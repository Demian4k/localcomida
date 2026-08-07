import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { isNativeMobile } from "../lib/platform";
import type { Printer, ScannedDevice, Zone, ZoneDeletePreview } from "../types";

type ZoneFormMode = "create" | "edit" | "delete" | null;

function asDeviceList(raw: unknown): ScannedDevice[] {
  if (Array.isArray(raw)) return raw as ScannedDevice[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { devices?: unknown }).devices)) {
    return (raw as { devices: ScannedDevice[] }).devices;
  }
  return [];
}

export function PrintersPage() {
  const mobile = isNativeMobile();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [scanned, setScanned] = useState<ScannedDevice[]>([]);
  const [jobs, setJobs] = useState<
    { id: string; zoneName: string; orderId: number; status: string; error?: string }[]
  >([]);
  const [scanning, setScanning] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zoneMode, setZoneMode] = useState<ZoneFormMode>(null);
  const [zoneFormName, setZoneFormName] = useState("");
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [deletePreview, setDeletePreview] = useState<ZoneDeletePreview | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const cajaZoneCount = zones.filter((z) => z.name.toLowerCase().includes("caja")).length;

  function canDeleteZone(zone: Zone): boolean {
    if (zones.length <= 1) return false;
    if (zone.name.toLowerCase().includes("caja") && cajaZoneCount < 2) return false;
    return true;
  }

  async function reload() {
    const [p, z, q] = await Promise.all([
      api<Printer[]>("/hardware/printers"),
      api<Zone[]>("/hardware/zones"),
      api<{
        jobs: { id: string; zoneName: string; orderId: number; status: string; error?: string }[];
      }>("/hardware/print-queue"),
    ]);
    setPrinters(p);
    setZones(z);
    setJobs(q.jobs.slice(0, 12));
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar impresoras");
    });
  }, []);

  async function scan() {
    setScanning(true);
    setError(null);
    setMessage(null);
    try {
      const raw = await api<unknown>("/hardware/scan");
      const devices = asDeviceList(raw);
      setScanned(devices);
      if (devices.length === 0) {
        setMessage(
          mobile
            ? "No se encontró ninguna impresora en la Wi‑Fi (puerto 9100). En móvil el USB se agrega manualmente por IP, o usa el PC como principal para escanear USB."
            : "No se encontró ninguna impresora. Revisa que esté encendida, conectada por cable o en la misma red Wi‑Fi.",
        );
      } else {
        setMessage(`Se encontraron ${devices.length} impresora(s)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al escanear");
    } finally {
      setScanning(false);
    }
  }

  async function addManualPrinter() {
    const address = manualAddress.trim();
    if (!address) {
      setError("Escribe la IP o dirección (ej. 192.168.1.50:9100)");
      return;
    }
    setManualBusy(true);
    setError(null);
    try {
      const addr = address.includes(":") ? address : `${address}:9100`;
      await api("/hardware/printers", {
        method: "POST",
        body: JSON.stringify({
          name: `Impresora ${addr}`,
          connection_type: "WIFI",
          address: addr,
        }),
      });
      setManualAddress("");
      setMessage(`Impresora agregada: ${addr}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar");
    } finally {
      setManualBusy(false);
    }
  }

  async function registerDevice(device: ScannedDevice) {
    const name =
      device.label?.trim() ||
      (device.type === "USB"
        ? `USB ${device.address.replace(/^WINPRINTER:/i, "").replace(/^USB:/i, "")}`
        : `Red ${device.address}`);
    try {
      await api("/hardware/printers", {
        method: "POST",
        body: JSON.stringify({
          name,
          connection_type: device.type === "ETHERNET" ? "ETHERNET" : device.type,
          address: device.address,
        }),
      });
      setMessage(`Registrada: ${name}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar");
    }
  }

  async function assign(printerId: number, zoneId: number) {
    try {
      await api(`/hardware/printers/${printerId}/assign`, {
        method: "PUT",
        body: JSON.stringify({ zone_id: zoneId }),
      });
      setMessage("Impresora asignada a zona");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al asignar");
    }
  }

  async function testPrint(printerId: number) {
    setTestingId(printerId);
    setError(null);
    try {
      await api(`/hardware/printers/${printerId}/test`, { method: "POST" });
      setMessage("Prueba de impresión enviada");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló la prueba");
    } finally {
      setTestingId(null);
    }
  }

  async function removePrinter(printerId: number) {
    try {
      await api(`/hardware/printers/${printerId}`, { method: "DELETE" });
      setMessage("Impresora eliminada");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  }

  function openCreateZone() {
    setEditingZone(null);
    setDeletePreview(null);
    setZoneFormName("");
    setZoneMode("create");
    setError(null);
  }

  function openEditZone(zone: Zone) {
    setEditingZone(zone);
    setDeletePreview(null);
    setZoneFormName(zone.name);
    setZoneMode("edit");
    setError(null);
  }

  async function openDeleteZone(zone: Zone) {
    setEditingZone(zone);
    setZoneFormName("");
    setError(null);
    try {
      const preview = await api<ZoneDeletePreview>(
        `/hardware/zones/${zone.id}/delete-preview`,
      );
      setDeletePreview(preview);
      setZoneMode("delete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se puede eliminar esta zona");
    }
  }

  function closeZoneModal() {
    setZoneMode(null);
    setEditingZone(null);
    setDeletePreview(null);
    setZoneFormName("");
  }

  async function saveZone() {
    if (!zoneFormName.trim()) {
      setError("El nombre de la zona es obligatorio");
      return;
    }
    setZoneBusy(true);
    setError(null);
    try {
      if (zoneMode === "create") {
        await api("/hardware/zones", {
          method: "POST",
          body: JSON.stringify({ name: zoneFormName.trim() }),
        });
        setMessage(`Zona "${zoneFormName.trim()}" creada`);
      } else if (zoneMode === "edit" && editingZone) {
        await api(`/hardware/zones/${editingZone.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: zoneFormName.trim() }),
        });
        setMessage(`Zona renombrada a "${zoneFormName.trim()}"`);
      }
      closeZoneModal();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar zona");
    } finally {
      setZoneBusy(false);
    }
  }

  async function confirmDeleteZone() {
    if (!editingZone) return;
    setZoneBusy(true);
    setError(null);
    try {
      const result = await api<{
        message: string;
        products_reassigned: number;
        fallback_zone: { name: string };
      }>(`/hardware/zones/${editingZone.id}`, { method: "DELETE" });
      setMessage(
        `${result.message}. ${result.products_reassigned} producto(s) movidos a ${result.fallback_zone.name}.`,
      );
      closeZoneModal();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar zona");
    } finally {
      setZoneBusy(false);
    }
  }

  async function togglePrint(zone: Zone, enabled: boolean) {
    setError(null);
    try {
      await api(`/hardware/zones/${zone.id}`, {
        method: "PUT",
        body: JSON.stringify({ print_enabled: enabled }),
      });
      setMessage(
        enabled
          ? `Impresión en papel activada para «${zone.name}»`
          : `Impresión en papel desactivada para «${zone.name}»`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la zona");
    }
  }

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 lg:p-6 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Impresoras</h1>
          <p className="text-muted text-sm mt-1">
            Las encomiendas se ven en las tablets de cocina. La impresión en papel es
            opcional.
          </p>
        </div>
        <Button size="lg" onClick={() => void scan()} disabled={scanning}>
          {scanning ? "Buscando…" : "Buscar impresoras"}
        </Button>
      </div>

      {message ? <p className="text-success text-sm">{message}</p> : null}
      {error && !zoneMode ? <p className="text-danger text-sm">{error}</p> : null}

      <div className="rounded-[1.5rem] border border-border bg-white p-4 space-y-3">
        <p className="text-sm font-medium">Agregar por IP (Wi‑Fi)</p>
        <p className="text-xs text-muted">
          {mobile
            ? "En teléfonos/tablets: busca en la red o escribe la IP de la impresora. USB del teléfono no se detecta automáticamente."
            : "También puedes escribir la IP si la impresora de red no aparece en el escaneo."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="field-input flex-1"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            placeholder="192.168.1.50 o 192.168.1.50:9100"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button
            variant="secondary"
            disabled={manualBusy}
            onClick={() => void addManualPrinter()}
          >
            {manualBusy ? "…" : "Agregar"}
          </Button>
        </div>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-semibold">Zonas</h2>
          <Button variant="secondary" onClick={openCreateZone}>
            Nueva zona
          </Button>
        </div>
        <p className="text-xs text-muted mb-3">
          Cada zona puede tener una tablet de cocina. Activa «Imprimir también» solo si
          quieres ticket en papel además de la pantalla.
        </p>
        <div className="grid gap-2">
          {zones.map((z) => {
            const deleteAllowed = canDeleteZone(z);
            const isSoleCaja =
              z.name.toLowerCase().includes("caja") && cajaZoneCount < 2 && zones.length > 1;
            return (
              <div
                key={z.id}
                className="rounded-[1.5rem] border border-border bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{z.name}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {z.products_count ?? 0} producto(s) · {z.printers_count ?? 0} impresora(s)
                  </p>
                  {isSoleCaja ? (
                    <p className="text-xs text-muted mt-1">
                      Para eliminarla, crea otra zona de respaldo con «Caja» en el nombre.
                    </p>
                  ) : null}
                  <label className="mt-2 inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-border"
                      checked={Boolean(z.print_enabled)}
                      onChange={(e) => void togglePrint(z, e.target.checked)}
                    />
                    Imprimir también en papel
                  </label>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" onClick={() => openEditZone(z)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-danger"
                    onClick={() => void openDeleteZone(z)}
                    disabled={!deleteAllowed}
                    title={
                      isSoleCaja
                        ? "Se necesita otra zona de caja como respaldo"
                        : undefined
                    }
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {scanned.length > 0 ? (
        <section>
          <h2 className="font-semibold mb-3">Detectadas</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {scanned.map((d) => (
              <div
                key={`${d.type}-${d.address}`}
                className="rounded-[1.5rem] border border-border bg-white p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{d.label ?? d.type}</p>
                  <p className="text-sm text-muted">
                    {d.type} · {d.address}
                  </p>
                  {d.port_name || d.driver ? (
                    <p className="text-xs text-muted mt-1 truncate">
                      {[d.port_name, d.driver].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <Button variant="secondary" onClick={() => void registerDevice(d)}>
                  Registrar
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-semibold mb-3">Impresoras configuradas</h2>
        <div className="grid gap-3">
          {printers.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay impresoras. Pulsa «Buscar impresoras».</p>
          ) : (
            printers.map((p) => (
              <div
                key={p.id}
                className="rounded-[1.5rem] border border-border bg-white p-4 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted break-all">
                      {p.connection_type} · {p.address}
                    </p>
                    <p className="text-sm mt-1">
                      Zona:{" "}
                      <span className="font-medium">{p.zone_name ?? "Sin asignar"}</span>
                    </p>
                  </div>
                  <select
                    className="min-h-11 rounded-2xl border border-border px-3 bg-surface"
                    value={p.zone_id ?? ""}
                    onChange={(e) => {
                      const zoneId = Number(e.target.value);
                      if (zoneId) void assign(p.id, zoneId);
                    }}
                  >
                    <option value="">Asignar zona…</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={testingId === p.id}
                    onClick={() => void testPrint(p.id)}
                  >
                    {testingId === p.id ? "Enviando…" : "Probar impresión"}
                  </Button>
                  <Button variant="ghost" onClick={() => void removePrinter(p.id)}>
                    Eliminar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Impresiones recientes</h2>
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-muted text-sm">Aún no hay impresiones</p>
          ) : (
            jobs.map((j) => (
              <div
                key={j.id}
                className="rounded-2xl border border-border bg-white px-4 py-3 flex justify-between gap-3 text-sm"
              >
                <span>
                  Orden #{j.orderId} · {j.zoneName}
                </span>
                <span
                  className={
                    j.status === "failed"
                      ? "text-danger"
                      : j.status === "done"
                        ? "text-success"
                        : "text-muted"
                  }
                >
                  {j.status}
                  {j.error ? ` — ${j.error}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <Modal
        open={zoneMode === "create" || zoneMode === "edit"}
        title={zoneMode === "create" ? "Nueva zona" : `Editar · ${editingZone?.name ?? ""}`}
        onClose={closeZoneModal}
        footer={
          <Button size="lg" className="w-full" disabled={zoneBusy} onClick={() => void saveZone()}>
            {zoneBusy ? "Guardando…" : "Guardar"}
          </Button>
        }
      >
        <div className="space-y-4">
          {zoneMode === "edit" ? (
            <p className="text-sm text-muted">
              Solo cambia el nombre. Los productos e impresoras de esta zona siguen igual.
            </p>
          ) : null}
          <div>
            <label className="text-sm text-muted">Nombre de la zona</label>
            <input
              className="field-input mt-1"
              value={zoneFormName}
              onChange={(e) => setZoneFormName(e.target.value)}
              placeholder="Cocina caliente, Barra, Caja…"
            />
          </div>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={zoneMode === "delete" && Boolean(deletePreview)}
        title={`Eliminar · ${deletePreview?.zone.name ?? ""}`}
        onClose={closeZoneModal}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={closeZoneModal}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={zoneBusy}
              onClick={() => void confirmDeleteZone()}
            >
              {zoneBusy ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        }
      >
        {deletePreview ? (
          <div className="space-y-3 text-sm text-muted leading-relaxed">
            <p>
              Se eliminará la zona{" "}
              <span className="text-ink font-medium">«{deletePreview.zone.name}»</span>.
            </p>
            <p>
              {deletePreview.products_count > 0 ? (
                <>
                  <span className="text-ink font-medium">{deletePreview.products_count}</span>{" "}
                  producto(s) pasarán a{" "}
                  <span className="text-ink font-medium">
                    «{deletePreview.fallback_zone.name}»
                  </span>{" "}
                  (primera zona de la lista).
                </>
              ) : (
                <>No hay productos asignados a esta zona.</>
              )}
            </p>
            {deletePreview.printers_count > 0 ? (
              <p>
                <span className="text-ink font-medium">{deletePreview.printers_count}</span>{" "}
                impresora(s) también se reasignarán a «{deletePreview.fallback_zone.name}».
              </p>
            ) : null}
            {deletePreview.is_caja_zone && deletePreview.caja_backup_zone ? (
              <p className="text-muted">
                Los vouchers de cliente seguirán saliendo por{" "}
                <span className="text-ink font-medium">
                  «{deletePreview.caja_backup_zone.name}»
                </span>{" "}
                (zona de caja de respaldo).
              </p>
            ) : null}
            {error ? <p className="text-danger">{error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** @deprecated Use PrintersPage */
export const HardwarePage = PrintersPage;
