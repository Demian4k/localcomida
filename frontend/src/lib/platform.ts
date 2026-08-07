/** Versión del cliente embebido (APK / Electron UI). Debe alinearse con min_client_version del servidor. */
export const CLIENT_VERSION = "1.1.3";

export type ClientPlatform = "desktop" | "android" | "ios" | "web";

declare global {
  interface Window {
    electron?: unknown;
  }
}

export function getClientPlatform(): ClientPlatform {
  try {
    // Capacitor injects this when running inside the native shell
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } })
      .Capacitor;
    const p = cap?.getPlatform?.();
    if (p === "android") return "android";
    if (p === "ios") return "ios";
  } catch {
    // ignore
  }

  if (typeof window !== "undefined" && window.electron) return "desktop";

  // Electron BrowserWindow loading localhost without preload flag
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Electron/i.test(ua)) return "desktop";

  return "web";
}

export function isNativeMobile(): boolean {
  const p = getClientPlatform();
  return p === "android" || p === "ios";
}

export function isDesktopShell(): boolean {
  return getClientPlatform() === "desktop";
}
