import type { AuthState } from "./types";
import { CLIENT_VERSION } from "./lib/platform";
import {
  hydrateSecureStorage,
  storageGetSync,
  storageRemove,
  storageSet,
} from "./lib/secureStorage";

const API_PATH = "/api/v1";
const API_BASE_KEY = "lc_api_base";
const TOKEN_KEY = "lc_token";
const AUTH_KEY = "lc_auth";

export const AUTH_STORAGE_KEYS = [
  API_BASE_KEY,
  TOKEN_KEY,
  AUTH_KEY,
  "lc_device_id",
  "lc_node_role",
  "lc_trial_started_at",
];

/** Base del servidor sin /api/v1 (ej. http://192.168.1.10:8000). Vacío = same-origin. */
export function getApiBase(): string {
  return (storageGetSync(API_BASE_KEY) || "").replace(/\/$/, "");
}

export function setApiBase(base: string): void {
  const cleaned = base.trim().replace(/\/$/, "");
  if (cleaned) void storageSet(API_BASE_KEY, cleaned);
  else void storageRemove(API_BASE_KEY);
}

function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${API_PATH}${p}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return storageGetSync(TOKEN_KEY);
}

export function getStoredAuth(): AuthState | null {
  const raw = storageGetSync(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function storeAuth(auth: AuthState): void {
  void storageSet(TOKEN_KEY, auth.access_token);
  void storageSet(AUTH_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  void storageRemove(TOKEN_KEY);
  void storageRemove(AUTH_KEY);
}

export async function prepareApiStorage(): Promise<void> {
  await hydrateSecureStorage(AUTH_STORAGE_KEYS);
}

export interface ServerMeta {
  service: string;
  api_version: string;
  server_version: string;
  min_client_version: string;
  server_id: string;
  server_name: string;
  client_outdated: boolean;
  install_apk_path: string;
}

/** fetch con AbortController — evita “Conectando…” eterno fuera de la Wi‑Fi. */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 3500,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchMeta(base?: string): Promise<ServerMeta | null> {
  const root = (base ?? getApiBase()).replace(/\/$/, "");
  const url = `${root}${API_PATH}/meta?client_version=${encodeURIComponent(CLIENT_VERSION)}`;
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "GET", headers: { "X-Client-Version": CLIENT_VERSION } },
      3500,
    );
    if (!res.ok) return null;
    return (await res.json()) as ServerMeta;
  } catch {
    return null;
  }
}

export async function checkHealth(base?: string, timeoutMs = 3500): Promise<boolean> {
  const root = (base ?? getApiBase()).replace(/\/$/, "");
  const url = `${root}${API_PATH}/health`;
  try {
    const res = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Client-Version", CLIENT_VERSION);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetchWithTimeout(apiUrl(path), {
    ...options,
    headers,
  }, 20000);

  const data: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Error ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export function apkDownloadUrl(base?: string): string {
  const root = (base ?? getApiBase()).replace(/\/$/, "");
  return `${root}${API_PATH}/install/android.apk`;
}
