export type RoleName = "Administrador" | "Cajero";

export type ConnectionType = "USB" | "WIFI" | "ETHERNET";

export type OrderStatus = "PREPARING" | "DELIVERED" | "CANCELLED";

export type ModifierAction = "ADD" | "REMOVE";

export type AdjustmentType = "add" | "subtract";

export interface JwtPayload {
  userId: number;
  role: RoleName;
  username: string;
}

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

export interface OrderModifierInput {
  ingredient_id: number;
  action: "add" | "remove" | "ADD" | "REMOVE";
  extra_price?: number;
  quantity_changed?: number;
}

export interface OrderItemInput {
  product_id: number;
  quantity: number;
  unit_price: number;
  modifiers: OrderModifierInput[];
}

export interface CreateOrderInput {
  user_id: number;
  total_amount: number;
  payment_method: string;
  items: OrderItemInput[];
}

export interface PrintJob {
  id: string;
  zoneId: number;
  zoneName: string;
  orderId: number;
  printerAddress: string | null;
  connectionType: ConnectionType | null;
  content: string;
  status: "queued" | "printing" | "done" | "failed";
  error?: string;
  createdAt: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};
