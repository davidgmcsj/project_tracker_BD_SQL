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
  buildEngineerTotals,
  generateEngineerReportText,
  getProjectsForEngineer,
  applyManualOrder,
  buildEngineerProjectQueue,
  filterEngineerProjectQueue,
  buildEngineerQueueMarkdown,
} from "../utils/engineers";
import ProjectQueueCard from "./engineer/ProjectQueueCard";
import ProjectQueueOverlay from "./engineer/ProjectQueueOverlay";
import LooseTasksSection from "./engineer/LooseTasksSection";
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

// Panorama agregado de solo lectura (buildEngineerTotals) — <div>, no
// <button>: un control sin acción confunde más de lo que ayuda.
function KpiStat({ tone, count, label }) {
  return (
    <div className={`eng-kpi-chip eng-kpi-chip--${tone}`}>
      <span className="eng-kpi-chip__count">{count}</span>
      <span className="eng-kpi-chip__label">{label}</span>
    </div>
  );
}

// Reordena las filas de UNA sección de una cola (buildEngineerProjectQueue)
// según el orden manual que el ingeniero fijó para las HOJAS (leafOrder, ver
// applyManualOrder) — los ancestros de contexto no tienen orden propio, así
// que cada uno se re-emite junto con la primera hoja que lo traía consigo en
// la cola original (buildEngineerProjectQueue ya los intercala justo antes
// de esa hoja), sin importar en qué posición quede esa hoja tras reordenar.
function reorderQueueSection(rows, leafOrder) {
  if (!Array.isArray(leafOrder) || !leafOrder.length) return rows;

  // Agrupa cada hoja con los ancestros que la preceden inmediatamente en la
  // cola original (un solo recorrido: cualquier ancestro "suelto" se adjunta
  // a la próxima hoja que aparezca).
  const groupByLeafId = new Map();
  let pendingAncestors = [];
  rows.forEach(row => {
    if (!row.isLeaf) { pendingAncestors.push(row); return; }
    groupByLeafId.set(row.activity.id, [...pendingAncestors, row]);
    pendingAncestors = [];
  });

  const orderedLeaves = applyManualOrder(
    rows.filter(r => r.isLeaf).map(r => ({ activity: r.activity })),
    leafOrder
  );
  return orderedLeaves.flatMap(({ activity }) => groupByLeafId.get(activity.id) || []);
}

// Sub-pestaña "Mi semana": KPIs agregados + una tarjeta por proyecto
// (ProjectQueueCard). Cada tarjeta abre su propia tabla jerárquica
// (ProjectQueueOverlay → EngineerProjectTable) con Esta semana/Próxima
// semana/Más adelante — reemplaza la lista plana cross-proyecto anterior.
function MyWeekTab({ engineer, projects, onOpenActivity, onToggleUrgent, onReorderQueue, onUpdateTasks, onOpenProjectHierarchy }) {
  const [queueProject, setQueueProject] = useState(null); // proyecto abierto en ProjectQueueOverlay, o null
  const [activeFilter, setActiveFilter] = useState(null); // "overdue" | "dueToday" | null — con qué se abrió el overlay

  const totals = useMemo(
    () => buildEngineerTotals(engineer.id, projects, TODAY),
    [engineer.id, projects]
  );

  const myProjects = useMemo(
    () => getProjectsForEngineer(engineer.id, projects),
    [engineer.id, projects]
  );

  // Una cola jerárquica por proyecto (buildEngineerProjectQueue), con el
  // orden manual del ingeniero ya aplicado por sección — reemplaza el orden
  // global "orden_ahora"/"orden_proxima" cross-proyecto por uno acotado a
  // cada proyecto+sección (engineer.orden_<sección>_<projectId>), porque el
  // reordenar a mano ahora vive DENTRO de la tabla de un proyecto, no en una
  // lista que cruza todos (confirmado con el usuario).
  const projectQueues = useMemo(() => myProjects.map(project => {
    const raw = buildEngineerProjectQueue(engineer.id, project, TODAY);
    const ordered = {};
    Object.entries(raw).forEach(([section, rows]) => {
      ordered[section] = reorderQueueSection(rows, engineer[`orden_${section}_${project.id}`]);
    });
    return { project, queue: ordered };
  }), [myProjects, engineer]);

  const todayIso = TODAY.toISOString().slice(0, 10);

  const countInQueue = (queue, pred) =>
    Object.values(queue).reduce((sum, rows) => sum + rows.filter(r => r.isLeaf && pred(r)).length, 0);

  const handleReorderSection = (project, section, leafIds) => {
    onReorderQueue?.(engineer.id, `orden_${section}_${project.id}`, leafIds);
  };

  // Nombre de archivo seguro: sin tildes/ñ (normalize NFD + descarta marcas
  // combinantes ̀-ͯ) ni caracteres que Windows/macOS rechacen en
  // un nombre de archivo.
  const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const downloadMarkdown = (md, filenameSlug) => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameSlug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Sin project: exporta TODOS los proyectos del ingeniero ("Exportar todas
  // las tareas"). Con project: solo ese proyecto ("Descargar tareas" de la
  // tarjeta) — misma estructura jerárquica + 3 secciones en ambos casos.
  const handleExportMarkdown = (project) => {
    const scoped = project ? projectQueues.filter(pq => pq.project.id === project.id) : projectQueues;
    const md = buildEngineerQueueMarkdown(engineer.name, scoped);
    downloadMarkdown(md, `mis-tareas-${slug(engineer.name)}${project ? `-${slug(project.project_name)}` : ""}`);
  };

  const openQueueFor = (project, filterKey) => {
    setQueueProject(project);
    setActiveFilter(filterKey || null);
  };

  const openPq = projectQueues.find(pq => pq.project.id === queueProject?.id);
  const displayedQueue = openPq ? filterEngineerProjectQueue(openPq.queue, activeFilter, todayIso) : null;

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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "20px 0 12px" }}>
        <h3 className="report-section-title" style={{ margin: 0 }}>Mis proyectos</h3>
        {projectQueues.length > 0 && (
          <button type="button" className="btn" onClick={() => handleExportMarkdown()}>⬇ Exportar todas las tareas</button>
        )}
      </div>

      {projectQueues.length === 0 && (
        <p style={{ color: "var(--text-2)" }}>Sin proyectos asignados todavía.</p>
      )}

      <div className="eng-pcard-grid">
        {projectQueues.map(({ project, queue }) => (
          <ProjectQueueCard
            key={project.id}
            project={project}
            overdueCount={countInQueue(queue, r => r.situation === "overdue")}
            dueTodayCount={countInQueue(queue, r => r.activity.due_date === todayIso)}
            onOpenPlanning={() => onOpenProjectHierarchy?.(project.id)}
            onViewQueue={(filterKey) => openQueueFor(project, filterKey)}
            onDownload={() => handleExportMarkdown(project)}
          />
        ))}
      </div>

      <LooseTasksSection
        tasks={engineer.tasks}
        onChange={tasks => onUpdateTasks?.(engineer.id, tasks)}
        engineerName={engineer.name}
      />

      <ProjectQueueOverlay
        open={!!queueProject}
        onClose={() => { setQueueProject(null); setActiveFilter(null); }}
        project={queueProject}
        queue={displayedQueue || {}}
        filterKey={activeFilter}
        onOpenActivity={onOpenActivity}
        onToggleUrgent={onToggleUrgent}
        onReorderSection={activeFilter === null ? (section, ids) => handleReorderSection(queueProject, section, ids) : undefined}
        onExportMarkdown={handleExportMarkdown}
      />
    </>
  );
}

export default function EngineerHub({
  engineers, projects,
  onAdd, onUpdate, onToggleActive, onRemove, onUpdateTasks,
  onToggleUrgent,  // (projectId, activityId) => void — alterna es_urgente, ver App.jsx
  onReorderQueue,  // (engineerId, "orden_<sección>_<projectId>", ids[]) => void
  onOpenActivity,  // (projectId, activityId) => void — abre la tarjeta de detalle
  onOpenProjectHierarchy, // (projectId) => void — abre Planificación completa del proyecto
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
          <MyWeekTab
            engineer={eng} projects={projects}
            onOpenActivity={onOpenActivity}
            onToggleUrgent={onToggleUrgent}
            onReorderQueue={onReorderQueue}
            onUpdateTasks={onUpdateTasks}
            onOpenProjectHierarchy={onOpenProjectHierarchy}
          />
        </>
      )}

      {subtab === "equipo" && !isLocked && (
        <EngineersView
          engineers={engineers} projects={projects}
          onAdd={onAdd} onUpdate={onUpdate} onToggleActive={onToggleActive} onRemove={onRemove} onUpdateTasks={onUpdateTasks}
          onOpenActivity={onOpenActivity}
        />
      )}

      {subtab === "historial" && eng && (
        <EngineerReportBody engineer={eng} projects={projects} onOpenActivity={onOpenActivity} />
      )}
    </div>
  );
}
