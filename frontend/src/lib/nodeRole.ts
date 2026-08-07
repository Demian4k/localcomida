import { Capacitor } from "@capacitor/core";
import { storageGetSync, storageRemove, storageSet } from "./secureStorage";

export type NodeRole = "primary" | "client";

const ROLE_KEY = "lc_node_role";

export function getStoredNodeRole(): NodeRole | null {
  const v = storageGetSync(ROLE_KEY);
  if (v === "primary" || v === "client") return v;
  return null;
}

export function storeNodeRole(role: NodeRole): void {
  void storageSet(ROLE_KEY, role);
}

export function clearNodeRole(): void {
  void storageRemove(ROLE_KEY);
}

/** El PC Electron es siempre el nodo de datos cuando corre ahí. */
export function defaultNodeRole(): NodeRole | null {
  if (Capacitor.isNativePlatform()) return null;
  // Web/Electron en el mismo origen del API → principal implícito
  return null;
}

export function isPrimaryNode(): boolean {
  return getStoredNodeRole() === "primary";
}
