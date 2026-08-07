import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-white rounded-t-[2rem] sm:rounded-[2rem] shadow-sm animate-fade-up max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-2xl hover:bg-surface text-muted"
          >
            ✕
          </button>
        </div>
        <div className="px-6 pb-4 overflow-y-auto hide-scrollbar flex-1">{children}</div>
        {footer ? <div className="px-6 pb-6 pt-2 border-t border-border">{footer}</div> : null}
      </div>
    </div>
  );
}
