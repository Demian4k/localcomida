import os from "node:os";

export interface NetworkInfo {
  port: number;
  urls: string[];
  primary_url: string | null;
  addresses: { address: string; iface: string }[];
}

/** IPs LAN privadas del host para que tablets se conecten. */
export function getNetworkInfo(port: number): NetworkInfo {
  const addresses: { address: string; iface: string }[] = [];
  const ifaces = os.networkInterfaces();

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const a = entry.address;
      if (
        a.startsWith("10.") ||
        a.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(a)
      ) {
        addresses.push({ address: a, iface: name });
      }
    }
  }

  // Preferir 192.168.* (Wi‑Fi doméstica/local típica)
  addresses.sort((x, y) => {
    const score = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
    return score(x.address) - score(y.address);
  });

  const urls = addresses.map((a) => `http://${a.address}:${port}`);
  return {
    port,
    urls,
    primary_url: urls[0] ?? null,
    addresses,
  };
}
