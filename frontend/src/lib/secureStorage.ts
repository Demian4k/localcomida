import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const memory = new Map<string, string>();

function useNativePrefs(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Lectura síncrona: localStorage + caché en memoria (Preferences se hidrata al boot). */
export function storageGetSync(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function storageGet(key: string): Promise<string | null> {
  if (useNativePrefs()) {
    const { value } = await Preferences.get({ key });
    if (value != null) {
      memory.set(key, value);
      try {
        localStorage.setItem(key, value);
      } catch {
        // ignore
      }
      return value;
    }
  }
  return storageGetSync(key);
}

export async function storageSet(key: string, value: string): Promise<void> {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  if (useNativePrefs()) {
    await Preferences.set({ key, value });
  }
}

export async function storageRemove(key: string): Promise<void> {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  if (useNativePrefs()) {
    await Preferences.remove({ key });
  }
}

/** Hidrata claves sensibles desde Preferences → localStorage/memoria al arrancar en Capacitor. */
export async function hydrateSecureStorage(keys: string[]): Promise<void> {
  if (!useNativePrefs()) return;
  await Promise.all(
    keys.map(async (key) => {
      const { value } = await Preferences.get({ key });
      if (value != null) {
        memory.set(key, value);
        try {
          localStorage.setItem(key, value);
        } catch {
          // ignore
        }
      }
    }),
  );
}
