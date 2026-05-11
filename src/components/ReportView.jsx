import { useState } from "react";
import MiniBar from "./MiniBar";
import { GlobalMetricsTable, ProjectMetricsTable } from "./MetricsTable";
import { projectProgress, generateReportText, generateSingleProjectReportText } from "../utils/formulas";

const STATUS = {
  "on-track": { label: "En curso",   cssClass: "on-track", icon: "🟡" },
  "at-risk":  { label: "En riesgo",  cssClass: "at-risk",  icon: "🟠" },
  blocked:    { label: "Bloqueado",  cssClass: "blocked",   icon: "🔴" },
  completed:  { label: "Completado", cssClass: "completed", icon: "🟢" },
};

const FIELD_CONFIG = {
  activitiesOfTheWeek: { label: "Actividades Identificadas", icon: "📋", variant: "blue" },
  pendingActivities:   { label: "Actividades no iniciadas",  icon: "⏳", variant: "amber" },
  blockers:            { label: "Bloqueantes",               icon: "🚫", variant: "red" },
  blockersImpact:      { label: "Impacto de los bloqueantes",icon: "⚠️", variant: "red-soft" },
  nonConformances:     { label: "Salidas no conformes",      icon: "⚠️", variant: "red-soft" },
  risks:               { label: "Riesgos",                   icon: "🔶", variant: "amber" },
  weekAccomplishments: { label: "Qué se hizo esta semana",   icon: "✅", variant: "green" },
  weekPlanned:         { label: "Plan para la próxima semana",icon: "→", variant: "blue" },
  keyDates:            { label: "Fechas Clave",              icon: "📅", variant: "teal" },
  comments:            { label: "Comentarios",               icon: "💬", variant: "gray" },
};

function BulletSection({ fieldKey, value }) {
  if (!value) return null;
  const cfg = FIELD_CONFIG[fieldKey] || { label: fieldKey, icon: "•", variant: "gray" };
  const lines = value.split("\n").map(l => l.trim()).filter(Boolean);

  return (
    <div className={`rpt-section rpt-section--${cfg.variant}`}>
      <div className="rpt-section__header">
        <span className="rpt-section__icon">{cfg.icon}</span>
        <span className="rpt-section__label">{cfg.label}</span>
        <span className="rpt-section__count">{lines.length}</span>
      </div>
      <ul className="rpt-bullets">
        {lines.map((line, i) => (
          <li key={i} className="rpt-bullets__item">{line}</li>
        ))}
      </ul>
    </div>
  );
}

function EngineerWeekCard({ eng }) {
  const name = eng.name === "Otro..." ? (eng.customName || "—") : (eng.name || "—");
  const lines = (eng.weekActivities || "").split("\n").map(l => l.trim()).filter(Boolean);
  if (!eng.weekTotal && !lines.length) return null;

  return (
    <div className="rpt-eng-card">
      <div className="rpt-eng-card__header">
        <span className="rpt-eng-card__name">{name}</span>
        {eng.weekTotal > 0 && (
          <span className="rpt-eng-card__badge">{eng.weekTotal} tarea{eng.weekTotal !== 1 ? "s" : ""}</span>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="rpt-bullets rpt-bullets--compact">
          {lines.map((line, i) => (
            <li key={i} className="rpt-bullets__item">{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportView({ projects, weekLabel, singleProjectIdx, onClearSingle }) {
  const [toast, setToast] = useState("");

  const isSingle = singleProjectIdx !== null && singleProjectIdx !== undefined;
  const displayProjects = isSingle ? [projects[singleProjectIdx]] : projects;

  const handleCopy = () => {
    const text = isSingle
      ? generateSingleProjectReportText(projects[singleProjectIdx], weekLabel)
      : generateReportText(projects, weekLabel);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setToast("✓ Reporte copiado al portapapeles");
        setTimeout(() => setToast(""), 2500);
      })
      .catch(() => setToast("No se pudo copiar"));
  };

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <div className="report-panel__title-group">
          {isSingle && (
            <button className="btn btn--secondary report-back-btn" onClick={onClearSingle}>
              ← Reporte consolidado
            </button>
          )}
          <h2 className="report-panel__title">
            {isSingle
              ? `Reporte: ${projects[singleProjectIdx]?.name || "Proyecto"}`
              : "Reporte Semanal Consolidado"}
          </h2>
        </div>
        <button className="btn btn--accent" onClick={handleCopy}>
          Copiar reporte ✎
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {projects.length === 0 ? (
        <div className="edit-empty">Agrega proyectos para generar el reporte</div>
      ) : (
        <>
          {!isSingle && (
            <div className="report-metrics">
              <h3 className="report-section-title">Resumen Global</h3>
              <GlobalMetricsTable projects={projects} />
            </div>
          )}

          {displayProjects.map((p, i) => {
            const pct = Math.round(
              projectProgress(p.totalActivities, p.completedActivities, p.inProgressActivities)
            );
            const st = STATUS[p.status] || STATUS["on-track"];
            const engWithWeekData = (p.engineers || []).filter(
              e => e.weekTotal > 0 || (e.weekActivities || "").trim()
            );

            return (
              <div key={p.id} className="report-project">
                {/* ── Cabecera ── */}
                <div className="report-project__header">
                  <span className="report-project__name">
                    <span className="report-project__icon">{st.icon}</span>
                    {p.name || `Proyecto ${i + 1}`}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {p.plannerUrl && (
                      <a href={p.plannerUrl} target="_blank" rel="noopener noreferrer" className="planner-link">
                        📋 Planner
                      </a>
                    )}
                    <span className={`status-pill status-pill--${st.cssClass}`}>{st.label}</span>
                  </div>
                </div>

                <div className="report-project__stats">
                  Avance: <strong>{pct}%</strong> (según tareas identificadas) — {p.completedActivities}/{p.totalActivities} actividades | En proceso: {p.inProgressActivities}
                </div>

                <MiniBar
                  completed={p.completedActivities}
                  inProgress={p.inProgressActivities}
                  total={p.totalActivities}
                />

                <div className="report-project__metrics">
                  <ProjectMetricsTable project={p} />
                </div>

                {/* ── Campos de texto en viñetas ── */}
                <div className="rpt-sections-grid">
                  <BulletSection fieldKey="activitiesOfTheWeek" value={p.activitiesOfTheWeek} />
                  <BulletSection fieldKey="pendingActivities"   value={p.pendingActivities} />
                  <BulletSection fieldKey="blockers"            value={p.blockers} />
                  {p.blockers && <BulletSection fieldKey="blockersImpact" value={p.blockersImpact} />}
                  <BulletSection fieldKey="nonConformances"     value={p.nonConformances} />
                  <BulletSection fieldKey="risks"               value={p.risks} />
                  {p.showFridayFields && (
                    <>
                      <BulletSection fieldKey="weekAccomplishments" value={p.weekAccomplishments} />
                      <BulletSection fieldKey="weekPlanned"         value={p.weekPlanned} />
                    </>
                  )}
                  <BulletSection fieldKey="keyDates"  value={p.keyDates} />
                  <BulletSection fieldKey="comments"  value={p.comments} />
                </div>

                {/* ── Ingenieros esta semana ── */}
                {engWithWeekData.length > 0 && (
                  <div className="rpt-eng-section">
                    <div className="rpt-eng-section__title">
                      <span>👷 Equipo — esta semana</span>
                      <span className="rpt-section__count">{engWithWeekData.length}</span>
                    </div>
                    <div className="rpt-eng-grid">
                      {engWithWeekData.map((eng, ei) => (
                        <EngineerWeekCard key={ei} eng={eng} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
