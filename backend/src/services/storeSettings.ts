import { db } from "../db.js";

export interface StoreSettings {
  name: string;
  address: string;
  optional_info: string;
  farewell_message: string;
}

export function getStoreSettings(): StoreSettings {
  const row = db
    .prepare(
      `SELECT name, address, optional_info, farewell_message FROM store_settings WHERE id = 1`,
    )
    .get() as StoreSettings | undefined;

  return (
    row ?? {
      name: "LocalComida",
      address: "",
      optional_info: "",
      farewell_message: "¡Gracias por su compra!",
    }
  );
}
