import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./Button";
import { Modal } from "./Modal";
import type { RoleName, UserProfile } from "../types";

interface RoleRow {
  id: number;
  name: RoleName;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const emptyForm = {
  username: "",
  pin: "",
  role_id: "",
  is_active: true,
};

export function ProfilesPanel({ open, onClose }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [u, r] = await Promise.all([
      api<UserProfile[]>("/users"),
      api<RoleRow[]>("/users/roles"),
    ]);
    setUsers(u);
    setRoles(r);
  }

  useEffect(() => {
    if (!open) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Error al cargar perfiles");
    });
  }, [open]);

  function openCreate() {
    setCreating(true);
    setEditing(null);
    const cashier = roles.find((r) => r.name === "Cajero") ?? roles[0];
    setForm({
      ...emptyForm,
      role_id: cashier ? String(cashier.id) : "",
    });
    setError(null);
  }

  function openEdit(user: UserProfile) {
    setCreating(false);
    setEditing(user);
    setForm({
      username: user.username,
      pin: "",
      role_id: String(user.role_id),
      is_active: user.is_active,
    });
    setError(null);
  }

  async function save() {
    if (!form.username.trim() || !form.role_id) {
      setError("Usuario y rol son obligatorios");
      return;
    }
    if (creating && form.pin.length < 4) {
      setError("PIN mínimo 4 dígitos");
      return;
    }
    if (form.pin && !/^\d{4,12}$/.test(form.pin)) {
      setError("PIN inválido (4-12 dígitos)");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (creating) {
        await api("/users", {
          method: "POST",
          body: JSON.stringify({
            username: form.username.trim(),
            pin: form.pin,
            role_id: Number(form.role_id),
            is_active: form.is_active,
          }),
        });
      } else if (editing) {
        await api(`/users/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            username: form.username.trim(),
            pin: form.pin || "",
            role_id: Number(form.role_id),
            is_active: form.is_active,
          }),
        });
      }
      setCreating(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || Boolean(editing);

  return (
    <>
      <Modal
        open={open && !formOpen}
        title="Perfiles"
        onClose={onClose}
        footer={
          <Button size="lg" className="w-full" onClick={openCreate}>
            Nuevo perfil
          </Button>
        }
      >
        {error ? <p className="text-danger text-sm mb-3">{error}</p> : null}
        <p className="text-sm text-muted mb-3">
          Usuarios que pueden entrar a la caja. El administrador configura el local; el cajero solo vende.
        </p>
        <div className="space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => openEdit(u)}
              className="w-full text-left rounded-2xl border border-border p-3 hover:bg-surface"
            >
              <div className="flex justify-between gap-2">
                <p className="font-medium">{u.username}</p>
                <p className={`text-xs ${u.is_active ? "text-success" : "text-muted"}`}>
                  {u.is_active ? "Activo" : "Inactivo"}
                </p>
              </div>
              <p className="text-xs text-muted mt-1">{u.role}</p>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={formOpen}
        title={creating ? "Nuevo perfil" : `Editar · ${editing?.username ?? ""}`}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        footer={
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted">Usuario</label>
            <input
              className="field-input mt-1"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm text-muted">
              {creating ? "PIN" : "Nuevo PIN (opcional)"}
            </label>
            <input
              className="field-input mt-1"
              type="password"
              inputMode="numeric"
              value={form.pin}
              onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
              placeholder={creating ? "4-12 dígitos" : "Dejar vacío para no cambiar"}
            />
          </div>
          <div>
            <label className="text-sm text-muted">Rol</label>
            <select
              className="field-input mt-1"
              value={form.role_id}
              onChange={(e) => setForm((f) => ({ ...f, role_id: e.target.value }))}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 min-h-11">
            <input
              type="checkbox"
              className="size-5"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            <span className="text-sm">Perfil activo</span>
          </label>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
