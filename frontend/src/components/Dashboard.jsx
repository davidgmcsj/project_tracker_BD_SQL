import { useState } from "react";
import { GlobalMetricsTable, ProjectMetricsTableCompact } from "./MetricsTable";
import { generateAssignmentsByEngineer } from "../utils/formulas";

const STATUS = {
  "on-track":        { label: "En curso",        cssClass: "on-track",        icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cssClass: "at-risk",         icon: "🟠" },
  blocked:           { label: "Bloqueado",       cssClass: "blocked",         icon: "🔴" },
  completed:         { label: "Completado",      cssClass: "completed",       icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cssClass: "mejora-continua", icon: "🔵" },
};

export default function Dashboard({ projects, engineers, onEdit, onAdd, onViewReport, onExportReport, onGenerateInforme, generatingInforme, generatingName, onCancelInforme }) {
  const [toast, setToast] = useState("");

  const handleCopyAssign = (p, i, e) => {
    e.stopPropagation();
    // Usa solo los ingenieros del catálogo que están en el equipo del proyecto
    const projectEngIds = new Set((p.engineers || []).map(r => r.engineer_id).filter(Boolean));
    const projectEngCatalog = projectEngIds.size > 0
      ? (engineers || []).filter(e => projectEngIds.has(e.id))
      : engineers || [];
    const txt = generateAssignmentsByEngineer([p], projectEngCatalog, p.project_name || `Proyecto ${i + 1}`);
    navigator.clipboard.writeText(txt)
      .then(() => { setToast(`✓ Asignaciones de "${p.project_name || `Proyecto ${i + 1}`}" copiadas`); setTimeout(() => setToast(""), 2500); })
      .catch(() => { setToast("No se pudo copiar"); setTimeout(() => setToast(""), 2500); });
  };

  return (
    <div>
      {projects.length > 0 && (
        <div className="dashboard-metrics">
          <h3 className="dashboard-metrics__title">Resumen Global</h3>
          <GlobalMetricsTable projects={projects} />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <div className="dashboard-grid">
        {projects.map((p, i) => {
          const st = STATUS[p.status] || STATUS["on-track"];
          const isGeneratingThis = generatingInforme && generatingName === (p.project_name || `Proyecto ${i + 1}`);

          return (
            <div key={p.id} className="project-card" onClick={() => onEdit(i)}>
              <div className="project-card__header">
                <h3 className="project-card__name">
                  <span style={{ marginRight: 6 }}>{st.icon}</span>
                  {p.project_name || `Proyecto ${i + 1}`}
                </h3>
                <span className={`status-pill status-pill--${st.cssClass}`}>{st.label}</span>
              </div>
              <div className="project-card__metrics" onClick={e => e.stopPropagation()}>
                <ProjectMetricsTableCompact project={p} />
              </div>
              <div className="project-card__actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn--card-report" onClick={() => onViewReport(i)}>
                  📄 Ver reporte
                </button>
                <button className="btn btn--card-export" onClick={() => onExportReport(i)}>
                  📋 Copiar reporte
                </button>
                {isGeneratingThis ? (
                  <button className="btn btn--card-cancel" onClick={onCancelInforme}>
                    ✕ Cancelar
                  </button>
                ) : (
                  <button
                    className="btn btn--card-informe"
                    onClick={() => onGenerateInforme(i)}
                    disabled={generatingInforme}
                    title="Generar Informe de Gestión (.docx)"
                  >
                    {generatingInforme && !isGeneratingThis ? "⏳ Generando…" : "📝 Informe"}
                  </button>
                )}
                <button
                  className="btn btn--card-assign"
                  onClick={(e) => handleCopyAssign(p, i, e)}
                  title="Copiar actividades por ingeniero"
                >
                  👥 Asignaciones
                </button>
              </div>
            </div>
          );
        })}

        <div className="add-card" onClick={onAdd}>
          <span className="add-card__icon">+</span>
          <span className="add-card__text">Agregar proyecto</span>
        </div>
      </div>
    </div>
  );
}
