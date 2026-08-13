// UsersAdminView.jsx — Administración de usuarios (solo visible para admins,
// App.jsx la gatea con currentUser.esAdmin). Mismo patrón que QuartersView.jsx/
// ReportesView.jsx: consulta al backend por su cuenta (loadUsers/createUser/
// updateUser en utils/storage.js), sin depender del estado global de
// proyectos — las credenciales no viven en data.json/localStorage.
//
// Sin endpoint de auto-registro (ver create-user.cjs): esta pantalla es el
// único lugar para dar de alta usuarios además de ese script — y solo es
// alcanzable ya siendo admin.

import { useState, useEffect } from "react";
import { loadUsers, createUser, updateUser } from "../utils/storage";

function emptyDraft() {
  return { username: "", name: "", email: "", password: "", ingenieroId: "", esAdmin: false };
}

// Formulario de alta — todos los campos en un solo draft, confirma con el
// botón (no con Enter suelto por campo: hay demasiados campos para que
// Enter en "usuario" dispare el submit antes de llenar el resto).
function NewUserForm({ engineers, onConfirm, onCancel }) {
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field) => (e) => setDraft(d => ({ ...d, [field]: e.target.value }));

  // Autocompleta "Nombre completo" con el nombre del ingeniero elegido —
  // son dos campos independientes (el desplegable solo VINCULA la cuenta al
  // catálogo, no llena el nombre) y sin esto era fácil creer que ya estaba
  // lleno, elegir el ingeniero y llevarse el error de "nombre obligatorio"
  // con el campo vacío sin darse cuenta. Solo autocompleta si el nombre
  // sigue vacío — si el admin ya escribió algo a mano, no se lo pisa.
  const handleEngineerChange = (e) => {
    const ingenieroId = e.target.value;
    setDraft(d => {
      const selected = engineers.find(en => String(en.sql_id) === ingenieroId);
      const shouldAutofill = selected && !d.name.trim();
      return { ...d, ingenieroId, name: shouldAutofill ? selected.name : d.name };
    });
  };

  const confirm = async () => {
    if (!draft.username.trim() || !draft.name.trim() || !draft.password) {
      setError("Usuario, nombre y contraseña son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm({
        username: draft.username.trim(), name: draft.name.trim(), email: draft.email.trim(),
        password: draft.password, ingenieroId: draft.ingenieroId ? Number(draft.ingenieroId) : null,
        esAdmin: draft.esAdmin,
      });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="project-card" style={{ marginBottom: 16 }}>
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">Nuevo usuario</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input className="field__input" placeholder="Usuario (para iniciar sesión)…" value={draft.username} onChange={set("username")} autoFocus />
        <input className="field__input" placeholder="Nombre completo…" value={draft.name} onChange={set("name")} />
        <input className="field__input" placeholder="Correo (opcional)…" value={draft.email} onChange={set("email")} />
        <input className="field__input" type="password" placeholder="Contraseña (mín. 8 caracteres)…" value={draft.password} onChange={set("password")} />
        <select className="field__input" value={draft.ingenieroId} onChange={handleEngineerChange}>
          <option value="">Sin ingeniero vinculado</option>
          {engineers.map(e => <option key={e.id} value={e.sql_id || ""} disabled={!e.sql_id}>{e.name}{!e.sql_id ? " (sin sincronizar con SQL)" : ""}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={draft.esAdmin} onChange={e => setDraft(d => ({ ...d, esAdmin: e.target.checked }))} />
          Administrador
        </label>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
      <div className="project-card__actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn--accent" disabled={saving} onClick={confirm}>{saving ? "Guardando…" : "Crear usuario"}</button>
        <button type="button" className="btn btn--card-report" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );
}

// Fila de edición — vínculo/rol/activo/reseteo de contraseña de un usuario
// existente. NombreUsuario no es editable aquí a propósito: es la clave de
// login, cambiarla es un caso raro que amerita ir directo a SQL.
function UserRow({ user, engineers, onSave }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [ingenieroId, setIngenieroId] = useState(user.ingenieroId ? String(user.ingenieroId) : "");
  const [esAdmin, setEsAdmin] = useState(user.esAdmin);
  const [active, setActive] = useState(user.active);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const engineerName = engineers.find(e => e.sql_id === user.ingenieroId)?.name || null;

  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(user.id, {
        name: name.trim(), email: email.trim(), ingenieroId: ingenieroId ? Number(ingenieroId) : null,
        esAdmin, active, password: newPassword || undefined,
      });
      setEditing(false);
      setNewPassword("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr>
        <td>{user.username}</td>
        <td>{user.name}</td>
        <td style={{ color: "var(--text-2)" }}>{user.email || "—"}</td>
        <td>{engineerName || <span style={{ color: "var(--text-2)" }}>Sin vincular</span>}</td>
        <td><span className={`eng-badge ${user.esAdmin ? "eng-badge--info" : "eng-badge--pending"}`}>{user.esAdmin ? "Admin" : "Ingeniero"}</span></td>
        <td><span className={`status-pill ${user.active ? "status-pill--on-track" : "status-pill--blocked"}`}>{user.active ? "Activo" : "Inactivo"}</span></td>
        <td style={{ textAlign: "right" }}>
          <button type="button" className="btn btn--card-export" onClick={() => setEditing(true)}>✎ Editar</button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={7}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "8px 0" }}>
          <input className="field__input" placeholder="Nombre completo…" value={name} onChange={e => setName(e.target.value)} />
          <input className="field__input" placeholder="Correo…" value={email} onChange={e => setEmail(e.target.value)} />
          <select className="field__input" value={ingenieroId} onChange={e => setIngenieroId(e.target.value)}>
            <option value="">Sin ingeniero vinculado</option>
            {engineers.map(e => <option key={e.id} value={e.sql_id || ""} disabled={!e.sql_id}>{e.name}{!e.sql_id ? " (sin sincronizar con SQL)" : ""}</option>)}
          </select>
          <input className="field__input" type="password" placeholder="Nueva contraseña (opcional)…" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={esAdmin} onChange={e => setEsAdmin(e.target.checked)} />
            Administrador
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Activo
          </label>
        </div>
        {error && <p style={{ color: "var(--red)", fontSize: 13, margin: "4px 0" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
          <button type="button" className="btn btn--accent" disabled={saving} onClick={confirm}>{saving ? "Guardando…" : "Guardar"}</button>
          <button type="button" className="btn btn--card-report" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
        </div>
      </td>
    </tr>
  );
}

export default function UsersAdminView({ engineers }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setLoading(true);
    loadUsers()
      .then(data => { setUsers(data); setError(""); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [version]);

  const handleCreate = async (payload) => {
    await createUser(payload);
    setAdding(false);
    setVersion(v => v + 1);
  };

  const handleSave = async (userId, patch) => {
    await updateUser(userId, patch);
    setVersion(v => v + 1);
  };

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <h2 className="report-panel__title">Administración de usuarios</h2>
        {!adding && (
          <button type="button" className="btn btn--accent" onClick={() => setAdding(true)}>+ Nuevo usuario</button>
        )}
      </div>

      {adding && (
        <NewUserForm engineers={engineers || []} onConfirm={handleCreate} onCancel={() => setAdding(false)} />
      )}

      {error && <p className="reportes-view__error">⚠ {error}</p>}

      {loading ? (
        <p style={{ color: "var(--text-2)" }}>Cargando usuarios…</p>
      ) : (
        <div className="metrics-container" style={{ overflowX: "auto" }}>
          <table className="metrics-table metrics-table--project">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Ingeniero vinculado</th>
                <th>Rol</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <UserRow key={u.id} user={u} engineers={engineers || []} onSave={handleSave} />
              ))}
            </tbody>
          </table>
          {!users.length && <p style={{ color: "var(--text-2)", padding: 16 }}>Sin usuarios todavía.</p>}
        </div>
      )}
    </div>
  );
}
