// GlobalBoardView.jsx — Tablero Kanban cruzando TODOS los proyectos
// (Fase 12 — Planner A). El Kanban que ya existe en EditView es por
// proyecto individual; este agrupa las actividades de todos los proyectos
// a la vez, por ingeniero / proyecto / estado / vencimiento.
//
// Solo lectura a propósito: cambiar estado o responsable se sigue haciendo
// desde el editor del proyecto — este tablero es para tener panorama, no
// para editar. Datos 100% del lado cliente (projects/engineers que ya
// tiene App.jsx): la asignación de ingeniero por actividad no vive en SQL
// todavía (ver nota en activity-events.cjs), así que no hay forma de
// construir esto como una consulta del motor de reportes.

import { useState, useMemo } from "react";
import { visibleActivities, getActivityStatus, getToday } from "../utils/formulas";

const AGRUPACIONES = [
  { value: "estado",      label: "Estado" },
  { value: "ingeniero",   label: "Ingeniero" },
  { value: "proyecto",    label: "Proyecto" },
  { value: "vencimiento", label: "Vencimiento" },
];

const ESTADO_COLS = [
  { key: "not_started", label: "No iniciada" },
  { key: "in_progress", label: "En proceso" },
  { key: "completed",   label: "Completada" },
];

function diasHasta(fecha, hoy) {
  if (!fecha) return null;
  const a = new Date(fecha + "T12:00:00");
  const b = new Date(hoy + "T12:00:00");
  return Math.round((a - b) / 86400000);
}

function venceCol(dueDate, hoy) {
  if (!dueDate) return "sin_fecha";
  const dias = diasHasta(dueDate, hoy);
  if (dias < 0) return "vencidas";
  if (dias <= 7) return "proximos_7d";
  return "futuras";
}

const VENCIMIENTO_COLS = [
  { key: "vencidas",     label: "⚠ Vencidas" },
  { key: "proximos_7d",  label: "Próximos 7 días" },
  { key: "futuras",      label: "Futuras" },
  { key: "sin_fecha",    label: "Sin fecha" },
];

// Reúne todas las actividades visibles de todos los proyectos en una sola
// lista plana, con el nombre del proyecto y el estado ya resueltos.
// isRoot: true si la actividad no es subtarea de ninguna otra (parent_id
// nulo/ausente) — alimenta el doble depósito del agrupador "Estado".
function flattenActivities(projects) {
  const out = [];
  (projects || []).forEach(p => {
    visibleActivities(p.activities_identified).forEach(a => {
      out.push({
        id: `${p.id}:${a.id}`,
        text: a.text || "",
        projectName: p.project_name || "Proyecto",
        projectId: p.id,
        dueDate: a.due_date || "",
        assigned: a.assigned_engineers || [],
        status: getActivityStatus(p.task_status, a.id),
        isRoot: !a.parent_id,
      });
    });
  });
  return out;
}

const STATUS_LABEL_TO_KEY = { "Completada": "completed", "En proceso": "in_progress", "No iniciada": "not_started" };

// Agrupa una lista de actividades ya filtrada en las columnas dadas y renderiza
// el tablero. Extraído para reutilizarse dos veces cuando agrupar === "estado"
// (depósito de tareas principales + depósito de todas las actividades).
function BoardColumns({ columnas, actividades, agrupar, hoy }) {
  const actividadesPorColumna = useMemo(() => {
    const map = new Map(columnas.map(c => [c.key, []]));
    actividades.forEach(act => {
      let keys = [];
      if (agrupar === "estado") keys = [STATUS_LABEL_TO_KEY[act.status] || "not_started"];
      else if (agrupar === "vencimiento") keys = [venceCol(act.dueDate, hoy)];
      else if (agrupar === "proyecto") keys = [act.projectId];
      else keys = act.assigned.length ? act.assigned.map(e => e.id) : ["__sin_asignar"];

      keys.forEach(k => { if (map.has(k)) map.get(k).push(act); });
    });
    return map;
  }, [actividades, columnas, agrupar, hoy]);

  return (
    <div className="global-board__columns">
      {columnas.map(col => {
        const items = actividadesPorColumna.get(col.key) || [];
        return (
          <div key={col.key} className="global-board__column">
            <div className="global-board__column-head">
              <span>{col.label}</span>
              <span className="global-board__column-count">{items.length}</span>
            </div>
            <div className="global-board__column-body">
              {items.length === 0 && <p className="notes-panel__empty">Sin actividades.</p>}
              {items.map(act => (
                <div key={act.id} className="global-board__card">
                  <div className="global-board__card-project">{act.projectName}</div>
                  <div className="global-board__card-text">{act.text}</div>
                  {act.dueDate && <div className="global-board__card-due">📅 {act.dueDate}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GlobalBoardView({ projects, engineers }) {
  const [agrupar, setAgrupar] = useState("estado");
  const hoy = getToday();

  const actividades = useMemo(() => flattenActivities(projects), [projects]);
  const actividadesRaiz = useMemo(() => actividades.filter(a => a.isRoot), [actividades]);

  const columnas = useMemo(() => {
    if (agrupar === "estado") return ESTADO_COLS;
    if (agrupar === "vencimiento") return VENCIMIENTO_COLS;
    if (agrupar === "proyecto") {
      return (projects || []).map(p => ({ key: p.id, label: p.project_name || "Proyecto" }));
    }
    // ingeniero
    const cols = (engineers || []).filter(e => e.active !== false).map(e => ({ key: e.id, label: e.name }));
    cols.push({ key: "__sin_asignar", label: "Sin asignar" });
    return cols;
  }, [agrupar, projects, engineers]);

  return (
    <div className="global-board">
      <div className="report-filters">
        <span className="reportes-saved__label">Agrupar por:</span>
        {AGRUPACIONES.map(a => (
          <button
            key={a.value} type="button"
            className={`reportes-col-chip ${agrupar === a.value ? "reportes-col-chip--on" : ""}`}
            onClick={() => setAgrupar(a.value)}
          >
            {a.label}
          </button>
        ))}
        <span className="report-filters__count">{actividades.length} actividades en total</span>
      </div>

      {agrupar === "estado" ? (
        <>
          <h3 className="global-board__deposito-title">
            Depósito 1 — Tareas principales ({actividadesRaiz.length})
          </h3>
          <BoardColumns columnas={columnas} actividades={actividadesRaiz} agrupar={agrupar} hoy={hoy} />

          <h3 className="global-board__deposito-title">
            Depósito 2 — Todas las actividades ({actividades.length})
          </h3>
          <BoardColumns columnas={columnas} actividades={actividades} agrupar={agrupar} hoy={hoy} />
        </>
      ) : (
        <BoardColumns columnas={columnas} actividades={actividades} agrupar={agrupar} hoy={hoy} />
      )}
    </div>
  );
}
