import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { Button } from "../components/Button";
import { CategoryInput } from "../components/CategoryInput";
import { Modal } from "../components/Modal";
import type { CatalogProduct, Ingredient, Zone } from "../types";
import { formatMoney } from "../types";

interface RecipeDraft {
  ingredient_id: number;
  quantity_required: string;
  is_modifiable: boolean;
  extra_price: string;
}

interface ProductForm {
  name: string;
  base_price: string;
  zone_id: string;
  category: string;
  is_active: boolean;
  recipe: RecipeDraft[];
}

const emptyForm = (): ProductForm => ({
  name: "",
  base_price: "0",
  zone_id: "",
  category: "Comida",
  is_active: true,
  recipe: [],
});

interface Props {
  onCatalogChanged?: () => void;
}

export function ProductsPage({ onCatalogChanged }: Props) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("Todos");
  const [addIngredientId, setAddIngredientId] = useState("");

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
  }, [products]);

  const categories = useMemo(() => {
    return ["Todos", ...categoryOptions];
  }, [categoryOptions]);

  const filtered =
    filter === "Todos" ? products : products.filter((p) => p.category === filter);

  const prepZones = useMemo(
    () => zones.filter((z) => !z.name.toLowerCase().includes("caja")),
    [zones],
  );

  async function load() {
    const [p, i, z] = await Promise.all([
      api<CatalogProduct[]>("/catalog/products/manage"),
      api<Ingredient[]>("/inventory/ingredients"),
      api<Zone[]>("/hardware/zones"),
    ]);
    setProducts(p);
    setIngredients(i);
    setZones(z);
    if (!form.zone_id && z.length > 0) {
      const firstPrep = z.find((zone) => !zone.name.toLowerCase().includes("caja")) ?? z[0];
      setForm((f) => ({ ...f, zone_id: String(firstPrep.id) }));
    }
  }

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar productos");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    const firstPrep =
      prepZones[0] ?? zones[0] ?? { id: 1, name: "" };
    setEditingId(null);
    setForm({
      ...emptyForm(),
      zone_id: String(firstPrep.id),
    });
    setAddIngredientId("");
    setOpen(true);
    setError(null);
  }

  function openEdit(product: CatalogProduct) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      base_price: String(product.base_price),
      zone_id: String(product.zone_id),
      category: product.category,
      is_active: product.is_active !== false,
      recipe: (product.recipe ?? []).map((r) => ({
        ingredient_id: r.ingredient_id,
        quantity_required: String(r.quantity_required),
        is_modifiable: r.is_modifiable,
        extra_price: String(r.extra_price),
      })),
    });
    setAddIngredientId("");
    setOpen(true);
    setError(null);
  }

  function addRecipeLine() {
    const id = Number(addIngredientId);
    if (!id) return;
    if (form.recipe.some((r) => r.ingredient_id === id)) {
      setError("Ese ingrediente ya está en la receta");
      return;
    }
    const ing = ingredients.find((i) => i.id === id);
    if (!ing) return;
    setForm((f) => ({
      ...f,
      recipe: [
        ...f.recipe,
        {
          ingredient_id: id,
          quantity_required: "1",
          is_modifiable: false,
          extra_price: "0",
        },
      ],
    }));
    setAddIngredientId("");
    setError(null);
  }

  function updateRecipeLine(ingredientId: number, patch: Partial<RecipeDraft>) {
    setForm((f) => ({
      ...f,
      recipe: f.recipe.map((r) =>
        r.ingredient_id === ingredientId ? { ...r, ...patch } : r,
      ),
    }));
  }

  function removeRecipeLine(ingredientId: number) {
    setForm((f) => ({
      ...f,
      recipe: f.recipe.filter((r) => r.ingredient_id !== ingredientId),
    }));
  }

  async function save() {
    const price = Number(form.base_price);
    const zoneId = Number(form.zone_id);
    if (!form.name.trim() || !form.category.trim()) {
      setError("Nombre y categoría son obligatorios");
      return;
    }
    if (!Number.isInteger(price) || price < 0) {
      setError("Precio base inválido (CLP entero ≥ 0)");
      return;
    }
    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      setError("Debes asignar una zona de preparación");
      return;
    }

    const recipe = [];
    for (const line of form.recipe) {
      const qty = Number(line.quantity_required);
      const extra = Number(line.extra_price);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError("Cantidad de receta inválida");
        return;
      }
      if (!Number.isInteger(extra) || extra < 0) {
        setError("Precio extra inválido");
        return;
      }
      recipe.push({
        ingredient_id: line.ingredient_id,
        quantity_required: qty,
        is_modifiable: line.is_modifiable,
        extra_price: extra,
      });
    }

    const body = {
      name: form.name.trim(),
      base_price: price,
      zone_id: zoneId,
      category: form.category.trim(),
      is_active: form.is_active,
      recipe,
    };

    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await api(`/catalog/products/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await api("/catalog/products", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setOpen(false);
      await load();
      onCatalogChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar producto");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 lg:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="text-muted text-sm mt-1">
            Arma el menú: precio, en qué zona se prepara y qué ingredientes lleva.
          </p>
        </div>
        <Button size="lg" onClick={openCreate}>
          Nuevo producto
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

      {error && !open ? <p className="text-danger text-sm mb-3">{error}</p> : null}

      <div className="grid gap-2">
        {filtered.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => openEdit(product)}
            className="w-full text-left rounded-[1.5rem] bg-white border border-border px-4 py-4 flex items-center justify-between gap-3 hover:border-ink/30"
          >
            <div className="min-w-0">
              <p className="font-medium">{product.name}</p>
              <p className="text-xs text-muted mt-0.5">
                {product.category} · {product.zone_name || "Sin zona"} ·{" "}
                {(product.recipe ?? []).length} ingredientes
                {product.is_active === false ? " · Inactivo" : ""}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold">{formatMoney(product.base_price)}</p>
              <p
                className={`text-xs ${product.is_active === false ? "text-muted" : "text-success"}`}
              >
                {product.is_active === false ? "Oculto en caja" : "Activo"}
              </p>
            </div>
          </button>
        ))}
      </div>

      <Modal
        open={open}
        title={editingId ? "Editar producto" : "Nuevo producto"}
        onClose={() => setOpen(false)}
        footer={
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar producto"}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Precio base (CLP)">
              <input
                type="number"
                min="0"
                step="1"
                value={form.base_price}
                onChange={(e) => setForm((f) => ({ ...f, base_price: e.target.value }))}
                className="field-input"
              />
            </Field>
            <Field label="Categoría / Tipo">
              <CategoryInput
                value={form.category}
                onChange={(category) => setForm((f) => ({ ...f, category }))}
                categories={categoryOptions}
                placeholder="Comida, Cócteles…"
              />
            </Field>
          </div>
          <Field label="Zona donde se prepara">
            <select
              value={form.zone_id}
              onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
              className="field-input"
            >
              {(prepZones.length > 0 ? prepZones : zones).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-3 min-h-11">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="size-5 rounded"
            />
            <span className="text-sm">Activo en caja</span>
          </label>

          <div className="pt-2 border-t border-border">
            <p className="font-medium mb-2">Receta</p>
            <p className="text-xs text-muted mb-3">
              Qué ingredientes usa. Marca si el cliente puede quitar o pedir extra.
            </p>

            <div className="flex gap-2 mb-3">
              <select
                value={addIngredientId}
                onChange={(e) => setAddIngredientId(e.target.value)}
                className="field-input flex-1"
              >
                <option value="">Agregar ingrediente…</option>
                {ingredients
                  .filter((i) => !form.recipe.some((r) => r.ingredient_id === i.id))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
              </select>
              <Button variant="secondary" onClick={addRecipeLine} disabled={!addIngredientId}>
                +
              </Button>
            </div>

            <div className="space-y-2">
              {form.recipe.length === 0 ? (
                <p className="text-sm text-muted">Sin ingredientes en la receta</p>
              ) : (
                form.recipe.map((line) => {
                  const ing = ingredients.find((i) => i.id === line.ingredient_id);
                  return (
                    <div
                      key={line.ingredient_id}
                      className="rounded-2xl border border-border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">
                          {ing?.name ?? `Ingrediente #${line.ingredient_id}`}
                        </p>
                        <button
                          type="button"
                          className="text-muted text-sm min-h-11 px-2"
                          onClick={() => removeRecipeLine(line.ingredient_id)}
                        >
                          Quitar
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label={`Cantidad (${ing?.unit ?? "u"})`}>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            value={line.quantity_required}
                            onChange={(e) =>
                              updateRecipeLine(line.ingredient_id, {
                                quantity_required: e.target.value,
                              })
                            }
                            className="field-input"
                          />
                        </Field>
                        <Field label="Extra (CLP)">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={line.extra_price}
                            disabled={!line.is_modifiable}
                            onChange={(e) =>
                              updateRecipeLine(line.ingredient_id, {
                                extra_price: e.target.value,
                              })
                            }
                            className="field-input disabled:opacity-40"
                          />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 text-sm min-h-11">
                        <input
                          type="checkbox"
                          checked={line.is_modifiable}
                          onChange={(e) =>
                            updateRecipeLine(line.ingredient_id, {
                              is_modifiable: e.target.checked,
                              extra_price: e.target.checked ? line.extra_price : "0",
                            })
                          }
                          className="size-4"
                        />
                        Se puede cambiar al vender (sin / extra)
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {error ? <p className="text-danger text-sm">{error}</p> : null}
        </div>
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
