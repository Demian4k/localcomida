import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface ReadyItem {
  id: number;
  daily_number: number;
  zone_id: number;
  zone_name: string;
  ready_at: string;
}

interface ToastMsg {
  key: string;
  text: string;
}

/**
 * Aviso breve abajo-izquierda cuando una estación marca una encomienda lista.
 * Poll de ready-feed; cada aviso dura ~1s con fade.
 */
export function ReadyToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [visible, setVisible] = useState(false);
  const sinceRef = useRef(new Date().toISOString().replace("T", " ").slice(0, 19));
  const queueRef = useRef<ToastMsg[]>([]);
  const showingRef = useRef(false);

  useEffect(() => {
    function showNext() {
      if (showingRef.current) return;
      const next = queueRef.current.shift();
      if (!next) return;
      showingRef.current = true;
      setToast(next);
      setVisible(true);
      window.setTimeout(() => {
        setVisible(false);
        window.setTimeout(() => {
          setToast(null);
          showingRef.current = false;
          showNext();
        }, 280);
      }, 1000);
    }

    const id = window.setInterval(() => {
      void api<{ items: ReadyItem[] }>(
        `/stations/ready-feed?since=${encodeURIComponent(sinceRef.current)}`,
      )
        .then((res) => {
          if (!res?.items?.length) return;
          for (const item of res.items) {
            queueRef.current.push({
              key: `${item.id}-${item.ready_at}`,
              text: `Orden #${item.daily_number} · ${item.zone_name || "estación"} lista`,
            });
            if (item.ready_at > sinceRef.current) {
              sinceRef.current = item.ready_at;
            }
          }
          showNext();
        })
        .catch(() => undefined);
    }, 1500);

    return () => window.clearInterval(id);
  }, []);

  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 pointer-events-none transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="rounded-2xl border border-border bg-white px-4 py-3 shadow-sm text-sm font-medium">
        {toast.text}
      </div>
    </div>
  );
}
