import { useState } from "react";
import MiniBar from "./MiniBar";
import { GlobalMetricsTable, ProjectMetricsTable } from "./MetricsTable";
import { projectProgress, generateReportText, generateSingleProjectReportText } from "../utils/formulas";

const STATUS = {
  "on-track": { label:"En curso",   cssClass:"on-track", icon:"🟡" },
  "at-risk":  { label:"En riesgo",  cssClass:"at-risk",  icon:"🟠" },
  blocked:    { label:"Bloqueado",  cssClass:"blocked",  icon:"🔴" },
  completed:  { label:"Completado", cssClass:"completed",icon:"🟢" },
};

// UI label map para campos de impedimentos
const IMPEDIMENT_UI = {
  blocker:       { label:"Bloqueantes",          icon:"🚫", variant:"red"      },
  risk:          { label:"Riesgos",              icon:"🔶", variant:"amber"    },
  non_conformity:{ label:"Salidas no conformes", icon:"⚠️", variant:"red-soft" },
};

// Mapa de campos de texto del proyecto a su configuración de UI
const FIELD_CONFIG = {
  activities_identified: { label:"Actividades Identificadas",    icon:"📋", variant:"blue"    },
  weekly_achievements:   { label:"Qué se hizo esta semana",      icon:"✅", variant:"green"   },
  next_week_plan:        { label:"Plan para la próxima semana",  icon:"→",  variant:"blue"    },
  milestones:            { label:"Fechas Clave",                 icon:"📅", variant:"teal"    },
  comments:              { label:"Comentarios",                  icon:"💬", variant:"gray"    },
};

function BulletSection({ fieldKey, value }) {
  if (!value) return null;
  const cfg   = FIELD_CONFIG[fieldKey] || { label: fieldKey, icon:"•", variant:"gray" };
  const lines = value.split("\n").map(l => l.trim()).filter(Boolean);
  return (
    <div className={`rpt-section rpt-section--${cfg.variant}`}>
      <div className="rpt-section__header">
        <span className="rpt-section__icon">{cfg.icon}</span>
        <span className="rpt-section__label">{cfg.label}</span>
        <span className="rpt-section__count">{lines.length}</span>
      </div>
      <ul className="rpt-bullets">
        {lines.map((line,i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
      </ul>
    </div>
  );
}

function ImpedimentSection({ impediments }) {
  if (!impediments?.length) return null;
  const byCategory = {};
  impediments.forEach(im => { (byCategory[im.category] ||= []).push(im); });

  return (
    <>
      {Object.entries(byCategory).map(([cat, items]) => {
        const cfg = IMPEDIMENT_UI[cat] || { label: cat, icon:"⚠️", variant:"red-soft" };
        return (
          <div key={cat} className={`rpt-section rpt-section--${cfg.variant}`}>
            <div className="rpt-section__header">
              <span className="rpt-section__icon">{cfg.icon}</span>
              <span className="rpt-section__label">{cfg.label}</span>
              <span className="rpt-section__count">{items.length}</span>
            </div>
            <ul className="rpt-bullets">
              {items.map((im,i) => (
                <li key={i} className="rpt-bullets__item">
                  {im.description}
                  {im.impact && <span style={{ display:"block", marginLeft:16, fontSize:"12px", color:"var(--text-2)", marginTop:2 }}>→ Impacto: {im.impact}</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function EngineerWeekCard({ eng }) {
  const name  = eng.engineer_id==="Otro..."?(eng.custom_name||"—"):(eng.engineer_id||"—");
  const lines = (eng.weekly_detail||"").split("\n").map(l=>l.trim()).filter(Boolean);
  if (!eng.weekly_total && !lines.length) return null;
  return (
    <div className="rpt-eng-card">
      <div className="rpt-eng-card__header">
        <span className="rpt-eng-card__name">{name}</span>
        {eng.weekly_total > 0 && (
          <span className="rpt-eng-card__badge">{eng.weekly_total} tarea{eng.weekly_total!==1?"s":""}</span>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="rpt-bullets rpt-bullets--compact">
          {lines.map((line,i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function ReportView({ projects, weekLabel, singleProjectIdx, onClearSingle }) {
  const [toast, setToast] = useState("");

  const isSingle       = singleProjectIdx !== null && singleProjectIdx !== undefined;
  const displayProjects = isSingle ? [projects[singleProjectIdx]] : projects;

  const handleCopy = () => {
    const text = isSingle
      ? generateSingleProjectReportText(projects[singleProjectIdx], weekLabel)
      : generateReportText(projects, weekLabel);
    navigator.clipboard.writeText(text)
      .then(() => { setToast("✓ Reporte copiado al portapapeles"); setTimeout(()=>setToast(""), 2500); })
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
            {isSingle ? `Reporte: ${projects[singleProjectIdx]?.project_name||"Proyecto"}` : "Reporte Semanal Consolidado"}
          </h2>
        </div>
        <button className="btn btn--accent" onClick={handleCopy}>Copiar reporte ✎</button>
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
            const m   = p.manual_metrics || {};
            const pct = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
            const st  = STATUS[p.status] || STATUS["on-track"];
            const engWithWeek = (p.engineers||[]).filter(e => e.weekly_total>0 || (e.weekly_detail||"").trim());

            return (
              <div key={p.id} className="report-project">
                <div className="report-project__header">
                  <span className="report-project__name">
                    <span className="report-project__icon">{st.icon}</span>
                    {p.project_name || `Proyecto ${i+1}`}
                  </span>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    {p.report_date && (
                      <span style={{ fontSize:"12px", color:"var(--text-2)" }}>📅 {p.report_date}</span>
                    )}
                    {p.planner_url && (
                      <a href={p.planner_url} target="_blank" rel="noopener noreferrer" className="planner-link">
                        📋 Planner
                      </a>
                    )}
                    <span className={`status-pill status-pill--${st.cssClass}`}>{st.label}</span>
                  </div>
                </div>

                <div className="report-project__stats">
                  Avance: <strong>{pct}%</strong> — {m.completed_tasks}/{m.total_tasks} actividades | En proceso: {m.in_progress_tasks}
                </div>

                <MiniBar completed={m.completed_tasks} inProgress={m.in_progress_tasks} total={m.total_tasks} />

                <div className="report-project__metrics">
                  <ProjectMetricsTable project={p} />
                </div>

                <div className="rpt-sections-grid">
                  <BulletSection fieldKey="activities_identified" value={p.activities_identified} />
                  <ImpedimentSection impediments={p.impediments} />
                  {p.show_closing_fields && (
                    <>
                      <BulletSection fieldKey="weekly_achievements" value={p.weekly_achievements} />
                      <BulletSection fieldKey="next_week_plan"      value={p.next_week_plan} />
                    </>
                  )}
                  <BulletSection fieldKey="milestones" value={p.milestones} />
                  <BulletSection fieldKey="comments"   value={p.comments} />
                </div>

                {engWithWeek.length > 0 && (
                  <div className="rpt-eng-section">
                    <div className="rpt-eng-section__title">
                      <span>👷 Equipo — esta semana</span>
                      <span className="rpt-section__count">{engWithWeek.length}</span>
                    </div>
                    <div className="rpt-eng-grid">
                      {engWithWeek.map((eng,ei) => <EngineerWeekCard key={ei} eng={eng} />)}
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
