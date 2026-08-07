import { useEffect, useRef, useState } from "react";
import type { AuthState } from "../types";

export type ProfileAction =
  | "profiles"
  | "store"
  | "sales"
  | "cash-close"
  | "connect-tablets"
  | "logout";


interface Props {
  auth: AuthState;
  onAction: (action: ProfileAction) => void;
}

export function ProfileMenu({ auth, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isAdmin = auth.role === "Administrador";
  const label = auth.username || `Usuario #${auth.user_id}`;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items: { id: ProfileAction; label: string; adminOnly?: boolean; danger?: boolean }[] =
    [
      { id: "profiles", label: "Modificar perfiles", adminOnly: true },
      { id: "store", label: "Información del local", adminOnly: true },
      { id: "connect-tablets", label: "Conectar tablets", adminOnly: false },
      { id: "sales", label: "Ventas", adminOnly: true },
      { id: "cash-close", label: "Cierre de caja" },
      { id: "logout", label: "Salir", danger: true },
    ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 px-4 rounded-2xl border border-border bg-white text-sm font-medium hover:bg-surface flex items-center gap-2"
      >
        <span className="max-w-[140px] truncate">{label}</span>
        <span className="text-muted text-xs">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-64 rounded-[1.5rem] border border-border bg-white shadow-sm z-40 overflow-hidden animate-fade-up">
          <div className="px-4 py-3 border-b border-border">
            <p className="font-medium truncate">{label}</p>
            <p className="text-xs text-muted">{auth.role}</p>
          </div>
          <div className="p-2">
            {items
              .filter((i) => !i.adminOnly || isAdmin)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full text-left min-h-11 px-3 rounded-2xl text-sm hover:bg-surface ${
                    item.danger ? "text-danger" : ""
                  }`}
                  onClick={() => {
                    setOpen(false);
                    onAction(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
