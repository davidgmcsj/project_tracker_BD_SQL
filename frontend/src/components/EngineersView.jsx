import { useState } from "react";
import { getProjectsForEngineer, getEngineerActivitiesInProject } from "../utils/engineers";
import { createEngineerTask } from "../utils/formulas";

const STATUS_LABELS = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado", "mejora-continua": "Mejora Continua" };

const TASK_STATUS_OPTIONS = [
  { value: "not_started", label: "No iniciada" },
  { value: "in_progress",  label: "En proceso"  },
  { value: "completed",    label: "Completada"  },
];

// ── Fila de creación/edición inline (mismo patrón que ActivitiesList en EditView.jsx) ──

function EngineerForm({ initial, onConfirm, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [role, setRole] = useState(initial?.role || "");

  const confirm = () => {
    const n = name.trim();
    if (!n) return;
    onConfirm(n, role.trim());
  };

  return (
    <div className="list-field-draft" style={{ flexWrap: "wrap" }}>
      <input
        className="field__input list-field-draft__input"
        autoFocus value={name}
        placeholder="Nombre completo…"
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          if (e.key === "Escape") onCancel();
        }}
      />
      <input
        className="field__input list-field-draft__input"
        value={role}
        placeholder="Cargo (opcional)…"
        onChange={e => setRole(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="list-field-draft__ok"     onClick={confirm}  title="Guardar">✓</button>
      <button type="button" className="list-field-draft__cancel" onClick={onCancel} title="Cancelar">✕</button>
    </div>
  );
}

// ── Tarjeta de ingeniero ──────────────────────────────────────────────────────

function EngineerCard({ eng, onUpdate, onToggleActive, onOpenDetail }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="project-card">
        <EngineerForm
          initial={eng}
          onConfirm={(name, role) => { onUpdate(eng.id, name, role); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`project-card ${!eng.active ? "project-card--inactive" : ""}`} onClick={() => onOpenDetail(eng.id)}>
      <div className="project-card__header">
        <h3 className="project-card__name">{eng.name}</h3>
        <span className={`status-pill ${eng.active ? "status-pill--on-track" : "status-pill--blocked"}`}>
          {eng.active ? "Activo" : "Inactivo"}
        </span>
      </div>
      {eng.role && <p style={{ color: "var(--text-2)", fontSize: "13px", margin: "4px 0 12px" }}>{eng.role}</p>}
      <div className="project-card__actions" onClick={e => e.stopPropagation()}>
        <button className="btn btn--card-export" onClick={() => setEditing(true)}>✎ Editar</button>
        <button className="btn btn--card-report" onClick={() => onToggleActive(eng.id)}>
          {eng.active ? "Desactivar" : "Reactivar"}
        </button>
      </div>
    </div>
  );
}

// ── Fecha de status_history, mismo lenguaje visual que EditView (solo lectura aquí) ──

function HistoryDate({ label, value }) {
  if (!value) return null;
  return (
    <span className="status-date-badge">
      <span className="status-date-badge__label">{label}:</span>
      <span className="status-date-badge__value">{value}</span>
    </span>
  );
}

// ── Sub-tarjeta de proyecto dentro del detalle del ingeniero ─────────────────

function ProjectActivitiesCard({ project, engineerId }) {
  const activities = getEngineerActivitiesInProject(engineerId, project);
  const statusLabel = STATUS_LABELS[project.status] || project.status;

  return (
    <div className="project-card">
      <div className="project-card__header">
        <h3 className="project-card__name">{project.project_name}</h3>
        <span className="status-pill">{statusLabel}</span>
      </div>
      {activities.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>
          Sin actividades asignadas esta semana en este proyecto.
        </p>
      ) : (
        <ul className="rpt-bullets rpt-bullets--compact">
          {activities.map(a => (
            <li key={a.id} className="rpt-bullets__item">
              <div>{a.position}. {a.text}</div>
              <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <HistoryDate label="Inscrita"    value={a.history.added} />
                <HistoryDate label="En proceso"  value={a.history.in_progress} />
                <HistoryDate label="Completada"  value={a.history.completed} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tareas sueltas (no asociadas a ningún proyecto) ───────────────────────────

function LooseTasksSection({ tasks, onChange }) {
  const [draft,   setDraft]   = useState("");
  const [adding,  setAdding]  = useState(false);

  const list = tasks || [];

  const confirmAdd = () => {
    const t = draft.trim();
    if (t) onChange([...list, createEngineerTask(t)]);
    setDraft(""); setAdding(false);
  };

  const update = (id, field, val) => onChange(list.map(t => t.id === id ? { ...t, [field]: val } : t));
  const remove = (id)             => onChange(list.filter(t => t.id !== id));

  return (
    <div className="field" style={{ marginTop: 24 }}>
      <div className="field__header">
        <label className="field__label">
          Tareas sueltas
          {list.length > 0 && <span className="act-count">{list.length}</span>}
        </label>
        {!adding && (
          <button type="button" className="btn-add-item" onClick={() => setAdding(true)}>
            + Agregar tarea
          </button>
        )}
      </div>

      {adding && (
        <div className="list-field-draft">
          <input
            className="field__input list-field-draft__input"
            autoFocus value={draft}
            placeholder="Descripción de la tarea… (Enter para confirmar)"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirmAdd(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
          />
          <button type="button" className="list-field-draft__ok"     onClick={confirmAdd}                          title="Confirmar">✓</button>
          <button type="button" className="list-field-draft__cancel" onClick={() => { setDraft(""); setAdding(false); }} title="Cancelar">✕</button>
        </div>
      )}

      {list.length > 0 ? (
        <ol className="act-list">
          {list.map(t => (
            <li key={t.id} className="act-list__item">
              <span className="act-list__text" style={{ flex: 2 }}>{t.description}</span>
              <select
                className="field__input" style={{ flex: "0 0 140px" }}
                value={t.status}
                onChange={e => update(t.id, "status", e.target.value)}
              >
                {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                type="date" className="field__input" style={{ flex: "0 0 150px" }}
                value={t.date || ""}
                onChange={e => update(t.id, "date", e.target.value)}
              />
              <button type="button" className="act-list__remove" onClick={() => remove(t.id)} title="Eliminar">✕</button>
            </li>
          ))}
        </ol>
      ) : (
        !adding && <p className="act-list__empty">Sin tareas sueltas registradas.</p>
      )}
    </div>
  );
}

// ── Panel de detalle de un ingeniero ──────────────────────────────────────────

function EngineerDetail({ eng, projects, onUpdateTasks, onBack }) {
  const projectsForEngineer = getProjectsForEngineer(eng.id, projects);

  return (
    <div>
      <button className="btn btn--secondary report-back-btn" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Volver a Ingenieros
      </button>

      <div className="project-card" style={{ marginBottom: 20 }}>
        <div className="project-card__header">
          <h3 className="project-card__name">{eng.name}</h3>
          <span className={`status-pill ${eng.active ? "status-pill--on-track" : "status-pill--blocked"}`}>
            {eng.active ? "Activo" : "Inactivo"}
          </span>
        </div>
        {eng.role && <p style={{ color: "var(--text-2)", fontSize: "13px", margin: "4px 0 0" }}>{eng.role}</p>}
      </div>

      <h3 className="report-section-title">
        Proyectos ({projectsForEngineer.length})
      </h3>

      {projectsForEngineer.length === 0 ? (
        <p style={{ color: "var(--text-2)" }}>
          Este ingeniero no está asignado a ningún proyecto todavía. Para asignarlo, edita un proyecto
          en la pestaña "Editar" y agrégalo en su sección de Ingenieros.
        </p>
      ) : (
        <div className="dashboard-grid">
          {projectsForEngineer.map(p => (
            <ProjectActivitiesCard key={p.id} project={p} engineerId={eng.id} />
          ))}
        </div>
      )}

      <LooseTasksSection tasks={eng.tasks} onChange={tasks => onUpdateTasks(eng.id, tasks)} />
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────

export default function EngineersView({ engineers, projects, onAdd, onUpdate, onToggleActive, onUpdateTasks }) {
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const list = engineers || [];

  if (selectedId) {
    const eng = list.find(e => e.id === selectedId);
    if (eng) {
      return <EngineerDetail eng={eng} projects={projects} onUpdateTasks={onUpdateTasks} onBack={() => setSelectedId(null)} />;
    }
  }

  return (
    <div>
      <div className="dashboard-grid">
        {list.map(eng => (
          <EngineerCard key={eng.id} eng={eng} onUpdate={onUpdate} onToggleActive={onToggleActive} onOpenDetail={setSelectedId} />
        ))}

        {adding ? (
          <div className="project-card">
            <EngineerForm
              onConfirm={(name, role) => { onAdd(name, role); setAdding(false); }}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <div className="add-card" onClick={() => setAdding(true)}>
            <span className="add-card__icon">+</span>
            <span className="add-card__text">Agregar ingeniero</span>
          </div>
        )}
      </div>

      {!list.length && !adding && (
        <p style={{ color: "var(--text-2)", marginTop: 16 }}>
          Sin ingenieros aún. Agrega el primero.
        </p>
      )}
    </div>
  );
}
