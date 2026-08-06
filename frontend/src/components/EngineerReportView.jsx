// EngineerReportView.jsx — Reporte consolidado por ingeniero.
// Junta, para el ingeniero seleccionado: sus actividades por proyecto (con estado
// y fechas) y sus tareas adicionales. Pensado como insumo para reuniones y para el
// informe trimestral.

import { useMemo, useState } from "react";
import {
  getProjectsForEngineer,
  getAllAssignedActivitiesInProject,
  generateEngineerReportText,
  engineerWeekTasks,
  engineerNextWeekTasks,
} from "../utils/engineers";
import EngineerActivitiesTable from "./engineer/EngineerActivitiesTable";
import AdditionalTasksTable from "./engineer/AdditionalTasksTable";
import EngineerWeekTable from "./engineer/EngineerWeekTable";

// Calculada una vez al cargar el módulo (no en cada render): evita que el
// React Compiler marque los useMemo de más abajo como impuros por depender
// de `new Date()`, y es suficiente para una sesión de trabajo normal.
const TODAY = new Date();

// Iniciales para el avatar (máx 2 letras).
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

// Color estable del avatar derivado del nombre (paleta institucional).
const AVATAR_COLORS = ["#003399", "#1a49a8", "#0e7490", "#7c3aed", "#be185d", "#0f766e", "#b45309"];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Cuenta la carga del ingeniero (actividades por estado) sumando todos sus proyectos.
function engineerWorkload(engineerId, projects, tasks) {
  let done = 0, wip = 0, pending = 0;
  getProjectsForEngineer(engineerId, projects).forEach(p => {
    getAllAssignedActivitiesInProject(engineerId, p).forEach(a => {
      if (a.status === "completed") done++;
      else if (a.status === "in_progress") wip++;
      else pending++;
    });
  });
  (tasks || []).forEach(t => {
    if (t.status === "completed") done++;
    else if (t.status === "in_progress") wip++;
    else pending++;
  });
  const total = done + wip + pending;
  return { done, wip, pending, total, pct: total ? Math.round((done / total) * 100) : 0 };
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
        <EngineerActivitiesTable activities={acts} />
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
        <AdditionalTasksTable tasks={list} mode="read" />
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

  // El React Compiler marca estos dos useMemo como "Compilation Skipped": el
  // componente tiene un early return condicional MÁS ABAJO (if (!list.length)
  // return ...) después de los hooks — válido según las Reglas de Hooks, pero
  // una forma que el compiler no logra optimizar. Preexistente a este cambio;
  // no bloquea el build ni afecta el comportamiento en runtime.
  const engId = eng?.id ?? null;
  const weekRows = useMemo(
    () => (engId ? engineerWeekTasks(engId, projects, TODAY) : []),
    [engId, projects]
  );
  const nextWeekRows = useMemo(
    () => (engId ? engineerNextWeekTasks(engId, projects, TODAY) : []),
    [engId, projects]
  );

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
          {(() => {
            const w = engineerWorkload(eng.id, projects, eng.tasks);
            return (
              <div className="eng-hero">
                <div className="eng-hero__avatar" style={{ background: avatarColor(eng.name) }}>
                  {initials(eng.name)}
                </div>
                <div className="eng-hero__body">
                  <div className="eng-hero__top">
                    <div>
                      <h3 className="eng-hero__name">{eng.name}</h3>
                      {eng.role && <p className="eng-hero__role">{eng.role}</p>}
                    </div>
                    <span className={`status-pill ${eng.active ? "status-pill--on-track" : "status-pill--blocked"}`}>
                      {eng.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <div className="eng-hero__load">
                    <div className="eng-hero__bar" title={`${w.done} de ${w.total} completadas`}>
                      <div className="eng-hero__bar-fill" style={{ width: `${w.pct}%` }} />
                    </div>
                    <span className="eng-hero__pct tabular">{w.done}/{w.total}</span>
                  </div>
                  <div className="eng-hero__badges">
                    <span className="eng-badge eng-badge--done">{w.done} ✓ completadas</span>
                    <span className="eng-badge eng-badge--wip">{w.wip} ↻ en curso</span>
                    <span className="eng-badge eng-badge--pending">{w.pending} ○ pendientes</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* "Mi semana" / "próxima semana": junta tareas de TODOS los
              proyectos del ingeniero, calculado automáticamente por fechas
              (mismo motor que EditView — ver utils/weekPlanning.js). Es la
              vista de "qué debo hacer" pedida para el día a día del ingeniero,
              sin tener que entrar proyecto por proyecto. */}
          <h3 className="report-section-title" style={{ marginBottom: 12 }}>
            Esta semana ({weekRows.length})
          </h3>
          <EngineerWeekTable rows={weekRows} />

          <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>
            Próxima semana ({nextWeekRows.length})
          </h3>
          <EngineerWeekTable rows={nextWeekRows} />

          <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>
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
