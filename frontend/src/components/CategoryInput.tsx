import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./Button";

interface CategoryInputProps {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
}

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Mayor puntuación = mejor coincidencia con el texto escrito. */
function matchScore(category: string, query: string): number {
  const c = normalize(category);
  const q = normalize(query);
  if (!q) return 1;
  if (c === q) return 1000;
  if (c.startsWith(q)) return 800 - (c.length - q.length);
  const idx = c.indexOf(q);
  if (idx >= 0) return 600 - idx * 10 - Math.abs(c.length - q.length);

  // Coincidencia por prefijos de tokens / solapamiento de caracteres
  let shared = 0;
  let qi = 0;
  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] === q[qi]) {
      shared++;
      qi++;
    }
  }
  if (shared === 0) return 0;
  return Math.round((shared / q.length) * 200) - Math.abs(c.length - q.length);
}

function findExactExisting(categories: string[], value: string): string | null {
  const n = normalize(value);
  if (!n) return null;
  return categories.find((c) => normalize(c) === n) ?? null;
}

export function CategoryInput({
  value,
  onChange,
  categories,
  placeholder = "Escribe o elige una categoría…",
}: CategoryInputProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pendingNew, setPendingNew] = useState<string | null>(null);
  const knownRef = useRef(value);

  const uniqueCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const raw of categories) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = normalize(trimmed);
      if (!map.has(key)) map.set(key, trimmed);
    }
    return Array.from(map.values());
  }, [categories]);

  const suggestions = useMemo(() => {
    const scored = uniqueCategories
      .map((cat) => ({ cat, score: matchScore(cat, value) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.cat.localeCompare(b.cat, "es"));
    return scored.map((x) => x.cat);
  }, [uniqueCategories, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function selectCategory(cat: string) {
    onChange(cat);
    knownRef.current = cat;
    setOpen(false);
    setPendingNew(null);
  }

  function resolveOnCommit() {
    const trimmed = value.trim();
    if (!trimmed) return;

    const existing = findExactExisting(uniqueCategories, trimmed);
    if (existing) {
      if (existing !== value) onChange(existing);
      knownRef.current = existing;
      setOpen(false);
      return;
    }

    // Texto nuevo: confirmar creación
    setPendingNew(trimmed);
    setOpen(false);
  }

  function confirmCreate() {
    if (!pendingNew) return;
    onChange(pendingNew);
    knownRef.current = pendingNew;
    setPendingNew(null);
  }

  function cancelCreate() {
    const top = suggestions[0];
    if (top && normalize(top) !== normalize(pendingNew ?? "")) {
      onChange(top);
      knownRef.current = top;
    } else {
      onChange(knownRef.current);
    }
    setPendingNew(null);
  }

  return (
    <>
      <div ref={wrapRef} className="relative">
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="field-input"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            // Pequeño delay para permitir click en sugerencia
            window.setTimeout(() => {
              if (!wrapRef.current?.contains(document.activeElement)) {
                resolveOnCommit();
              }
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && suggestions[0] && normalize(suggestions[0]) === normalize(value)) {
                selectCategory(suggestions[0]);
              } else if (open && suggestions[0] && value.trim() && normalize(suggestions[0]).startsWith(normalize(value))) {
                selectCategory(suggestions[0]);
              } else {
                resolveOnCommit();
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "ArrowDown" && suggestions[0]) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />

        {open && suggestions.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 left-0 right-0 mt-2 max-h-56 overflow-y-auto hide-scrollbar rounded-2xl border border-border bg-white shadow-sm"
          >
            {suggestions.map((cat, index) => (
              <li key={cat} role="option" aria-selected={index === 0}>
                <button
                  type="button"
                  className={`w-full text-left min-h-11 px-4 text-sm hover:bg-surface ${
                    index === 0 ? "bg-surface/80 font-medium" : ""
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectCategory(cat)}
                >
                  {cat}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {open && value.trim() && suggestions.length === 0 ? (
          <div className="absolute z-20 left-0 right-0 mt-2 rounded-2xl border border-border bg-white px-4 py-3 text-sm text-muted shadow-sm">
            Sin coincidencias · al salir se pedirá confirmar la nueva categoría
          </div>
        ) : null}
      </div>

      {pendingNew ? (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Cerrar"
            onClick={cancelCreate}
          />
          <div className="relative w-full max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] shadow-sm animate-fade-up p-6">
            <h3 className="text-xl font-semibold tracking-tight mb-3">Nueva categoría</h3>
            <p className="text-sm text-muted leading-relaxed">
              La categoría{" "}
              <span className="text-ink font-medium">«{pendingNew}»</span> no existe.
              ¿Quieres crearla? Así evitas duplicados por tipografía distinta.
            </p>
            {suggestions[0] ? (
              <button
                type="button"
                className="mt-4 w-full min-h-11 rounded-2xl border border-border px-4 text-sm text-left hover:bg-surface"
                onClick={() => selectCategory(suggestions[0])}
              >
                Usar sugerencia: <span className="font-medium">{suggestions[0]}</span>
              </button>
            ) : null}
            <div className="flex gap-2 mt-5">
              <Button variant="secondary" className="flex-1" onClick={cancelCreate}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={confirmCreate}>
                Crear
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
