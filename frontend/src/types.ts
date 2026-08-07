export type RoleName = "Administrador" | "Cajero";

export type IngredientUnit = "gramos" | "ml" | "unidades";

export interface RecipeIngredient {
  ingredient_id: number;
  name: string;
  is_modifiable: boolean;
  extra_price: number;
  quantity_required: number;
  unit: string;
}

export interface CatalogProduct {
  id: number;
  name: string;
  base_price: number;
  zone_id: number;
  zone_name: string;
  category: string;
  is_active?: boolean;
  recipe: RecipeIngredient[];
}

export interface CartModifier {
  ingredient_id: number;
  name: string;
  action: "ADD" | "REMOVE";
  extra_price: number;
}

export interface CartItem {
  key: string;
  product: CatalogProduct;
  quantity: number;
  modifiers: CartModifier[];
}

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  unit: IngredientUnit | string;
  current_stock: number;
  /** CLP por kg (si gramos), por L (si ml) o por unidad. */
  cost_per_unit: number;
  /** CLP por gramo / ml / unidad — calculado en API móvil; opcional en Express. */
  cost_per_base_unit?: number;
  /** "kg" | "l" | "unidad" — base de compra del costo. */
  cost_basis?: "kg" | "l" | "unidad" | string;
  low_stock_threshold: number;
  is_low: boolean;
}

/** Etiqueta de costo según unidad de medida. */
export function costLabelForUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (u === "gramos") return "Costo por kilo (CLP)";
  if (u === "ml") return "Costo por litro (CLP)";
  return "Costo por unidad (CLP)";
}

export function stockUnitSuffix(unit: string): string {
  const u = unit.toLowerCase();
  if (u === "gramos") return "g";
  if (u === "ml") return "ml";
  return "u";
}

/** CLP por unidad base de receta (g / ml / unidad). */
export function costPerBaseUnit(ing: Pick<Ingredient, "unit" | "cost_per_unit" | "cost_per_base_unit">): number {
  if (typeof ing.cost_per_base_unit === "number" && Number.isFinite(ing.cost_per_base_unit)) {
    return ing.cost_per_base_unit;
  }
  const u = String(ing.unit || "").toLowerCase();
  if (u === "gramos" || u === "ml") return (Number(ing.cost_per_unit) || 0) / 1000;
  return Number(ing.cost_per_unit) || 0;
}

export interface Printer {
  id: number;
  name: string;
  connection_type: string;
  address: string;
  zone_id: number | null;
  zone_name: string | null;
}

export interface Zone {
  id: number;
  name: string;
  products_count?: number;
  printers_count?: number;
  print_enabled?: boolean;
}

export interface ZoneDeletePreview {
  zone: { id: number; name: string };
  fallback_zone: { id: number; name: string };
  products_count: number;
  printers_count: number;
  is_caja_zone: boolean;
  /** Otra zona cuyo nombre incluye «caja»; presente si se puede borrar la actual. */
  caja_backup_zone: { id: number; name: string } | null;
}

export interface ScannedDevice {
  type: "USB" | "WIFI" | "ETHERNET";
  address: string;
  status: string;
  label?: string;
  port_name?: string;
  driver?: string;
}

export interface AuthState {
  access_token: string;
  role: RoleName;
  user_id: number;
  username: string;
}

export interface StoreSettings {
  name: string;
  address: string;
  optional_info: string;
  farewell_message: string;
}

export interface SaleSummary {
  id: number;
  daily_number: number;
  business_date: string;
  total_amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  cash_closing_id: number | null;
  sold_by: string;
}

export interface SaleDetail extends SaleSummary {
  items: {
    id: number;
    quantity: number;
    unit_price: number;
    subtotal: number;
    product_name: string;
    modifiers: {
      action: string;
      ingredient_name: string;
      price_adjustment: number;
      label: string;
    }[];
  }[];
}

export interface CashClosingCurrent {
  period_start: string | null;
  last_closing_id: number | null;
  orders_count: number;
  total_efectivo: number;
  total_tarjeta: number;
  total_other: number;
  total_amount: number;
  orders: {
    id: number;
    total_amount: number;
    payment_method: string;
    created_at: string;
    sold_by: string;
  }[];
}

export interface CashClosingHistory {
  id: number;
  closed_at: string;
  total_efectivo: number;
  total_tarjeta: number;
  total_other: number;
  total_amount: number;
  orders_count: number;
  period_start: string | null;
  closed_by: string;
}

export interface UserProfile {
  id: number;
  username: string;
  is_active: boolean;
  role_id: number;
  role: RoleName;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function cartItemUnitPrice(item: CartItem): number {
  const extras = item.modifiers
    .filter((m) => m.action === "ADD")
    .reduce((sum, m) => sum + m.extra_price, 0);
  return item.product.base_price + extras;
}

export function cartItemSubtotal(item: CartItem): number {
  return cartItemUnitPrice(item) * item.quantity;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + cartItemSubtotal(item), 0);
}
