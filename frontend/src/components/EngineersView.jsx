import { useState } from "react";
import { getProjectsForEngineer, getEngineerActivitiesInProject, hasActiveWeeklyTasks, countActiveWeeklyTasks, countTotalAssignedTasks } from "../utils/engineers";
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

// ── Tabla de proyectos vinculados, mismo lenguaje visual que MetricsTable ─────

function EngineerProjectsTable({ eng, projects }) {
  const projectsForEngineer = getProjectsForEngineer(eng.id, projects);
  if (!projectsForEngineer.length) return null;

  const activeCount = projectsForEngineer.filter(p => hasActiveWeeklyTasks(eng.id, p)).length;

  return (
    <div className="metrics-container">
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr>
            <th>Proyecto vinculado</th>
            <th>Esta semana</th>
            <th>Total Asignadas</th>
          </tr>
        </thead>
        <tbody>
          {projectsForEngineer.map(p => {
            const count = countActiveWeeklyTasks(eng.id, p);
            const totalAssigned = countTotalAssignedTasks(eng.id, p);
            return (
              <tr key={p.id}>
                <td>{p.project_name}</td>
                <td>
                  {count > 0
                    ? <span className="eng-badge eng-badge--done">{count} tarea{count !== 1 ? "s" : ""}</span>
                    : <span className="eng-badge eng-badge--pending">Sin actividad</span>}
                </td>
                <td>
                  {totalAssigned > 0
                    ? <span className="eng-badge eng-badge--info">{totalAssigned} tarea{totalAssigned !== 1 ? "s" : ""}</span>
                    : <span className="eng-badge eng-badge--pending">Sin tareas</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="metrics-note">
        {activeCount} de {projectsForEngineer.length} proyecto{projectsForEngineer.length !== 1 ? "s" : ""} con actividad esta semana.
      </p>
    </div>
  );
}

// ── Tarjeta de ingeniero ──────────────────────────────────────────────────────

function EngineerCard({ eng, projects, onUpdate, onToggleActive, onOpenDetail }) {
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
      <div onClick={e => e.stopPropagation()}>
        <EngineerProjectsTable eng={eng} projects={projects} />
      </div>
      <div className="project-card__actions" onClick={e => e.stopPropagation()}>
        <button className="btn btn--card-export" onClick={() => setEditing(true)}>✎ Editar</button>
        <button className="btn btn--card-report" onClick={() => onToggleActive(eng.id)}>
          {eng.active ? "Desactivar" : "Reactivar"}
        </button>
      </div>
    </div>
  );
}

// ── Sub-tarjeta de proyecto dentro del detalle del ingeniero ─────────────────

function ProjectActivitiesCard({ project, engineerId }) {
  const activities = getEngineerActivitiesInProject(engineerId, project);
  const statusLabel = STATUS_LABELS[project.status] || project.status;
  const active = hasActiveWeeklyTasks(engineerId, project);

  const completedSet = new Set(project.task_status?.completed || []);
  const inProgressSet = new Set(project.task_status?.in_progress || []);

  return (
    <div
      className="project-card"
      style={active ? { borderColor: "var(--green)", background: "var(--green-bg)" } : undefined}
    >
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">
          {active && <span title="Con actividad esta semana" style={{ marginRight: 6, color: "var(--green)" }}>●</span>}
          {project.project_name}
        </h3>
        <span className="status-pill">{statusLabel}</span>
      </div>
      {activities.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>
          Sin actividades asignadas esta semana en este proyecto.
        </p>
      ) : (
        <div className="metrics-container" style={{ overflowX: "auto" }}>
          <table className="metrics-table metrics-table--project">
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>#</th>
                <th>Actividad</th>
                <th style={{ width: "120px" }}>Estado</th>
                <th style={{ width: "110px" }}>Inscrita</th>
                <th style={{ width: "110px" }}>En proceso</th>
                <th style={{ width: "110px" }}>Completada</th>
              </tr>
            </thead>
            <tbody>
              {activities.map(a => {
                const isCompleted = completedSet.has(a.id);
                const isInProgress = inProgressSet.has(a.id);

                let statusClass = "eng-badge--pending";
                let statusLabelText = "No iniciada";
                if (isCompleted) {
                  statusClass = "eng-badge--done";
                  statusLabelText = "Completada";
                } else if (isInProgress) {
                  statusClass = "eng-badge--wip";
                  statusLabelText = "En proceso";
                }

                return (
                  <tr key={a.id}>
                    <td style={{ textAlign: "center", fontWeight: 700 }}>{a.position}</td>
                    <td>{a.text}</td>
                    <td>
                      <span className={`eng-badge ${statusClass}`}>{statusLabelText}</span>
                    </td>
                    <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{a.history.added || "—"}</td>
                    <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{a.history.in_progress || "—"}</td>
                    <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{a.history.completed || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          Tareas adicionales
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
        !adding && <p className="act-list__empty">Sin tareas adicionales registradas.</p>
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

      <EngineerProjectsTable eng={eng} projects={projects} />

      <h3 className="report-section-title" style={{ marginTop: 20 }}>
        Detalle de actividades por proyecto ({projectsForEngineer.length})
      </h3>

      {projectsForEngineer.length === 0 ? (
        <p style={{ color: "var(--text-2)" }}>
          Este ingeniero no está asignado a ningún proyecto todavía. Para asignarlo, edita un proyecto
          en la pestaña "Editar" y agrégalo en su sección de Ingenieros.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
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
  const [query, setQuery] = useState("");
  const list = engineers || [];

  if (selectedId) {
    const eng = list.find(e => e.id === selectedId);
    if (eng) {
      return <EngineerDetail eng={eng} projects={projects} onUpdateTasks={onUpdateTasks} onBack={() => setSelectedId(null)} />;
    }
  }

  const q = query.trim().toLowerCase();
  const visible = q ? list.filter(e => e.name.toLowerCase().includes(q)) : list;

  return (
    <div>
      <div className="act-selector__search" style={{ marginBottom: 16, maxWidth: 360 }}>
        <input
          className="act-selector__search-input"
          type="text" placeholder="Buscar ingeniero…"
          value={query} onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="act-selector__search-clear" onClick={() => setQuery("")} title="Limpiar">✕</button>
        )}
      </div>

      <div className="dashboard-grid">
        {visible.map(eng => (
          <EngineerCard key={eng.id} eng={eng} projects={projects} onUpdate={onUpdate} onToggleActive={onToggleActive} onOpenDetail={setSelectedId} />
        ))}

        {!query && (adding ? (
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
        ))}
      </div>

      {!list.length && !adding && (
        <p style={{ color: "var(--text-2)", marginTop: 16 }}>
          Sin ingenieros aún. Agrega el primero.
        </p>
      )}
      {list.length > 0 && q && !visible.length && (
        <p style={{ color: "var(--text-2)", marginTop: 16 }}>
          Sin coincidencias para "{query}".
        </p>
      )}
    </div>
  );
}
