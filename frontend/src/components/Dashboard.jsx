import { GlobalMetricsTable, ProjectMetricsTableCompact } from "./MetricsTable";

const STATUS = {
  "on-track": { label: "En curso",   cssClass: "on-track", icon: "🟡" },
  "at-risk":  { label: "En riesgo",  cssClass: "at-risk",  icon: "🟠" },
  blocked:    { label: "Bloqueado",  cssClass: "blocked",  icon: "🔴" },
  completed:  { label: "Completado", cssClass: "completed",icon: "🟢" },
};

export default function Dashboard({ projects, onEdit, onAdd, onViewReport }) {
  return (
    <div>
      {projects.length > 0 && (
        <div className="dashboard-metrics">
          <h3 className="dashboard-metrics__title">Resumen Global</h3>
          <GlobalMetricsTable projects={projects} />
        </div>
      )}

      <div className="dashboard-grid">
        {projects.map((p, i) => {
          const st = STATUS[p.status] || STATUS["on-track"];
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
