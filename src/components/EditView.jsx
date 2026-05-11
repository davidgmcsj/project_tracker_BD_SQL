import { useState, useRef } from "react";
import { projectProgress } from "../utils/formulas";

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
              <button className="btn btn--danger" onClick={() => setStep(2)}>Sí, continuar</button>
            </div>
          </>
        ) : (
          <>
            <div className="delete-modal__icon">🗑️</div>
            <h3 className="delete-modal__title">Confirmación final</h3>
            <p className="delete-modal__body">
              ¿Confirmas que deseas eliminar permanentemente el proyecto <strong>"{projectName}"</strong>?
            </p>
            <div className="delete-modal__actions">
              <button className="btn btn--secondary" onClick={onCancel}>Cancelar</button>
              <button className="btn btn--danger-solid" onClick={onConfirm}>Eliminar definitivamente</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
const STATUS_OPTIONS = [
  { value: "on-track", label: "En curso" },
  { value: "at-risk", label: "En riesgo" },
  { value: "blocked", label: "Bloqueado" },
  { value: "completed", label: "Completado" },
];

const ENGINEER_LIST = [
  "Alvaro Antonio Baena Rubio",
  "Andres Esteban Romero Romero",
  "Aseneth Quintero Bernate",
  "Brayan Jair Robayo Vera",
  "Cristian Mauricio Ortegon Martinez",
  "David Alejandro Gonzalez Mateus",
  "David Alzate Gomez",
  "Emirt Lorenzo Adams Saenz",
  "Ingrid Jhulieth Estacio Carvajal",
  "John Ervey Sanchez Velandia",
  "Juan Carlos Verano Estrada",
  "Moises Bernardo Suarez Gamez",
  "Oscar Andres Mancera Garzón",
  "Steven Osorio Tipan",
  "Otro...",
];

function ListField({ label, value, onChange, addLabel, placeholder, rows = 4 }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft]   = useState("");

  const confirm = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      const current = value ? value.trimEnd() : "";
      onChange(current ? current + "\n" + trimmed : trimmed);
    }
    setDraft("");
    setAdding(false);
  };

  const cancel = () => { setDraft(""); setAdding(false); };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirm(); }
    if (e.key === "Escape") cancel();
  };

  return (
    <div className="field">
      <div className="field__header">
        <label className="field__label">{label}</label>
        {!adding && (
          <button type="button" className="btn-add-item"
            onClick={() => { setAdding(true); setDraft(""); }}>
            + {addLabel}
          </button>
        )}
      </div>

      {adding && (
        <div className="list-field-draft">
          <input
            className="field__input list-field-draft__input"
            autoFocus
            value={draft}
            placeholder={`Escribe y presiona Enter o ✓…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="list-field-draft__ok" onClick={confirm}
            title="Confirmar">✓</button>
          <button type="button" className="list-field-draft__cancel" onClick={cancel}
            title="Cancelar">✕</button>
        </div>
      )}

      <textarea
        className="field__textarea"
        rows={rows}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function EngineerRow({ eng, index, onChange, onRemove }) {
  const [addingWeek, setAddingWeek] = useState(false);
  const [weekDraft, setWeekDraft]   = useState("");

  const noInitGlobal = Math.max(0, eng.assigned - eng.completed - eng.inProgress);
  const isOverGlobal = eng.completed + eng.inProgress > eng.assigned;
  const displayName  = eng.name === "Otro..." ? (eng.customName || "este ingeniero") : (eng.name || "este ingeniero");

  const confirmWeek = () => {
    const trimmed = weekDraft.trim();
    if (trimmed) {
      const current = (eng.weekActivities || "").trimEnd();
      onChange(index, "weekActivities", current ? current + "\n" + trimmed : trimmed);
    }
    setWeekDraft(""); setAddingWeek(false);
  };
  const cancelWeek = () => { setWeekDraft(""); setAddingWeek(false); };

  return (
    <div className="engineer-card">
      <div className="engineer-card__header">
        <div className="engineer-row__name">
          <select className="field__input" value={eng.name}
            onChange={(e) => onChange(index, "name", e.target.value)}>
            <option value="">Seleccionar ingeniero…</option>
            {ENGINEER_LIST.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {eng.name === "Otro..." && (
            <input className="field__input" style={{ marginTop: 6 }}
              placeholder="Nombre del ingeniero"
              value={eng.customName || ""}
              onChange={(e) => onChange(index, "customName", e.target.value)} />
          )}
        </div>
        <button className="btn btn--danger"
          style={{ padding: "4px 14px", fontSize: "12px", alignSelf: "flex-start" }}
          onClick={() => onRemove(index)} type="button">
          Quitar
        </button>
      </div>

      <div className="engineer-card__sections">
        {/* ── Global ── */}
        <div className="engineer-section">
          <div className="engineer-section__title">Global</div>
          <div className="engineer-header">
            <span>Asignadas</span>
            <span>Completadas</span>
            <span>En proceso</span>
            <span>No iniciadas</span>
          </div>
          <div className="engineer-row">
            <input className="field__input" type="number" min="0"
              value={eng.assigned} onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(index, "assigned", e.target.value === "" ? "" : Number(e.target.value))} />
            <input className="field__input" type="number" min="0"
              value={eng.completed} onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(index, "completed", e.target.value === "" ? "" : Number(e.target.value))}
              style={{ borderColor: isOverGlobal ? "var(--red)" : undefined }} />
            <input className="field__input" type="number" min="0"
              value={eng.inProgress} onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(index, "inProgress", e.target.value === "" ? "" : Number(e.target.value))}
              style={{ borderColor: isOverGlobal ? "var(--red)" : undefined }} />
            <input className="field__input" type="number" readOnly value={noInitGlobal}
              style={{ background: "#f8fafc", fontWeight: "bold", color: isOverGlobal ? "var(--red)" : "var(--text)" }} />
          </div>
          {isOverGlobal && (
            <div style={{ color: "var(--red)", fontSize: "12px", fontWeight: 600 }}>
              ⚠ Completadas + en proceso supera las asignadas.
            </div>
          )}
        </div>

        {/* ── Semana ── */}
        <div className="engineer-section">
          <div className="engineer-section__title">Esta semana</div>
          <div className="engineer-week-simple">
            <label className="field__label" style={{ fontSize: "11px" }}>Tareas semana</label>
            <input className="field__input engineer-week-simple__num" type="number" min="0"
              value={eng.weekTotal || 0} onFocus={(e) => e.target.select()}
              onChange={(e) => onChange(index, "weekTotal", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <div className="field__header">
              <label className="field__label" style={{ fontSize: "11px" }}>Actividades de la semana</label>
              {!addingWeek && (
                <button type="button" className="btn-add-item"
                  onClick={() => { setAddingWeek(true); setWeekDraft(""); }}>
                  + Agregar actividad
                </button>
              )}
            </div>
            {addingWeek && (
              <div className="list-field-draft">
                <input className="field__input list-field-draft__input" autoFocus
                  value={weekDraft}
                  placeholder="Escribe y presiona Enter o ✓…"
                  onChange={(e) => setWeekDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmWeek(); }
                    if (e.key === "Escape") cancelWeek();
                  }} />
                <button type="button" className="list-field-draft__ok" onClick={confirmWeek} title="Confirmar">✓</button>
                <button type="button" className="list-field-draft__cancel" onClick={cancelWeek} title="Cancelar">✕</button>
              </div>
            )}
            <textarea className="field__textarea" rows={3}
              placeholder={`Actividades de ${displayName} esta semana…\nUna por línea`}
              value={eng.weekActivities || ""}
              onChange={(e) => onChange(index, "weekActivities", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({ ind, index, onChange, onRemove }) {
  const pct    = Math.round(projectProgress(ind.total, ind.completed, ind.inProgress));
  const noInit = Math.max(0, ind.total - ind.completed - ind.inProgress);
  const isOver = ind.completed + ind.inProgress > ind.total;

  return (
    <div className="indicator-row">
      <div className="indicator-row__top">
        <input className="field__input indicator-row__name"
          placeholder="Nombre del indicador…"
          value={ind.name || ""}
          onChange={(e) => onChange(index, "name", e.target.value)} />
        <div className="indicator-row__pct" style={{
          background: pct >= 75 ? "var(--green-bg)" : pct >= 40 ? "var(--amber-bg)" : "var(--red-bg)",
          color:      pct >= 75 ? "var(--green)"    : pct >= 40 ? "var(--amber)"    : "var(--red)",
        }}>{pct}%</div>
        <button className="btn btn--danger" style={{ padding: "4px 12px", fontSize: "12px" }}
          onClick={() => onRemove(index)} type="button">Quitar</button>
      </div>
      <div className="indicator-row__nums">
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>Total actividades</label>
          <input className="field__input" type="number" min="0" value={ind.total}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange(index, "total", e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>Completadas</label>
          <input className="field__input" type="number" min="0" value={ind.completed}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange(index, "completed", e.target.value === "" ? "" : Number(e.target.value))}
            style={{ borderColor: isOver ? "var(--red)" : undefined }} />
        </div>
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>En proceso</label>
          <input className="field__input" type="number" min="0" value={ind.inProgress}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange(index, "inProgress", e.target.value === "" ? "" : Number(e.target.value))}
            style={{ borderColor: isOver ? "var(--red)" : undefined }} />
        </div>
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>No iniciadas (Auto)</label>
          <input className="field__input" type="number" readOnly value={noInit}
            style={{ background: "#f8fafc", fontWeight: "bold", color: isOver ? "var(--red)" : "var(--text)" }} />
        </div>
      </div>
      {isOver && (
        <div style={{ color: "var(--red)", fontSize: "12px", fontWeight: 600 }}>
          ⚠ Completadas + en proceso supera el total de este indicador.
        </div>
      )}
    </div>
  );
}

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onSaveChanges, onReorderProjects, onAddProject, onRemoveProject, onViewReport,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragSrcIdx = useRef(null);

  const handleDragStart = (e, i) => {
    dragSrcIdx.current = i;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(i);
  };

  const handleDrop = (e, i) => {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === i) { setDragOverIdx(null); return; }
    onReorderProjects(src, i);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };

  const p = editingIdx !== null ? projects[editingIdx] : null;

  const pending     = p ? Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities) : 0;
  const isOverLimit = p ? (p.completedActivities + p.inProgressActivities > p.totalActivities) : false;
  const engineers   = p?.engineers  || [];
  const indicators  = p?.indicators || [];
  const sharedTasks = Number(p?.sharedTasks || 0);

  const addEngineer    = () => onUpdateProject(editingIdx, "engineers", [...engineers, { name: "", customName: "", assigned: 0, completed: 0, inProgress: 0, weekTotal: 0, weekActivities: "" }]);
  const updateEngineer = (i, field, value) => onUpdateProject(editingIdx, "engineers", engineers.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  const removeEngineer = (i) => onUpdateProject(editingIdx, "engineers", engineers.filter((_, idx) => idx !== i));

  const addIndicator    = () => onUpdateProject(editingIdx, "indicators", [...indicators, { name: "", total: 0, completed: 0, inProgress: 0 }]);
  const updateIndicator = (i, field, value) => onUpdateProject(editingIdx, "indicators", indicators.map((ind, idx) => idx === i ? { ...ind, [field]: value } : ind));
  const removeIndicator = (i) => onUpdateProject(editingIdx, "indicators", indicators.filter((_, idx) => idx !== i));

  const listField = (label, field, addLabel, placeholder, rows) => (
    <ListField
      label={label}
      value={p[field] || ""}
      onChange={(v) => onUpdateProject(editingIdx, field, v)}
      addLabel={addLabel}
      placeholder={placeholder}
      rows={rows}
    />
  );

  return (
    <div className="edit-view">
      <div className="project-tabs">
        {projects.map((proj, i) => (
          <button
            key={proj.id}
            draggable
            className={`project-tab ${editingIdx === i ? "project-tab--active" : ""} ${dragOverIdx === i ? "project-tab--drag-over" : ""}`}
            onClick={() => onSelectProject(i)}
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            title="Arrastra para reordenar"
          >
            <span className="project-tab__grip">⠿</span>
            {proj.name || `Proyecto ${i + 1}`}
          </button>
        ))}
        <button className="project-tab project-tab--add" onClick={onAddProject}>+ Nuevo</button>
      </div>

      {p ? (
        <div className="edit-panel">
          <div className="edit-panel__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", color: "var(--azul-oscuro)" }}>Editando: {p.name || "Nuevo Proyecto"}</h2>
            <button className={`btn ${hasUnsavedChanges ? "btn--accent" : ""}`}
              onClick={onSaveChanges} style={{ padding: "10px 24px", fontSize: "14px" }}
              disabled={!hasUnsavedChanges}>
              {hasUnsavedChanges ? "💾 Guardar cambios" : "✓ Guardado"}
            </button>
          </div>

          {/* ── Nombre, Estado, Planner ── */}
          <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            <div className="field">
              <label className="field__label">Nombre del proyecto</label>
              <input className="field__input" value={p.name} placeholder="Ej: Migración CRM"
                onChange={(e) => onUpdateProject(editingIdx, "name", e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label">Estado</label>
              <select className="field__input" value={p.status}
                onChange={(e) => onUpdateProject(editingIdx, "status", e.target.value)}>
                {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label">Planner</label>
              <input className="field__input" value={p.plannerUrl || ""} placeholder="https://tasks.office.com/…"
                onChange={(e) => onUpdateProject(editingIdx, "plannerUrl", e.target.value)} />
            </div>
          </div>

          {/* ── Totales del proyecto ── */}
          <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
            <div className="field">
              <label className="field__label">Total actividades</label>
              <input className="field__input" type="number" min="0" value={p.totalActivities}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onUpdateProject(editingIdx, "totalActivities", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field__label">Completadas</label>
              <input className="field__input" type="number" min="0" value={p.completedActivities}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onUpdateProject(editingIdx, "completedActivities", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field__label">En proceso</label>
              <input className="field__input" type="number" min="0" value={p.inProgressActivities}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onUpdateProject(editingIdx, "inProgressActivities", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field__label">No iniciados (Auto)</label>
              <input className="field__input" type="number" readOnly value={pending}
                style={{ backgroundColor: "#f8fafc", fontWeight: "bold", color: isOverLimit ? "var(--red)" : "var(--text)" }} />
            </div>
          </div>
          {isOverLimit && (
            <div style={{ color: "var(--red)", fontSize: "12px", fontWeight: "600" }}>
              ⚠ La suma de completadas y en proceso supera el total de actividades.
            </div>
          )}

          {/* ══════════ INDICADORES ══════════ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Indicadores</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }}
                onClick={addIndicator} type="button">
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

          {/* ══════════ ACTIVIDADES SEMANALES ══════════ */}
          {listField("Actividades Identificadas", "activitiesOfTheWeek", "Agregar actividad", "Actividad 1\nActividad 2…")}

          <div className="edit-row edit-row--2col">
            {listField("Actividades no iniciadas", "pendingActivities", "Agregar actividad", "Tarea 1\nTarea 2…")}
            {listField("Bloqueantes", "blockers", "Agregar bloqueante", "Bloqueante 1\nBloqueante 2…")}
          </div>

          {p.blockers && listField("Impacto de los bloqueantes", "blockersImpact", "Agregar impacto", "Describe el impacto…", 3)}

          {/* ══════════ INGENIEROS ══════════ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Equipo de ingenieros</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }}
                onClick={addEngineer} type="button">
                + Agregar ingeniero
              </button>
            </div>

            {engineers.length > 0 && (
              <>
                {engineers.map((eng, i) => (
                  <EngineerRow key={i} eng={eng} index={i} onChange={updateEngineer} onRemove={removeEngineer} />
                ))}

                {/* Tareas compartidas */}
                <div className="shared-tasks-row">
                  <span className="shared-tasks-row__label">Tareas compartidas entre ingenieros</span>
                  <input className="field__input shared-tasks-row__input"
                    type="number" min="0" value={sharedTasks}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onUpdateProject(editingIdx, "sharedTasks", e.target.value === "" ? 0 : Number(e.target.value))} />
                </div>
              </>
            )}
          </div>

          {/* ══════════ SALIDAS NO CONFORMES & RIESGOS ══════════ */}
          <div className="edit-row edit-row--2col">
            {listField("Salidas no conformes", "nonConformances", "Agregar salida no conforme", "Salida no conforme 1\nSalida no conforme 2…")}
            {listField("Riesgos", "risks", "Agregar riesgo", "Riesgo 1\nRiesgo 2…")}
          </div>

          {/* ══════════ SECCIÓN CIERRE ══════════ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Sección de Cierre</label>
              <label className="field__checkbox-wrapper">
                <input type="checkbox" checked={p.showFridayFields}
                  onChange={(e) => onUpdateProject(editingIdx, "showFridayFields", e.target.checked)} />
                Habilitar campos
              </label>
            </div>
            <div className="edit-row edit-row--2col" style={{ marginTop: "12px", opacity: p.showFridayFields ? 1 : 0.5 }}>
              <div className="field">
                <label className="field__label">→ Plan para la próxima semana</label>
                {p.showFridayFields
                  ? <ListField label="" value={p.weekPlanned || ""} addLabel="Agregar actividad"
                      placeholder="Objetivos para la próxima semana…"
                      onChange={(v) => onUpdateProject(editingIdx, "weekPlanned", v)} rows={4} />
                  : <textarea className="field__textarea" rows={4} disabled value={p.weekPlanned || ""}
                      placeholder="Objetivos para la próxima semana…" onChange={() => {}} />
                }
              </div>
              <div className="field">
                <label className="field__label">✓ ¿Qué se hizo esta semana?</label>
                {p.showFridayFields
                  ? <ListField label="" value={p.weekAccomplishments || ""} addLabel="Agregar logro"
                      placeholder="Logros y avances concretos…"
                      onChange={(v) => onUpdateProject(editingIdx, "weekAccomplishments", v)} rows={4} />
                  : <textarea className="field__textarea" rows={4} disabled value={p.weekAccomplishments || ""}
                      placeholder="Logros y avances concretos…" onChange={() => {}} />
                }
              </div>
            </div>
          </div>

          {listField("📅 Fechas clave", "keyDates", "Agregar fecha", "Hito, entrega, deadline…", 2)}

          {listField("Comentarios", "comments", "Agregar comentario", "Comentario 1\nComentario 2…", 3)}

          <div className="edit-panel__footer">
            <button className="btn btn--accent" onClick={() => onViewReport(editingIdx)}>
              📄 Ver reporte
            </button>
            <button className="btn btn--danger" onClick={() => setShowDeleteModal(true)}>
              Eliminar proyecto
            </button>
          </div>

          {showDeleteModal && (
            <DeleteConfirmModal
              projectName={p?.name || "este proyecto"}
              onCancel={() => setShowDeleteModal(false)}
              onConfirm={() => {
                setShowDeleteModal(false);
                onRemoveProject(editingIdx);
              }}
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
