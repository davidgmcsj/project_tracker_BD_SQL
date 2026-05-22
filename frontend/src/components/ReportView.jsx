import { useState } from "react";
import MiniBar from "./MiniBar";
import { GlobalMetricsTable, ProjectMetricsTable } from "./MetricsTable";
import { projectProgress, generateReportText, generateSingleProjectReportText } from "../utils/formulas";
import { generateQuarterlyReport } from "../utils/generateQuarterlyReport";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS = {
  "on-track":        { label: "En curso",        cssClass: "on-track",        icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cssClass: "at-risk",         icon: "🟠" },
  blocked:           { label: "Bloqueado",       cssClass: "blocked",         icon: "🔴" },
  completed:         { label: "Completado",      cssClass: "completed",       icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cssClass: "mejora-continua", icon: "🔵" },
};

const IMPEDIMENT_UI = {
  blocker:        { label: "Bloqueantes",          icon: "🚫", variant: "red"      },
  risk:           { label: "Riesgos",              icon: "🔶", variant: "amber"    },
  non_conformity: { label: "Salidas no conformes", icon: "⚠️", variant: "red-soft" },
};

const FIELD_CONFIG = {
  activities_identified: { label: "Actividades Identificadas",   icon: "📋", variant: "blue"  },
  weekly_achievements:   { label: "Qué se hizo esta semana",     icon: "✅", variant: "green" },
  next_week_plan:        { label: "Plan para la próxima semana", icon: "→",  variant: "blue"  },
};

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}


function toLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split("\n").map(l => l.trim()).filter(Boolean);
}

function groupByActivity(items) {
  const grouped = {};
  items.forEach((item, i) => {
    const key = item.activity || "__sin__";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...item, _idx: i });
  });
  return Object.entries(grouped);
}

// ── Componentes de sección ────────────────────────────────────────────────────

function BulletSection({ fieldKey, value }) {
  const lines = toLines(value);
  if (!lines.length) return null;
  const cfg        = FIELD_CONFIG[fieldKey] || { label: fieldKey, icon: "•", variant: "gray" };
  const isNumbered = fieldKey === "activities_identified";

  return (
    <div className={`rpt-section rpt-section--${cfg.variant}`}>
      <div className="rpt-section__header">
        <span className="rpt-section__icon">{cfg.icon}</span>
        <span className="rpt-section__label">{cfg.label}</span>
        <span className="rpt-section__count">{lines.length}</span>
      </div>
      {isNumbered ? (
        <ol className="rpt-bullets rpt-bullets--numbered">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item rpt-bullets__item--numbered">{line}</li>)}
        </ol>
      ) : (
        <ul className="rpt-bullets">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
        </ul>
      )}
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
        const cfg = IMPEDIMENT_UI[cat] || { label: cat, icon: "⚠️", variant: "red-soft" };
        return (
          <div key={cat} className={`rpt-section rpt-section--${cfg.variant}`}>
            <div className="rpt-section__header">
              <span className="rpt-section__icon">{cfg.icon}</span>
              <span className="rpt-section__label">{cfg.label}</span>
              <span className="rpt-section__count">{items.length}</span>
            </div>
            <ul className="rpt-bullets">
              {items.map((im, i) => (
                <li key={i} className="rpt-bullets__item">
                  {im.description}
                  {im.impact && (
                    <span style={{ display: "block", marginLeft: 16, fontSize: "12px", color: "var(--text-2)", marginTop: 2 }}>
                      → Impacto: {im.impact}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function MilestoneSection({ milestones }) {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  const validItems = milestones.filter(m => m.date || m.note);
  if (!validItems.length) return null;
  const groups = groupByActivity(validItems);

  return (
    <div className="rpt-section rpt-section--teal rpt-section--full">
      <div className="rpt-section__header">
        <span className="rpt-section__icon">📅</span>
        <span className="rpt-section__label">Fechas Clave</span>
        <span className="rpt-section__count">{validItems.length}</span>
      </div>
      <div className="milestone-report">
        {groups.map(([actKey, items]) => (
          <div key={actKey} className="milestone-report__group">
            {actKey !== "__sin__" && <div className="milestone-report__act">{actKey}</div>}
            {items.map((m, i) => (
              <div key={i} className="milestone-report__row">
                {m.date && <span className="milestone-report__date">{fmtDate(m.date)}</span>}
                {m.note && <span className="milestone-report__note">{m.note}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommentSection({ comments }) {
  if (!Array.isArray(comments) || !comments.length) return null;
  const validItems = comments.filter(c => c.text);
  if (!validItems.length) return null;
  const groups = groupByActivity(validItems);

  return (
    <div className="rpt-section rpt-section--gray rpt-section--full">
      <div className="rpt-section__header">
        <span className="rpt-section__icon">💬</span>
        <span className="rpt-section__label">Comentarios</span>
        <span className="rpt-section__count">{validItems.length}</span>
      </div>
      <div className="milestone-report">
        {groups.map(([actKey, items]) => (
          <div key={actKey} className="milestone-report__group">
            {actKey !== "__sin__" && <div className="milestone-report__act">{actKey}</div>}
            {items.map((c, i) => (
              <div key={i} className="milestone-report__row">
                {c.date && <span className="milestone-report__date">{fmtDate(c.date)}</span>}
                <span className="milestone-report__note">{c.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskStatusSection({ taskStatus }) {
  if (!taskStatus || typeof taskStatus !== "object") return null;
  const done = (taskStatus.completed   || []).filter(Boolean);
  const wip  = (taskStatus.in_progress || []).filter(Boolean);
  const not  = (taskStatus.not_started || []).filter(Boolean);
  if (!done.length && !wip.length && !not.length) return null;

  const cols = [
    { items: done, label: "Completadas",  icon: "✅", variant: "green" },
    { items: wip,  label: "En proceso",   icon: "🔄", variant: "amber" },
    { items: not,  label: "No iniciadas", icon: "○",  variant: "gray"  },
  ].filter(c => c.items.length > 0);

  return (
    <div className="rpt-task-status">
      {cols.map(col => (
        <div key={col.label} className={`rpt-section rpt-section--${col.variant}`}>
          <div className="rpt-section__header">
            <span className="rpt-section__icon">{col.icon}</span>
            <span className="rpt-section__label">{col.label}</span>
            <span className="rpt-section__count">{col.items.length}</span>
          </div>
          <ul className="rpt-bullets">
            {col.items.map((item, i) => <li key={i} className="rpt-bullets__item">{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EngineerWeekCard({ eng }) {
  const name  = eng.engineer_id === "Otro..." ? (eng.custom_name || "—") : (eng.engineer_id || "—");
  const lines = toLines(eng.weekly_detail);
  if (!eng.weekly_total && !lines.length) return null;

  return (
    <div className="rpt-eng-card">
      <div className="rpt-eng-card__header">
        <span className="rpt-eng-card__name">{name}</span>
        {eng.weekly_total > 0 && (
          <span className="rpt-eng-card__badge">{eng.weekly_total} tarea{eng.weekly_total !== 1 ? "s" : ""}</span>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="rpt-bullets rpt-bullets--compact">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
        </ul>
      )}
    </div>
  );
}

function ProjectReport({ p, i, onGenerateInforme, onExportText }) {
  const m   = p.manual_metrics || {};
  const pct = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const st  = STATUS[p.status] || STATUS["on-track"];
  const engWithWeek = (p.engineers || []).filter(e =>
    e.weekly_total > 0 || (Array.isArray(e.weekly_detail) ? e.weekly_detail.length : (e.weekly_detail || "").trim())
  );

  return (
    <div className="report-project">
      <div className="report-project__header">
        <span className="report-project__name">
          <span className="report-project__icon">{st.icon}</span>
          {p.project_name || `Proyecto ${i + 1}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {p.report_date && (
            <span style={{ fontSize: "12px", color: "var(--text-2)" }}>📅 {p.report_date}</span>
          )}
          {p.planner_url && (
            <a href={p.planner_url} target="_blank" rel="noopener noreferrer" className="planner-link">
              📋 Planner
            </a>
          )}
          <span className={`status-pill status-pill--${st.cssClass}`}>{st.label}</span>
          <button
            className="btn btn--card-export"
            onClick={() => onExportText(p)}
            title="Copiar reporte de este proyecto al portapapeles"
          >
            📋 Copiar reporte
          </button>
          <button
            className="btn btn--informe"
            onClick={() => onGenerateInforme(p)}
            title="Generar Informe de Gestión (.docx)"
          >
            📄 Informe
          </button>
        </div>
      </div>

      <div className="report-project__stats">
        Avance: <strong>{pct}%</strong> — {m.completed_tasks}/{m.total_tasks} actividades | En proceso: {m.in_progress_tasks}
      </div>

      <MiniBar completed={m.completed_tasks} inProgress={m.in_progress_tasks} total={m.total_tasks} />

      <div className="report-project__metrics">
        <ProjectMetricsTable project={p} />
      </div>

      <TaskStatusSection taskStatus={p.task_status} />

      <div className="rpt-sections-grid">
        <BulletSection fieldKey="activities_identified" value={p.activities_identified} />
        <ImpedimentSection impediments={p.impediments} />
        {p.show_closing_fields && (
          <>
            <BulletSection fieldKey="weekly_achievements" value={p.weekly_achievements} />
            <BulletSection fieldKey="next_week_plan"      value={p.next_week_plan} />
          </>
        )}
      </div>

      <MilestoneSection milestones={p.milestones} />
      <CommentSection   comments={p.comments} />

      {engWithWeek.length > 0 && (
        <div className="rpt-eng-section">
          <div className="rpt-eng-section__title">
            <span>👷 Equipo — esta semana</span>
            <span className="rpt-section__count">{engWithWeek.length}</span>
          </div>
          <div className="rpt-eng-grid">
            {engWithWeek.map((eng, ei) => <EngineerWeekCard key={ei} eng={eng} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ReportView({ projects, weekLabel, singleProjectIdx, onClearSingle }) {
  const [toast, setToast]           = useState("");
  const [generating, setGenerating] = useState(false);

  const isSingle        = singleProjectIdx != null;
  const displayProjects = isSingle ? [projects[singleProjectIdx]] : projects;

  const handleCopy = () => {
    const text = isSingle
      ? generateSingleProjectReportText(projects[singleProjectIdx], weekLabel)
      : generateReportText(projects, weekLabel);
    navigator.clipboard.writeText(text)
      .then(() => { setToast("✓ Reporte copiado al portapapeles"); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar"));
  };

  const handleExportText = (project) => {
    const text = generateSingleProjectReportText(project, weekLabel);
    navigator.clipboard.writeText(text)
      .then(() => { setToast(`✓ Reporte de "${project.project_name || "proyecto"}" copiado`); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar al portapapeles"));
  };

  const handleGenerateInforme = async (project) => {
    setGenerating(true);
    try {
      await generateQuarterlyReport(project);
      setToast("✓ Informe de gestión generado");
    } catch (e) {
      setToast("Error generando informe: " + e.message);
    } finally {
      setGenerating(false);
      setTimeout(() => setToast(""), 3000);
    }
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
              ? `Reporte: ${projects[singleProjectIdx]?.project_name || "Proyecto"}`
              : "Reporte Semanal Consolidado"}
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isSingle && (
            <button
              className="btn btn--primary"
              onClick={handleGenerateInforme}
              disabled={generating}
              title="Genera el Informe de Gestión institucional en formato Word (.docx)"
            >
              {generating ? "Generando..." : "📄 Generar Informe"}
            </button>
          )}
          <button className="btn btn--accent" onClick={handleCopy}>Copiar reporte ✎</button>
        </div>
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
          {displayProjects.map((p, i) => <ProjectReport key={p.id} p={p} i={i} onGenerateInforme={handleGenerateInforme} onExportText={handleExportText} />)}
        </>
      )}
    </div>
  );
}
