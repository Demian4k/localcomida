import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { BottomSheet } from "../components/BottomSheet";
import { Modal } from "../components/Modal";
import { api } from "../api";
import { useIsPhone } from "../lib/useIsPhone";
import type { AuthState, CartItem, CartModifier, CatalogProduct } from "../types";
import {
  cartItemSubtotal,
  cartItemUnitPrice,
  cartTotal,
  formatMoney,
} from "../types";

interface Props {
  auth: AuthState;
  products: CatalogProduct[];
  onOrderDone: (orderId: number) => void;
  printerAlert?: string | null;
}

export function PosPage({ auth, products, onOrderDone, printerAlert }: Props) {
  const isPhone = useIsPhone();
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return ["Todos", ...Array.from(set)];
  }, [products]);

  const [category, setCategory] = useState("Todos");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "tarjeta">("efectivo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** Celular: panel del ticket desplegado (revisión antes de cobrar). */
  const [ticketOpen, setTicketOpen] = useState(false);

  const filtered =
    category === "Todos" ? products : products.filter((p) => p.category === category);

  const editingItem = cart.find((c) => c.key === editingKey) ?? null;
  const total = cartTotal(cart);
  const itemCount = cart.reduce((n, i) => n + i.quantity, 0);

  function addProduct(product: CatalogProduct) {
    const key = `${product.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setCart((prev) => [...prev, { key, product, quantity: 1, modifiers: [] }]);
    setSuccess(null);
    setError(null);
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + delta } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function toggleModifier(ingredientId: number, action: "ADD" | "REMOVE") {
    if (!editingItem) return;
    const recipe = (editingItem.product.recipe ?? []).find((r) => r.ingredient_id === ingredientId);
    if (!recipe?.is_modifiable) return;

    setCart((prev) =>
      prev.map((item) => {
        if (item.key !== editingItem.key) return item;
        const existing = item.modifiers.find((m) => m.ingredient_id === ingredientId);
        let modifiers: CartModifier[] = item.modifiers.filter(
          (m) => m.ingredient_id !== ingredientId,
        );

        if (existing?.action === action) {
          // toggle off
        } else {
          modifiers = [
            ...modifiers,
            {
              ingredient_id: ingredientId,
              name: recipe.name,
              action,
              extra_price: action === "ADD" ? recipe.extra_price : 0,
            },
          ];
        }
        return { ...item, modifiers };
      }),
    );
  }

  async function confirmPayment() {
    if (cart.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        user_id: auth.user_id,
        total_amount: total,
        payment_method: paymentMethod,
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: cartItemUnitPrice(item),
          modifiers: item.modifiers.map((m) => ({
            ingredient_id: m.ingredient_id,
            action: m.action.toLowerCase(),
            extra_price: m.extra_price,
          })),
        })),
      };

      const result = await api<{
        order_id: number;
        daily_number: number;
        message: string;
      }>("/orders", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setCart([]);
      setTicketOpen(false);
      setSuccess(`Orden #${result.daily_number} confirmada`);
      onOrderDone(result.order_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar");
    } finally {
      setBusy(false);
    }
  }

  /** Celular: 1er toque abre revisión; 2º toque (panel abierto) confirma la venta. */
  function onSellPress() {
    if (cart.length === 0 || busy) return;
    if (isPhone && !ticketOpen) {
      setTicketOpen(true);
      setError(null);
      return;
    }
    void confirmPayment();
  }

  function renderCartLines() {
    if (cart.length === 0) {
      return <p className="text-muted text-sm py-8 text-center">Sin productos</p>;
    }
    return cart.map((item) => (
      <div
        key={item.key}
        className="w-full text-left rounded-2xl border border-border p-3 hover:bg-surface"
      >
        <button
          type="button"
          onClick={() => setEditingKey(item.key)}
          className="w-full text-left"
        >
          <div className="flex justify-between gap-2">
            <p className="font-medium">{item.product.name}</p>
            <p className="font-semibold">{formatMoney(cartItemSubtotal(item))}</p>
          </div>
          {item.modifiers.length > 0 ? (
            <p className="text-xs text-muted mt-1">
              {item.modifiers
                .map((m) => (m.action === "REMOVE" ? `Sin ${m.name}` : `+ ${m.name}`))
                .join(" · ")}
            </p>
          ) : null}
        </button>
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="md"
            variant="secondary"
            className="!min-h-10 !px-3"
            onClick={() => updateQty(item.key, -1)}
          >
            −
          </Button>
          <span className="min-w-6 text-center font-medium">{item.quantity}</span>
          <Button
            size="md"
            variant="secondary"
            className="!min-h-10 !px-3"
            onClick={() => updateQty(item.key, 1)}
          >
            +
          </Button>
        </div>
      </div>
    ));
  }

  function renderPaymentControls(opts: { confirmLabel: string; showHint?: boolean }) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {(["efectivo", "tarjeta"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPaymentMethod(m)}
              className={`flex-1 min-h-11 rounded-2xl border capitalize ${
                paymentMethod === m
                  ? "bg-ink text-white border-ink"
                  : "bg-white border-border"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-end">
          <span className="text-muted">Total</span>
          <span className="text-3xl font-semibold tracking-tight">{formatMoney(total)}</span>
        </div>

        {opts.showHint ? (
          <p className="text-xs text-muted text-center">
            Revisa el pedido y vuelve a tocar para cobrar
          </p>
        ) : null}

        {error ? <p className="text-danger text-sm">{error}</p> : null}
        {success && !isPhone ? <p className="text-success text-sm">{success}</p> : null}

        <Button
          size="lg"
          className="w-full"
          disabled={cart.length === 0 || busy}
          onClick={() => onSellPress()}
        >
          {busy ? "Procesando…" : opts.confirmLabel}
        </Button>
      </div>
    );
  }

  const productGrid = (
    <section
      className={`flex-1 min-h-0 flex flex-col p-4 lg:p-6 ${isPhone ? "pb-28" : ""}`}
    >
      {printerAlert ? (
        <div className="mb-3 rounded-2xl border border-border bg-white px-4 py-3 text-sm text-muted animate-soft-pulse">
          {printerAlert}
        </div>
      ) : null}

      {success && isPhone ? (
        <p className="mb-3 text-success text-sm text-center">{success}</p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-4">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`min-h-11 px-4 rounded-2xl whitespace-nowrap border transition ${
              category === c
                ? "bg-ink text-white border-ink"
                : "bg-white border-border text-ink"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => addProduct(product)}
              className="min-h-[120px] rounded-[1.75rem] bg-white border border-border p-4 text-left hover:border-ink/30 active:scale-[0.98] transition animate-fade-up"
            >
              <p className="font-semibold text-base leading-tight">{product.name}</p>
              <p className="text-xs text-muted mt-1">{product.zone_name}</p>
              <p className="mt-4 text-lg font-semibold">{formatMoney(product.base_price)}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );

  const modifyModal = (
    <Modal
      open={Boolean(editingItem)}
      title={editingItem?.product.name ?? "Modificar"}
      onClose={() => setEditingKey(null)}
      footer={
        <Button className="w-full" size="lg" onClick={() => setEditingKey(null)}>
          Listo
        </Button>
      }
    >
      {editingItem ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Precio unitario: {formatMoney(cartItemUnitPrice(editingItem))}
          </p>
          {(editingItem.product.recipe ?? [])
            .filter((r) => r.is_modifiable)
            .map((r) => {
              const current = editingItem.modifiers.find(
                (m) => m.ingredient_id === r.ingredient_id,
              );
              return (
                <div
                  key={r.ingredient_id}
                  className="rounded-2xl border border-border p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      {r.extra_price > 0
                        ? `Extra +${formatMoney(r.extra_price)}`
                        : "Sin costo extra"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={current?.action === "REMOVE" ? "primary" : "secondary"}
                      onClick={() => toggleModifier(r.ingredient_id, "REMOVE")}
                    >
                      Sin
                    </Button>
                    <Button
                      variant={current?.action === "ADD" ? "primary" : "secondary"}
                      onClick={() => toggleModifier(r.ingredient_id, "ADD")}
                    >
                      Extra
                    </Button>
                  </div>
                </div>
              );
            })}
          {(editingItem.product.recipe ?? []).every((r) => !r.is_modifiable) ? (
            <p className="text-muted text-sm">Sin ingredientes modificables</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );

  // ——— Celular: catálogo a pantalla completa + barra + panel desplegable ———
  if (isPhone) {
    return (
      <div className="h-full flex flex-col relative">
        {productGrid}

        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTicketOpen(true)}
              className="flex-1 min-w-0 text-left rounded-2xl border border-border px-3 py-2 active:bg-surface"
            >
              <p className="text-xs text-muted">
                {itemCount === 0
                  ? "Pedido vacío"
                  : `${itemCount} ${itemCount === 1 ? "ítem" : "ítems"}`}
              </p>
              <p className="text-lg font-semibold tracking-tight truncate">
                {formatMoney(total)}
              </p>
            </button>
            <Button
              size="lg"
              className="shrink-0 min-w-[8.5rem]"
              disabled={cart.length === 0 || busy}
              onClick={() => onSellPress()}
            >
              {busy ? "…" : ticketOpen ? "Cobrar" : "Vender"}
            </Button>
          </div>
        </div>

        <BottomSheet
          open={ticketOpen}
          title="Pedido"
          subtitle="Toca un ítem para modificar · revisa y cobra"
          onClose={() => setTicketOpen(false)}
          footer={renderPaymentControls({
            confirmLabel: "Confirmar pago",
            showHint: true,
          })}
        >
          <div className="space-y-2 pb-2">{renderCartLines()}</div>
        </BottomSheet>

        {modifyModal}
      </div>
    );
  }

  // ——— Tablet / escritorio: layout de dos columnas (sin cambios de flujo) ———
  return (
    <div className="h-full flex flex-col lg:flex-row gap-0">
      {productGrid}

      <aside className="w-full lg:w-[380px] border-t lg:border-t-0 lg:border-l border-border bg-white flex flex-col max-h-[45%] lg:max-h-full">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">Ticket</h2>
          <p className="text-sm text-muted">Toca un ítem para modificar</p>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar px-5 space-y-2">
          {renderCartLines()}
        </div>

        <div className="p-5 border-t border-border">
          {renderPaymentControls({ confirmLabel: "Confirmar pago" })}
        </div>
      </aside>

      {modifyModal}
    </div>
  );
}
