import { projectProgress, globalProgress } from "../utils/formulas";

function badgePctStyle(pct) {
  if (pct >= 75) return { background: "var(--green-bg)", color: "var(--green)" };
  if (pct >= 40) return { background: "var(--amber-bg)", color: "var(--amber)" };
  return { background: "var(--red-bg)", color: "var(--red)" };
}

export function GlobalMetricsTable({ projects }) {
  const totalActivities = projects.reduce((s, p) => s + Number(p.totalActivities || 0), 0);
  const totalCompleted  = projects.reduce((s, p) => s + Number(p.completedActivities || 0), 0);
  const totalPending    = projects.reduce(
    (s, p) => s + Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities), 0
  );
  const avgPercent      = Math.round(globalProgress(projects));
  const blockedProjects = projects.filter(p => p.blockers);

  return (
    <div className="metrics-container">
      <table className="metrics-table">
        <thead>
          <tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Avance Promedio</td>
            <td><strong>{avgPercent}%</strong></td>
            <td>Promedio de avance de los proyectos con tareas definidas.</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{totalCompleted} de {totalActivities}</strong></td>
            <td>{totalPending} no iniciado{totalPending !== 1 ? "s" : ""}{totalPending > 0 ? "." : " — todo al día."}</td>
          </tr>
          <tr>
            <td>Riesgos Activos</td>
            <td><strong>{blockedProjects.length}</strong></td>
            <td>{blockedProjects.length === 0 ? "Sin bloqueantes activos." : blockedProjects.map(p => p.name).join(", ")}</td>
          </tr>
        </tbody>
      </table>
      <p className="metrics-note">* El porcentaje de avance se calcula según las tareas identificadas en cada proyecto.</p>
    </div>
  );
}

function IndicatorRows({ indicators }) {
  if (!indicators.length) return null;
  return (
    <>
      <tr className="metrics-table__section-header">
        <td colSpan={3}>Indicadores</td>
      </tr>
      {indicators.map((ind, i) => {
        const indPct    = Math.round(projectProgress(ind.total, ind.completed, ind.inProgress));
        const indNoInit = Math.max(0, ind.total - ind.completed - ind.inProgress);
        return (
          <tr key={i} className="metrics-table__indicator-row">
            <td>{ind.name || `Indicador ${i + 1}`}</td>
            <td><span className="ind-pct-badge" style={badgePctStyle(indPct)}>{indPct}%</span></td>
            <td>
              <span className="eng-badge eng-badge--done">{ind.completed} ✓</span>
              {" "}
              <span className="eng-badge eng-badge--wip">{ind.inProgress} ↻</span>
              {" "}
              <span className="eng-badge eng-badge--pending">{indNoInit} ○</span>
              <span style={{ marginLeft: 8, fontSize: "11px", color: "var(--text-3)" }}>de {ind.total}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function ProjectMetricsTableCompact({ project }) {
  const p          = project;
  const pct        = Math.round(projectProgress(p.totalActivities, p.completedActivities, p.inProgressActivities));
  const pending    = Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities);
  const hasBlockers = !!p.blockers;

  return (
    <div className="metrics-container">
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Avance</td>
            <td><strong>{pct}%</strong></td>
            <td>{p.completedActivities} completadas · {p.inProgressActivities} en proceso (basado en tareas identificadas).</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{p.completedActivities} de {p.totalActivities}</strong></td>
            <td>{pending} no iniciada{pending !== 1 ? "s" : ""}{pending === 0 ? " — todo completado." : "."}</td>
          </tr>
          <tr>
            <td>Riesgos Activos</td>
            <td><strong>{hasBlockers ? 1 : 0}</strong></td>
            <td>{hasBlockers ? p.blockers.split("\n").filter(Boolean)[0] : "Sin bloqueantes."}</td>
          </tr>
          <IndicatorRows indicators={p.indicators || []} />
        </tbody>
      </table>
      <p className="metrics-note">* El porcentaje de avance se calcula según las tareas identificadas.</p>
    </div>
  );
}

export function ProjectMetricsTable({ project }) {
  const p          = project;
  const pct        = Math.round(projectProgress(p.totalActivities, p.completedActivities, p.inProgressActivities));
  const pending    = Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities);
  const hasBlockers = !!p.blockers;
  const engineers  = p.engineers  || [];
  const indicators = p.indicators || [];

  return (
    <div className="metrics-container">
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Avance</td>
            <td><strong>{pct}%</strong></td>
            <td>{p.completedActivities} completadas · {p.inProgressActivities} en proceso (basado en tareas identificadas).</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{p.completedActivities} de {p.totalActivities}</strong></td>
            <td>{pending} no iniciada{pending !== 1 ? "s" : ""}{pending === 0 ? " — todo completado." : "."}</td>
          </tr>
          <tr>
            <td>Riesgos Activos</td>
            <td><strong>{hasBlockers ? 1 : 0}</strong></td>
            <td>{hasBlockers ? p.blockers.split("\n").filter(Boolean)[0] : "Sin bloqueantes."}</td>
          </tr>

          <IndicatorRows indicators={indicators} />

          {engineers.length > 0 && (
            <tr className="metrics-table__section-header">
              <td colSpan={3}>
                Ingenieros
                {p.sharedTasks > 0 && (
                  <span style={{ fontWeight: 400, fontSize: "11px", marginLeft: 10, opacity: 0.85 }}>
                    ({engineers.reduce((s, e) => s + Number(e.assigned || 0), 0)} asignadas − {p.sharedTasks} compartidas = {engineers.reduce((s, e) => s + Number(e.assigned || 0), 0) - p.sharedTasks} reales)
                  </span>
                )}
              </td>
            </tr>
          )}
          {engineers.map((eng, i) => {
            const engName      = eng.name === "Otro..." ? (eng.customName || "—") : (eng.name || "—");
            const noInitGlobal = Math.max(0, eng.assigned - eng.completed - eng.inProgress);
            return (
              <tr key={i} className="metrics-table__engineer-row">
                <td style={{ fontWeight: 700 }}>{engName}</td>
                <td>
                  <div style={{ fontSize: "11px", color: "var(--text-3)", marginBottom: 3 }}>Global</div>
                  <strong>{eng.completed}</strong>
                  <span className="eng-stat"> / {eng.assigned}</span>
                </td>
                <td>
                  <div style={{ fontSize: "11px", color: "var(--text-3)", marginBottom: 3 }}>Global</div>
                  <span className="eng-badge eng-badge--done">{eng.completed} ✓</span>
                  {" "}
                  <span className="eng-badge eng-badge--wip">{eng.inProgress} ↻</span>
                  {" "}
                  <span className="eng-badge eng-badge--pending">{noInitGlobal} ○</span>
                </td>
              </tr>
            );
          })}
          {engineers.some(e => e.weekTotal > 0 || e.weekActivities) && engineers.map((eng, i) => {
            const engName = eng.name === "Otro..." ? (eng.customName || "—") : (eng.name || "—");
            if (!eng.weekTotal && !eng.weekActivities) return null;
            return (
              <tr key={`week-${i}`} className="metrics-table__engineer-row metrics-table__engineer-week">
                <td style={{ paddingLeft: 20, color: "var(--text-2)", fontSize: "12px" }}>↳ semana</td>
                <td>
                  <strong>{eng.weekTotal || 0}</strong>
                  <span className="eng-stat"> tareas</span>
                </td>
                <td style={{ color: "var(--text-2)", fontSize: "12px", whiteSpace: "pre-wrap" }}>
                  {eng.weekActivities || "—"}
                </td>
              </tr>
            );
          })}

          {p.nonConformances && (
            <>
              <tr className="metrics-table__section-header"><td colSpan={3}>Salidas no conformes</td></tr>
              <tr><td colSpan={3} className="metrics-table__text-cell">{p.nonConformances}</td></tr>
            </>
          )}
          {p.risks && (
            <>
              <tr className="metrics-table__section-header"><td colSpan={3}>Riesgos</td></tr>
              <tr><td colSpan={3} className="metrics-table__text-cell">{p.risks}</td></tr>
            </>
          )}
        </tbody>
      </table>
      <p className="metrics-note">* El porcentaje de avance se calcula según las tareas identificadas.</p>
    </div>
  );
}
