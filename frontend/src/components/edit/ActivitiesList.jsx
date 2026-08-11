// ActivitiesList.jsx — Lista de actividades numeradas: alta rápida (con
// selector opcional "Es subtarea de"), edición inline, asignación de
// responsables (multi), cambio de estado, borrado individual y por lotes.

import { useState } from "react";
import { buildActivityIndex, activityLabel } from "../../utils/formulas";
import { safeArr, safeActs, buildAssignables } from "./shared";
import AssigneeDropdown from "./AssigneeDropdown";

export default function ActivitiesList({
  activities,
  engineerCatalog,
  externalContacts,
  taskStatus,
  onChange,
  onUpdateActivityMeta,
  onAddActivity,
  onAddActivityDetailed,
  onCreateExternal,
  onImportPlanner,
}) {
  const [draft,   setDraft]   = useState("");
  const [adding,  setAdding]  = useState(false);
  const [draftResponsible, setDraftResponsible] = useState("");
  const [draftStatus, setDraftStatus] = useState("not_started");
  const [draftParentId, setDraftParentId] = useState(""); // "" = actividad raíz, sin padre

  const [editIdx,      setEditIdx]      = useState(null);
  const [editVal,      setEditVal]      = useState("");
  const [confirmDelId, setConfirmDelId] = useState(null); // ID de actividad pendiente de confirmar borrado

  // Selección múltiple para borrado por lotes. Guardamos IDs (no índices) para
  // que la selección no se corra si la lista cambia mientras hay marcadas.
  const [selectedIds,     setSelectedIds]     = useState(() => new Set());
  const [confirmBulkDel,  setConfirmBulkDel]  = useState(false);

  const acts = safeActs(activities);
  // Numeración jerárquica ("1", "1.1"...) para el selector "Es subtarea de" —
  // misma fuente que usa el Kanban y el Cronograma, así el usuario reconoce
  // la actividad por el mismo número que ve en el resto de la app.
  const parentOptionsIndex = buildActivityIndex(acts);

  const confirmAdd = () => {
    const t = draft.trim();
    if (t) {
      onAddActivity(t, draftResponsible, draftStatus, draftParentId || null);
    }
    setDraft("");
    setDraftResponsible("");
    setDraftStatus("not_started");
    setDraftParentId("");
    setAdding(false);
  };

  const startEdit   = (i) => { setEditIdx(i); setEditVal(acts[i].text); };
  const confirmEdit = () => {
    const t = editVal.trim();
    if (t) {
      const next = [...acts];
      next[editIdx] = { ...next[editIdx], text: t };
      onChange(next);
    }
    setEditIdx(null); setEditVal("");
  };
  // Pide confirmación antes de borrar — guarda el ID (no el índice) para que
  // no cambie si el usuario desplaza la lista mientras el diálogo está abierto.
  const requestRemoveAct = (i) => setConfirmDelId(acts[i].id);
  const confirmRemoveAct = () => {
    onChange(acts.filter(a => a.id !== confirmDelId));
    setConfirmDelId(null);
  };

  // ── Selección múltiple ──────────────────────────────────────────────────────
  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allSelected  = acts.length > 0 && acts.every(a => selectedIds.has(a.id));
  const someSelected = selectedIds.size > 0;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(acts.map(a => a.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());
  const confirmBulkRemove = () => {
    onChange(acts.filter(a => !selectedIds.has(a.id)));
    clearSelection();
    setConfirmBulkDel(false);
  };

  const getStatusValue = (actId) => {
    if (safeArr(taskStatus?.completed).includes(actId)) return "completed";
    if (safeArr(taskStatus?.in_progress).includes(actId)) return "in_progress";
    if (safeArr(taskStatus?.not_started).includes(actId)) return "not_started";
    return "";
  };

  const allAssignables  = buildAssignables(engineerCatalog, externalContacts);

  const handleDraftCreateExternal = (name, company) => {
    const newId = onCreateExternal ? onCreateExternal(name, company) : null;
    if (newId) setDraftResponsible(newId);
  };

  const handleActCreateExternal = (actId, name, company) => {
    const newId = onCreateExternal ? onCreateExternal(name, company) : null;
    if (newId) onUpdateActivityMeta(actId, { action: 'add', engId: newId }, undefined);
  };

  return (
    <div className="field">
      <div className="field__header">
        <label className="field__label">
          Actividades Identificadas
          {acts.length > 0 && <span className="act-count">{acts.length}</span>}
        </label>
        {!adding && (
          <div className="field__header-actions">
            {onImportPlanner && (
              <button type="button" className="btn-import-planner" onClick={onImportPlanner} title="Cargar el Excel exportado de Planner">
                📥 Importar de Planner
              </button>
            )}
            {/* Abre la tarjeta completa (fechas, responsables, objetivos,
                subtareas). El alta rápida inline queda como atajo secundario
                para cargar varias actividades seguidas solo con su nombre. */}
            <button type="button" className="btn-add-item" onClick={onAddActivityDetailed}>
              + Agregar actividad
            </button>
            <button type="button" className="btn-add-item btn-add-item--ghost" onClick={() => setAdding(true)} title="Agregar solo el nombre, sin abrir la tarjeta">
              + Alta rápida
            </button>
          </div>
        )}
      </div>

      {/* Barra de acciones por lotes: visible solo cuando hay actividades y no se está agregando */}
      {!adding && acts.length > 0 && (
        <div className="act-bulk-bar">
          <label className="act-bulk-bar__all">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={toggleSelectAll}
            />
            {someSelected ? `${selectedIds.size} seleccionada(s)` : "Seleccionar todo"}
          </label>
          {someSelected && (
            <div className="act-bulk-bar__actions">
              <button type="button" className="btn btn--secondary act-bulk-bar__btn" onClick={clearSelection}>
                Limpiar
              </button>
              <button type="button" className="btn btn--danger act-bulk-bar__btn" onClick={() => setConfirmBulkDel(true)}>
                🗑️ Eliminar {selectedIds.size} seleccionada(s)
              </button>
            </div>
          )}
        </div>
      )}

      {adding && (
        <div className="list-field-draft list-field-draft--activity">
          <input
            className="field__input list-field-draft__input"
            autoFocus value={draft}
            placeholder="Descripción de la actividad…"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmAdd(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
          />
          <AssigneeDropdown
            assignables={allAssignables}
            assignedIds={draftResponsible ? new Set([draftResponsible]) : new Set()}
            placeholder="— Responsable —"
            onSelect={id => setDraftResponsible(id)}
            onCreateExternal={handleDraftCreateExternal}
          />
          <select
            className="field__input list-field-draft__select"
            value={draftStatus}
            onChange={e => setDraftStatus(e.target.value)}
            style={{ width: "130px", flexShrink: 0 }}
          >
            <option value="">— Estado —</option>
            <option value="not_started">No iniciada</option>
            <option value="in_progress">En proceso</option>
            <option value="completed">Completada</option>
          </select>
          {acts.length > 0 && (
            <select
              className="field__input list-field-draft__select"
              value={draftParentId}
              onChange={e => setDraftParentId(e.target.value)}
              title="Opcional: convierte esta actividad en subtarea de otra"
              style={{ width: "200px", flexShrink: 0 }}
            >
              <option value="">— Es subtarea de… (opcional) —</option>
              {acts.map(a => (
                <option key={a.id} value={a.id}>{activityLabel(parentOptionsIndex, a.id)}</option>
              ))}
            </select>
          )}
          <button type="button" className="list-field-draft__ok"     onClick={confirmAdd}                         title="Confirmar">✓</button>
          <button type="button" className="list-field-draft__cancel" onClick={() => { setDraft(""); setAdding(false); }} title="Cancelar">✕</button>
        </div>
      )}

      {acts.length > 0 ? (
        <ol className="act-list">
          {acts.map((act, i) => {
            const statusVal = getStatusValue(act.id);

            let statusSelectClass = "act-list__select--status-pending";
            if (statusVal === "completed") statusSelectClass = "act-list__select--status-completed";
            else if (statusVal === "in_progress") statusSelectClass = "act-list__select--status-progress";

            const isSelected = selectedIds.has(act.id);

            return (
              <li key={act.id} className={`act-list__item${isSelected ? " act-list__item--selected" : ""}`} style={{ alignItems: "center" }}>
                {editIdx === i ? (
                  <div className="list-field-draft" style={{ flex: 1, margin: 0 }}>
                    <input
                      className="field__input list-field-draft__input"
                      autoFocus value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") { e.preventDefault(); confirmEdit(); }
                        if (e.key === "Escape") setEditIdx(null);
                      }}
                    />
                    <button type="button" className="list-field-draft__ok"     onClick={confirmEdit}           title="Guardar">✓</button>
                    <button type="button" className="list-field-draft__cancel" onClick={() => setEditIdx(null)} title="Cancelar">✕</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      className="act-list__select-box"
                      checked={isSelected}
                      onChange={() => toggleSelected(act.id)}
                      title="Seleccionar para eliminar"
                      style={{ flexShrink: 0 }}
                    />
                    <span className="act-list__num">{i + 1}.</span>
                    <span className="act-list__text">{act.text}</span>

                    {/* ── Multi-responsables: chips + dropdown para agregar ── */}
                    <div className="act-list__eng-chips" style={{ width: "260px", flexShrink: 0 }}>
                      {(act.assigned_engineers || []).map(eng => {
                        const isExternal = eng.id.startsWith("ext_");
                        const extEntry   = isExternal ? (externalContacts || []).find(c => c.id === eng.id) : null;
                        const chipLabel  = isExternal
                          ? `${eng.name.split(' ')[0]}${extEntry?.company ? ` · ${extEntry.company}` : ""}`
                          : eng.name.split(' ')[0];
                        return (
                          <span key={eng.id} className={`act-list__eng-chip${isExternal ? " act-list__eng-chip--external" : ""}`} title={isExternal ? `${eng.name}${extEntry?.company ? ` (${extEntry.company})` : ""}` : eng.name}>
                            {isExternal && <span className="act-list__eng-chip-ext">Ext</span>}
                            <span className="act-list__eng-chip-name">{chipLabel}</span>
                            <button
                              type="button"
                              className="act-list__eng-chip-rm"
                              onClick={() => onUpdateActivityMeta(act.id, { action: 'remove', engId: eng.id }, undefined)}
                              title={`Quitar a ${eng.name}`}
                            >✕</button>
                          </span>
                        );
                      })}
                      {allAssignables.some(a => !(act.assigned_engineers || []).some(e => e.id === a.id)) && (
                        <AssigneeDropdown
                          assignables={allAssignables}
                          assignedIds={new Set((act.assigned_engineers || []).map(e => e.id))}
                          placeholder={(act.assigned_engineers || []).length === 0 ? '— Resp. —' : '+ Agregar'}
                          onSelect={id => onUpdateActivityMeta(act.id, { action: 'add', engId: id }, undefined)}
                          onCreateExternal={(name, company) => handleActCreateExternal(act.id, name, company)}
                        />
                      )}
                    </div>

                    <select
                      className={`field__input act-list__select act-list__select--status ${statusSelectClass}`}
                      value={statusVal}
                      onChange={e => onUpdateActivityMeta(act.id, undefined, e.target.value)}
                      title="Cambiar estado de la actividad"
                      style={{ width: "130px", flexShrink: 0 }}
                    >
                      <option value="">— Estado —</option>
                      <option value="not_started">No iniciada</option>
                      <option value="in_progress">En proceso</option>
                      <option value="completed">Completada</option>
                    </select>

                    <button type="button" className="act-list__edit"   onClick={() => startEdit(i)}         title="Editar texto">✎</button>
                    <button type="button" className="act-list__remove" onClick={() => requestRemoveAct(i)} title="Eliminar">✕</button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !adding && <p className="act-list__empty">Sin actividades aún. Agrega la primera.</p>
      )}

      {/* Diálogo de confirmación de eliminación de actividad */}
      {confirmDelId && (() => {
        const actToDelete = acts.find(a => a.id === confirmDelId);
        return (
          <div className="act-del-overlay">
            <div className="act-del-dialog">
              <div className="act-del-dialog__icon">🗑️</div>
              <h4 className="act-del-dialog__title">¿Eliminar actividad?</h4>
              <p className="act-del-dialog__name">"{actToDelete?.text || confirmDelId}"</p>
              <p className="act-del-dialog__warn">Esta acción no se puede deshacer.</p>
              <div className="act-del-dialog__actions">
                <button className="btn btn--secondary" onClick={() => setConfirmDelId(null)}>Cancelar</button>
                <button className="btn btn--danger-solid" onClick={confirmRemoveAct}>Eliminar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Diálogo de confirmación de eliminación por lotes */}
      {confirmBulkDel && (
        <div className="act-del-overlay">
          <div className="act-del-dialog">
            <div className="act-del-dialog__icon">🗑️</div>
            <h4 className="act-del-dialog__title">¿Eliminar {selectedIds.size} actividad(es)?</h4>
            <p className="act-del-dialog__name">Se eliminarán las {selectedIds.size} actividades seleccionadas.</p>
            <p className="act-del-dialog__warn">Esta acción no se puede deshacer.</p>
            <div className="act-del-dialog__actions">
              <button className="btn btn--secondary" onClick={() => setConfirmBulkDel(false)}>Cancelar</button>
              <button className="btn btn--danger-solid" onClick={confirmBulkRemove}>Eliminar seleccionadas</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
