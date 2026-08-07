import { TRIAL_DAYS } from "../lib/trial";

/** Pantalla bloqueante cuando termina la prueba de 20 días. */
export function TrialExpiredPage() {
  return (
    <div className="h-full flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md bg-white rounded-[2rem] border border-border p-8 space-y-5 text-center animate-fade-up">
        <p className="text-2xl font-semibold tracking-tight">Versión de prueba finalizada</p>
        <p className="text-base text-ink leading-relaxed">
          Muchas gracias por usar la versión de prueba. Para la versión completa contacta con el
          proveedor.
        </p>
        <p className="text-sm text-muted">
          Esta instalación dejó de funcionar tras {TRIAL_DAYS} días de uso.
        </p>
      </div>
    </div>
  );
}
