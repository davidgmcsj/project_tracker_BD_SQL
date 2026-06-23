import { useState, useRef, useCallback, useEffect } from "react";
import {
  projectProgress,
  createDefaultEngineer, createDefaultIndicator,
  createDefaultImpediment, createDefaultMilestone, createDefaultComment,
  createActivity, buildActivityIndex, activityText, activityLabel,
} from "../utils/formulas";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "on-track",        label: "En curso"        },
  { value: "at-risk",         label: "En riesgo"       },
  { value: "blocked",         label: "Bloqueado"       },
  { value: "completed",       label: "Completado"      },
  { value: "mejora-continua", label: "Mejora Continua" },
];

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

// Filtra items: todas las palabras del query deben aparecer en el texto (case-insensitive)
function matchesSearch(text, query) {
  if (!query.trim()) return true;
  const lower = text.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => lower.includes(word));
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
  taskStatus,
  onChange,
  onUpdateActivityMeta,
  onAddActivity,
}) {
  const [draft,   setDraft]   = useState("");
  const [adding,  setAdding]  = useState(false);
  const [draftResponsible, setDraftResponsible] = useState("");
  const [draftStatus, setDraftStatus] = useState("not_started");

  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");

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
  const removeAct = (i) => onChange(acts.filter((_, idx) => idx !== i));

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

  return (
    <div className="field">
      <div className="field__header">
        <label className="field__label">
          Actividades Identificadas
          {acts.length > 0 && <span className="act-count">{acts.length}</span>}
        </label>
        {!adding && (
          <button type="button" className="btn-add-item" onClick={() => setAdding(true)}>
            + Agregar actividad
          </button>
        )}
      </div>

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
          <select
            className="field__input list-field-draft__select"
            value={draftResponsible}
            onChange={e => setDraftResponsible(e.target.value)}
            style={{ width: "160px", flexShrink: 0 }}
          >
            <option value="">— Responsable —</option>
            {activeEngineers.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
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
            const assignedEngId = getAssignedEngId(act);
            const statusVal = getStatusValue(act.id);

            let statusSelectClass = "act-list__select--status-pending";
            if (statusVal === "completed") statusSelectClass = "act-list__select--status-completed";
            else if (statusVal === "in_progress") statusSelectClass = "act-list__select--status-progress";

            return (
              <li key={act.id} className="act-list__item" style={{ alignItems: "center" }}>
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
                    <span className="act-list__num">{i + 1}.</span>
                    <span className="act-list__text">{act.text}</span>
                    
                    <select
                      className="field__input act-list__select act-list__select--responsible"
                      value={assignedEngId}
                      onChange={e => onUpdateActivityMeta(act.id, e.target.value, undefined)}
                      title="Asignar ingeniero responsable"
                      style={{ width: "160px", flexShrink: 0 }}
                    >
                      <option value="">— Responsable —</option>
                      {activeEngineers.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>

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

                    <button type="button" className="act-list__edit"   onClick={() => startEdit(i)} title="Editar texto">✎</button>
                    <button type="button" className="act-list__remove" onClick={() => removeAct(i)} title="Eliminar">✕</button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !adding && <p className="act-list__empty">Sin actividades aún. Agrega la primera.</p>
      )}
    </div>
  );
}

// ── Selector de actividades (multi-select con límite) ─────────────────────────

function getCurrentWeekKey() {
  const now = new Date();
  const day = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + 1);
  return mon.toISOString().slice(0, 10);
}

function ActivitySelector({ label, activities, selected, limit, onChange, excludeCompleted, excludeOldCompleted, completedDates, fixedAssigned }) {
  const [query, setQuery] = useState("");
  const acts   = safeActs(activities);
  const selArr = safeArr(selected);
  const actIndex = buildActivityIndex(acts);

  const currentWeek = getCurrentWeekKey();

  // excludeCompleted: oculta TODAS las completadas (para "próxima semana" e "ingeniero esta semana")
  const completedSet = excludeCompleted ? new Set(safeArr(excludeCompleted)) : null;

  // excludeOldCompleted: oculta solo las completadas en semanas ANTERIORES (para "qué se hizo esta semana")
  const oldCompletedSet = excludeOldCompleted
    ? new Set(
        safeArr(excludeOldCompleted).filter(id => {
          const dateKey = completedDates?.[id];
          if (!dateKey) return false;
          const itemWeek = new Date(dateKey + "T12:00:00");
          const day = itemWeek.getDay() || 7;
          itemWeek.setDate(itemWeek.getDate() - day + 1);
          return itemWeek.toISOString().slice(0, 10) < currentWeek;
        })
      )
    : null;

  const deselect = (id) => onChange(selArr.filter(s => s !== id));
  const select   = (id) => {
    if (limit && selArr.length >= limit) return;
    onChange([...selArr, id]);
  };
  const toggle = (id) => selArr.includes(id) ? deselect(id) : select(id);

  const { onDragStart, onDrop } = useDragSort(selArr, onChange);

  const fixedSet = fixedAssigned ? new Set(safeArr(fixedAssigned)) : null;

  // Filtra según el modo y aplica búsqueda, preservando posición original
  const visible = acts.reduce((acc, act, origIdx) => {
    if (completedSet    && completedSet.has(act.id))    return acc;
    if (oldCompletedSet && oldCompletedSet.has(act.id)) return acc;
    if (!matchesSearch(act.text, query)) return acc;
    acc.push({ act, origIdx });
    return acc;
  }, []);

  return (
    <div className="act-selector">
      <div className="act-selector__header">
        <span className="act-selector__label">{label}</span>
        {limit && (
          <span className={`act-selector__count ${selArr.length >= limit ? "act-selector__count--full" : ""}`}>
            {selArr.length}/{limit} seleccionadas
          </span>
        )}
      </div>

      {acts.length > 0 ? (
        <>
          <div className="act-selector__search">
            <input
              className="act-selector__search-input"
              type="text" placeholder="Buscar actividad…"
              value={query} onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="act-selector__search-clear" onClick={() => setQuery("")} title="Limpiar">✕</button>
            )}
          </div>
          <div className="act-selector__list">
            {visible.length === 0 ? (
              <p className="act-selector__empty">{query ? `Sin coincidencias para "${query}"` : "Sin actividades disponibles"}</p>
            ) : visible.map(({ act, origIdx }) => {
              const checked     = selArr.includes(act.id);
              const isFixed     = fixedSet && fixedSet.has(act.id);
              const disabled    = !checked && limit && selArr.length >= limit;
              return (
                <label
                  key={act.id}
                  className={`act-selector__item ${checked ? "act-selector__item--checked" : ""} ${disabled ? "act-selector__item--disabled" : ""} ${isFixed ? "act-selector__item--fixed" : ""}`}
                >
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(act.id)} />
                  <span className="act-selector__num">{origIdx + 1}.</span>
                  <span className="act-selector__text">{act.text}</span>
                  {isFixed && <span className="act-selector__fixed-badge">Asignada</span>}
                </label>
              );
            })}
          </div>
        </>
      ) : (
        <p className="act-selector__empty">
          Primero agrega actividades identificadas para poder seleccionarlas aquí.
        </p>
      )}

      {selArr.length > 0 && (
        <div className="act-selector__selected">
          <span className="act-selector__selected-label">Seleccionadas:</span>
          {selArr.map((id, i) => (
            <span
              key={id} className="act-selector__chip"
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(i)}
              title="Arrastra para reordenar"
            >
              <span className="act-selector__chip-grip">⠿</span>
              <span className="act-selector__chip-text">{activityLabel(actIndex, id)}</span>
              <button type="button" className="act-selector__chip-remove" onClick={() => deselect(id)} title="Quitar selección">✕</button>
            </span>
          ))}
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

// ── Lista de seleccionadas con drag-to-reorder ────────────────────────────────

function SelectedList({ items, activities, onChange }) {
  const { onDragStart, onDrop } = useDragSort(items, onChange);
  const actIndex = buildActivityIndex(safeActs(activities));
  return (
    <ol className="engineer-selected__list">
      {items.map((id, i) => (
        <li
          key={id} className="engineer-selected__item"
          draggable
          onDragStart={() => onDragStart(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => onDrop(i)}
          title="Arrastra para reordenar"
        >
          <span className="engineer-selected__grip">⠿</span>
          <span className="engineer-selected__num">{i + 1}.</span>
          <span className="engineer-selected__text">{activityText(actIndex, id)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Fila de ingeniero ─────────────────────────────────────────────────────────

const CREATE_ENGINEER_OPTION = "__create__";

function EngineerRow({ eng, index, onChange, onRemove, activities, taskStatus, engineerCatalog, onCreateEngineer }) {
  const weeklyArr = safeArr(eng.weekly_detail);
  const limit     = eng.weekly_total > 0 ? eng.weekly_total : undefined;

  // IDs de actividades asignadas fijamente a este ingeniero (para destacar en verde)
  const fixedAssigned = eng.engineer_id
    ? safeActs(activities)
        .filter(a => (a.assigned_engineers || []).some(e => e.id === eng.engineer_id))
        .map(a => a.id)
    : [];
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");

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

      <div className="engineer-card__sections">
        <div className="engineer-section">
          <div className="engineer-section__title">Esta semana</div>
          <div className="engineer-week-simple">
            <label className="field__label" style={{ fontSize: "11px" }}>
              Tareas semana
              {limit && <span style={{ fontSize: "10px", color: "var(--text-3)", marginLeft: 6 }}>(selecciona hasta {limit})</span>}
            </label>
            <input
              className="field__input engineer-week-simple__num" type="number" min="0"
              value={eng.weekly_total || 0}
              onFocus={e => e.target.select()}
              onChange={e => onChange(index, "weekly_total", e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <ActivitySelector
              label="Actividades de la semana"
              activities={activities}
              selected={weeklyArr}
              limit={limit}
              onChange={val => onChange(index, "weekly_detail", val)}
              excludeOldCompleted={taskStatus?.completed}
              completedDates={taskStatus?.completed_dates}
              fixedAssigned={fixedAssigned}
            />
          </div>
        </div>

        <div className="engineer-section">
          <div className="engineer-section__title">
            Seleccionadas
            {weeklyArr.length > 0 && (
              <span className="engineer-selected__count">{weeklyArr.length}</span>
            )}
          </div>
          {weeklyArr.length === 0 ? (
            <p className="engineer-selected__empty">Selecciona actividades en "Esta semana"</p>
          ) : (
            <SelectedList items={weeklyArr} activities={activities} onChange={val => onChange(index, "weekly_detail", val)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Combobox de actividad con búsqueda integrada ──────────────────────────────

function ActivitySelect({ value, activities, onChange }) {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState("");
  const rootRef  = useRef(null);
  const inputRef = useRef(null);

  const acts = safeActs(activities);
  const opts = acts.map((act, ai) => ({ id: act.id, label: `${ai + 1}. ${act.text}` }));
  const visible = opts.filter(o => matchesSearch(o.label, query));
  const selectedLabel = opts.find(o => o.id === value)?.label || "";

  const select = (opt) => {
    onChange(opt.id);
    setOpen(false);
    setQuery("");
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange("");
    setOpen(false);
    setQuery("");
  };

  // Cierra el dropdown al hacer clic fuera
  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="act-entry-select" ref={rootRef}>
      {/* Trigger — muestra el valor seleccionado */}
      <div
        className={`act-entry-select__trigger ${open ? "act-entry-select__trigger--open" : ""}`}
        onClick={handleOpen}
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); } }}
      >
        <span className={`act-entry-select__trigger-text ${!value ? "act-entry-select__trigger-text--placeholder" : ""}`}>
          {selectedLabel || "— Sin actividad —"}
        </span>
        <div className="act-entry-select__trigger-icons">
          {value && (
            <button type="button" className="act-entry-select__x" onClick={clear} title="Quitar selección">✕</button>
          )}
          <span className="act-entry-select__arrow">{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="act-entry-select__dropdown">
          <div className="act-entry-select__search">
            <input
              ref={inputRef}
              className="act-entry-select__search-input"
              type="text" placeholder="Buscar actividad…"
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && visible.length === 1) select(visible[0]);
              }}
            />
            {query && (
              <button type="button" className="act-entry-select__search-clear" onClick={() => setQuery("")} title="Limpiar">✕</button>
            )}
          </div>
          <ul className="act-entry-select__list">
            <li
              className={`act-entry-select__opt act-entry-select__opt--none ${!value ? "act-entry-select__opt--active" : ""}`}
              onMouseDown={() => select({ id: "" })}
            >
              — Sin actividad —
            </li>
            {visible.length === 0 ? (
              <li className="act-entry-select__opt act-entry-select__opt--empty">Sin coincidencias</li>
            ) : (
              visible.map((opt) => (
                <li
                  key={opt.id}
                  className={`act-entry-select__opt ${value === opt.id ? "act-entry-select__opt--active" : ""}`}
                  onMouseDown={() => select(opt)}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Fechas clave estructuradas ────────────────────────────────────────────────

function ActivityEntryList({ items, activities, textField, placeholder, onChange }) {
  const update = (i, field, val) => onChange(items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const remove = (i)             => onChange(items.filter((_, idx) => idx !== i));
  const actIndex = buildActivityIndex(safeActs(activities));

  const byActivity = {};
  items.forEach((item, i) => {
    const key = item.activity || "__sin__";
    if (!byActivity[key]) byActivity[key] = [];
    byActivity[key].push({ ...item, _idx: i });
  });

  return (
    <>
      {Object.entries(byActivity).map(([actKey, group]) => (
        <div key={actKey} className="milestone-group">
          {actKey !== "__sin__" && (
            <div className="milestone-group__header">
              <span className="milestone-group__act">{activityLabel(actIndex, actKey)}</span>
            </div>
          )}
          {group.map((item) => (
            <div key={item._idx} className="milestone-row">
              <div className="milestone-row__fields">
                <div className="field" style={{ flex: 2, minWidth: 0 }}>
                  <label className="field__label" style={{ fontSize: "11px" }}>Actividad</label>
                  <ActivitySelect
                    value={item.activity || ""}
                    activities={activities}
                    onChange={val => update(item._idx, "activity", val)}
                  />
                </div>
                <div className="field" style={{ flex: "0 0 160px" }}>
                  <label className="field__label" style={{ fontSize: "11px" }}>Fecha</label>
                  <input
                    type="date" className="field__input"
                    value={item.date || ""}
                    onChange={e => update(item._idx, "date", e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 3, minWidth: 0 }}>
                  <label className="field__label" style={{ fontSize: "11px" }}>{textField === "note" ? "Descripción / Hito" : "Comentario"}</label>
                  <input
                    type="text" className="field__input"
                    value={item[textField] || ""}
                    placeholder={placeholder}
                    onChange={e => update(item._idx, textField, e.target.value)}
                  />
                </div>
                <button
                  type="button" className="milestone-row__remove btn btn--danger"
                  onClick={() => remove(item._idx)} title="Eliminar"
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
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

function TaskStatusSelector({ taskStatus, activities, onChange }) {
  const ts   = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);
  const actIndex = buildActivityIndex(acts);

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
                    const hist = ts.status_history?.[item] || {};
                    return (
                      <li
                        key={item} className="task-status-col__item"
                        draggable
                        onDragStart={() => colDragStart(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => colDrop(i)}
                        title="Arrastra para reordenar"
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
                                onClick={() => move(item, other.key)}
                              >
                                {other.icon}
                              </button>
                            ))}
                            <button
                              type="button" className="task-status-col__remove-btn"
                              title="Quitar de la lista" onClick={() => remove(item)}
                            >✕</button>
                          </div>
                        </div>
                        <div className="task-status-col__dates">
                          <StatusDateBadge
                            label="Inscrita"
                            value={hist.added || null}
                            onEdit={v => editHistoryDate(item, "added", v)}
                          />
                          {col.key === "in_progress" && (
                            <StatusDateBadge
                              label="En proceso"
                              value={hist.in_progress || null}
                              onEdit={v => editHistoryDate(item, "in_progress", v)}
                            />
                          )}
                          {col.key === "completed" && (
                            <StatusDateBadge
                              label="Completada"
                              value={hist.completed || null}
                              onEdit={v => editHistoryDate(item, "completed", v)}
                            />
                          )}
                        </div>
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

function MilestoneList({ milestones, activities, onChange }) {
  const items = Array.isArray(milestones) ? milestones : [];
  return (
    <div className="field field--optional">
      <div className="field__header">
        <label className="field__label">📅 Fechas Clave</label>
        <button type="button" className="btn-add-item" onClick={() => onChange([...items, createDefaultMilestone()])}>
          + Agregar fecha
        </button>
      </div>
      {items.length === 0
        ? <p className="act-list__empty">Sin fechas clave. Agrega la primera.</p>
        : <ActivityEntryList items={items} activities={activities} textField="note" placeholder="Ej: Entrega de back, Deploy a producción…" onChange={onChange} />
      }
    </div>
  );
}

function CommentList({ comments, activities, onChange }) {
  const items = Array.isArray(comments) ? comments : [];
  return (
    <div className="field field--optional">
      <div className="field__header">
        <label className="field__label">💬 Comentarios</label>
        <button type="button" className="btn-add-item" onClick={() => onChange([...items, createDefaultComment()])}>
          + Agregar comentario
        </button>
      </div>
      {items.length === 0
        ? <p className="act-list__empty">Sin comentarios. Agrega el primero.</p>
        : <ActivityEntryList items={items} activities={activities} textField="text" placeholder="Escribe el comentario…" onChange={onChange} />
      }
    </div>
  );
}

// ── Panel de asignación masiva ───────────────────────────────────────────────
// Permite seleccionar un ingeniero y marcar N actividades de una sola vez.

function BulkAssignPanel({ activities, engineerCatalog, taskStatus, onBulkAssign }) {
  const [expanded,      setExpanded]      = useState(false);
  const [selectedEngId, setSelectedEngId] = useState("");
  const [checked,       setChecked]       = useState(new Set());
  const [query,         setQuery]         = useState("");
  const [filterOwned,   setFilterOwned]   = useState(false); // solo sin responsable

  const acts          = safeActs(activities);
  const completedSet  = new Set(safeArr((taskStatus || {}).completed));
  const activeEngineers = (engineerCatalog || []).filter(e => e.active);

  // Actividades no completadas (las completadas no necesitan reasignación masiva)
  const assignable = acts.filter(a => !completedSet.has(a.id));

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
              <option value="">— Seleccionar ingeniero —</option>
              {activeEngineers.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
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
              const currentEng = (a.assigned_engineers || [])[0];
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
                  {currentEng ? (
                    <span className="bulk-assign-row__owner">{currentEng.name}</span>
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

// ── Asignación fija de actividades a ingenieros ───────────────────────────────
// Persiste hasta que la actividad se marque como completada.
// No se reinicia con "Nueva semana".

const ROW_HEIGHT_PX = 44; // altura aproximada de cada fila
const MAX_VISIBLE   = 7;

function ActivityAssignmentRow({ activity, position, engineerCatalog, completedBy, onToggleEngineer }) {
  const isCompleted    = !!completedBy;
  const assignedIds    = new Set((activity.assigned_engineers || []).map(e => e.id));
  const activeEngineers = (engineerCatalog || []).filter(e => e.active || assignedIds.has(e.id));

  if (isCompleted) {
    // completedBy es array [{engineer_id, engineer_name}]
    const names = Array.isArray(completedBy)
      ? completedBy.map(e => e.engineer_name).filter(Boolean).join(", ")
      : (completedBy.engineer_name || "—");
    return (
      <div className="act-assign-row act-assign-row--completed">
        <span className="act-assign-row__num">{position}.</span>
        <span className="act-assign-row__text act-assign-row__text--done">{activity.text}</span>
        <span className="act-assign-row__badge-done">✓ {names}</span>
      </div>
    );
  }

  return (
    <div className="act-assign-row act-assign-row--multi">
      <div className="act-assign-row__top">
        <span className="act-assign-row__num">{position}.</span>
        <span className="act-assign-row__text">{activity.text}</span>
      </div>
      <div className="act-assign-row__chips">
        {(activity.assigned_engineers || []).map(e => (
          <span key={e.id} className="act-assign-chip">
            {e.name}
            <button
              type="button"
              className="act-assign-chip__remove"
              onClick={() => onToggleEngineer(activity.id, e.id, false)}
              title={`Quitar a ${e.name}`}
            >✕</button>
          </span>
        ))}
        {activeEngineers.filter(e => !assignedIds.has(e.id)).length > 0 && (
          <select
            className="field__input act-assign-row__select"
            value=""
            onChange={e => { if (e.target.value) onToggleEngineer(activity.id, e.target.value, true); }}
          >
            <option value="">{assignedIds.size === 0 ? "Asignar…" : "+ Otro…"}</option>
            {activeEngineers.filter(e => !assignedIds.has(e.id)).map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ActivityAssignmentSection({ activities, taskStatus, engineerCatalog, onActivitiesChange }) {
  const [query,         setQuery]         = useState("");
  const [filterEngId,   setFilterEngId]   = useState("");  // "" = todos

  const completedSet = new Set(safeArr((taskStatus || {}).completed));
  const completedBy  = (taskStatus || {}).completed_by || {};

  const allActs     = safeActs(activities);
  const positionMap = new Map(allActs.map((a, i) => [a.id, i + 1]));

  const assignableActs = allActs.filter(a => !completedSet.has(a.id));
  const completedActs  = allActs.filter(a => completedSet.has(a.id) && completedBy[a.id]);

  // Ingenieros que tienen al menos una actividad asignada (para el filtro dropdown)
  const assignedEngineers = (() => {
    const seen = new Map();
    allActs.forEach(a => {
      (a.assigned_engineers || []).forEach(e => {
        if (!seen.has(e.id)) seen.set(e.id, e.name);
      });
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

  const applyFilters = (arr) => {
    let result = arr;
    // Filtro por ingeniero
    if (filterEngId) {
      result = result.filter(a => (a.assigned_engineers || []).some(e => e.id === filterEngId));
    }
    // Búsqueda por texto / número
    if (query.trim()) {
      const words = query.trim().toLowerCase().split(/\s+/);
      result = result.filter(a => {
        const haystack = `${positionMap.get(a.id)} ${a.text}`.toLowerCase();
        return words.every(w => haystack.includes(w));
      });
    }
    return result;
  };

  const visibleAssignable = applyFilters(assignableActs);
  const visibleCompleted  = applyFilters(completedActs);
  const allVisible        = [...visibleAssignable, ...visibleCompleted];
  const totalRows         = allVisible.length;
  const needsScroll       = totalRows > MAX_VISIBLE;
  const listMaxHeight     = needsScroll ? `${MAX_VISIBLE * ROW_HEIGHT_PX}px` : undefined;

  const handleToggleEngineer = (actId, engineerId, add) => {
    const catalog  = engineerCatalog || [];
    const engEntry = catalog.find(e => e.id === engineerId);
    const today    = new Date().toISOString().slice(0, 10);
    const newActs  = allActs.map(a => {
      if (a.id !== actId) return a;
      const current = a.assigned_engineers || [];
      const updated = add
        ? (current.some(e => e.id === engineerId) ? current : [...current, { id: engineerId, name: engEntry?.name || "" }])
        : current.filter(e => e.id !== engineerId);
      return {
        ...a,
        assigned_engineers: updated,
        assigned_date: updated.length > 0 ? (a.assigned_date || today) : null,
      };
    });
    // Si el ingeniero quitado era el del filtro activo y ya no tiene actividades, limpiamos el filtro
    if (!add && filterEngId === engineerId) {
      const stillHas = newActs.some(a => (a.assigned_engineers || []).some(e => e.id === engineerId));
      if (!stillHas) setFilterEngId("");
    }
    onActivitiesChange(newActs);
  };

  if (!allActs.length) {
    return (
      <div className="field field--optional">
        <div className="field__header">
          <label className="field__label">👤 Asignación de Responsables</label>
        </div>
        <p className="act-list__empty">Agrega actividades identificadas para poder asignarlas.</p>
      </div>
    );
  }

  const assignedCount   = assignableActs.filter(a => (a.assigned_engineers || []).length > 0).length;
  const activeFilters   = !!query.trim() || !!filterEngId;

  return (
    <div className="field field--optional">
      <div className="field__header">
        <label className="field__label">👤 Asignación de Responsables</label>
        <span className="field__header-hint">
          {assignedCount} de {assignableActs.length} asignadas
        </span>
      </div>

      {/* Barra de filtros */}
      <div className="act-assign-filters">
        {/* Búsqueda por texto */}
        <div className="act-assign-search">
          <input
            className="act-assign-search__input"
            type="text"
            placeholder="Buscar por número o texto…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="act-assign-search__clear" onClick={() => setQuery("")} title="Limpiar">✕</button>
          )}
        </div>

        {/* Filtro por ingeniero — solo muestra los que tienen actividades asignadas */}
        <select
          className="field__input act-assign-filter-eng"
          value={filterEngId}
          onChange={e => setFilterEngId(e.target.value)}
        >
          <option value="">Todos los ingenieros</option>
          {assignedEngineers.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        {/* Contador de resultados + limpiar filtros */}
        {activeFilters && (
          <div className="act-assign-filters__right">
            <span className="act-assign-search__count">{totalRows} resultado{totalRows !== 1 ? "s" : ""}</span>
            <button
              type="button"
              className="act-assign-filters__clear-all"
              onClick={() => { setQuery(""); setFilterEngId(""); }}
            >Limpiar filtros</button>
          </div>
        )}
      </div>

      <div
        className={`act-assign-list${needsScroll ? " act-assign-list--scroll" : ""}`}
        style={needsScroll ? { maxHeight: listMaxHeight } : undefined}
      >
        {allVisible.length === 0 ? (
          <p className="act-assign-empty">
            {activeFilters ? "Sin coincidencias para los filtros aplicados." : "Sin actividades."}
          </p>
        ) : (
          <>
            {visibleAssignable.map(a => (
              <ActivityAssignmentRow
                key={a.id}
                activity={a}
                position={positionMap.get(a.id)}
                engineerCatalog={engineerCatalog}
                completedBy={null}
                onToggleEngineer={handleToggleEngineer}
              />
            ))}
            {visibleCompleted.length > 0 && (
              <>
                <div className="act-assign-divider">Completadas</div>
                {visibleCompleted.map(a => (
                  <ActivityAssignmentRow
                    key={a.id}
                    activity={a}
                    position={positionMap.get(a.id)}
                    engineerCatalog={engineerCatalog}
                    completedBy={completedBy[a.id]}
                    onToggleEngineer={handleToggleEngineer}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
      {needsScroll && (
        <p className="act-assign-scroll-hint">↕ Desliza para ver las {totalRows} actividades</p>
      )}
    </div>
  );
}

// ── EditView principal ────────────────────────────────────────────────────────

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onUpdateProjectFull, onSaveChanges,
  onReorderProjects, onAddProject, onRemoveProject, onViewReport, onExportReport,
  engineerCatalog, onCreateEngineer,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dragOverIdx,     setDragOverIdx]     = useState(null);
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
  const activities  = safeActs(p?.activities_identified);

  // Métricas calculadas automáticamente desde actividades y estado de actividades
  const ts              = p?.task_status || {};
  const autoTotal       = activities.length;
  const autoCompletadas = safeArr(ts.completed).length;
  const autoEnProceso   = safeArr(ts.in_progress).length;
  const autoNoIniciadas = Math.max(0, autoTotal - autoCompletadas - autoEnProceso);

  const updateMetric = (field, val) =>
    onUpdateProject(editingIdx, "manual_metrics", { ...m, [field]: val === "" ? "" : Number(val) });

  // Recalcula total/completadas/en_proceso desde actividades y task_status
  const buildAutoMetrics = (newActs, newTs) => ({
    ...m,
    total_tasks:       newActs.length,
    completed_tasks:   safeArr(newTs.completed).length,
    in_progress_tasks: safeArr(newTs.in_progress).length,
  });

  const addEngineer    = () => onUpdateProject(editingIdx, "engineers",   [...engineers,   createDefaultEngineer()]);
  const updateEngineer = (i, f, v) => onUpdateProject(editingIdx, "engineers",   engineers.map((e, idx)   => idx === i ? { ...e,   [f]: v } : e));
  const removeEngineer = (i)       => onUpdateProject(editingIdx, "engineers",   engineers.filter((_, idx) => idx !== i));

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
      activities_identified: newActs,
      task_status: {
        ...newTs,
        completed_dates: pruneObjKeys(ts.completed_dates),
        status_history:  pruneObjKeys(ts.status_history),
      },
      manual_metrics:        buildAutoMetrics(newActs, newTs),
      weekly_achievements:   pruneArr(p.weekly_achievements),
      next_week_plan:        pruneArr(p.next_week_plan),
      engineers: (p.engineers || []).map(eng => ({
        ...eng,
        weekly_detail: pruneArr(eng.weekly_detail),
      })),
      milestones: (p.milestones || []).map(ms => ({
        ...ms,
        activity: validIds.has(ms.activity) ? ms.activity : "",
      })),
      comments: (p.comments || []).map(cm => ({
        ...cm,
        activity: validIds.has(cm.activity) ? cm.activity : "",
      })),
    });
  };

  const handleUpdateActivityMeta = (actId, newEngId, newStatus) => {
    let updatedActs = activities.map(a => {
      if (a.id !== actId) return a;
      let updatedEngs = a.assigned_engineers || [];
      let updatedDate = a.assigned_date;
      if (newEngId !== undefined) {
        if (newEngId === "") {
          updatedEngs = [];
          updatedDate = null;
        } else {
          const eng = (engineerCatalog || []).find(e => e.id === newEngId);
          if (eng) {
            updatedEngs = [{ id: eng.id, name: eng.name }];
            updatedDate = a.assigned_date || new Date().toISOString().slice(0, 10);
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
    const eng = (engineerCatalog || []).find(e => e.id === engId);
    if (!eng) return;
    const today  = new Date().toISOString().slice(0, 10);
    const idSet  = new Set(actIds);
    const newActs = activities.map(a => {
      if (!idSet.has(a.id)) return a;
      return {
        ...a,
        assigned_engineers: [{ id: eng.id, name: eng.name }],
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
            <h2 style={{ fontSize: "18px", color: "var(--azul-oscuro)" }}>Editando: {p.project_name || "Nuevo Proyecto"}</h2>
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
            taskStatus={p.task_status}
            onChange={handleActivitiesChange}
            onUpdateActivityMeta={handleUpdateActivityMeta}
            onAddActivity={handleAddActivity}
          />

          {/* ══ 3b. Asignación masiva ══ */}
          {activities.length > 0 && (
            <BulkAssignPanel
              activities={activities}
              engineerCatalog={engineerCatalog}
              taskStatus={p.task_status}
              onBulkAssign={handleBulkAssign}
            />
          )}

          {/* ══ 4. Estado de actividades ══ */}
          {activities.length > 0 && (
            <div className="field field--optional">
              <label className="field__label" style={{ marginBottom: 10 }}>
                Estado de Actividades
                <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
                  Clasifica cada actividad en su estado actual
                </span>
              </label>
              <TaskStatusSelector
                taskStatus={p.task_status}
                activities={activities}
                onChange={val => onUpdateProjectFull(editingIdx, {
                  ...p,
                  task_status:    val,
                  manual_metrics: buildAutoMetrics(activities, val),
                })}
              />
            </div>
          )}

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

          {/* ══ 9. Estado actual del proyecto ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">📋 Estado actual del proyecto</label>
            </div>
            <textarea
              className="field__textarea status-notes__textarea"
              rows={6}
              placeholder="Redacta aquí el estado actual del proyecto: avances, decisiones tomadas, bloqueos, contexto importante, notas para la próxima revisión..."
              value={p.status_notes || ""}
              onChange={e => onUpdateProject(editingIdx, "status_notes", e.target.value)}
            />
            {p.status_notes && (
              <div className="status-notes__preview">
                {p.status_notes.split("\n").map((line, i) =>
                  line.trim() ? <p key={i} className="status-notes__line">{line}</p> : <br key={i} />
                )}
              </div>
            )}
          </div>

          {/* ══ 10. Cierre semanal ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Sección de Cierre</label>
              <label className="field__checkbox-wrapper">
                <input
                  type="checkbox" checked={p.show_closing_fields}
                  onChange={e => onUpdateProject(editingIdx, "show_closing_fields", e.target.checked)}
                />
                Habilitar campos
              </label>
            </div>
            {p.show_closing_fields ? (
              <div className="edit-row edit-row--2col" style={{ marginTop: "12px" }}>
                <div className="field">
                  <label className="field__label">→ Plan para la próxima semana</label>
                  <ActivitySelector
                    label="Selecciona las actividades planificadas"
                    activities={activities}
                    selected={safeArr(p.next_week_plan)}
                    onChange={val => onUpdateProject(editingIdx, "next_week_plan", val)}
                    excludeCompleted={p.task_status?.completed}
                  />
                </div>
                <div className="field">
                  <label className="field__label">✓ ¿Qué se hizo esta semana?</label>
                  <ActivitySelector
                    label="Selecciona las actividades completadas"
                    activities={activities}
                    selected={safeArr(p.weekly_achievements)}
                    onChange={val => onUpdateProject(editingIdx, "weekly_achievements", val)}
                    excludeOldCompleted={p.task_status?.completed}
                    completedDates={p.task_status?.completed_dates}
                  />
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "12px", color: "var(--text-3)", marginTop: 8 }}>
                Activa esta sección para registrar el cierre semanal.
              </p>
            )}
          </div>

          {/* ══ 9. Fechas clave ══ */}
          <MilestoneList
            milestones={p.milestones}
            activities={activities}
            onChange={val => onUpdateProject(editingIdx, "milestones", val)}
          />

          {/* ══ 11. Comentarios ══ */}
          <CommentList
            comments={p.comments}
            activities={activities}
            onChange={val => onUpdateProject(editingIdx, "comments", val)}
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
    </div>
  );
}
