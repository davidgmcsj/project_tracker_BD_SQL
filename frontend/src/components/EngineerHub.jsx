// EngineerHub.jsx — Punto de entrada único para todo lo relacionado con
// ingenieros. Reemplaza a las pestañas separadas "Ingenieros" y "Rep.
// Ingenieros": ambas respondían la misma pregunta ("qué hace cada
// ingeniero") con datos que podían no coincidir (ver Fase 1 —
// utils/engineers.js). Aquí conviven en sub-pestañas de una sola pantalla:
//
//   - "Mi semana"  → lo nuevo de esta fase: KPIs accionables + "qué hacer
//                     ahora", para que el ingeniero sepa qué tiene pendiente
//                     sin entrar proyecto por proyecto (idea adoptada del
//                     dashboard de Contro O.T.: indicadores accionables, no
//                     solo descriptivos).
//   - "Equipo"      → el contenido íntegro de EngineersView: la única vista
//                     que ESCRIBE datos de ingeniero (alta/edición/tareas).
//   - "Historial"   → el detalle por proyecto + tareas adicionales de
//                     EngineerReportView, insumo para reuniones e informe
//                     trimestral.

import { useEffect, useMemo, useState } from "react";
import {
  getProjectsForEngineer,
  engineerWeekTasks,
  engineerNextWeekTasks,
  buildEngineerWeekKpis,
  generateEngineerReportText,
} from "../utils/engineers";
import EngineerWeekTable from "./engineer/EngineerWeekTable";
import EngineersView from "./EngineersView";
import EngineerReportBody from "./EngineerReportBody";

const TODAY = new Date();

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

const AVATAR_COLORS = ["#003399", "#1a49a8", "#0e7490", "#7c3aed", "#be185d", "#0f766e", "#b45309"];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const SUBTABS = [
  { key: "mi-semana", label: "Mi semana" },
  { key: "equipo",    label: "Equipo" },
  { key: "historial", label: "Historial" },
];

function KpiChip({ tone, count, label, active, onClick }) {
  return (
    <button
      type="button"
      className={`eng-kpi-chip eng-kpi-chip--${tone} ${active ? "eng-kpi-chip--active" : ""}`}
      onClick={onClick}
    >
      <span className="eng-kpi-chip__count">{count}</span>
      <span className="eng-kpi-chip__label">{label}</span>
    </button>
  );
}

// Sub-pestaña "Mi semana": KPIs accionables + lista priorizada "qué hacer
// ahora" + vista rápida de la próxima semana. Todo se deriva en vivo desde
// las fechas (utils/weekPlanning.js vía utils/engineers.js) — nada nuevo que
// mantener sincronizado.
function MyWeekTab({ engineer, projects, onOpenActivity }) {
  const [filter, setFilter] = useState(null); // "overdue" | "today" | null

  const weekRows = useMemo(
    () => engineerWeekTasks(engineer.id, projects, TODAY),
    [engineer.id, projects]
  );
  const nextWeekRows = useMemo(
    () => engineerNextWeekTasks(engineer.id, projects, TODAY),
    [engineer.id, projects]
  );
  const kpis = useMemo(
    () => buildEngineerWeekKpis(weekRows, projects, TODAY),
    [weekRows, projects]
  );

  const todayIso = TODAY.toISOString().slice(0, 10);
  const visibleTodo = kpis.todo.filter(row => {
    if (filter === "overdue") return row.situation === "overdue";
    if (filter === "today") return row.activity.due_date === todayIso;
    return true;
  });

  return (
    <>
      <div className="eng-kpi-strip">
        <KpiChip tone="danger"  count={kpis.overdue}  label="Vencidas"
          active={filter === "overdue"} onClick={() => setFilter(f => f === "overdue" ? null : "overdue")} />
        <KpiChip tone="warn"    count={kpis.dueToday} label="Vence hoy"
          active={filter === "today"} onClick={() => setFilter(f => f === "today" ? null : "today")} />
        <KpiChip tone="info"    count={kpis.thisWeek} label="Esta semana"
          active={filter === null} onClick={() => setFilter(null)} />
        <KpiChip tone="neutral" count={kpis.pending}  label="Pendientes"
          active={false} onClick={() => setFilter(null)} />
      </div>

      <h3 className="report-section-title" style={{ marginBottom: 12 }}>
        Qué hacer ahora {filter && <span className="act-count">{visibleTodo.length}</span>}
      </h3>
      <EngineerWeekTable rows={visibleTodo} onOpenActivity={onOpenActivity} />

      <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>
        Próxima semana ({nextWeekRows.length})
      </h3>
      <EngineerWeekTable rows={nextWeekRows} onOpenActivity={onOpenActivity} />
    </>
  );
}

export default function EngineerHub({
  engineers, projects,
  onAdd, onUpdate, onToggleActive, onUpdateTasks,
  onOpenActivity, // (projectId, activityId) => void — abre la tarjeta de detalle
  initialSubtab,  // sub-pestaña con la que abrir al navegar desde fuera (NavGroup)
}) {
  const [subtab, setSubtab] = useState(initialSubtab || "mi-semana");
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState("");

  // App.jsx sigue montando este mismo componente al pasar de "Equipo y mi
  // semana" a "Historial por ingeniero" (misma posición en el árbol) — sin
  // esto, la sub-pestaña interna quedaba pegada a la primera que se abrió,
  // sin importar cuál opción del menú se hubiera clickeado después.
  useEffect(() => {
    if (initialSubtab) setSubtab(initialSubtab);
  }, [initialSubtab]);

  const activeList = (engineers || []).filter(e => e.active !== false);
  const eng = (engineers || []).find(e => e.id === selectedId) || activeList[0] || null;

  const handleCopy = () => {
    if (!eng) return;
    navigator.clipboard.writeText(generateEngineerReportText(eng, projects))
      .then(() => { setToast(`✓ Reporte de "${eng.name}" copiado`); setTimeout(() => setToast(""), 2500); })
      .catch(() => { setToast("No se pudo copiar"); setTimeout(() => setToast(""), 2500); });
  };

  if (!activeList.length) {
    return <p style={{ color: "var(--text-2)", marginTop: 16 }}>Sin ingenieros activos. Agrega el primero en la pestaña "Equipo".</p>;
  }

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <h2 className="report-panel__title">Ingenieros</h2>
        {(subtab === "mi-semana" || subtab === "historial") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              className="field__input"
              style={{ minWidth: 220 }}
              value={eng?.id || ""}
              onChange={e => setSelectedId(e.target.value)}
            >
              {activeList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {subtab === "historial" && (
              <button className="btn btn--accent" onClick={handleCopy} disabled={!eng}>📋 Copiar reporte</button>
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <div className="tab-btn-row" style={{ margin: "12px 0 20px" }}>
        {SUBTABS.map(t => (
          <button
            key={t.key}
            className={`tab-btn ${subtab === t.key ? "tab-btn--active" : ""}`}
            onClick={() => setSubtab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subtab === "mi-semana" && eng && (
        <>
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
            </div>
          </div>
          <MyWeekTab engineer={eng} projects={projects} onOpenActivity={onOpenActivity} />
        </>
      )}

      {subtab === "equipo" && (
        <EngineersView
          engineers={engineers} projects={projects}
          onAdd={onAdd} onUpdate={onUpdate} onToggleActive={onToggleActive} onUpdateTasks={onUpdateTasks}
        />
      )}

      {subtab === "historial" && eng && (
        <EngineerReportBody engineer={eng} projects={projects} />
      )}
    </div>
  );
}
