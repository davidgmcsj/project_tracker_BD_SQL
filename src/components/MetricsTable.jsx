import { projectProgress, globalProgress } from "../utils/formulas";

function badgePctStyle(pct) {
  if (pct >= 75) return { background: "var(--green-bg)", color: "var(--green)" };
  if (pct >= 40) return { background: "var(--amber-bg)", color: "var(--amber)" };
  return { background: "var(--red-bg)", color: "var(--red)" };
}

export function GlobalMetricsTable({ projects }) {
  const totalAct   = projects.reduce((s,p) => s + Number(p.manual_metrics?.total_tasks       || 0), 0);
  const totalDone  = projects.reduce((s,p) => s + Number(p.manual_metrics?.completed_tasks   || 0), 0);
  const totalPend  = projects.reduce((s,p) => {
    const m = p.manual_metrics || {};
    return s + Math.max(0, (m.total_tasks||0) - (m.completed_tasks||0) - (m.in_progress_tasks||0));
  }, 0);
  const avgPct      = Math.round(globalProgress(projects));
  const withBlocker = projects.filter(p => (p.impediments||[]).some(im => im.category==="blocker"));

  return (
    <div className="metrics-container">
      <table className="metrics-table">
        <thead><tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr></thead>
        <tbody>
          <tr>
            <td>Avance Promedio</td>
            <td><strong>{avgPct}%</strong></td>
            <td>Promedio de avance de los proyectos con tareas definidas.</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{totalDone} de {totalAct}</strong></td>
            <td>{totalPend} no iniciado{totalPend!==1?"s":""}{totalPend>0?" .":" — todo al día."}</td>
          </tr>
          <tr>
            <td>Con bloqueantes</td>
            <td><strong>{withBlocker.length}</strong></td>
            <td>{withBlocker.length===0 ? "Sin bloqueantes activos." : withBlocker.map(p=>p.project_name).join(", ")}</td>
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
      <tr className="metrics-table__section-header"><td colSpan={3}>Indicadores</td></tr>
      {indicators.map((ind, i) => {
        const pct    = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
        const noInit = Math.max(0, ind.total - ind.completed - ind.in_progress);
        return (
          <tr key={i} className="metrics-table__indicator-row">
            <td>{ind.name || `Indicador ${i+1}`}</td>
            <td><span className="ind-pct-badge" style={badgePctStyle(pct)}>{pct}%</span></td>
            <td>
              <span className="eng-badge eng-badge--done">{ind.completed} ✓</span>{" "}
              <span className="eng-badge eng-badge--wip">{ind.in_progress} ↻</span>{" "}
              <span className="eng-badge eng-badge--pending">{noInit} ○</span>
              <span style={{ marginLeft:8, fontSize:"11px", color:"var(--text-3)" }}>de {ind.total}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function ProjectMetricsTableCompact({ project }) {
  const p       = project;
  const m       = p.manual_metrics || {};
  const pct     = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const pending = Math.max(0, (m.total_tasks||0) - (m.completed_tasks||0) - (m.in_progress_tasks||0));
  const blockers = (p.impediments||[]).filter(im=>im.category==="blocker");

  return (
    <div className="metrics-container">
      <table className="metrics-table metrics-table--project">
        <thead><tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr></thead>
        <tbody>
          <tr>
            <td>Avance</td>
            <td><strong>{pct}%</strong></td>
            <td>{m.completed_tasks} completadas · {m.in_progress_tasks} en proceso.</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{m.completed_tasks} de {m.total_tasks}</strong></td>
            <td>{pending} no iniciada{pending!==1?"s":""}{pending===0?" — todo completado.":"."}</td>
          </tr>
          <tr>
            <td>Bloqueantes</td>
            <td><strong>{blockers.length}</strong></td>
            <td>{blockers.length===0 ? "Sin bloqueantes." : blockers[0].description.split("\n")[0]}</td>
          </tr>
          <IndicatorRows indicators={p.indicators||[]} />
        </tbody>
      </table>
      <p className="metrics-note">* El porcentaje de avance se calcula según las tareas identificadas.</p>
    </div>
  );
}

export function ProjectMetricsTable({ project }) {
  const p          = project;
  const m          = p.manual_metrics || {};
  const pct        = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const pending    = Math.max(0, (m.total_tasks||0) - (m.completed_tasks||0) - (m.in_progress_tasks||0));
  const blockers   = (p.impediments||[]).filter(im=>im.category==="blocker");
  const risks      = (p.impediments||[]).filter(im=>im.category==="risk");
  const nonConf    = (p.impediments||[]).filter(im=>im.category==="non_conformity");
  const engineers  = p.engineers  || [];
  const indicators = p.indicators || [];

  return (
    <div className="metrics-container">
      <table className="metrics-table metrics-table--project">
        <thead><tr><th>Métrica</th><th>Valor</th><th>Observaciones</th></tr></thead>
        <tbody>
          <tr>
            <td>Avance</td>
            <td><strong>{pct}%</strong></td>
            <td>{m.completed_tasks} completadas · {m.in_progress_tasks} en proceso.</td>
          </tr>
          <tr>
            <td>Estado de Tareas</td>
            <td><strong>{m.completed_tasks} de {m.total_tasks}</strong></td>
            <td>{pending} no iniciada{pending!==1?"s":""}{pending===0?" — todo completado.":"."}</td>
          </tr>
          <tr>
            <td>Bloqueantes</td>
            <td><strong>{blockers.length}</strong></td>
            <td>{blockers.length===0 ? "Sin bloqueantes." : blockers[0].description.split("\n")[0]}</td>
          </tr>

          <IndicatorRows indicators={indicators} />

          {engineers.length > 0 && (
            <tr className="metrics-table__section-header">
              <td colSpan={3}>
                Ingenieros
                {(m.shared_tasks_discount||0) > 0 && (
                  <span style={{ fontWeight:400, fontSize:"11px", marginLeft:10, opacity:0.85 }}>
                    ({engineers.reduce((s,e)=>s+Number(e.assigned||0),0)} asignadas − {m.shared_tasks_discount} compartidas = {engineers.reduce((s,e)=>s+Number(e.assigned||0),0)-m.shared_tasks_discount} reales)
                  </span>
                )}
              </td>
            </tr>
          )}
          {engineers.map((eng, i) => {
            const name   = eng.engineer_id==="Otro..."?(eng.custom_name||"—"):(eng.engineer_id||"—");
            const noInit = Math.max(0, eng.assigned - eng.completed - eng.in_progress);
            return (
              <tr key={i} className="metrics-table__engineer-row">
                <td style={{ fontWeight:700 }}>{name}</td>
                <td>
                  <div style={{ fontSize:"11px", color:"var(--text-3)", marginBottom:3 }}>Global</div>
                  <strong>{eng.completed}</strong><span className="eng-stat"> / {eng.assigned}</span>
                </td>
                <td>
                  <div style={{ fontSize:"11px", color:"var(--text-3)", marginBottom:3 }}>Global</div>
                  <span className="eng-badge eng-badge--done">{eng.completed} ✓</span>{" "}
                  <span className="eng-badge eng-badge--wip">{eng.in_progress} ↻</span>{" "}
                  <span className="eng-badge eng-badge--pending">{noInit} ○</span>
                </td>
              </tr>
            );
          })}
          {engineers.some(e=>e.weekly_total>0||(Array.isArray(e.weekly_detail)?e.weekly_detail.length:e.weekly_detail)) && engineers.map((eng,i) => {
            const name = eng.engineer_id==="Otro..."?(eng.custom_name||"—"):(eng.engineer_id||"—");
            const detail = Array.isArray(eng.weekly_detail) ? eng.weekly_detail : (eng.weekly_detail ? eng.weekly_detail.split("\n").map(l=>l.trim()).filter(Boolean) : []);
            if (!eng.weekly_total && !detail.length) return null;
            return (
              <tr key={`week-${i}`} className="metrics-table__engineer-row metrics-table__engineer-week">
                <td style={{ paddingLeft:20, color:"var(--text-2)", fontSize:"12px" }}>↳ semana</td>
                <td><strong>{eng.weekly_total||0}</strong><span className="eng-stat"> tareas</span></td>
                <td style={{ color:"var(--text-2)", fontSize:"12px" }}>
                  {detail.length > 0
                    ? <ul style={{ margin:0, padding:"0 0 0 14px", listStyle:"disc" }}>{detail.map((d,di)=><li key={di}>{d}</li>)}</ul>
                    : "—"}
                </td>
              </tr>
            );
          })}

          {nonConf.length > 0 && (
            <>
              <tr className="metrics-table__section-header"><td colSpan={3}>Salidas no conformes</td></tr>
              {nonConf.map((nc,i) => <tr key={i}><td colSpan={3} className="metrics-table__text-cell">{nc.description}</td></tr>)}
            </>
          )}
          {risks.length > 0 && (
            <>
              <tr className="metrics-table__section-header"><td colSpan={3}>Riesgos</td></tr>
              {risks.map((r,i) => <tr key={i}><td colSpan={3} className="metrics-table__text-cell">{r.description}{r.impact?` — ${r.impact}`:""}</td></tr>)}
            </>
          )}
        </tbody>
      </table>
      <p className="metrics-note">* El porcentaje de avance se calcula según las tareas identificadas.</p>
    </div>
  );
}
