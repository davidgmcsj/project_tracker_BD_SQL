// AssigneeDropdown.jsx — Dropdown de asignación con soporte de externos y
// creación en popover. Usado por ActivitiesList y EngineerRow.

import { useState, useRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";

export default function AssigneeDropdown({ assignables, assignedIds, placeholder, onSelect, onCreateExternal }) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newComp,  setNewComp]  = useState("");
  const wrapRef = useRef(null);

  const engineers = assignables.filter(a => a.type === "engineer" && !assignedIds.has(a.id));
  const externals = assignables.filter(a => a.type === "external" && !assignedIds.has(a.id));

  const handleConfirmCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateExternal(name, newComp.trim());
    setNewName(""); setNewComp(""); setCreating(false);
  };

  useClickOutside(wrapRef, () => setCreating(false), creating);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <select
        className="field__input act-assign-row__select"
        value=""
        onChange={e => {
          const val = e.target.value;
          if (val === "__new_external__") { setCreating(true); return; }
          if (val) onSelect(val);
        }}
      >
        <option value="">{placeholder}</option>
        {engineers.length > 0 && (
          <>
            <option disabled>── Equipo interno ──</option>
            {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </>
        )}
        {externals.length > 0 && (
          <>
            <option disabled>── Colaboradores externos ──</option>
            {externals.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
          </>
        )}
        <option disabled>──────────────────</option>
        <option value="__new_external__">+ Agregar colaborador externo…</option>
      </select>

      {creating && (
        <div className="assignee-create-popover">
          <p className="assignee-create-popover__title">Nuevo colaborador externo</p>
          <input
            className="assignee-create-popover__input field__input"
            placeholder="Nombre completo…"
            value={newName}
            autoFocus
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleConfirmCreate(); } if (e.key === "Escape") setCreating(false); }}
          />
          <input
            className="assignee-create-popover__input field__input"
            placeholder="Empresa / entidad (ej: Microsoft)"
            value={newComp}
            onChange={e => setNewComp(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleConfirmCreate(); } if (e.key === "Escape") setCreating(false); }}
          />
          <div className="assignee-create-popover__actions">
            <button type="button" className="assignee-create-popover__cancel" onClick={() => setCreating(false)}>Cancelar</button>
            <button type="button" className="assignee-create-popover__ok" onClick={handleConfirmCreate} disabled={!newName.trim()}>Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}
