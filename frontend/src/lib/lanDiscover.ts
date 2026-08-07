/**
 * Descubrimiento local sin escribir IP:
 * 1) WebRTC para obtener la IP Wi‑Fi de este dispositivo
 * 2) Barrido rápido del segmento .1–.254 al puerto 8000 /health
 */
export async function getLocalIpv4(): Promise<string | null> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const ip = await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => {
        pc.close();
        resolve(null);
      }, 2500);

      pc.onicecandidate = (ev) => {
        const cand = ev.candidate?.candidate;
        if (!cand) return;
        const m = cand.match(
          /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/,
        );
        if (!m) return;
        const addr = m[1];
        if (
          addr.startsWith("10.") ||
          addr.startsWith("192.168.") ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)
        ) {
          window.clearTimeout(timer);
          pc.close();
          resolve(addr);
        }
      };
    });
    return ip;
  } catch {
    return null;
  }
}

export interface DiscoveredServer {
  url: string;
  address: string;
}

async function probeHost(ip: string, port: number, timeoutMs = 350): Promise<DiscoveredServer | null> {
  const url = `http://${ip}:${port}`;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/v1/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; service?: string };
    if (data.status === "ok" && data.service === "localcomida-pos") {
      return { url, address: ip };
    }
  } catch {
    // ignore
  } finally {
    window.clearTimeout(t);
  }
  return null;
}

/** Busca servidores LocalComida en la misma Wi‑Fi (puerto 8000). */
export async function discoverLocalServers(
  port = 8000,
  onProgress?: (found: number) => void,
): Promise<DiscoveredServer[]> {
  const localIp = await getLocalIpv4();
  const bases = new Set<string>();

  if (localIp) {
    const parts = localIp.split(".");
    bases.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
  }

  // Si no hay IP local, no podemos barrer; devolver vacío
  if (bases.size === 0) return [];

  const hosts: string[] = [];
  for (const base of bases) {
    // Priorizar IPs típicas de router/host + muestreo denso
    const preferred = [1, 2, 3, 4, 5, 10, 20, 50, 100, 101, 150, 200];
    for (const h of preferred) hosts.push(`${base}.${h}`);
    for (let h = 1; h <= 254; h++) {
      if (!preferred.includes(h)) hosts.push(`${base}.${h}`);
    }
  }

  // No probar la propia IP primero de forma especial — ok incluirla
  const found: DiscoveredServer[] = [];
  const seen = new Set<string>();
  const concurrency = 40;

  for (let i = 0; i < hosts.length; i += concurrency) {
    const slice = hosts.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((ip) => probeHost(ip, port)));
    for (const r of results) {
      if (r && !seen.has(r.url)) {
        seen.add(r.url);
        found.push(r);
        onProgress?.(found.length);
      }
    }
    // Si ya encontramos al menos uno en los primeros bloques, podemos cortar temprano
    // pero seguimos un poco más por si hay varios hosts
    if (found.length > 0 && i > 80) break;
  }

  return found;
}
