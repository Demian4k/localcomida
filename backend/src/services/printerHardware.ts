import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import type { ConnectionType } from "../types.js";

const execFileAsync = promisify(execFile);

export interface DetectedPrinter {
  type: "USB" | "WIFI" | "ETHERNET";
  address: string;
  status: "online";
  label?: string;
  port_name?: string;
  driver?: string;
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  return false;
}

function probePort(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isPrivateIp(host)) {
      resolve(false);
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function looksLikeThermal(name: string, driver: string, port: string): boolean {
  const hay = `${name} ${driver} ${port}`.toLowerCase();
  const keywords = [
    "epson",
    "tm-",
    "tm ",
    "thermal",
    "receipt",
    "pos-",
    " pos",
    "ticket",
    "zebra",
    "star ",
    "citizen",
    "bixolon",
    "rongta",
    "xprinter",
    "gprinter",
    "escpos",
    "esc/pos",
    "kitchen",
    "comanda",
    "boleta",
  ];
  if (keywords.some((k) => hay.includes(k))) return true;
  if (/^usb\d+/i.test(port)) return true;
  if (/^com\d+/i.test(port)) return true;
  return false;
}

function isVirtualPrinter(name: string, driver: string): boolean {
  const hay = `${name} ${driver}`.toLowerCase();
  const virtual = [
    "microsoft print to pdf",
    "onenote",
    "fax",
    "xps",
    "onedrive",
    "adobe pdf",
    "send to onenote",
    "microsoft ips",
    "anydesk",
    "cutepdf",
    "doPDF".toLowerCase(),
  ];
  return virtual.some((v) => hay.includes(v));
}

async function runPowerShell(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

/** Impresoras USB / instaladas en Windows (spooler). */
export async function scanWindowsPrinters(): Promise<DetectedPrinter[]> {
  if (process.platform !== "win32") return [];

  try {
    const json = await runPowerShell(
      `$ErrorActionPreference='SilentlyContinue'; Get-Printer | Select-Object Name,PortName,DriverName,PrinterStatus | ConvertTo-Json -Compress`,
    );
    if (!json) return [];

    const parsed = JSON.parse(json) as
      | {
          Name?: string;
          PortName?: string;
          DriverName?: string;
          PrinterStatus?: number | string;
        }
      | {
          Name?: string;
          PortName?: string;
          DriverName?: string;
          PrinterStatus?: number | string;
        }[];

    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const found: DetectedPrinter[] = [];

    for (const row of rows) {
      const name = (row.Name ?? "").trim();
      const port = (row.PortName ?? "").trim();
      const driver = (row.DriverName ?? "").trim();
      if (!name) continue;
      if (isVirtualPrinter(name, driver)) continue;

      const isTcp =
        /^(IP_|WSD|TCP|PORTPROMPT)/i.test(port) || /\d+\.\d+\.\d+\.\d+/.test(port);

      if (isTcp) {
        const ipMatch = port.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch && isPrivateIp(ipMatch[1])) {
          found.push({
            type: "WIFI",
            address: `${ipMatch[1]}:9100`,
            status: "online",
            label: name,
            port_name: port,
            driver,
          });
          continue;
        }
      }

      // USB, COM, WSD sin IP parseable, o cualquier impresora instalada en el spooler
      const thermal = looksLikeThermal(name, driver, port);
      found.push({
        type: "USB",
        address: `WINPRINTER:${name}`,
        status: "online",
        label: thermal ? `${name} (posible termica/POS)` : name,
        port_name: port || undefined,
        driver: driver || undefined,
      });
    }

    return found;
  } catch (err) {
    console.warn("[hardware] scanWindowsPrinters:", err);
    return [];
  }
}

async function collectArpNeighbors(): Promise<string[]> {
  const hosts: string[] = [];

  if (process.platform === "win32") {
    try {
      const json = await runPowerShell(
        `$ErrorActionPreference='SilentlyContinue'; Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -in @('Reachable','Permanent','Stale') } | Select-Object -ExpandProperty IPAddress | ConvertTo-Json -Compress`,
      );
      if (json) {
        const parsed = JSON.parse(json) as string | string[];
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const ip of list) {
          if (typeof ip === "string" && isPrivateIp(ip) && !ip.endsWith(".255")) {
            hosts.push(ip);
          }
        }
      }
    } catch {
      // ignore
    }
    return hosts;
  }

  // Linux / macOS: `ip neigh` o `arp -an`
  try {
    const { stdout } = await execFileAsync("ip", ["neigh"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    for (const m of stdout.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)) {
      if (isPrivateIp(m[1]) && !m[1].endsWith(".255")) hosts.push(m[1]);
    }
  } catch {
    try {
      const { stdout } = await execFileAsync("arp", ["-an"], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      for (const m of stdout.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)) {
        if (isPrivateIp(m[1]) && !m[1].endsWith(".255")) hosts.push(m[1]);
      }
    } catch {
      // ignore
    }
  }

  return hosts;
}

/** Hosts candidatos desde ARP + subred local (solo LAN privada). */
async function collectNetworkCandidates(): Promise<string[]> {
  const hosts = new Set<string>(await collectArpNeighbors());

  // Subredes de interfaces locales (muestreo + conocidos)
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal || !isPrivateIp(entry.address)) continue;
      const parts = entry.address.split(".").map(Number);
      const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
      // Muestreo rápido de IPs típicas POS + gateway .1
      const sample = [
        1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 70, 80,
        90, 100, 101, 102, 103, 104, 105, 110, 120, 150, 200, 210, 220, 230, 250,
      ];
      for (const h of sample) {
        hosts.add(`${base}.${h}`);
      }
    }
  }

  return [...hosts].filter((ip) => isPrivateIp(ip));
}

/** Dispositivos USB térmicos + colas CUPS en Linux / macOS. */
export async function scanUnixPrinters(): Promise<DetectedPrinter[]> {
  if (process.platform === "win32") return [];

  const found: DetectedPrinter[] = [];
  const seen = new Set<string>();

  const addUsbPath = (filePath: string, label?: string) => {
    const key = filePath.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      type: "USB",
      address: filePath,
      status: "online",
      label: label ?? path.basename(filePath),
    });
  };

  const usbGlobs =
    process.platform === "darwin"
      ? ["/dev/cu.usb*", "/dev/tty.usb*"]
      : ["/dev/usb/lp*", "/dev/ttyUSB*", "/dev/ttyACM*"];

  for (const pattern of usbGlobs) {
    const dir = path.dirname(pattern);
    const prefix = path.basename(pattern).replace(/\*$/, "");
    try {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(prefix) && prefix) continue;
        if (pattern.includes("*") && !name.startsWith(prefix)) continue;
        addUsbPath(path.join(dir, name), `USB ${name}`);
      }
    } catch {
      // ignore
    }
  }

  // CUPS: lpstat -v → device for URI
  try {
    const { stdout } = await execFileAsync("lpstat", ["-v"], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
    });
    for (const line of stdout.split("\n")) {
      // device for XYZ: usb://...
      const m = line.match(/device for\s+(.+?):\s+(\S+)/i);
      if (!m) continue;
      const name = m[1].trim();
      const uri = m[2].trim();
      if (/pdf|file:|ipp:\/\/localhost/i.test(uri)) continue;

      if (uri.startsWith("usb:") || uri.startsWith("/dev/")) {
        const address = uri.startsWith("/dev/") ? uri : `CUPS:${name}`;
        if (seen.has(address.toLowerCase())) continue;
        seen.add(address.toLowerCase());
        found.push({
          type: "USB",
          address,
          status: "online",
          label: name,
          port_name: uri,
        });
      } else if (/socket:\/\/(\d+\.\d+\.\d+\.\d+)/i.test(uri) || /ipp:\/\/(\d+\.\d+\.\d+\.\d+)/i.test(uri)) {
        const ip = uri.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
        if (ip && isPrivateIp(ip)) {
          const address = `${ip}:9100`;
          if (seen.has(address.toLowerCase())) continue;
          seen.add(address.toLowerCase());
          found.push({
            type: "WIFI",
            address,
            status: "online",
            label: name,
            port_name: uri,
          });
        }
      } else {
        const address = `CUPS:${name}`;
        if (seen.has(address.toLowerCase())) continue;
        seen.add(address.toLowerCase());
        found.push({
          type: "USB",
          address,
          status: "online",
          label: name,
          port_name: uri,
        });
      }
    }
  } catch {
    // CUPS no instalado
  }

  return found;
}

export async function scanSystemPrinters(): Promise<DetectedPrinter[]> {
  if (process.platform === "win32") return scanWindowsPrinters();
  return scanUnixPrinters();
}

/** Escaneo TCP puerto 9100 (ESC/POS raw). */
export async function scanNetworkEscPos(
  extraHosts: string[] = [],
): Promise<DetectedPrinter[]> {
  const candidates = new Set(await collectNetworkCandidates());
  for (const h of extraHosts) {
    if (isPrivateIp(h)) candidates.add(h);
  }

  const list = [...candidates];
  const found: DetectedPrinter[] = [];
  const concurrency = 40;

  for (let i = 0; i < list.length; i += concurrency) {
    const slice = list.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (ip) => {
        const open = await probePort(ip, 9100, 280);
        return open ? ip : null;
      }),
    );
    for (const ip of results) {
      if (ip) {
        found.push({
          type: "WIFI",
          address: `${ip}:9100`,
          status: "online",
          label: `ESC/POS ${ip}`,
        });
      }
    }
  }

  return found;
}

export async function scanAllPrinters(knownNetworkHosts: string[] = []): Promise<DetectedPrinter[]> {
  const [usb, netFound] = await Promise.all([
    scanSystemPrinters(),
    scanNetworkEscPos(knownNetworkHosts),
  ]);

  const map = new Map<string, DetectedPrinter>();
  for (const d of [...usb, ...netFound]) {
    const key = `${d.type}|${d.address.toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
    } else if (!prev.label && d.label) {
      map.set(key, d);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.label ?? a.address).localeCompare(b.label ?? b.address, "es");
  });
}

/** Codifica texto de ticket a bytes ESC/POS (Epson-compatible). */
export function encodeEscPos(text: string): Buffer {
  const chunks: Buffer[] = [];
  // Init
  chunks.push(Buffer.from([0x1b, 0x40]));
  // Code page PC858 (Euro/Latin) — ESC t n
  chunks.push(Buffer.from([0x1b, 0x74, 19]));
  // Align left
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = iconv.encode(normalized.endsWith("\n") ? normalized : `${normalized}\n`, "cp858");
  chunks.push(body);

  // Feed + partial cut
  chunks.push(Buffer.from([0x0a, 0x0a, 0x0a]));
  chunks.push(Buffer.from([0x1d, 0x56, 0x01]));

  return Buffer.concat(chunks);
}

function parseNetworkAddress(address: string): { host: string; port: number } | null {
  const cleaned = address.replace(/^tcp:\/\//i, "").trim();
  const [host, portStr] = cleaned.split(":");
  if (!host || !isPrivateIp(host)) return null;
  const port = portStr ? Number(portStr) : 9100;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

async function printViaTcp(address: string, data: Buffer): Promise<void> {
  const parsed = parseNetworkAddress(address);
  if (!parsed) throw new Error("Dirección de red inválida (solo IP privada)");

  await new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(8000);
    socket.once("timeout", () => finish(new Error("Timeout de red al imprimir")));
    socket.once("error", (err) => finish(err));
    socket.connect(parsed.port, parsed.host, () => {
      socket.write(data, (err) => {
        if (err) {
          finish(err);
          return;
        }
        socket.end(() => finish());
      });
    });
  });
}

/** Impresión directa a nodo USB (/dev/usb/lp0, /dev/ttyUSB0, …). */
async function printViaUsbDevice(devicePath: string, data: Buffer): Promise<void> {
  if (!devicePath.startsWith("/dev/")) {
    throw new Error("Ruta de dispositivo USB inválida");
  }
  if (!fs.existsSync(devicePath)) {
    throw new Error(`Dispositivo no encontrado: ${devicePath}`);
  }
  await fs.promises.writeFile(devicePath, data);
}

/** Impresión via cola CUPS (lpr -o raw). */
async function printViaCups(printerName: string, data: Buffer): Promise<void> {
  const tmp = path.join(os.tmpdir(), `localcomida-ticket-${Date.now()}-${process.pid}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    await execFileAsync("lpr", ["-P", printerName, "-o", "raw", tmp], {
      timeout: 15000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Impresión CUPS falló: ${message}`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/** Impresión raw al spooler de Windows (USB / driver instalado). */
async function printViaWindowsPrinter(printerName: string, data: Buffer): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Impresión por spooler Windows no disponible en este sistema");
  }

  const tmp = path.join(os.tmpdir(), `localcomida-ticket-${Date.now()}-${process.pid}.bin`);
  fs.writeFileSync(tmp, data);

  const psScript = `
$ErrorActionPreference = 'Stop'
$printerName = @'
${printerName.replace(/'/g, "''")}
'@
$filePath = @'
${tmp.replace(/'/g, "''")}
'@
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "LocalComida Ticket";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        try {
          IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
          Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
          int written;
          bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
          Marshal.FreeCoTaskMem(pUnmanagedBytes);
          return ok;
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
if (-not $ok) { throw "WritePrinter falló para '$printerName' (¿driver RAW/ESC-POS?)" }
`;

  try {
    await runPowerShell(psScript);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Impresora USB/Windows no respondió: ${message}`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export async function printRaw(
  connectionType: ConnectionType | string,
  address: string,
  content: string,
): Promise<void> {
  if (!address?.trim()) {
    throw new Error("Sin impresora asignada a la zona");
  }

  const data = encodeEscPos(content);
  const type = connectionType.toUpperCase();
  const addr = address.trim();

  if (type === "WIFI" || type === "ETHERNET" || /^(\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(addr)) {
    await printViaTcp(addr, data);
    return;
  }

  if (addr.toUpperCase().startsWith("WINPRINTER:")) {
    await printViaWindowsPrinter(addr.slice("WINPRINTER:".length), data);
    return;
  }

  if (addr.toUpperCase().startsWith("CUPS:")) {
    await printViaCups(addr.slice("CUPS:".length), data);
    return;
  }

  if (addr.startsWith("/dev/")) {
    await printViaUsbDevice(addr, data);
    return;
  }

  if (type === "USB") {
    if (process.platform === "win32") {
      await printViaWindowsPrinter(addr.replace(/^USB:/i, ""), data);
      return;
    }
    if (addr.startsWith("/dev/")) {
      await printViaUsbDevice(addr, data);
      return;
    }
    await printViaCups(addr.replace(/^USB:/i, ""), data);
    return;
  }

  throw new Error(`Tipo de conexión no soportado: ${connectionType}`);
}

export { isPrivateIp, parseNetworkAddress };
