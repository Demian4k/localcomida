import type { ConnectionType, PrintJob } from "../types.js";
import { EventEmitter } from "node:events";
import { printRaw } from "./printerHardware.js";

/**
 * Cola de impresión asíncrona.
 * Nunca bloquea el hilo de respuesta HTTP.
 * Envía ESC/POS real por TCP:9100 o spooler Windows (USB).
 */
class PrintQueue extends EventEmitter {
  private jobs: PrintJob[] = [];
  private processing = false;
  private alerts: { message: string; at: string }[] = [];

  enqueue(job: Omit<PrintJob, "id" | "status" | "createdAt">): PrintJob {
    const full: PrintJob = {
      ...job,
      id: `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.jobs.unshift(full);
    if (this.jobs.length > 100) this.jobs.length = 100;
    void this.processNext();
    return full;
  }

  getJobs(): PrintJob[] {
    return [...this.jobs];
  }

  getAlerts(): { message: string; at: string }[] {
    return [...this.alerts];
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  private pushAlert(message: string): void {
    this.alerts.unshift({ message, at: new Date().toISOString() });
    if (this.alerts.length > 20) this.alerts.length = 20;
    this.emit("alert", message);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const job = this.jobs.find((j) => j.status === "queued");
        if (!job) break;

        job.status = "printing";
        try {
          await this.sendToPrinter(job);
          job.status = "done";
        } catch (err) {
          const message = err instanceof Error ? err.message : "Error de impresión";
          job.status = "failed";
          job.error = message;
          this.pushAlert(`Impresora ${job.zoneName} fuera de línea — ${message}`);
          console.error(`[PRINT FAIL] zone=${job.zoneName} order=#${job.orderId}`, message);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async sendToPrinter(job: PrintJob): Promise<void> {
    if (!job.printerAddress) {
      throw new Error("Sin impresora asignada a la zona");
    }

    // Modo demo opcional (solo para desarrollo sin hardware)
    if (process.env.PRINT_DRY_RUN === "true") {
      console.log(
        `[PRINT DRY] zone=${job.zoneName} order=#${job.orderId} -> ${job.connectionType} ${job.printerAddress}`,
      );
      console.log(job.content.split("\n").map((l) => `  | ${l}`).join("\n"));
      return;
    }

    await printRaw(
      (job.connectionType ?? "USB") as ConnectionType,
      job.printerAddress,
      job.content,
    );

    console.log(
      `[PRINT OK] zone=${job.zoneName} order=#${job.orderId} -> ${job.connectionType} ${job.printerAddress}`,
    );
  }
}

export const printQueue = new PrintQueue();
