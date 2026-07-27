// EngineerReportView.jsx — Reporte consolidado por ingeniero.
// Junta, para el ingeniero seleccionado: sus actividades por proyecto (con estado
// y fechas) y sus tareas adicionales. Pensado como insumo para reuniones y para el
// informe trimestral.

import { useState } from "react";
import {
  getProjectsForEngineer,
  getAllAssignedActivitiesInProject,
  generateEngineerReportText,
} from "../utils/engineers";

const STATUS_META = {
  completed:   { label: "Completada", cls: "eng-badge--done"    },
  in_progress: { label: "En proceso", cls: "eng-badge--wip"     },
  not_started: { label: "No iniciada", cls: "eng-badge--pending" },
};

function DatesCell({ history }) {
  const h = history || {};
  return (
    <>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.added || "—"}</td>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.in_progress || "—"}</td>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.completed || "—"}</td>
    </>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.not_started;
  return <span className={`eng-badge ${meta.cls}`}>{meta.label}</span>;
}

function ProjectBlock({ project, engineerId }) {
  const acts = getAllAssignedActivitiesInProject(engineerId, project);
  return (
    <div className="project-card" style={{ marginBottom: 16 }}>
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">{project.project_name}</h3>
        <span className="status-pill">{acts.length} actividad{acts.length !== 1 ? "es" : ""}</span>
      </div>
      {acts.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin actividades asignadas en este proyecto.</p>
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
              {acts.map(a => (
                <tr key={a.id}>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{a.position}</td>
                  <td>{a.text}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <DatesCell history={a.history} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdditionalTasksBlock({ tasks }) {
  const list = tasks || [];
  return (
    <div className="project-card" style={{ marginBottom: 16 }}>
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">Tareas adicionales</h3>
        <span className="status-pill">{list.length} tarea{list.length !== 1 ? "s" : ""}</span>
      </div>
      {list.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin tareas adicionales registradas.</p>
      ) : (
        <div className="metrics-container" style={{ overflowX: "auto" }}>
          <table className="metrics-table metrics-table--project">
            <thead>
              <tr>
                <th>Tarea</th>
                <th style={{ width: "120px" }}>Estado</th>
                <th style={{ width: "70px", textAlign: "center" }}>Avance</th>
                <th style={{ width: "110px" }}>Inscrita</th>
                <th style={{ width: "110px" }}>En proceso</th>
                <th style={{ width: "110px" }}>Completada</th>
              </tr>
            </thead>
            <tbody>
              {list.map(t => {
                const h = { added: t.date || "", in_progress: "", completed: "", ...(t.history || {}) };
                return (
                  <tr key={t.id}>
                    <td>{t.description}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td style={{ textAlign: "center" }}>{Number(t.progress) ? `${t.progress}%` : "—"}</td>
                    <DatesCell history={h} />
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

export default function EngineerReportView({ engineers, projects }) {
  const list = (engineers || []).filter(e => e.active !== false);
  const [selectedId, setSelectedId] = useState(list[0]?.id || null);
  const [toast, setToast] = useState("");

  const eng = (engineers || []).find(e => e.id === selectedId) || null;
  const projs = eng ? getProjectsForEngineer(eng.id, projects) : [];

  const handleCopy = () => {
    if (!eng) return;
    const text = generateEngineerReportText(eng, projects);
    navigator.clipboard.writeText(text)
      .then(() => { setToast(`✓ Reporte de "${eng.name}" copiado`); setTimeout(() => setToast(""), 2500); })
      .catch(() => { setToast("No se pudo copiar"); setTimeout(() => setToast(""), 2500); });
  };

  if (!list.length) {
    return <p style={{ color: "var(--text-2)", marginTop: 16 }}>Sin ingenieros activos para reportar.</p>;
  }

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <h2 className="report-panel__title">Reporte por Ingeniero</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            className="field__input"
            style={{ minWidth: 220 }}
            value={selectedId || ""}
            onChange={e => setSelectedId(e.target.value)}
          >
            {list.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn btn--accent" onClick={handleCopy} disabled={!eng}>📋 Copiar reporte</button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {!eng ? (
        <div className="edit-empty">Selecciona un ingeniero.</div>
      ) : (
        <>
          <div className="project-card" style={{ marginBottom: 20 }}>
            <div className="project-card__header">
              <h3 className="project-card__name">{eng.name}</h3>
              <span className={`status-pill ${eng.active ? "status-pill--on-track" : "status-pill--blocked"}`}>
                {eng.active ? "Activo" : "Inactivo"}
              </span>
            </div>
            {eng.role && <p style={{ color: "var(--text-2)", fontSize: "13px", margin: "4px 0 0" }}>{eng.role}</p>}
          </div>

          <h3 className="report-section-title" style={{ marginBottom: 12 }}>
            Actividades por proyecto ({projs.length})
          </h3>
          {projs.length === 0 ? (
            <p style={{ color: "var(--text-2)" }}>Este ingeniero no está asignado a ningún proyecto.</p>
          ) : (
            projs.map(p => <ProjectBlock key={p.id} project={p} engineerId={eng.id} />)
          )}

          <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>Tareas adicionales</h3>
          <AdditionalTasksBlock tasks={eng.tasks} />
        </>
      )}
    </div>
  );
}
