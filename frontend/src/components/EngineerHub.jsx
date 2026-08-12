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
  engineerWeekTasks,
  engineerNextWeekTasks,
  buildEngineerWeekKpis,
  buildEngineerTotals,
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

// Variante de solo lectura de KpiChip — para el panorama agregado
// (buildEngineerTotals), que no filtra nada al hacer clic, a diferencia de
// la franja semanal de arriba. <div>, no <button>: un control sin acción
// confunde más de lo que ayuda.
function KpiStat({ tone, count, label }) {
  return (
    <div className={`eng-kpi-chip eng-kpi-chip--${tone}`}>
      <span className="eng-kpi-chip__count">{count}</span>
      <span className="eng-kpi-chip__label">{label}</span>
    </div>
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
  const totals = useMemo(
    () => buildEngineerTotals(engineer.id, projects, TODAY),
    [engineer.id, projects]
  );

  const todayIso = TODAY.toISOString().slice(0, 10);
  const visibleTodo = kpis.todo.filter(row => {
    if (filter === "overdue") return row.situation === "overdue";
    if (filter === "today") return row.activity.due_date === todayIso;
    return true;
  });

  return (
    <>
      <h3 className="report-section-title" style={{ marginBottom: 12 }}>
        Total en todos los proyectos
      </h3>
      <div className="eng-kpi-strip">
        <KpiStat tone="info"    count={totals.total}      label="Asignadas" />
        <KpiStat tone="ok"      count={totals.completed}  label="Completadas" />
        <KpiStat tone="warn"    count={totals.inProgress} label="En proceso" />
        <KpiStat tone="neutral" count={totals.notStarted} label="No iniciadas" />
        <KpiStat tone="danger"  count={totals.overdue}    label="Vencidas" />
      </div>

      <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>
        Esta semana
      </h3>
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
  lockedEngineerId, // sql_id del ingeniero al que un usuario no-admin queda
                    // restringido (migración 019) — oculta el selector y
                    // "Equipo" (esa sub-pestaña ESCRIBE datos de cualquier
                    // ingeniero, no solo el propio). null/undefined = sin
                    // restricción, comportamiento de admin de siempre.
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

  const isLocked = lockedEngineerId != null;
  const activeList = (engineers || []).filter(e => e.active !== false);
  // lockedEngineerId es el sql_id (columna Usuarios.IngenieroID, viene de
  // SQL) — distinto de e.id (el id local del catálogo que usa selectedId).
  const eng = isLocked
    ? (engineers || []).find(e => e.sql_id === lockedEngineerId) || null
    : (engineers || []).find(e => e.id === selectedId) || activeList[0] || null;

  const handleCopy = () => {
    if (!eng) return;
    navigator.clipboard.writeText(generateEngineerReportText(eng, projects))
      .then(() => { setToast(`✓ Reporte de "${eng.name}" copiado`); setTimeout(() => setToast(""), 2500); })
      .catch(() => { setToast("No se pudo copiar"); setTimeout(() => setToast(""), 2500); });
  };

  if (isLocked && !eng) {
    return (
      <p style={{ color: "var(--text-2)", marginTop: 16 }}>
        Tu usuario no está vinculado a ningún ingeniero activo del catálogo. Contacta a un administrador.
      </p>
    );
  }
  if (!isLocked && !activeList.length) {
    return <p style={{ color: "var(--text-2)", marginTop: 16 }}>Sin ingenieros activos. Agrega el primero en la pestaña "Equipo".</p>;
  }

  // "Equipo" ESCRIBE datos de CUALQUIER ingeniero (alta, edición, tareas de
  // otros) — un usuario bloqueado a su propio ingeniero no debe verla, ni
  // siquiera de solo lectura, para no exponer al resto del equipo.
  const visibleSubtabs = isLocked ? SUBTABS.filter(t => t.key !== "equipo") : SUBTABS;

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <h2 className="report-panel__title">Ingenieros</h2>
        {(subtab === "mi-semana" || subtab === "historial") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!isLocked && (
              <select
                className="field__input"
                style={{ minWidth: 220 }}
                value={eng?.id || ""}
                onChange={e => setSelectedId(e.target.value)}
              >
                {activeList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
            {subtab === "historial" && (
              <button className="btn btn--accent" onClick={handleCopy} disabled={!eng}>📋 Copiar reporte</button>
            )}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <div className="tab-btn-row" style={{ margin: "12px 0 20px" }}>
        {visibleSubtabs.map(t => (
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

      {subtab === "equipo" && !isLocked && (
        <EngineersView
          engineers={engineers} projects={projects}
          onAdd={onAdd} onUpdate={onUpdate} onToggleActive={onToggleActive} onUpdateTasks={onUpdateTasks}
          onOpenActivity={onOpenActivity}
        />
      )}

      {subtab === "historial" && eng && (
        <EngineerReportBody engineer={eng} projects={projects} onOpenActivity={onOpenActivity} />
      )}
    </div>
  );
}
