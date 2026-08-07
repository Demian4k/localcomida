import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Altura del panel (por defecto ~88% de la pantalla). */
  heightClass?: string;
}

/** Panel inferior a pantalla casi completa — pensado para editar el ticket en celular. */
export function BottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  heightClass = "h-[88vh]",
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${heightClass} max-h-[92vh] bg-white rounded-t-[1.75rem] shadow-sm flex flex-col animate-fade-up`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="text-sm text-muted mt-0.5">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-2xl hover:bg-surface text-muted shrink-0"
            aria-label="Cerrar panel"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-5 pb-2">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-border bg-white">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
