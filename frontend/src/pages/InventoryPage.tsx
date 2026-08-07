import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { Button } from "../components/Button";
import { CategoryInput } from "../components/CategoryInput";
import { Modal } from "../components/Modal";
import type { Ingredient, IngredientUnit } from "../types";
import { costLabelForUnit, formatMoney, stockUnitSuffix } from "../types";

type Mode = "edit" | "stock" | "create" | null;

const UNITS: IngredientUnit[] = ["gramos", "ml", "unidades"];

const emptyForm = {
  name: "",
  category: "General",
  unit: "unidades" as IngredientUnit,
  cost_per_unit: "0",
  low_stock_threshold: "10",
  current_stock: "0",
};

export function InventoryPage() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState<Ingredient | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [adjustmentType, setAdjustmentType] = useState<"add" | "subtract">("add");
  const [quantity, setQuantity] = useState("10");
  const [reason, setReason] = useState("Compra a proveedor");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("Todos");

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
  }, [items]);

  const categories = useMemo(() => {
    return ["Todos", ...categoryOptions];
  }, [categoryOptions]);

  const filtered =
    filter === "Todos" ? items : items.filter((i) => i.category === filter);

  async function load() {
    const data = await api<Ingredient[]>("/inventory/ingredients");
    setItems(data);
  }

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar inventario");
    });
  }, []);

  function openCreate() {
    setSelected(null);
    setForm(emptyForm);
    setMode("create");
    setError(null);
  }

  function openEdit(item: Ingredient) {
    setSelected(item);
    setForm({
      name: item.name,
      category: item.category,
      unit: (UNITS.includes(item.unit as IngredientUnit)
        ? item.unit
        : "unidades") as IngredientUnit,
      cost_per_unit: String(item.cost_per_unit),
      low_stock_threshold: String(item.low_stock_threshold),
      current_stock: String(item.current_stock),
    });
    setMode("edit");
    setError(null);
  }

  function openStock(item: Ingredient) {
    setSelected(item);
    setQuantity("10");
    setReason("Compra a proveedor");
    setAdjustmentType("add");
    setMode("stock");
    setError(null);
  }

  async function saveAttributes() {
    const cost = Number(form.cost_per_unit);
    const threshold = Number(form.low_stock_threshold);
    if (!form.name.trim() || !form.category.trim()) {
      setError("Nombre y categoría son obligatorios");
      return;
    }
    if (!Number.isInteger(cost) || cost < 0) {
      setError(
        form.unit === "gramos"
          ? "Costo por kilo inválido (entero ≥ 0)"
          : form.unit === "ml"
            ? "Costo por litro inválido (entero ≥ 0)"
            : "Costo unitario inválido (entero ≥ 0)",
      );
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      setError("Umbral crítico inválido");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        const stock = Number(form.current_stock);
        if (!Number.isFinite(stock) || stock < 0) {
          setError("Stock inicial inválido");
          setBusy(false);
          return;
        }
        await api("/inventory/ingredients", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category.trim(),
            unit: form.unit,
            cost_per_unit: cost,
            low_stock_threshold: threshold,
            current_stock: stock,
          }),
        });
      } else if (selected) {
        await api(`/inventory/ingredients/${selected.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category.trim(),
            unit: form.unit,
            cost_per_unit: cost,
            low_stock_threshold: threshold,
          }),
        });
      }
      setMode(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function saveStock() {
    if (!selected) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Cantidad inválida");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/inventory/ingredients/${selected.id}/stock`, {
        method: "PUT",
        body: JSON.stringify({
          adjustment_type: adjustmentType,
          quantity: qty,
          reason,
        }),
      });
      setMode(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ajustar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 lg:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-muted text-sm mt-1">
            Aquí controlas los ingredientes, su stock y cuándo avisar si quedan pocos.
          </p>
        </div>
        <Button size="lg" onClick={openCreate}>
          Nuevo ingrediente
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-4">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={`min-h-11 px-4 rounded-2xl whitespace-nowrap border ${
              filter === c ? "bg-ink text-white border-ink" : "bg-white border-border"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {error && !mode ? <p className="text-danger text-sm mb-3">{error}</p> : null}

      <div className="grid gap-2">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="rounded-[1.5rem] bg-white border border-border px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-muted mt-0.5">
                {item.category} · {item.unit} ·{" "}
                {item.unit === "gramos"
                  ? `${formatMoney(item.cost_per_unit)}/kg`
                  : item.unit === "ml"
                    ? `${formatMoney(item.cost_per_unit)}/L`
                    : `costo ${formatMoney(item.cost_per_unit)}`}{" "}
                · stock {item.current_stock}
                {stockUnitSuffix(item.unit)}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right mr-1">
                <p className={`text-lg font-semibold ${item.is_low ? "text-danger" : ""}`}>
                  {item.current_stock}
                </p>
                {item.is_low ? (
                  <p className="text-xs text-danger">Stock bajo</p>
                ) : (
                  <p className="text-xs text-muted">OK</p>
                )}
              </div>
              <Button variant="secondary" onClick={() => openEdit(item)}>
                Atributos
              </Button>
              <Button variant="secondary" onClick={() => openStock(item)}>
                Stock
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={mode === "create" || mode === "edit"}
        title={mode === "create" ? "Nuevo ingrediente" : selected?.name ?? "Editar"}
        onClose={() => setMode(null)}
        footer={
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void saveAttributes()}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="field-input"
            />
          </Field>
          <Field label="Categoría">
            <CategoryInput
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              categories={categoryOptions}
              placeholder="Vegetales, Licores, Proteínas…"
            />
          </Field>
          <Field label="Unidad de medida">
            <select
              value={form.unit}
              onChange={(e) =>
                setForm((f) => ({ ...f, unit: e.target.value as IngredientUnit }))
              }
              className="field-input"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label={costLabelForUnit(form.unit)}>
            <input
              type="number"
              min="0"
              step="1"
              value={form.cost_per_unit}
              onChange={(e) => setForm((f) => ({ ...f, cost_per_unit: e.target.value }))}
              className="field-input"
            />
          </Field>
          {(form.unit === "gramos" || form.unit === "ml") && Number(form.cost_per_unit) > 0 ? (
            <p className="text-xs text-muted -mt-2">
              Equivale a {formatMoney(Number(form.cost_per_unit) / 1000)} por{" "}
              {form.unit === "gramos" ? "gramo" : "ml"} (para recetas y costos).
            </p>
          ) : null}
          <Field
            label={
              form.unit === "gramos"
                ? "Umbral de stock bajo (gramos)"
                : form.unit === "ml"
                  ? "Umbral de stock bajo (ml)"
                  : "Umbral de stock bajo"
            }
          >
            <input
              type="number"
              min="0"
              step="any"
              value={form.low_stock_threshold}
              onChange={(e) =>
                setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))
              }
              className="field-input"
            />
          </Field>
          {mode === "create" ? (
            <Field
              label={
                form.unit === "gramos"
                  ? "Stock inicial (gramos)"
                  : form.unit === "ml"
                    ? "Stock inicial (ml)"
                    : "Stock inicial"
              }
            >
              <input
                type="number"
                min="0"
                step="any"
                value={form.current_stock}
                onChange={(e) => setForm((f) => ({ ...f, current_stock: e.target.value }))}
                className="field-input"
              />
            </Field>
          ) : null}
          {error ? <p className="text-danger text-sm">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={mode === "stock"}
        title={`Ajuste de stock · ${selected?.name ?? ""}`}
        onClose={() => setMode(null)}
        footer={
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void saveStock()}>
            {busy ? "Guardando…" : "Aplicar ajuste"}
          </Button>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Stock actual:{" "}
              <span className="text-ink font-medium">
                {selected.current_stock}
                {stockUnitSuffix(selected.unit)} ({selected.unit})
              </span>
            </p>
            <div className="flex gap-2">
              {(["add", "subtract"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAdjustmentType(t)}
                  className={`flex-1 min-h-11 rounded-2xl border ${
                    adjustmentType === t
                      ? "bg-ink text-white border-ink"
                      : "bg-white border-border"
                  }`}
                >
                  {t === "add" ? "Ingreso" : "Merma"}
                </button>
              ))}
            </div>
            <Field label="Cantidad">
              <input
                type="number"
                min="0.01"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="field-input"
              />
            </Field>
            <Field label="Motivo">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="field-input"
              />
            </Field>
            {error ? <p className="text-danger text-sm">{error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-sm text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
