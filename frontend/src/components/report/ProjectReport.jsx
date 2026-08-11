// ProjectReport.jsx — Tarjeta de reporte de un proyecto individual: cabecera
// con acciones (copiar, exportar asignaciones, generar informe), métricas,
// secciones de contenido y el bloque de status con IA.

import { useState, useRef } from "react";
import MiniBar from "../MiniBar";
import { ProjectMetricsTable } from "../MetricsTable";
import { projectProgress, buildActivityIndex, activityText, buildEngineerIndex, generateAssignmentsMarkdown, generateAssignmentsPlainText, visibleActivities } from "../../utils/formulas";
import { useClickOutside } from "../../hooks/useClickOutside";
import { STATUS } from "./reportShared";
import { BulletSection, ImpedimentSection, MilestoneSection, CommentSection, TaskStatusSection, EngineerWeekCard } from "./reportSections";
import AIStatusSection from "./AIStatusSection";

export default function ProjectReport({ p, i, onGenerateInforme, onExportText, generating, generatingName, autoRunStatus, engineerCatalog, weekLabel, setToast }) {
  const m   = p.manual_metrics || {};
  const pct = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const st  = STATUS[p.status] || STATUS["on-track"];
  const activitiesIndex = buildActivityIndex(visibleActivities(p.activities_identified));
  const engineerIndex   = buildEngineerIndex(engineerCatalog);
  const engWithWeek = (p.engineers || []).filter(e =>
    e.weekly_total > 0 || (Array.isArray(e.weekly_detail) ? e.weekly_detail.length : (e.weekly_detail || "").trim())
  );

  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef(null);
  useClickOutside(menuRef, () => setShowExportMenu(false));

  const handleCopyAssignmentsMd = () => {
    const md = generateAssignmentsMarkdown([p], weekLabel);
    navigator.clipboard.writeText(md)
      .then(() => { setToast(`✓ Asignaciones de "${p.project_name || "proyecto"}" copiadas en Markdown`); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar"));
    setShowExportMenu(false);
  };

  const handleCopyAssignmentsTxt = () => {
    const txt = generateAssignmentsPlainText([p], weekLabel);
    navigator.clipboard.writeText(txt)
      .then(() => { setToast(`✓ Asignaciones de "${p.project_name || "proyecto"}" copiadas en Texto Plano`); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar"));
    setShowExportMenu(false);
  };

  const downloadFile = (content, filename, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAssignmentsMd = () => {
    const md = generateAssignmentsMarkdown([p], weekLabel);
    const filename = `asignacion_responsables_${(p.project_name || "proyecto").toLowerCase().replace(/[\s\W]+/g, "_")}_${weekLabel.replace(/[\s—–]+/g, "_")}.md`;
    downloadFile(md, filename, "text/markdown;charset=utf-8");
    setShowExportMenu(false);
  };

  const handleDownloadAssignmentsTxt = () => {
    const txt = generateAssignmentsPlainText([p], weekLabel);
    const filename = `asignacion_responsables_${(p.project_name || "proyecto").toLowerCase().replace(/[\s\W]+/g, "_")}_${weekLabel.replace(/[\s—–]+/g, "_")}.txt`;
    downloadFile(txt, filename, "text/plain;charset=utf-8");
    setShowExportMenu(false);
  };

  return (
    <div className="report-project">
      <div className="report-project__header">
        <span className="report-project__name">
          <span className="report-project__icon">{st.icon}</span>
          {p.project_name || `Proyecto ${i + 1}`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }} ref={menuRef}>
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

          <div className="export-dropdown-wrap">
            <button
              className="btn btn--card-export"
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="Exportar asignaciones de actividades y ingenieros responsables de este proyecto"
            >
              👥 Responsables ▾
            </button>
            {showExportMenu && (
              <div className="export-dropdown-menu">
                <div className="export-dropdown-label">Formato Markdown (.md)</div>
                <button className="export-dropdown-item" onClick={handleCopyAssignmentsMd}>
                  📋 Copiar Tabla .md
                </button>
                <button className="export-dropdown-item export-dropdown-item--separator" onClick={handleDownloadAssignmentsMd}>
                  💾 Descargar Tabla .md
                </button>
                <div className="export-dropdown-label">Formato Texto Plano (.txt)</div>
                <button className="export-dropdown-item" onClick={handleCopyAssignmentsTxt}>
                  📋 Copiar Texto .txt
                </button>
                <button className="export-dropdown-item" onClick={handleDownloadAssignmentsTxt}>
                  💾 Descargar Texto .txt
                </button>
              </div>
            )}
          </div>

          <button
            className="btn btn--informe"
            onClick={() => onGenerateInforme(p)}
            disabled={generating}
            title="Generar Informe de Gestión (.docx)"
          >
            📄 Informe
          </button>
          {generating && generatingName === p.project_name && (
            <span className="generating-inline">
              <span className="generating-inline__spinner" />
              Generando informe
            </span>
          )}
        </div>
      </div>

      <div className="report-project__stats">
        Avance: <strong>{pct}%</strong> — {m.completed_tasks}/{m.total_tasks} actividades | En proceso: {m.in_progress_tasks}
      </div>

      <MiniBar completed={m.completed_tasks} inProgress={m.in_progress_tasks} total={m.total_tasks} />

      <div className="report-project__metrics">
        <ProjectMetricsTable project={p} engineers={engineerCatalog} />
      </div>

      <TaskStatusSection taskStatus={p.task_status} activitiesIndex={activitiesIndex} />

      <div className="rpt-sections-grid">
        <BulletSection fieldKey="activities_identified" value={visibleActivities(p.activities_identified).map(a => a.text)} />
        <ImpedimentSection impediments={p.impediments} />
        {/* weekly_achievements/next_week_plan ya se calculan automáticamente
            (ver NextWeekPlanningSection en EditView.jsx) — BulletSection ya
            se oculta sola cuando el array queda vacío, sin necesitar el
            antiguo checkbox "Habilitar campos". */}
        <BulletSection fieldKey="weekly_achievements" value={(p.weekly_achievements || []).map(id => activityText(activitiesIndex, id))} />
        <BulletSection fieldKey="next_week_plan"      value={(p.next_week_plan      || []).map(id => activityText(activitiesIndex, id))} />
      </div>

      <MilestoneSection milestones={p.milestones} activitiesIndex={activitiesIndex} />
      <CommentSection   comments={p.comments}     activitiesIndex={activitiesIndex} />

      {engWithWeek.length > 0 && (
        <div className="rpt-eng-section">
          <div className="rpt-eng-section__title">
            <span>👷 Equipo — esta semana</span>
            <span className="rpt-section__count">{engWithWeek.length}</span>
          </div>
          <div className="rpt-eng-grid">
            {engWithWeek.map((eng, ei) => <EngineerWeekCard key={ei} eng={eng} activitiesIndex={activitiesIndex} engineerIndex={engineerIndex} />)}
          </div>
        </div>
      )}

      <AIStatusSection project={p} autoRun={autoRunStatus} />
    </div>
  );
}
