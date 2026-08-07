import { storageGetSync, storageSet } from "./secureStorage";

const TRIAL_START_KEY = "lc_trial_started_at";
export const TRIAL_DAYS = 20;

/** Compilada solo en builds de prueba (`VITE_TRIAL=1`). La versión completa no incluye el candado. */
export function isTrialBuild(): boolean {
  return import.meta.env.VITE_TRIAL === "1" || import.meta.env.VITE_TRIAL === "true";
}

export function getTrialStartMs(): number | null {
  const raw = storageGetSync(TRIAL_START_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Registra el primer uso si aún no hay fecha. */
export function ensureTrialStarted(): number {
  const existing = getTrialStartMs();
  if (existing) return existing;
  const now = Date.now();
  void storageSet(TRIAL_START_KEY, String(now));
  return now;
}

export function getTrialDaysRemaining(now = Date.now()): number | null {
  if (!isTrialBuild()) return null;
  const start = getTrialStartMs() ?? now;
  const elapsed = now - start;
  const remainingMs = TRIAL_DAYS * 24 * 60 * 60 * 1000 - elapsed;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

export function isTrialExpired(now = Date.now()): boolean {
  if (!isTrialBuild()) return false;
  const start = getTrialStartMs();
  if (!start) return false;
  return now - start >= TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

export const TRIAL_STORAGE_KEYS = [TRIAL_START_KEY];
