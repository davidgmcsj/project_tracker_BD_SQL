import { useState, useRef } from "react";
import { projectProgress, createDefaultEngineer, createDefaultIndicator, createDefaultImpediment } from "../utils/formulas";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "on-track",  label: "En curso"    },
  { value: "at-risk",   label: "En riesgo"   },
  { value: "blocked",   label: "Bloqueado"   },
  { value: "completed", label: "Completado"  },
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

// UI label → category key
const IMPEDIMENT_TYPES = [
  { category: "blocker",        label: "Bloqueante",         icon: "🚫", hasImpact: true  },
  { category: "risk",           label: "Riesgo",             icon: "🔶", hasImpact: true  },
  { category: "non_conformity", label: "Salida no conforme", icon: "⚠️", hasImpact: false },
];
const IMPEDIMENT_META = Object.fromEntries(IMPEDIMENT_TYPES.map(t => [t.category, t]));

// ── Sub-componentes ───────────────────────────────────────────────────────────

function DeleteConfirmModal({ projectName, onConfirm, onCancel }) {
  const [step, setStep] = useState(1);
  return (
    <div className="delete-modal-overlay">
      <div className="delete-modal">
        {step === 1 ? (
          <>
            <div className="delete-modal__icon">⚠️</div>
            <h3 className="delete-modal__title">¿Eliminar proyecto?</h3>
            <p className="delete-modal__body">Estás a punto de eliminar <strong>"{projectName}"</strong>.<br />Esta acción no se puede deshacer.</p>
            <div className="delete-modal__actions">
              <button className="btn btn--secondary" onClick={onCancel}>Cancelar</button>
              <button className="btn btn--danger" onClick={() => setStep(2)}>Sí, continuar</button>
            </div>
          </>
        ) : (
          <>
            <div className="delete-modal__icon">🗑️</div>
            <h3 className="delete-modal__title">Confirmación final</h3>
            <p className="delete-modal__body">¿Confirmas eliminar permanentemente <strong>"{projectName}"</strong>?</p>
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

function ListField({ label, value, onChange, addLabel, placeholder, rows = 4 }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft]   = useState("");

  const confirm = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      const current = value ? value.trimEnd() : "";
      onChange(current ? current + "\n" + trimmed : trimmed);
    }
    setDraft(""); setAdding(false);
  };
  const cancel = () => { setDraft(""); setAdding(false); };

  return (
    <div className="field">
      <div className="field__header">
        <label className="field__label">{label}</label>
        {!adding && (
          <button type="button" className="btn-add-item" onClick={() => setAdding(true)}>
            + {addLabel}
          </button>
        )}
      </div>
      {adding && (
        <div className="list-field-draft">
          <input className="field__input list-field-draft__input" autoFocus value={draft}
            placeholder="Escribe y presiona Enter o ✓…"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirm(); } if (e.key === "Escape") cancel(); }} />
          <button type="button" className="list-field-draft__ok"     onClick={confirm} title="Confirmar">✓</button>
          <button type="button" className="list-field-draft__cancel" onClick={cancel}  title="Cancelar">✕</button>
        </div>
      )}
      <textarea className="field__textarea" rows={rows} value={value || ""} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function ImpedimentRow({ item, index, onChange, onRemove }) {
  const meta = IMPEDIMENT_META[item.category] || IMPEDIMENT_TYPES[0];
  return (
    <div className="impediment-row">
      <div className="impediment-row__header">
        <span className="impediment-row__badge">{meta.icon} {meta.label}</span>
        <button className="btn btn--danger" style={{ padding: "3px 12px", fontSize: "12px" }}
          type="button" onClick={() => onRemove(index)}>Quitar</button>
      </div>
      <div className="field" style={{ marginTop: 6 }}>
        <label className="field__label" style={{ fontSize: "11px" }}>Descripción</label>
        <textarea className="field__textarea" rows={2} value={item.description || ""}
          placeholder={`Describe el ${meta.label.toLowerCase()}…`}
          onChange={e => onChange(index, "description", e.target.value)} />
      </div>
      {meta.hasImpact && (
        <div className="field" style={{ marginTop: 4 }}>
          <label className="field__label" style={{ fontSize: "11px" }}>Impacto</label>
          <textarea className="field__textarea" rows={2} value={item.impact || ""}
            placeholder="Describe el impacto…"
            onChange={e => onChange(index, "impact", e.target.value)} />
        </div>
      )}
    </div>
  );
}

function EngineerRow({ eng, index, onChange, onRemove }) {
  const [addingWeek, setAddingWeek] = useState(false);
  const [weekDraft,  setWeekDraft]  = useState("");

  const noInitGlobal = Math.max(0, eng.assigned - eng.completed - eng.in_progress);
  const isOverGlobal = eng.completed + eng.in_progress > eng.assigned;
  const displayName  = eng.engineer_id === "Otro..." ? (eng.custom_name || "este ingeniero") : (eng.engineer_id || "este ingeniero");

  const confirmWeek = () => {
    const trimmed = weekDraft.trim();
    if (trimmed) {
      const current = (eng.weekly_detail || "").trimEnd();
      onChange(index, "weekly_detail", current ? current + "\n" + trimmed : trimmed);
    }
    setWeekDraft(""); setAddingWeek(false);
  };

  return (
    <div className="engineer-card">
      <div className="engineer-card__header">
        <div className="engineer-row__name">
          <select className="field__input" value={eng.engineer_id}
            onChange={e => onChange(index, "engineer_id", e.target.value)}>
            <option value="">Seleccionar ingeniero…</option>
            {ENGINEER_LIST.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {eng.engineer_id === "Otro..." && (
            <input className="field__input" style={{ marginTop: 6 }} placeholder="Nombre del ingeniero"
              value={eng.custom_name || ""}
              onChange={e => onChange(index, "custom_name", e.target.value)} />
          )}
        </div>
        <button className="btn btn--danger" style={{ padding: "4px 14px", fontSize: "12px", alignSelf: "flex-start" }}
          type="button" onClick={() => onRemove(index)}>Quitar</button>
      </div>

      <div className="engineer-card__sections">
        {/* Global */}
        <div className="engineer-section">
          <div className="engineer-section__title">Global</div>
          <div className="engineer-header">
            <span>Asignadas</span><span>Completadas</span><span>En proceso</span><span>No iniciadas</span>
          </div>
          <div className="engineer-row">
            {[
              { field: "assigned",    border: false },
              { field: "completed",   border: isOverGlobal },
              { field: "in_progress", border: isOverGlobal },
            ].map(({ field, border }) => (
              <input key={field} className="field__input" type="number" min="0" value={eng[field]}
                onFocus={e => e.target.select()}
                style={{ borderColor: border ? "var(--red)" : undefined }}
                onChange={e => onChange(index, field, e.target.value === "" ? "" : Number(e.target.value))} />
            ))}
            <input className="field__input" type="number" readOnly value={noInitGlobal}
              style={{ background: "#f8fafc", fontWeight: "bold", color: isOverGlobal ? "var(--red)" : "var(--text)" }} />
          </div>
          {isOverGlobal && <div style={{ color:"var(--red)", fontSize:"12px", fontWeight:600 }}>⚠ Completadas + en proceso supera las asignadas.</div>}
        </div>

        {/* Semana */}
        <div className="engineer-section">
          <div className="engineer-section__title">Esta semana</div>
          <div className="engineer-week-simple">
            <label className="field__label" style={{ fontSize: "11px" }}>Tareas semana</label>
            <input className="field__input engineer-week-simple__num" type="number" min="0"
              value={eng.weekly_total || 0} onFocus={e => e.target.select()}
              onChange={e => onChange(index, "weekly_total", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <div className="field__header">
              <label className="field__label" style={{ fontSize: "11px" }}>Actividades de la semana</label>
              {!addingWeek && (
                <button type="button" className="btn-add-item" onClick={() => setAddingWeek(true)}>+ Agregar actividad</button>
              )}
            </div>
            {addingWeek && (
              <div className="list-field-draft">
                <input className="field__input list-field-draft__input" autoFocus value={weekDraft}
                  placeholder="Escribe y presiona Enter o ✓…"
                  onChange={e => setWeekDraft(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();confirmWeek();} if(e.key==="Escape"){setWeekDraft("");setAddingWeek(false);} }} />
                <button type="button" className="list-field-draft__ok"     onClick={confirmWeek}                                title="Confirmar">✓</button>
                <button type="button" className="list-field-draft__cancel" onClick={()=>{setWeekDraft("");setAddingWeek(false);}} title="Cancelar">✕</button>
              </div>
            )}
            <textarea className="field__textarea" rows={3}
              placeholder={`Actividades de ${displayName} esta semana…\nUna por línea`}
              value={eng.weekly_detail || ""}
              onChange={e => onChange(index, "weekly_detail", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({ ind, index, onChange, onRemove }) {
  const pct    = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
  const noInit = Math.max(0, ind.total - ind.completed - ind.in_progress);
  const isOver = ind.completed + ind.in_progress > ind.total;

  return (
    <div className="indicator-row">
      <div className="indicator-row__top">
        <input className="field__input indicator-row__name" placeholder="Nombre del indicador…"
          value={ind.name || ""} onChange={e => onChange(index, "name", e.target.value)} />
        <div className="indicator-row__pct" style={{
          background: pct>=75?"var(--green-bg)":pct>=40?"var(--amber-bg)":"var(--red-bg)",
          color:      pct>=75?"var(--green)"   :pct>=40?"var(--amber)"   :"var(--red)",
        }}>{pct}%</div>
        <button className="btn btn--danger" style={{ padding:"4px 12px", fontSize:"12px" }}
          type="button" onClick={() => onRemove(index)}>Quitar</button>
      </div>
      <div className="indicator-row__nums">
        {[
          { lbl:"Total actividades", field:"total"       },
          { lbl:"Completadas",       field:"completed"   },
          { lbl:"En proceso",        field:"in_progress" },
        ].map(({ lbl, field }) => (
          <div className="field" key={field}>
            <label className="field__label" style={{ fontSize:"11px" }}>{lbl}</label>
            <input className="field__input" type="number" min="0" value={ind[field]}
              onFocus={e => e.target.select()}
              style={{ borderColor: isOver && field!=="total" ? "var(--red)" : undefined }}
              onChange={e => onChange(index, field, e.target.value===""?"":Number(e.target.value))} />
          </div>
        ))}
        <div className="field">
          <label className="field__label" style={{ fontSize:"11px" }}>No iniciadas (Auto)</label>
          <input className="field__input" type="number" readOnly value={noInit}
            style={{ background:"#f8fafc", fontWeight:"bold", color: isOver?"var(--red)":"var(--text)" }} />
        </div>
      </div>
      {isOver && <div style={{ color:"var(--red)", fontSize:"12px", fontWeight:600 }}>⚠ Completadas + en proceso supera el total.</div>}
    </div>
  );
}

// ── EditView principal ────────────────────────────────────────────────────────

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onSaveChanges,
  onReorderProjects, onAddProject, onRemoveProject, onViewReport,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dragOverIdx, setDragOverIdx]         = useState(null);
  const dragSrcIdx = useRef(null);

  const handleDragStart = (e, i) => { dragSrcIdx.current = i; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver  = (e, i) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(i); };
  const handleDrop      = (e, i) => { e.preventDefault(); const src = dragSrcIdx.current; if (src !== null && src !== i) onReorderProjects(src, i); setDragOverIdx(null); };
  const handleDragEnd   = ()     => { dragSrcIdx.current = null; setDragOverIdx(null); };

  const p          = editingIdx !== null ? projects[editingIdx] : null;
  const m          = p?.manual_metrics || {};
  const pending    = p ? Math.max(0, (m.total_tasks||0) - (m.completed_tasks||0) - (m.in_progress_tasks||0)) : 0;
  const isOverLimit = p ? (Number(m.completed_tasks||0) + Number(m.in_progress_tasks||0)) > Number(m.total_tasks||0) : false;
  const engineers   = p?.engineers   || [];
  const indicators  = p?.indicators  || [];
  const impediments = p?.impediments || [];

  const updateMetric = (field, val) =>
    onUpdateProject(editingIdx, "manual_metrics", { ...m, [field]: val === "" ? "" : Number(val) });

  const addEngineer    = () => onUpdateProject(editingIdx, "engineers", [...engineers, createDefaultEngineer()]);
  const updateEngineer = (i, f, v) => onUpdateProject(editingIdx, "engineers", engineers.map((e, idx) => idx===i ? {...e,[f]:v} : e));
  const removeEngineer = (i) => onUpdateProject(editingIdx, "engineers", engineers.filter((_,idx) => idx!==i));

  const addIndicator    = () => onUpdateProject(editingIdx, "indicators", [...indicators, createDefaultIndicator()]);
  const updateIndicator = (i, f, v) => onUpdateProject(editingIdx, "indicators", indicators.map((ind,idx) => idx===i ? {...ind,[f]:v} : ind));
  const removeIndicator = (i) => onUpdateProject(editingIdx, "indicators", indicators.filter((_,idx) => idx!==i));

  const addImpediment    = (cat) => onUpdateProject(editingIdx, "impediments", [...impediments, createDefaultImpediment(cat)]);
  const updateImpediment = (i, f, v) => onUpdateProject(editingIdx, "impediments", impediments.map((im,idx) => idx===i ? {...im,[f]:v} : im));
  const removeImpediment = (i) => onUpdateProject(editingIdx, "impediments", impediments.filter((_,idx) => idx!==i));

  const listField = (label, field, addLabel, placeholder, rows) => (
    <ListField label={label} value={p[field]||""} onChange={v => onUpdateProject(editingIdx, field, v)}
      addLabel={addLabel} placeholder={placeholder} rows={rows} />
  );

  return (
    <div className="edit-view">
      {/* ── Pestañas ── */}
      <div className="project-tabs">
        {projects.map((proj, i) => (
          <button key={proj.id} draggable
            className={`project-tab ${editingIdx===i?"project-tab--active":""} ${dragOverIdx===i?"project-tab--drag-over":""}`}
            onClick={() => onSelectProject(i)}
            onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)}
            onDrop={e=>handleDrop(e,i)} onDragEnd={handleDragEnd}
            title="Arrastra para reordenar">
            <span className="project-tab__grip">⠿</span>
            {proj.project_name || `Proyecto ${i+1}`}
          </button>
        ))}
        <button className="project-tab project-tab--add" onClick={onAddProject}>+ Nuevo</button>
      </div>

      {p ? (
        <div className="edit-panel">
          {/* Cabecera */}
          <div className="edit-panel__header" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
            <h2 style={{ fontSize:"18px", color:"var(--azul-oscuro)" }}>Editando: {p.project_name || "Nuevo Proyecto"}</h2>
            <button className={`btn ${hasUnsavedChanges?"btn--accent":""}`}
              onClick={onSaveChanges} style={{ padding:"10px 24px", fontSize:"14px" }} disabled={!hasUnsavedChanges}>
              {hasUnsavedChanges ? "💾 Guardar cambios" : "✓ Guardado"}
            </button>
          </div>

          {/* ══ 1. Identificación ══ */}
          <div className="edit-row" style={{ gridTemplateColumns:"1fr 1fr 1fr", gap:"16px" }}>
            <div className="field">
              <label className="field__label">Nombre del Proyecto</label>
              <input className="field__input" value={p.project_name} placeholder="Ej: Migración CRM"
                onChange={e => onUpdateProject(editingIdx, "project_name", e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label">Estado</label>
              <select className="field__input" value={p.status}
                onChange={e => onUpdateProject(editingIdx, "status", e.target.value)}>
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label">URL de Planner</label>
              <input className="field__input" value={p.planner_url||""} placeholder="https://tasks.office.com/…"
                onChange={e => onUpdateProject(editingIdx, "planner_url", e.target.value)} />
            </div>
          </div>

          {/* ══ 2. Métricas manuales (datos de Planner) ══ */}
          <div className="field field--optional">
            <label className="field__label" style={{ marginBottom:10 }}>
              Métricas de Avance
              <span style={{ fontSize:"11px", color:"var(--text-3)", fontWeight:400, marginLeft:8 }}>(valores manuales — datos de Planner)</span>
            </label>
            <div className="edit-row" style={{ gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr", gap:"12px" }}>
              {[
                { lbl:"Total actividades",  field:"total_tasks"           },
                { lbl:"Completadas",        field:"completed_tasks"       },
                { lbl:"En proceso",         field:"in_progress_tasks"     },
                { lbl:"No iniciadas (Auto)",field:null                    },
                { lbl:"Tareas compartidas", field:"shared_tasks_discount" },
              ].map(({ lbl, field }) => (
                <div className="field" key={lbl}>
                  <label className="field__label" style={{ fontSize:"11px" }}>{lbl}</label>
                  {field ? (
                    <input className="field__input" type="number" min="0"
                      value={m[field]??0} onFocus={e=>e.target.select()}
                      onChange={e => updateMetric(field, e.target.value)} />
                  ) : (
                    <input className="field__input" type="number" readOnly value={pending}
                      style={{ background:"#f8fafc", fontWeight:"bold", color: isOverLimit?"var(--red)":"var(--text)" }} />
                  )}
                </div>
              ))}
            </div>
            {isOverLimit && <div style={{ color:"var(--red)", fontSize:"12px", fontWeight:600 }}>⚠ La suma de completadas y en proceso supera el total.</div>}
          </div>

          {/* ══ 3. Indicadores ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Indicadores</label>
              <button className="btn btn--accent" style={{ padding:"5px 14px", fontSize:"12px" }} type="button" onClick={addIndicator}>+ Agregar indicador</button>
            </div>
            {indicators.length > 0 && (
              <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:12 }}>
                {indicators.map((ind,i) => <IndicatorRow key={i} ind={ind} index={i} onChange={updateIndicator} onRemove={removeIndicator} />)}
              </div>
            )}
          </div>

          {/* ══ 4. Actividades ══ */}
          {listField("Actividades Identificadas", "activities_identified", "Agregar actividad", "Actividad 1\nActividad 2…")}

          {/* ══ 5. Impedimentos (bloqueantes, riesgos, no conformidades) ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Impedimentos y Riesgos</label>
              <div style={{ display:"flex", gap:8 }}>
                {IMPEDIMENT_TYPES.map(t => (
                  <button key={t.category} className="btn btn--accent" style={{ padding:"5px 12px", fontSize:"11px" }}
                    type="button" onClick={() => addImpediment(t.category)}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            {impediments.length > 0 && (
              <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:10 }}>
                {impediments.map((im,i) => <ImpedimentRow key={i} item={im} index={i} onChange={updateImpediment} onRemove={removeImpediment} />)}
              </div>
            )}
          </div>

          {/* ══ 6. Ingenieros ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Equipo de Ingenieros</label>
              <button className="btn btn--accent" style={{ padding:"5px 14px", fontSize:"12px" }} type="button" onClick={addEngineer}>+ Agregar ingeniero</button>
            </div>
            {engineers.length > 0 && (
              <>
                {engineers.map((eng,i) => <EngineerRow key={i} eng={eng} index={i} onChange={updateEngineer} onRemove={removeEngineer} />)}
                <div className="shared-tasks-row">
                  <span className="shared-tasks-row__label">Tareas compartidas entre ingenieros</span>
                  <input className="field__input shared-tasks-row__input" type="number" min="0"
                    value={m.shared_tasks_discount??0} onFocus={e=>e.target.select()}
                    onChange={e => updateMetric("shared_tasks_discount", e.target.value===""?0:Number(e.target.value))} />
                </div>
              </>
            )}
          </div>

          {/* ══ 7. Cierre semanal ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Sección de Cierre</label>
              <label className="field__checkbox-wrapper">
                <input type="checkbox" checked={p.show_closing_fields}
                  onChange={e => onUpdateProject(editingIdx, "show_closing_fields", e.target.checked)} />
                Habilitar campos
              </label>
            </div>
            <div className="edit-row edit-row--2col" style={{ marginTop:"12px", opacity: p.show_closing_fields?1:0.5 }}>
              <div className="field">
                <label className="field__label">→ Plan para la próxima semana</label>
                {p.show_closing_fields
                  ? <ListField label="" value={p.next_week_plan||""} addLabel="Agregar actividad"
                      placeholder="Objetivos para la próxima semana…"
                      onChange={v => onUpdateProject(editingIdx, "next_week_plan", v)} rows={4} />
                  : <textarea className="field__textarea" rows={4} disabled value={p.next_week_plan||""} placeholder="Objetivos para la próxima semana…" onChange={()=>{}} />
                }
              </div>
              <div className="field">
                <label className="field__label">✓ ¿Qué se hizo esta semana?</label>
                {p.show_closing_fields
                  ? <ListField label="" value={p.weekly_achievements||""} addLabel="Agregar logro"
                      placeholder="Logros y avances concretos…"
                      onChange={v => onUpdateProject(editingIdx, "weekly_achievements", v)} rows={4} />
                  : <textarea className="field__textarea" rows={4} disabled value={p.weekly_achievements||""} placeholder="Logros y avances concretos…" onChange={()=>{}} />
                }
              </div>
            </div>
          </div>

          {listField("📅 Fechas clave", "milestones", "Agregar fecha",      "Hito, entrega, deadline…", 2)}
          {listField("Comentarios",     "comments",   "Agregar comentario", "Comentario 1\nComentario 2…", 3)}

          <div className="edit-panel__footer">
            <button className="btn btn--accent" onClick={() => onViewReport(editingIdx)}>📄 Ver reporte</button>
            <button className="btn btn--danger" onClick={() => setShowDeleteModal(true)}>Eliminar proyecto</button>
          </div>

          {showDeleteModal && (
            <DeleteConfirmModal
              projectName={p?.project_name || "este proyecto"}
              onCancel={() => setShowDeleteModal(false)}
              onConfirm={() => { setShowDeleteModal(false); onRemoveProject(editingIdx); }}
            />
          )}
        </div>
      ) : (
        <div className="edit-empty">
          {projects.length > 0 ? "Selecciona un proyecto para editarlo" : 'Haz clic en "+ Nuevo" para agregar tu primer proyecto'}
        </div>
      )}
    </div>
  );
}
