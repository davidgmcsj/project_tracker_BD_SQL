import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  projectProgress,
  createDefaultEngineer, createDefaultIndicator, createDefaultImpediment,
  createActivity, buildActivityIndex, activityText, activityLabel,
  visibleActivities, formatDateDMY, getToday,
} from "../utils/formulas";
import {
  activitiesForEngineerWeek, weekRange, nextWeekRange,
  activitiesForWeek, completedInWeek, SITUATION_LABEL,
} from "../utils/weekPlanning";
import { mergePlannerImport, normalizeName } from "../utils/plannerImport";
import { useClickOutside } from "../hooks/useClickOutside";
import ActivityDetailModal from "./ActivityDetailModal";
import PlannerImportModal from "./PlannerImportModal";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import ProjectPlanningOverlays from "./ProjectPlanningOverlays";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "on-track",        label: "En curso"        },
  { value: "at-risk",         label: "En riesgo"       },
  { value: "blocked",         label: "Bloqueado"       },
  { value: "completed",       label: "Completado"      },
  { value: "mejora-continua", label: "Mejora Continua" },
];

// Semana en curso, calculada una vez al cargar el módulo — suficiente para
// una sesión de trabajo normal (el caso extremo de dejar la pestaña abierta
// cruzando la medianoche del domingo se corrige con un refresco de página).
const CURRENT_WEEK = weekRange(getToday());

const IMPEDIMENT_TYPES = [
  { category: "blocker",        label: "Bloqueante",         icon: "🚫", hasImpact: true  },
  { category: "risk",           label: "Riesgo",             icon: "🔶", hasImpact: true  },
  { category: "non_conformity", label: "Salida no conforme", icon: "⚠️", hasImpact: false },
];
const IMPEDIMENT_META = Object.fromEntries(IMPEDIMENT_TYPES.map(t => [t.category, t]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeArr(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// activities_identified es un array de objetos {id, text}, nunca un string suelto.
function safeActs(val) {
  return Array.isArray(val) ? val : [];
}

// Mezcla ingenieros activos + externos activos en un único array para dropdowns de asignación.
// type: 'engineer' | 'external' permite distinguirlos visualmente.
function buildAssignables(engineerCatalog, externalContacts) {
  const engineers = (engineerCatalog || []).filter(e => e.active).map(e => ({
    id: e.id, name: e.name, type: "engineer",
  }));
  const externals = (externalContacts || []).filter(c => c.active).map(c => ({
    id: c.id, name: c.name, company: c.company || "", type: "external",
  }));
  return [...engineers, ...externals];
}

// ── Dropdown de asignación con soporte de externos y creación en popover ──────
function AssigneeDropdown({ assignables, assignedIds, placeholder, onSelect, onCreateExternal }) {
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

// Hook para drag-and-drop de reordenamiento dentro de una lista
function useDragSort(items, onChange) {
  const dragIdx = useRef(null);
  const onDragStart = useCallback((i) => { dragIdx.current = i; }, []);
  const onDrop      = useCallback((i) => {
    const src = dragIdx.current;
    if (src === null || src === i) return;
    const next = [...items];
    const [moved] = next.splice(src, 1);
    next.splice(i, 0, moved);
    onChange(next);
    dragIdx.current = null;
  }, [items, onChange]);
  return { onDragStart, onDrop };
}

// ── Modal de confirmación de eliminación ──────────────────────────────────────

function DeleteConfirmModal({ projectName, onConfirm, onCancel }) {
  const [step, setStep] = useState(1);
  return (
    <div className="delete-modal-overlay">
      <div className="delete-modal">
        {step === 1 ? (
          <>
            <div className="delete-modal__icon">⚠️</div>
            <h3 className="delete-modal__title">¿Eliminar proyecto?</h3>
            <p className="delete-modal__body">
              Estás a punto de eliminar <strong>"{projectName}"</strong>.<br />
              Esta acción no se puede deshacer.
            </p>
            <div className="delete-modal__actions">
              <button className="btn btn--secondary" onClick={onCancel}>Cancelar</button>
              <button className="btn btn--danger"    onClick={() => setStep(2)}>Sí, continuar</button>
            </div>
          </>
        ) : (
          <>
            <div className="delete-modal__icon">🗑️</div>
            <h3 className="delete-modal__title">Confirmación final</h3>
            <p className="delete-modal__body">
              ¿Confirmas eliminar permanentemente <strong>"{projectName}"</strong>?
            </p>
            <div className="delete-modal__actions">
              <button className="btn btn--secondary"    onClick={onCancel}>Cancelar</button>
              <button className="btn btn--danger-solid" onClick={onConfirm}>Eliminar definitivamente</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Lista de actividades numeradas ────────────────────────────────────────────

function ActivitiesList({
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

  const [editIdx,      setEditIdx]      = useState(null);
  const [editVal,      setEditVal]      = useState("");
  const [confirmDelId, setConfirmDelId] = useState(null); // ID de actividad pendiente de confirmar borrado

  // Selección múltiple para borrado por lotes. Guardamos IDs (no índices) para
  // que la selección no se corra si la lista cambia mientras hay marcadas.
  const [selectedIds,     setSelectedIds]     = useState(() => new Set());
  const [confirmBulkDel,  setConfirmBulkDel]  = useState(false);

  const acts = safeActs(activities);

  const confirmAdd = () => {
    const t = draft.trim();
    if (t) {
      onAddActivity(t, draftResponsible, draftStatus);
    }
    setDraft("");
    setDraftResponsible("");
    setDraftStatus("not_started");
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

  const getAssignedEngId = (act) => {
    const firstAssigned = (act.assigned_engineers || [])[0];
    return firstAssigned ? firstAssigned.id : "";
  };

  const getStatusValue = (actId) => {
    if (safeArr(taskStatus?.completed).includes(actId)) return "completed";
    if (safeArr(taskStatus?.in_progress).includes(actId)) return "in_progress";
    if (safeArr(taskStatus?.not_started).includes(actId)) return "not_started";
    return "";
  };

  const activeEngineers = (engineerCatalog || []).filter(e => e.active);
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

// ── Fila de impedimento ───────────────────────────────────────────────────────

function ImpedimentRow({ item, index, onChange, onRemove }) {
  const meta = IMPEDIMENT_META[item.category] || IMPEDIMENT_TYPES[0];
  return (
    <div className="impediment-row">
      <div className="impediment-row__header">
        <span className="impediment-row__badge">{meta.icon} {meta.label}</span>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "3px 12px", fontSize: "12px" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>
      <div className="field" style={{ marginTop: 6 }}>
        <label className="field__label" style={{ fontSize: "11px" }}>Descripción</label>
        <textarea
          className="field__textarea" rows={2}
          value={item.description || ""}
          placeholder={`Describe el ${meta.label.toLowerCase()}…`}
          onChange={e => onChange(index, "description", e.target.value)}
        />
      </div>
      {meta.hasImpact && (
        <div className="field" style={{ marginTop: 4 }}>
          <label className="field__label" style={{ fontSize: "11px" }}>Impacto</label>
          <textarea
            className="field__textarea" rows={2}
            value={item.impact || ""}
            placeholder="Describe el impacto…"
            onChange={e => onChange(index, "impact", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

// ── Fila de indicador ─────────────────────────────────────────────────────────

function IndicatorRow({ ind, index, onChange, onRemove }) {
  const pct    = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
  const noInit = Math.max(0, ind.total - ind.completed - ind.in_progress);
  const isOver = ind.completed + ind.in_progress > ind.total;

  const pctColor = pct >= 75
    ? { background: "var(--green-bg)", color: "var(--green)"  }
    : pct >= 40
    ? { background: "var(--amber-bg)", color: "var(--amber)"  }
    : { background: "var(--red-bg)",   color: "var(--red)"    };

  return (
    <div className="indicator-row">
      <div className="indicator-row__top">
        <input
          className="field__input indicator-row__name"
          placeholder="Nombre del indicador…"
          value={ind.name || ""}
          onChange={e => onChange(index, "name", e.target.value)}
        />
        <div className="indicator-row__pct" style={pctColor}>{pct}%</div>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "4px 12px", fontSize: "12px" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>
      <div className="indicator-row__nums">
        {[
          { lbl: "Total actividades", field: "total"       },
          { lbl: "Completadas",       field: "completed"   },
          { lbl: "En proceso",        field: "in_progress" },
        ].map(({ lbl, field }) => (
          <div className="field" key={field}>
            <label className="field__label" style={{ fontSize: "11px" }}>{lbl}</label>
            <input
              className="field__input" type="number" min="0"
              value={ind[field]}
              onFocus={e => e.target.select()}
              style={{ borderColor: isOver && field !== "total" ? "var(--red)" : undefined }}
              onChange={e => onChange(index, field, e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
        ))}
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>No iniciadas (Auto)</label>
          <input
            className="field__input" type="number" readOnly value={noInit}
            style={{ background: "#f8fafc", fontWeight: "bold", color: isOver ? "var(--red)" : "var(--text)" }}
          />
        </div>
      </div>
      {isOver && <div style={{ color: "var(--red)", fontSize: "12px", fontWeight: 600 }}>⚠ Completadas + en proceso supera el total.</div>}
    </div>
  );
}

// ── Fila de ingeniero ─────────────────────────────────────────────────────────

const CREATE_ENGINEER_OPTION = "__create__";

function EngineerRow({ eng, index, onChange, onRemove, activities, taskStatus, engineerCatalog, onCreateEngineer, onOpenActivity }) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");

  // "Esta semana" ya no se selecciona a mano: se deduce de las fechas de
  // inicio/fin de las actividades asignadas a este ingeniero, por
  // solapamiento con la semana actual (ver utils/weekPlanning.js). Una tarea
  // de varias semanas aparece sola en cada una que atraviesa.
  const weekRows = useMemo(() => {
    if (!eng.engineer_id) return [];
    return activitiesForEngineerWeek(activities, CURRENT_WEEK, taskStatus, eng.engineer_id);
  }, [activities, taskStatus, eng.engineer_id]);
  const weekIds = weekRows.map(r => r.activity.id);
  // Comparación por contenido (no por referencia): el array se recalcula en
  // cada render pero solo debe escribirse en el proyecto cuando cambia lo
  // que contiene, para no disparar guardados/renders de más.
  const weekIdsKey = weekIds.join(",");

  useEffect(() => {
    const current = safeArr(eng.weekly_detail);
    if (current.join(",") === weekIdsKey) return;
    onChange(index, "weekly_detail", weekIds);
    if (eng.weekly_total !== weekIds.length) onChange(index, "weekly_total", weekIds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por weekIdsKey (contenido), no por identidad de weekIds
  }, [weekIdsKey]);

  const confirmCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const id = onCreateEngineer(name, "");
    onChange(index, "engineer_id", id);
    setCreating(false);
    setNewName("");
  };

  return (
    <div className="engineer-card">
      <div className="engineer-card__header">
        <div className="engineer-row__name">
          {creating ? (
            <div className="list-field-draft">
              <input
                className="field__input list-field-draft__input"
                autoFocus value={newName}
                placeholder="Nombre del nuevo ingeniero…"
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); confirmCreate(); }
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button type="button" className="list-field-draft__ok"     onClick={confirmCreate}            title="Crear">✓</button>
              <button type="button" className="list-field-draft__cancel" onClick={() => setCreating(false)} title="Cancelar">✕</button>
            </div>
          ) : (
            <select
              className="field__input"
              value={eng.engineer_id}
              onChange={e => {
                if (e.target.value === CREATE_ENGINEER_OPTION) setCreating(true);
                else onChange(index, "engineer_id", e.target.value);
              }}
            >
              <option value="">Seleccionar ingeniero…</option>
              {(engineerCatalog || []).filter(e => e.active || e.id === eng.engineer_id).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
              <option value={CREATE_ENGINEER_OPTION}>+ Crear nuevo ingeniero…</option>
            </select>
          )}
        </div>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "4px 14px", fontSize: "12px", alignSelf: "flex-start" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>

      <div className="engineer-card__sections engineer-card__sections--single">
        <div className="engineer-section">
          <div className="engineer-section__title">
            Esta semana
            {weekRows.length > 0 && <span className="engineer-selected__count">{weekRows.length}</span>}
            <span className="engineer-week-auto-hint" title="Calculado automáticamente desde las fechas de inicio/fin de cada actividad">
              🔄 automático
            </span>
          </div>
          {!eng.engineer_id ? (
            <p className="engineer-selected__empty">Selecciona un ingeniero para ver sus tareas de la semana.</p>
          ) : weekRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades asignadas que crucen esta semana.</p>
          ) : (
            <WeekActivitiesTable rows={weekRows} onOpenActivity={onOpenActivity} />
          )}
        </div>
      </div>
    </div>
  );
}

// "completed" no es una situación del motor de clasificación (weekPlanning.js
// solo describe pendientes) — es la vista de "esto ya se hizo" que usa
// NextWeekPlanningSection para el bloque de logros de la semana.
const ROW_STATUS_LABEL = { ...SITUATION_LABEL, completed: "Completada" };

// Tabla de solo lectura: actividad, inicio, fin y su situación en la semana
// (vence / inicia / continúa / en demora / completada). Clic en el nombre
// abre su tarjeta.
function WeekActivitiesTable({ rows, onOpenActivity }) {
  return (
    <table className="week-auto-table">
      <thead>
        <tr>
          <th>Actividad</th>
          <th>Inicio</th>
          <th>Fin</th>
          <th>Situación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ activity, situation }) => (
          <tr key={activity.id}>
            <td className="week-auto-table__name">
              {onOpenActivity ? (
                <button type="button" className="week-auto-table__name-link" onClick={() => onOpenActivity(activity.id)}>
                  {activity.text || "(sin nombre)"}
                </button>
              ) : (activity.text || "(sin nombre)")}
            </td>
            <td>{formatDateDMY(activity.start_date)}</td>
            <td>{formatDateDMY(activity.due_date)}</td>
            <td>
              <span className={`week-auto-table__situation week-auto-table__situation--${situation}`}>
                {ROW_STATUS_LABEL[situation]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Cierre semanal automático (reemplaza selección manual) ───────────────────
// "Qué se hizo esta semana" y "plan próxima semana" ya no se seleccionan a
// mano: se derivan de completed_dates y de las fechas de cada actividad
// (mismo motor que EngineerRow — ver utils/weekPlanning.js). El resultado se
// escribe en next_week_plan/weekly_achievements para que ReportView y el
// resto de consumidores del reporte sigan funcionando sin cambios.

const NEXT_WEEK = nextWeekRange(getToday());

function NextWeekPlanningSection({ activities, taskStatus, project, onUpdateProject, onOpenActivity }) {
  const completedRows = useMemo(
    () => completedInWeek(activities, CURRENT_WEEK, taskStatus),
    [activities, taskStatus]
  );
  const nextWeekRows = useMemo(
    () => activitiesForWeek(activities, NEXT_WEEK, taskStatus, { includeOverdue: false }),
    [activities, taskStatus]
  );

  const completedIds = completedRows.map(a => a.id);
  const nextWeekIds  = nextWeekRows.map(r => r.activity.id);
  const completedKey = completedIds.join(",");
  const nextWeekKey  = nextWeekIds.join(",");

  useEffect(() => {
    const current = safeArr(project.weekly_achievements);
    if (current.join(",") === completedKey) return;
    onUpdateProject({ ...project, weekly_achievements: completedIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por completedKey (contenido)
  }, [completedKey]);

  useEffect(() => {
    const current = safeArr(project.next_week_plan);
    if (current.join(",") === nextWeekKey) return;
    onUpdateProject({ ...project, next_week_plan: nextWeekIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por nextWeekKey (contenido)
  }, [nextWeekKey]);

  return (
    <div className="field field--optional">
      <div className="field__header">
        <label className="field__label" style={{ marginBottom: 0 }}>
          Cierre semanal
          <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
            Calculado automáticamente desde las fechas de cada actividad
          </span>
        </label>
      </div>
      <div className="edit-row edit-row--2col" style={{ marginTop: 12 }}>
        <div className="field">
          <label className="field__label">✓ Qué se hizo esta semana</label>
          {completedRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades completadas esta semana.</p>
          ) : (
            <WeekActivitiesTable
              rows={completedRows.map(activity => ({ activity, situation: "completed" }))}
              onOpenActivity={onOpenActivity}
            />
          )}
        </div>
        <div className="field">
          <label className="field__label">→ Plan para la próxima semana</label>
          {nextWeekRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades planificadas para la próxima semana.</p>
          ) : (
            <WeekActivitiesTable rows={nextWeekRows} onOpenActivity={onOpenActivity} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Clasificador de estado de actividades ─────────────────────────────────────

const TASK_STATUS_COLS = [
  { key: "completed",   label: "Completadas",  icon: "✅", variant: "green"  },
  { key: "in_progress", label: "En proceso",   icon: "🔄", variant: "amber"  },
  { key: "not_started", label: "No iniciadas", icon: "○",  variant: "gray"   },
];

// Fechas que se registran automáticamente por columna
const STATUS_DATE_FIELD = {
  not_started: null,
  in_progress: "in_progress",
  completed:   "completed",
};

function StatusDateBadge({ label, value, onEdit }) {
  const [editing, setEditing] = useState(false);
  return (
    <span className="status-date-badge">
      <span className="status-date-badge__label">{label}:</span>
      {editing ? (
        <input
          className="status-date-badge__input"
          type="date"
          defaultValue={value || ""}
          autoFocus
          onBlur={e => { onEdit(e.target.value || null); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === "Enter") { onEdit(e.target.value || null); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button type="button" className="status-date-badge__value" onClick={() => setEditing(true)} title="Editar fecha">
          {value || "—"}
        </button>
      )}
    </span>
  );
}

export function TaskStatusSelector({ taskStatus, activities, onChange, onOpenDetail }) {
  const ts   = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);
  const actIndex  = buildActivityIndex(acts);
  const actByIdMap = new Map(acts.map(a => [a.id, a]));

  // Ids válidos: solo los que existen en activities_identified
  const validIds     = new Set(acts.map(act => act.id));
  const filterValid   = (arr) => safeArr(arr).filter(id => validIds.has(id));

  // Todas las actividades ya asignadas en cualquier columna (solo válidas)
  const assigned = new Set([
    ...filterValid(ts.completed),
    ...filterValid(ts.in_progress),
    ...filterValid(ts.not_started),
  ]);

  const today = () => new Date().toISOString().slice(0, 10);

  // Actualiza completed_dates (para filtrado semanal) y status_history (para mostrar fechas)
  const updateDates = (next, item, toKey, fromKey) => {
    // completed_dates: sigue igual (para el filtro semanal)
    const cDates = { ...(ts.completed_dates || {}) };
    if (toKey === "completed") cDates[item] = today();
    else if (fromKey === "completed") delete cDates[item];
    next.completed_dates = cDates;

    // status_history: registra fecha por campo
    const hist = { ...(ts.status_history || {}) };
    if (!hist[item]) hist[item] = { added: today() };
    const dateField = STATUS_DATE_FIELD[toKey];
    if (dateField) hist[item] = { ...hist[item], [dateField]: today() };
    // Si se mueve de in_progress a otro lado, borra in_progress date
    if (fromKey === "in_progress" && toKey !== "in_progress") delete hist[item].in_progress;
    // Si se mueve de completed a otro lado, borra completed date
    if (fromKey === "completed"   && toKey !== "completed")   delete hist[item].completed;
    next.status_history = hist;
  };

  // Índice rápido id → lista de ingenieros asignados [{engineer_id, engineer_name}]
  const actAssignIndex = new Map(
    acts.filter(a => (a.assigned_engineers || []).length > 0)
        .map(a => [a.id, a.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }))])
  );

  const update = (colKey, newArr) => onChange({ ...ts, [colKey]: newArr });

  const move = (item, toKey) => {
    const fromKey = ["completed", "in_progress", "not_started"].find(k => safeArr(ts[k]).includes(item));
    const next = {
      completed:   safeArr(ts.completed).filter(s => s !== item),
      in_progress: safeArr(ts.in_progress).filter(s => s !== item),
      not_started: safeArr(ts.not_started).filter(s => s !== item),
    };
    next[toKey] = [...next[toKey], item];
    updateDates(next, item, toKey, fromKey);

    // Registra quiénes completaron la actividad (puede haber varios ingenieros asignados)
    const completedBy = { ...(ts.completed_by || {}) };
    if (toKey === "completed" && actAssignIndex.has(item)) {
      completedBy[item] = actAssignIndex.get(item); // array de {engineer_id, engineer_name}
    } else if (fromKey === "completed") {
      delete completedBy[item];
    }
    next.completed_by = completedBy;

    onChange(next);
  };

  const remove = (item) => {
    const next = {
      completed:   safeArr(ts.completed).filter(s => s !== item),
      in_progress: safeArr(ts.in_progress).filter(s => s !== item),
      not_started: safeArr(ts.not_started).filter(s => s !== item),
    };
    const cDates = { ...(ts.completed_dates || {}) };
    delete cDates[item];
    next.completed_dates = cDates;
    const hist = { ...(ts.status_history || {}) };
    delete hist[item];
    next.status_history = hist;
    const completedBy = { ...(ts.completed_by || {}) };
    delete completedBy[item];
    next.completed_by = completedBy;
    onChange(next);
  };

  const add = (item, toKey) => {
    if (assigned.has(item)) return;
    const next = { ...ts, [toKey]: [...safeArr(ts[toKey]), item] };
    updateDates(next, item, toKey, null);
    onChange(next);
  };

  const editHistoryDate = (item, field, value) => {
    const hist = { ...(ts.status_history || {}) };
    if (!hist[item]) hist[item] = { added: today() };
    if (value) hist[item] = { ...hist[item], [field]: value };
    else { hist[item] = { ...hist[item] }; delete hist[item][field]; }
    // Keep completed_dates in sync
    const cDates = { ...(ts.completed_dates || {}) };
    if (field === "completed") {
      if (value) cDates[item] = value;
      else delete cDates[item];
    }
    onChange({ ...ts, status_history: hist, completed_dates: cDates });
  };

  // Actividades sin asignar aún (ids), con su label numerado para mostrar
  const unassigned = acts.map(act => act.id).filter(id => !assigned.has(id));

  return (
    <div className="task-status-board">
      {/* Panel de actividades disponibles */}
      {unassigned.length > 0 && (
        <div className="task-status-unassigned">
          <div className="task-status-unassigned__label">Actividades sin clasificar</div>
          {unassigned.map((id) => (
            <div key={id} className="task-status-unassigned__item">
              <span className="task-status-unassigned__text">{activityLabel(actIndex, id)}</span>
              <div className="task-status-unassigned__actions">
                {TASK_STATUS_COLS.map(col => (
                  <button
                    key={col.key} type="button"
                    className={`task-status-unassigned__btn task-status-unassigned__btn--${col.variant}`}
                    title={`Mover a ${col.label}`}
                    onClick={() => add(id, col.key)}
                  >
                    {col.icon}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tres columnas */}
      <div className="task-status-cols">
        {TASK_STATUS_COLS.map(col => {
          const items = filterValid(ts[col.key]);
          const { onDragStart: colDragStart, onDrop: colDrop } = useDragSort(items, (reordered) => update(col.key, reordered));
          return (
            <div key={col.key} className={`task-status-col task-status-col--${col.variant}`}>
              <div className="task-status-col__header">
                <span className="task-status-col__icon">{col.icon}</span>
                <span className="task-status-col__label">{col.label}</span>
                <span className="task-status-col__count">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="task-status-col__empty">Sin actividades</p>
              ) : (
                <ul className="task-status-col__list">
                  {items.map((item, i) => {
                    const otherCols = TASK_STATUS_COLS.filter(c => c.key !== col.key);
                    const hist    = ts.status_history?.[item] || {};
                    const act     = actByIdMap.get(item);
                    const fmtKanbanDate = (d) => {
                      if (!d) return null;
                      const [y, m, day] = d.split("-");
                      return `${day}/${m}/${y}`;
                    };
                    // Calcular días restantes y estado de demora
                    const isCompleted = col.key === "completed";
                    const today = new Date(); today.setHours(0,0,0,0);
                    const dueDate = act?.due_date ? new Date(act.due_date) : null;
                    const diffDays = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;
                    const isOverdue = !isCompleted && dueDate && diffDays < 0;
                    let daysLabel = null;
                    let daysClass = "task-status-col__days-badge";
                    if (!isCompleted && diffDays !== null) {
                      if (diffDays < 0) {
                        daysLabel = `⚠ En demora (${Math.abs(diffDays)} días)`;
                        daysClass += " task-status-col__days-badge--overdue";
                      } else if (diffDays === 0) {
                        daysLabel = "⏰ Vence hoy";
                        daysClass += " task-status-col__days-badge--today";
                      } else {
                        daysLabel = `${diffDays} día${diffDays !== 1 ? "s" : ""} restante${diffDays !== 1 ? "s" : ""}`;
                        daysClass += diffDays <= 3 ? " task-status-col__days-badge--soon" : " task-status-col__days-badge--ok";
                      }
                    }
                    return (
                      <li
                        key={item}
                        className={`task-status-col__item${isOverdue ? " task-status-col__item--overdue" : ""}`}
                        draggable
                        onDragStart={() => colDragStart(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => colDrop(i)}
                        title="Arrastra para reordenar"
                        onClick={onOpenDetail ? () => onOpenDetail(item) : undefined}
                        style={onOpenDetail ? { cursor: "pointer" } : undefined}
                      >
                        <div className="task-status-col__item-main">
                          <span className="task-status-col__item__grip">⠿</span>
                          <span className="task-status-col__item-text">{activityLabel(actIndex, item)}</span>
                          <div className="task-status-col__item-actions">
                            {otherCols.map(other => (
                              <button
                                key={other.key} type="button"
                                className="task-status-col__move-btn"
                                title={`Mover a ${other.label}`}
                                onClick={e => { e.stopPropagation(); move(item, other.key); }}
                              >
                                {other.icon}
                              </button>
                            ))}
                            <button
                              type="button" className="task-status-col__remove-btn"
                              title="Quitar de la lista"
                              onClick={e => { e.stopPropagation(); remove(item); }}
                            >✕</button>
                          </div>
                        </div>
                        <div className="task-status-col__dates">
                          <span className={`task-status-col__date-chip${act?.start_date ? "" : " task-status-col__date-chip--nodate"}`}>
                            Inicio: {fmtKanbanDate(act?.start_date) || "Sin fecha"}
                          </span>
                          <span className={`task-status-col__date-chip task-status-col__date-chip--end${act?.due_date ? "" : " task-status-col__date-chip--nodate"}`}>
                            Fin: {fmtKanbanDate(act?.due_date) || "Sin fecha"}
                          </span>
                          {daysLabel && (
                            <span className={daysClass}>{daysLabel}</span>
                          )}
                        </div>
                        {/* Responsables */}
                        {act?.assigned_engineers?.length > 0 ? (
                          <div className="task-status-col__assignees">
                            <span className="task-status-col__assignees-icon">👤</span>
                            {act.assigned_engineers.map(e => (
                              <span key={e.id} className="task-status-col__assignee-chip">{e.name}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="task-status-col__assignees task-status-col__assignees--empty">
                            <span className="task-status-col__assignees-icon">👤</span>
                            <span className="task-status-col__assignee-none">Sin responsable</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel de asignación masiva ───────────────────────────────────────────────
// Permite seleccionar un ingeniero y marcar N actividades de una sola vez.

function BulkAssignPanel({ activities, engineerCatalog, externalContacts, taskStatus, onBulkAssign }) {
  const [expanded,      setExpanded]      = useState(false);
  const [selectedEngId, setSelectedEngId] = useState("");
  const [checked,       setChecked]       = useState(new Set());
  const [query,         setQuery]         = useState("");
  const [filterOwned,   setFilterOwned]   = useState(false); // solo sin responsable

  const acts          = safeActs(activities);
  const completedSet  = new Set(safeArr((taskStatus || {}).completed));
  const inProgressSet = new Set(safeArr((taskStatus || {}).in_progress));
  const activeEngineers = (engineerCatalog || []).filter(e => e.active);
  const activeExternals = (externalContacts || []).filter(c => c.active);
  const allAssignables  = buildAssignables(engineerCatalog, externalContacts);

  const getActStatus = (actId) => {
    if (completedSet.has(actId))  return "completed";
    if (inProgressSet.has(actId)) return "in_progress";
    return "not_started";
  };

  // Muestra TODAS las actividades (incluyendo completadas)
  const assignable = acts;

  // Aplica filtros: búsqueda por texto + opción "sin responsable"
  const visible = assignable.filter(a => {
    if (filterOwned && (a.assigned_engineers || []).length > 0) return false;
    if (query.trim()) {
      const words = query.trim().toLowerCase().split(/\s+/);
      const hay   = `${acts.indexOf(a) + 1} ${a.text}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });

  const toggleCheck = (id) =>
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll  = () => setChecked(new Set(visible.map(a => a.id)));
  const clearAll   = () => setChecked(new Set());

  const handleAssign = () => {
    if (!selectedEngId || checked.size === 0) return;
    onBulkAssign(selectedEngId, [...checked]);
    setChecked(new Set());
  };

  if (!assignable.length) return null;

  const selectedEng = activeEngineers.find(e => e.id === selectedEngId);
  const countChecked = [...checked].filter(id => visible.some(a => a.id === id)).length;
  // cuántas de las visibles están marcadas
  const allVisibleChecked = visible.length > 0 && visible.every(a => checked.has(a.id));

  return (
    <div className="bulk-assign-panel">
      {/* ── Cabecera colapsable ── */}
      <div className="bulk-assign-panel__header" onClick={() => setExpanded(e => !e)}>
        <span className="bulk-assign-panel__title">
          ⚡ Asignación Masiva de Responsables
          <span className="bulk-assign-panel__hint">
            Selecciona un ingeniero y marca varias actividades de una vez
          </span>
        </span>
        <span className="bulk-assign-panel__chevron">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="bulk-assign-panel__body">
          {/* ── Controles superiores ── */}
          <div className="bulk-assign-panel__controls">
            <select
              className="field__input bulk-assign-panel__eng-select"
              value={selectedEngId}
              onChange={e => setSelectedEngId(e.target.value)}
            >
              <option value="">— Seleccionar responsable —</option>
              {activeEngineers.length > 0 && (
                <>
                  <option disabled>── Equipo interno ──</option>
                  {activeEngineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </>
              )}
              {activeExternals.length > 0 && (
                <>
                  <option disabled>── Colaboradores externos ──</option>
                  {activeExternals.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
                </>
              )}
            </select>

            <div className="bulk-assign-panel__search-wrap">
              <input
                className="bulk-assign-panel__search"
                type="text"
                placeholder="Buscar actividad…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="bulk-assign-panel__search-clear" onClick={() => setQuery("")}>✕</button>
              )}
            </div>

            <label className="bulk-assign-panel__filter-label">
              <input
                type="checkbox"
                checked={filterOwned}
                onChange={e => setFilterOwned(e.target.checked)}
              />
              Solo sin responsable
            </label>

            <div className="bulk-assign-panel__sel-btns">
              <button
                type="button"
                className="bulk-assign-panel__sel-btn"
                onClick={allVisibleChecked ? clearAll : selectAll}
              >
                {allVisibleChecked ? "✕ Deseleccionar todo" : "✓ Seleccionar todo"}
              </button>
            </div>

            <button
              type="button"
              className={`btn bulk-assign-panel__apply-btn ${checked.size > 0 && selectedEngId ? "bulk-assign-panel__apply-btn--active" : ""}`}
              disabled={!selectedEngId || checked.size === 0}
              onClick={handleAssign}
            >
              Asignar {checked.size > 0 ? checked.size : ""} actividad{checked.size !== 1 ? "es" : ""}
              {selectedEng ? ` → ${selectedEng.name.split(" ")[0]}` : ""}
            </button>
          </div>

          {/* ── Lista de actividades ── */}
          <div className="bulk-assign-panel__list">
            {visible.length === 0 ? (
              <p className="bulk-assign-panel__empty">
                {query || filterOwned ? "Sin actividades que coincidan con los filtros." : "Sin actividades para asignar."}
              </p>
            ) : visible.map(a => {
              const origIdx    = acts.indexOf(a);
              const isChecked  = checked.has(a.id);
              const assignedEngs = a.assigned_engineers || [];
              const actStatus  = getActStatus(a.id);
              const statusLabel = actStatus === "completed" ? "Completada" : actStatus === "in_progress" ? "En proceso" : "No iniciada";
              const statusMod   = actStatus === "completed" ? "bulk-assign-row__status--done" : actStatus === "in_progress" ? "bulk-assign-row__status--progress" : "bulk-assign-row__status--pending";
              return (
                <label
                  key={a.id}
                  className={`bulk-assign-row${isChecked ? " bulk-assign-row--checked" : ""}`}
                  onClick={() => toggleCheck(a.id)}
                >
                  <input
                    type="checkbox"
                    className="bulk-assign-row__chk"
                    checked={isChecked}
                    onChange={() => {}}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="bulk-assign-row__num">{origIdx + 1}.</span>
                  <span className="bulk-assign-row__text">{a.text}</span>
                  <span className={`bulk-assign-row__status ${statusMod}`}>{statusLabel}</span>
                  {assignedEngs.length > 0 ? (
                    <span className="bulk-assign-row__owner">
                      {assignedEngs.map(e => e.name.split(' ')[0]).join(' · ')}
                    </span>
                  ) : (
                    <span className="bulk-assign-row__unassigned">Sin responsable</span>
                  )}
                </label>
              );
            })}
          </div>

          {checked.size > 0 && (
            <div className="bulk-assign-panel__footer">
              <span>{checked.size} actividad{checked.size !== 1 ? "es" : ""} seleccionada{checked.size !== 1 ? "s" : ""}</span>
              <button type="button" className="bulk-assign-panel__clear-sel" onClick={clearAll}>Limpiar selección</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel "Pulso del proyecto" ────────────────────────────────────────────────
// Reemplaza el textarea plano de "Estado actual". Muestra el semáforo del
// proyecto, chips de datos VIVOS calculados de las actividades (avance, blo-
// queantes, próxima fecha clave) y la nota de contexto en una tarjeta cuidada.

const PULSE_STATUS = {
  "on-track":        { label: "En curso",        cls: "ok",   icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cls: "warn", icon: "🟠" },
  blocked:           { label: "Bloqueado",       cls: "crit", icon: "🔴" },
  completed:         { label: "Completado",      cls: "ok",   icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cls: "info", icon: "🔵" },
};

function ProjectPulseField({ project, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const prevValue = useRef(value);
  useEffect(() => {
    if (!editing && value !== prevValue.current) { setDraft(value); prevValue.current = value; }
  }, [value, editing]);

  const handleEdit   = () => { setDraft(value); setEditing(true); };
  const handleSave   = () => { onChange(draft); setEditing(false); prevValue.current = draft; };
  const handleCancel = () => { setDraft(value); setEditing(false); };

  // ── Datos vivos (derivados, no capturados) ──
  const acts = visibleActivities(project.activities_identified);
  const m    = project.manual_metrics || {};
  const pct  = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const blockers = (project.impediments || []).filter(im => im.category === "blocker");
  const risks    = (project.impediments || []).filter(im => im.category === "risk");
  // Próxima fecha clave = due_date más cercana en el futuro entre las actividades.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = acts
    .map(a => a.due_date).filter(d => d && d >= today).sort();
  const nextDate = upcoming[0] || null;
  const fmtShort = (d) => {
    if (!d) return null;
    const [, mo, da] = d.split("-");
    const MM = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${da} ${MM[Number(mo) - 1]}`;
  };
  const st = PULSE_STATUS[project.status] || PULSE_STATUS["on-track"];

  return (
    <div className={`pulse pulse--${st.cls}`}>
      <div className="pulse__head">
        <div className="pulse__status">
          <span className="pulse__icon">{st.icon}</span>
          <div>
            <div className="pulse__status-label">{st.label}</div>
            <div className="pulse__eyebrow">Estado actual del proyecto</div>
          </div>
        </div>
        {!editing && (
          <button type="button" className="pulse__edit" onClick={handleEdit}>
            {value ? "✎ Editar nota" : "+ Agregar nota"}
          </button>
        )}
      </div>

      {/* Chips de datos vivos */}
      <div className="pulse__chips">
        <span className="pulse-chip"><strong className="tabular">{pct}%</strong> avance</span>
        <span className={`pulse-chip ${blockers.length ? "pulse-chip--crit" : ""}`}>
          <strong className="tabular">{blockers.length}</strong> bloqueante{blockers.length !== 1 ? "s" : ""}
        </span>
        {risks.length > 0 && (
          <span className="pulse-chip pulse-chip--warn"><strong className="tabular">{risks.length}</strong> riesgo{risks.length !== 1 ? "s" : ""}</span>
        )}
        {nextDate && <span className="pulse-chip">📅 Próx. hito: <strong>{fmtShort(nextDate)}</strong></span>}
        <span className="pulse-chip">{acts.length} actividad{acts.length !== 1 ? "es" : ""}</span>
      </div>

      {/* Nota de contexto */}
      {editing ? (
        <div className="pulse__edit-wrap">
          <textarea
            className="field__textarea pulse__textarea" rows={5} autoFocus
            placeholder="Contexto de la semana: avances, decisiones, bloqueos, qué necesitas para destrabar…"
            value={draft} onChange={e => setDraft(e.target.value)}
          />
          <div className="pulse__edit-actions">
            <button type="button" className="btn btn--secondary" onClick={handleCancel}>Cancelar</button>
            <button type="button" className="btn btn--brand-solid" onClick={handleSave}>Guardar nota</button>
          </div>
        </div>
      ) : value ? (
        <div className="pulse__note" onClick={handleEdit} title="Clic para editar">
          {value.split("\n").map((line, i) => line.trim()
            ? <p key={i} className="pulse__note-line">{line}</p>
            : <br key={i} />)}
        </div>
      ) : (
        <p className="pulse__empty" onClick={handleEdit}>
          Sin nota de contexto. Los datos de arriba se calculan solos; agrega aquí la narrativa que no se ve en los números.
        </p>
      )}
    </div>
  );
}

// ── EditView principal ────────────────────────────────────────────────────────

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onUpdateProjectFull, onSaveChanges, onSaveProjectsDirect,
  onReorderProjects, onAddProject, onRemoveProject, onViewReport, onExportReport,
  engineerCatalog, onCreateEngineer,
  externalContacts, onAddExternalContact, onToggleExternalActive,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dragOverIdx,     setDragOverIdx]     = useState(null);
  const [modalActId,      setModalActId]      = useState(null);
  const [showPlannerModal, setShowPlannerModal] = useState(false);
  const [planningView,    setPlanningView]    = useState(null); // "status" | "gantt" | "hierarchy" | null
  const dragSrcIdx = useRef(null);

  const handleDragStart = (e, i) => { dragSrcIdx.current = i; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver  = (e, i) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(i); };
  const handleDrop      = (e, i) => { e.preventDefault(); const src = dragSrcIdx.current; if (src !== null && src !== i) onReorderProjects(src, i); setDragOverIdx(null); };
  const handleDragEnd   = ()     => { dragSrcIdx.current = null; setDragOverIdx(null); };

  const p          = editingIdx !== null ? projects[editingIdx] : null;
  const m          = p?.manual_metrics || {};
  const engineers   = p?.engineers   || [];
  const indicators  = p?.indicators  || [];
  const impediments = p?.impediments || [];
  // allActivities = crudo (incluye archivadas) para almacenamiento y merge de importación.
  // activities    = solo visibles (no archivadas) para toda la UI y las métricas.
  const allActivities = safeActs(p?.activities_identified);
  const activities    = visibleActivities(allActivities);

  // Métricas calculadas automáticamente desde actividades y estado de actividades
  const ts              = p?.task_status || {};
  const autoTotal       = activities.length;
  const autoCompletadas = safeArr(ts.completed).length;
  const autoEnProceso   = safeArr(ts.in_progress).length;
  const autoNoIniciadas = Math.max(0, autoTotal - autoCompletadas - autoEnProceso);

  const updateMetric = (field, val) =>
    onUpdateProject(editingIdx, "manual_metrics", { ...m, [field]: val === "" ? "" : Number(val) });

  // Recalcula total/completadas/en_proceso desde actividades y task_status.
  // Cuenta solo actividades visibles (las archivadas por Planner no inflan el total).
  const buildAutoMetrics = (newActs, newTs) => ({
    ...m,
    total_tasks:       visibleActivities(newActs).length,
    completed_tasks:   safeArr(newTs.completed).length,
    in_progress_tasks: safeArr(newTs.in_progress).length,
  });

  const addEngineer    = () => onUpdateProject(editingIdx, "engineers",   [...engineers,   createDefaultEngineer()]);
  const updateEngineer = (i, f, v) => onUpdateProject(editingIdx, "engineers",   engineers.map((e, idx)   => idx === i ? { ...e,   [f]: v } : e));
  const removeEngineer = (i)       => onUpdateProject(editingIdx, "engineers",   engineers.filter((_, idx) => idx !== i));

  // Agrega un ingeniero al proyecto desde el selector rápido del header
  const addEngineerFromCatalog = (engId) => {
    if (!engId) return;
    const alreadyInTeam = engineers.some(e => e.engineer_id === engId);
    if (alreadyInTeam) return;
    const newRow = { ...createDefaultEngineer(), engineer_id: engId };
    onUpdateProject(editingIdx, "engineers", [...engineers, newRow]);
  };

  // Quita un ingeniero del equipo del proyecto (desde el selector rápido del header)
  const removeEngineerFromTeam = (engId) => {
    onUpdateProject(editingIdx, "engineers", engineers.filter(e => e.engineer_id !== engId));
  };

  const addIndicator    = () => onUpdateProject(editingIdx, "indicators",  [...indicators,  createDefaultIndicator()]);
  const updateIndicator = (i, f, v) => onUpdateProject(editingIdx, "indicators",  indicators.map((ind, idx) => idx === i ? { ...ind, [f]: v } : ind));
  const removeIndicator = (i)       => onUpdateProject(editingIdx, "indicators",  indicators.filter((_, idx) => idx !== i));

  const addImpediment    = (cat) => onUpdateProject(editingIdx, "impediments", [...impediments, createDefaultImpediment(cat)]);
  const updateImpediment = (i, f, v) => onUpdateProject(editingIdx, "impediments", impediments.map((im, idx) => idx === i ? { ...im, [f]: v } : im));
  const removeImpediment = (i)       => onUpdateProject(editingIdx, "impediments", impediments.filter((_, idx) => idx !== i));

  // Cada actividad tiene un id estable que nunca cambia. Borrar o reordenar
  // actividades NO afecta a las demás: el id deja de aparecer en newActs y
  // solo hay que podar las referencias colgantes (la actividad que se borró)
  // de todos los campos que la referencian por id.
  const handleActivitiesChange = (newActs) => {
    // newActs viene de la lista visible (sin archivadas). Reincorporamos las
    // actividades archivadas para no perderlas al guardar (siguen ocultas y
    // recuperables). Los ids archivados no entran en validIds, así que sus
    // referencias en task_status ya estaban podadas de antemano.
    const archived = allActivities.filter(a => a.archived);
    const mergedActs = [...newActs, ...archived];
    const validIds = new Set(newActs.map(a => a.id));
    const ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};

    const pruneArr     = (arr) => safeArr(arr).filter(id => validIds.has(id));
    const pruneObjKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => validIds.has(id)));

    const newTs = {
      completed:   pruneArr(ts.completed),
      in_progress: pruneArr(ts.in_progress),
      not_started: pruneArr(ts.not_started),
    };

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: mergedActs,
      task_status: {
        ...newTs,
        completed_dates: pruneObjKeys(ts.completed_dates),
        status_history:  pruneObjKeys(ts.status_history),
      },
      manual_metrics:      buildAutoMetrics(newActs, newTs),
      weekly_achievements: pruneArr(p.weekly_achievements),
      next_week_plan:      pruneArr(p.next_week_plan),
      engineers: (p.engineers || []).map(eng => ({
        ...eng,
        weekly_detail: pruneArr(eng.weekly_detail),
      })),
    });
  };

  // Aplica una importación de Planner ya confirmada en el modal.
  // Recibe { rows, engineersToCreate }. Pasos:
  //   1) Crear los ingenieros faltantes (onCreateEngineer es síncrono, devuelve id).
  //   2) Merge definitivo pasando el mapa nombre→id ya resuelto (enlaza responsables).
  //   3) Persistir proyecto (localStorage + servidor).
  const handleApplyPlannerImport = ({ rows, engineersToCreate }) => {
    const nameToId = new Map();
    (engineerCatalog || []).forEach(e => { if (e?.name) nameToId.set(normalizeName(e.name), e.id); });
    (engineersToCreate || []).forEach(({ name }) => {
      const newId = onCreateEngineer ? onCreateEngineer(name, "") : null;
      if (newId) nameToId.set(normalizeName(name), newId);
    });

    const res = mergePlannerImport(
      allActivities, p.task_status, rows, engineerCatalog, createActivity, nameToId
    );

    // Poblar el "Equipo del Proyecto" (p.engineers) con los responsables que trae
    // el Excel, sin duplicar los que ya están. Reúne todos los ids asignados a las
    // actividades importadas (no archivadas) y agrega una fila por cada uno nuevo.
    const teamIds = new Set((p.engineers || []).map(r => r.engineer_id).filter(Boolean));
    const importedEngIds = new Set();
    res.activities.forEach(a => {
      if (a.archived) return;
      (a.assigned_engineers || []).forEach(e => {
        // Solo ingenieros del catálogo (ids "eng_..."), no colaboradores externos ("ext_...").
        if (e.id && e.id.startsWith("eng_")) importedEngIds.add(e.id);
      });
    });
    const newTeamRows = [...importedEngIds]
      .filter(id => !teamIds.has(id))
      .map(id => ({ ...createDefaultEngineer(), engineer_id: id }));
    const mergedEngineers = [...(p.engineers || []), ...newTeamRows];

    const updatedProject = {
      ...p,
      activities_identified: res.activities,
      task_status:           res.task_status,
      manual_metrics:        buildAutoMetrics(res.activities, res.task_status),
      engineers:             mergedEngineers,
      planner_last_import:   new Date().toISOString(),
    };
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    // Persistir con el array explícito para evitar estado obsoleto (mismo patrón que
    // handleActivityModalSave). Los ingenieros nuevos ya se persistieron en onCreateEngineer.
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
  };

  const handleUpdateActivityMeta = (actId, newEngId, newStatus) => {
    let updatedActs = activities.map(a => {
      if (a.id !== actId) return a;
      let updatedEngs = a.assigned_engineers || [];
      let updatedDate = a.assigned_date;
      if (newEngId !== undefined) {
        const today = new Date().toISOString().slice(0, 10);
        if (newEngId !== null && typeof newEngId === 'object') {
          // Multi-assign format: { action: 'add'|'remove', engId }
          if (newEngId.action === 'add') {
            const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
            const eng = allContacts.find(e => e.id === newEngId.engId);
            if (eng && !updatedEngs.some(e => e.id === eng.id)) {
              updatedEngs = [...updatedEngs, { id: eng.id, name: eng.name }];
              updatedDate = updatedDate || today;
            }
          } else if (newEngId.action === 'remove') {
            updatedEngs = updatedEngs.filter(e => e.id !== newEngId.engId);
            if (updatedEngs.length === 0) updatedDate = null;
          }
        } else if (newEngId === '') {
          updatedEngs = [];
          updatedDate = null;
        } else {
          const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
          const eng = allContacts.find(e => e.id === newEngId);
          if (eng) {
            updatedEngs = [{ id: eng.id, name: eng.name }];
            updatedDate = a.assigned_date || today;
          }
        }
      }
      return {
        ...a,
        assigned_engineers: updatedEngs,
        assigned_date: updatedDate,
      };
    });

    let updatedTs = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    if (newStatus !== undefined) {
      const fromKey = ["completed", "in_progress", "not_started"].find(k => safeArr(updatedTs[k]).includes(actId));
      const next = {
        completed:   safeArr(updatedTs.completed).filter(s => s !== actId),
        in_progress: safeArr(updatedTs.in_progress).filter(s => s !== actId),
        not_started: safeArr(updatedTs.not_started).filter(s => s !== actId),
      };
      if (newStatus !== "") {
        next[newStatus] = [...next[newStatus], actId];
      }
      
      const today = () => new Date().toISOString().slice(0, 10);
      const cDates = { ...(updatedTs.completed_dates || {}) };
      if (newStatus === "completed") cDates[actId] = today();
      else if (fromKey === "completed") delete cDates[actId];
      next.completed_dates = cDates;

      const hist = { ...(updatedTs.status_history || {}) };
      if (!hist[actId]) hist[actId] = { added: today() };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField) hist[actId] = { ...hist[actId], [dateField]: today() };
      if (fromKey === "in_progress" && newStatus !== "in_progress") delete hist[actId].in_progress;
      if (fromKey === "completed"   && newStatus !== "completed")   delete hist[actId].completed;
      next.status_history = hist;

      const completedBy = { ...(updatedTs.completed_by || {}) };
      if (newStatus === "completed") {
        const act = updatedActs.find(a => a.id === actId);
        if (act && (act.assigned_engineers || []).length > 0) {
          completedBy[actId] = act.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }));
        }
      } else if (fromKey === "completed") {
        delete completedBy[actId];
      }
      next.completed_by = completedBy;

      updatedTs = next;
    }

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: updatedActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(updatedActs, updatedTs),
    });
  };

  const handleBulkAssign = (engId, actIds) => {
    const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
    const eng = allContacts.find(e => e.id === engId);
    if (!eng) return;
    const today  = new Date().toISOString().slice(0, 10);
    const idSet  = new Set(actIds);
    const newActs = activities.map(a => {
      if (!idSet.has(a.id)) return a;
      // Si ya está asignado, no duplicar
      if ((a.assigned_engineers || []).some(e => e.id === eng.id)) return a;
      return {
        ...a,
        assigned_engineers: [...(a.assigned_engineers || []), { id: eng.id, name: eng.name }],
        assigned_date: a.assigned_date || today,
      };
    });
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      manual_metrics: buildAutoMetrics(newActs, p.task_status || {}),
    });
  };

  const handleAddActivity = (text, engId, status) => {
    const newAct = createActivity(text);
    const actId = newAct.id;
    const todayStr = new Date().toISOString().slice(0, 10);

    if (engId !== "") {
      const eng = (engineerCatalog || []).find(e => e.id === engId);
      if (eng) {
        newAct.assigned_engineers = [{ id: eng.id, name: eng.name }];
        newAct.assigned_date = todayStr;
      }
    }

    const newActs = [...activities, newAct];

    let updatedTs = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    if (status !== "") {
      const next = {
        completed:   safeArr(updatedTs.completed),
        in_progress: safeArr(updatedTs.in_progress),
        not_started: safeArr(updatedTs.not_started),
      };
      next[status] = [...next[status], actId];

      const cDates = { ...(updatedTs.completed_dates || {}) };
      if (status === "completed") cDates[actId] = todayStr;
      next.completed_dates = cDates;

      const hist = { ...(updatedTs.status_history || {}) };
      hist[actId] = { added: todayStr };
      const dateField = STATUS_DATE_FIELD[status];
      if (dateField) hist[actId][dateField] = todayStr;
      next.status_history = hist;

      const completedBy = { ...(updatedTs.completed_by || {}) };
      if (status === "completed" && (newAct.assigned_engineers || []).length > 0) {
        completedBy[actId] = newAct.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }));
      }
      next.completed_by = completedBy;

      updatedTs = next;
    }

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(newActs, updatedTs),
    });
    return actId;
  };

  // Crea una actividad vacía y abre su tarjeta completa de inmediato, para
  // capturar todos los detalles (fechas, responsables, objetivos, subtareas)
  // sin pasar por el formulario mínimo de la lista.
  const handleAddActivityDetailed = () => {
    const newId = handleAddActivity("Nueva actividad", "", "not_started");
    setModalActId(newId);
  };

  const modalActivity = modalActId ? activities.find(a => a.id === modalActId) : null;

  // Subtareas reales de la actividad abierta en el modal — sección "Subtareas"
  // (distinta del checklist "Subactividades"). Crear/abrir una reemplaza el
  // modal por la tarjeta de la subtarea (mismo modal, otro id).
  const modalSubtasks = modalActId
    ? activities.filter(a => a.parent_id === modalActId)
    : [];

  const handleActivityModalSave = (updatedAct) => {
    // _history (fechas de transición Inscrita/En proceso/Completada) viene del modal
    // pero NO vive en la actividad: se escribe en task_status.status_history[actId].
    const { _history, ...actClean } = updatedAct;
    const newActs = activities.map(a => a.id === actClean.id ? actClean : a);
    let updatedProject = { ...p, activities_identified: newActs };
    if (_history) {
      const ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      updatedProject = {
        ...updatedProject,
        task_status: {
          ...ts,
          status_history: { ...(ts.status_history || {}), [actClean.id]: cleanHist },
        },
      };
    }
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
  };

  // Elimina una actividad desde el modal de detalle: la quita de la lista,
  // la saca de todos los depósitos del task_status y guarda inmediatamente.
  const handleActivityModalDelete = (actId) => {
    const newActs = activities.filter(a => a.id !== actId);
    const ts = p.task_status || {};
    const updatedTs = {
      ...ts,
      completed:      (ts.completed   || []).filter(id => id !== actId),
      in_progress:    (ts.in_progress || []).filter(id => id !== actId),
      not_started:    (ts.not_started || []).filter(id => id !== actId),
      status_history: Object.fromEntries(
        Object.entries(ts.status_history || {}).filter(([id]) => id !== actId)
      ),
    };
    const updatedProject  = { ...p, activities_identified: newActs, task_status: updatedTs, manual_metrics: buildAutoMetrics(newActs, updatedTs) };
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
    setModalActId(null);
  };

  // Crea una subtarea real (actividad hija) y devuelve su id, para abrir
  // inmediatamente la tarjeta de la subtarea recién creada desde la sección
  // "Subtareas" del modal de detalle.
  const handleHierarchyAddChild = (parentId, sequenceOrder) => {
    const newAct = createActivity("Nueva subtarea", parentId, sequenceOrder);
    const newActs = [...activities, newAct];
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      manual_metrics: buildAutoMetrics(newActs, p.task_status || {}),
    });
    return newAct.id;
  };

  // Crea una subtarea para la actividad abierta en el modal y navega a su
  // tarjeta de inmediato (misma mecánica que HierarchyTable.handleAddChild).
  const handleCreateSubtaskFromModal = () => {
    const newId = handleHierarchyAddChild(modalActId, modalSubtasks.length);
    setModalActId(newId);
  };

  // Elimina una actividad de la jerarquía. Sus hijas directas (si las tenía)
  // suben a ser hijas de SU padre en vez de quedar huérfanas — mismo criterio
  // que buildActivityTree ya aplica a datos huérfanos preexistentes.
  const handleHierarchyDelete = (actId) => {
    const target = activities.find(a => a.id === actId);
    const parentId = target?.parent_id ?? null;
    const newActs = activities
      .filter(a => a.id !== actId)
      .map(a => a.parent_id === actId ? { ...a, parent_id: parentId } : a);
    const ts = p.task_status || {};
    const updatedTs = {
      ...ts,
      completed:      (ts.completed   || []).filter(id => id !== actId),
      in_progress:    (ts.in_progress || []).filter(id => id !== actId),
      not_started:    (ts.not_started || []).filter(id => id !== actId),
      status_history: Object.fromEntries(
        Object.entries(ts.status_history || {}).filter(([id]) => id !== actId)
      ),
    };
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(newActs, updatedTs),
    });
  };

  return (
    <div className="edit-view">
      {/* ── Pestañas ── */}
      <div className="project-tabs">
        {projects.map((proj, i) => (
          <button
            key={proj.id} draggable
            className={`project-tab ${editingIdx === i ? "project-tab--active" : ""} ${dragOverIdx === i ? "project-tab--drag-over" : ""}`}
            onClick={() => onSelectProject(i)}
            onDragStart={e => handleDragStart(e, i)} onDragOver={e => handleDragOver(e, i)}
            onDrop={e => handleDrop(e, i)} onDragEnd={handleDragEnd}
            title="Arrastra para reordenar"
          >
            <span className="project-tab__grip">⠿</span>
            {proj.project_name || `Proyecto ${i + 1}`}
          </button>
        ))}
        <button className="project-tab project-tab--add" onClick={onAddProject}>+ Nuevo</button>
      </div>

      {p ? (
        <div className="edit-panel">
          {/* Cabecera */}
          <div className="edit-panel__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className={`priority-star priority-star--lg${p.priority ? " priority-star--active" : ""}`}
                onClick={() => onUpdateProject(editingIdx, "priority", !p.priority)}
                title={p.priority ? "Quitar de prioritarios" : "Marcar como prioritario"}
                aria-pressed={!!p.priority}
              >
                {p.priority ? "★" : "☆"}
              </button>
              <h2 style={{ fontSize: "18px", color: "var(--azul-oscuro)" }}>Editando: {p.project_name || "Nuevo Proyecto"}</h2>
            </div>
            <button
              className={`btn ${hasUnsavedChanges ? "btn--accent" : ""}`}
              onClick={onSaveChanges} style={{ padding: "10px 24px", fontSize: "14px" }}
              disabled={!hasUnsavedChanges}
            >
              {hasUnsavedChanges ? "💾 Guardar cambios" : "✓ Guardado"}
            </button>
          </div>

          {/* ══ 1. Identificación ══ */}
          <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            <div className="field">
              <label className="field__label">Nombre del Proyecto</label>
              <input
                className="field__input" value={p.project_name}
                placeholder="Ej: Migración CRM"
                onChange={e => onUpdateProject(editingIdx, "project_name", e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label">Estado</label>
              <select
                className="field__input" value={p.status}
                onChange={e => onUpdateProject(editingIdx, "status", e.target.value)}
              >
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label">URL de Planner</label>
              <input
                className="field__input" value={p.planner_url || ""}
                placeholder="https://tasks.office.com/…"
                onChange={e => onUpdateProject(editingIdx, "planner_url", e.target.value)}
              />
            </div>
          </div>

          {/* ══ 1b. Equipo del proyecto (selector rápido) ══ */}
          <div className="field project-team-selector">
            <div className="project-team-selector__header">
              <label className="field__label">Equipo del Proyecto</label>
              <select
                className="field__input project-team-selector__select"
                value=""
                onChange={e => addEngineerFromCatalog(e.target.value)}
              >
                <option value="">+ Agregar ingeniero al equipo…</option>
                {(engineerCatalog || [])
                  .filter(e => e.active && !engineers.some(r => r.engineer_id === e.id))
                  .map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="project-team-selector__chips">
              {engineers.length === 0 && (
                <span className="project-team-selector__empty">Sin ingenieros asignados al proyecto</span>
              )}
              {engineers.map(row => {
                const cat = (engineerCatalog || []).find(e => e.id === row.engineer_id);
                const name = cat?.name || row.engineer_id || "Sin nombre";
                return (
                  <span key={row.engineer_id || name} className="project-team-chip">
                    {name}
                    <button
                      className="project-team-chip__remove"
                      type="button"
                      title="Quitar del equipo"
                      onClick={() => removeEngineerFromTeam(row.engineer_id)}
                    >×</button>
                  </span>
                );
              })}
            </div>
          </div>

          {/* ══ 2. Métricas de avance (auto-calculadas) ══ */}
          <div className="field field--optional">
            <label className="field__label" style={{ marginBottom: 10 }}>
              Métricas de Avance
              <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
                (calculadas automáticamente desde actividades y estado)
              </span>
            </label>
            <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "12px" }}>
              {[
                { lbl: "Total actividades",  val: autoTotal       },
                { lbl: "Completadas",        val: autoCompletadas },
                { lbl: "En proceso",         val: autoEnProceso   },
                { lbl: "No iniciadas",       val: autoNoIniciadas },
                { lbl: "Tareas compartidas", val: null            },
              ].map(({ lbl, val }) => (
                <div className="field" key={lbl}>
                  <label className="field__label" style={{ fontSize: "11px" }}>{lbl}</label>
                  {val === null ? (
                    <input
                      className="field__input" type="number" min="0"
                      value={m.shared_tasks_discount ?? 0}
                      onFocus={e => e.target.select()}
                      onChange={e => updateMetric("shared_tasks_discount", e.target.value)}
                    />
                  ) : (
                    <input
                      className="field__input" type="number" readOnly value={val}
                      style={{ background: "#f8fafc", fontWeight: "bold", color: "var(--text)" }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ══ 3. Actividades identificadas ══ */}
          <ActivitiesList
            activities={activities}
            engineerCatalog={engineerCatalog}
            externalContacts={externalContacts}
            taskStatus={p.task_status}
            onChange={handleActivitiesChange}
            onUpdateActivityMeta={handleUpdateActivityMeta}
            onAddActivity={handleAddActivity}
            onAddActivityDetailed={handleAddActivityDetailed}
            onCreateExternal={onAddExternalContact}
            onImportPlanner={() => setShowPlannerModal(true)}
          />

          {/* ══ 3b. Asignación masiva ══ */}
          {activities.length > 0 && (
            <BulkAssignPanel
              activities={activities}
              engineerCatalog={engineerCatalog}
              externalContacts={externalContacts}
              taskStatus={p.task_status}
              onBulkAssign={handleBulkAssign}
            />
          )}

          {/* ══ 4. Planificación — accesos a las vistas a pantalla completa ══
                 Las tres vistas (tablero de estados, Gantt y tabla jerárquica)
                 viven en overlay: dentro del formulario quedaban demasiado
                 estrechas para ser útiles. */}
          {activities.length > 0 && (
            <div className="field field--optional">
              <div className="field__header">
                <label className="field__label" style={{ marginBottom: 0 }}>
                  Planificación
                  <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
                    Estados, cronograma y tabla de actividades, a pantalla completa
                  </span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("status")}
                  >
                    🗃 Ver estado de actividades
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("gantt")}
                  >
                    📅 Ver diagrama de Gantt
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("hierarchy")}
                  >
                    🗂 Ver planificación completa
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mismo componente que usa el dashboard: las tres vistas y la
              tarjeta de detalle se comportan igual desde ambos accesos. */}
          <ProjectPlanningOverlays
            project={p}
            view={planningView}
            onClose={() => setPlanningView(null)}
            onUpdateProject={updated => onUpdateProjectFull(editingIdx, updated)}
            engineerCatalog={engineerCatalog}
            externalContacts={externalContacts}
            StatusBoard={TaskStatusSelector}
          />

          {/* ══ 5. Indicadores ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Indicadores</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }} type="button" onClick={addIndicator}>
                + Agregar indicador
              </button>
            </div>
            {indicators.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {indicators.map((ind, i) => (
                  <IndicatorRow key={i} ind={ind} index={i} onChange={updateIndicator} onRemove={removeIndicator} />
                ))}
              </div>
            )}
          </div>

          {/* ══ 6. Impedimentos ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Impedimentos y Riesgos</label>
              <div style={{ display: "flex", gap: 8 }}>
                {IMPEDIMENT_TYPES.map(t => (
                  <button key={t.category} className="btn btn--accent" style={{ padding: "5px 12px", fontSize: "11px" }}
                    type="button" onClick={() => addImpediment(t.category)}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            {impediments.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {impediments.map((im, i) => (
                  <ImpedimentRow key={i} item={im} index={i} onChange={updateImpediment} onRemove={removeImpediment} />
                ))}
              </div>
            )}
          </div>

          {/* ══ 7. (Removido) Asignación de Responsables — ahora se hace arriba,
                 en cada actividad de "Actividades identificadas". ══ */}

          {/* ══ 8. Ingenieros ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Equipo de Ingenieros</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }} type="button" onClick={addEngineer}>
                + Agregar ingeniero
              </button>
            </div>
            {engineers.length > 0 && (
              <>
                {engineers.map((eng, i) => (
                  <EngineerRow key={i} eng={eng} index={i}
                    onChange={updateEngineer} onRemove={removeEngineer}
                    activities={activities}
                    taskStatus={p.task_status}
                    engineerCatalog={engineerCatalog}
                    onCreateEngineer={onCreateEngineer}
                    onOpenActivity={setModalActId}
                  />
                ))}
                <div className="shared-tasks-row">
                  <span className="shared-tasks-row__label">Tareas compartidas entre ingenieros</span>
                  <input
                    className="field__input shared-tasks-row__input" type="number" min="0"
                    value={m.shared_tasks_discount ?? 0} onFocus={e => e.target.select()}
                    onChange={e => updateMetric("shared_tasks_discount", e.target.value === "" ? 0 : Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          {/* ══ 9. Estado actual del proyecto — Panel "Pulso del proyecto" ══ */}
          <ProjectPulseField
            project={p}
            value={p.status_notes || ""}
            onChange={val => onUpdateProject(editingIdx, "status_notes", val)}
          />

          {/* ══ 9b. Notas y comentarios fechados (Proyecto_Notas, independiente del pulso) ══ */}
          <ProjectNotesPanel proyectoAppID={p.id} />

          {/* ══ 10. Cierre semanal — automático ══
                 Reemplaza la selección manual de "qué se hizo" y "plan próxima
                 semana": ambos se deducen de las fechas de las actividades.
                 Sigue escribiendo en next_week_plan/weekly_achievements para
                 que ReportView y el resto de consumidores no cambien. */}
          <NextWeekPlanningSection
            activities={activities}
            taskStatus={p.task_status}
            onUpdateProject={updated => onUpdateProjectFull(editingIdx, updated)}
            project={p}
            onOpenActivity={setModalActId}
          />

          <div className="edit-panel__footer">
            <button className="btn btn--accent"  onClick={() => onViewReport(editingIdx)}>📄 Ver reporte</button>
            <button className="btn btn--export"  onClick={() => onExportReport(editingIdx)}>📋 Copiar reporte</button>
            <button className="btn btn--danger"  onClick={() => setShowDeleteModal(true)}>Eliminar proyecto</button>
          </div>

          {showDeleteModal && (
            <DeleteConfirmModal
              projectName={p.project_name || "este proyecto"}
              onCancel={() => setShowDeleteModal(false)}
              onConfirm={() => { setShowDeleteModal(false); onRemoveProject(editingIdx); }}
            />
          )}
        </div>
      ) : (
        <div className="edit-empty">
          {projects.length > 0
            ? "Selecciona un proyecto para editarlo"
            : 'Haz clic en "+ Nuevo" para agregar tu primer proyecto'}
        </div>
      )}

      {modalActivity && p && (
        <ActivityDetailModal
          activity={modalActivity}
          projectName={p.project_name || "Proyecto"}
          projectId={p.id}
          taskStatus={p.task_status}
          engineerCatalog={engineerCatalog}
          externalContacts={externalContacts}
          onSave={handleActivityModalSave}
          onDelete={handleActivityModalDelete}
          onClose={() => setModalActId(null)}
          subtasks={modalSubtasks}
          onCreateSubtask={handleCreateSubtaskFromModal}
          onOpenSubtask={setModalActId}
          onDeleteSubtask={handleHierarchyDelete}
        />
      )}

      {p && (
        <PlannerImportModal
          isOpen={showPlannerModal}
          onClose={() => setShowPlannerModal(false)}
          onConfirm={handleApplyPlannerImport}
          existingActivities={allActivities}
          existingTaskStatus={p.task_status}
          engineerCatalog={engineerCatalog}
        />
      )}
    </div>
  );
}
