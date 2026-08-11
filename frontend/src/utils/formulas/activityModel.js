// activityModel.js — Estructura por defecto de un proyecto y de una
// actividad (modelo basado en IDs estables), y el filtro de archivadas.

import { getToday } from "./dateHelpers.js";

// ESTRUCTURA DE UN PROYECTO: aquí se definen todos los campos con sus valores por defecto.
// Si necesitas agregar un campo nuevo a todos los proyectos, agrégalo aquí.
// Los proyectos existentes NO tendrán el campo hasta que se editen y guarden.
export function createDefaultProject() {
  return {
    id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    project_name: "",
    status:       "on-track",
    priority:     false,   // proyecto prioritario (marca de estrella ⭐) para filtrar en Reporte
    version:      1,       // control de versión optimista — se incrementa en cada guardado identificado
    planner_url:  "",
    report_date:  getToday(),
    manual_metrics: {
      total_tasks:           0,
      completed_tasks:       0,
      in_progress_tasks:     0,
      shared_tasks_discount: 0,
    },
    activities_identified: [],
    weekly_achievements:   [],
    next_week_plan:        [],
    show_closing_fields:   false,
    task_status: { completed: [], in_progress: [], not_started: [], ambiente_pruebas: [], ambiente_produccion: [] },
    milestones:  [],
    comments:    [],
    engineers:   [],
    indicators:  [],
    impediments: [],
  };
}

// ── Actividades (modelo basado en IDs estables) ───────────────────────────────
// Cada actividad es { id, text }. El id se genera una sola vez y nunca cambia,
// así que borrar o reordenar actividades no afecta a las demás (comentarios,
// fechas clave, estado, logros, etc. referencian el id, no la posición ni el texto).

export function genActivityId() {
  return "act_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createActivity(text = "", parentId = null, sequenceOrder = 0) {
  return {
    id: genActivityId(),
    parent_id: parentId,           // id de otra actividad, o null = nivel raíz (jerarquía de subtareas)
    sequence_order: sequenceOrder, // orden entre hermanas del mismo padre — usado por el motor de cascada
    text,
    assigned_engineers: [],
    assigned_date: null,
    start_date: "",
    due_date: "",
    description: "",
    objectives: "",
    solution: "",
    progress: 0,          // % de cumplimiento manual (0-100)
    planned_hours: 0,     // horas planeadas (manual)
    checklist: [],
    notes: [],
    key_dates: [],
    attachments: [],      // metadata de adjuntos (bytes en SQL)
    planner_task_number: null, // "Número de tarea" de Planner (clave estable de sync). null = creada a mano.
    archived: false,      // true si desapareció de Planner en una importación (oculta, recuperable)
    archived_reason: "",  // motivo del archivado (p. ej. fecha de la importación que la retiró)
    es_desarrollo: false,   // true = habilita los estados "Ambiente Pruebas"/"Ambiente Producción" en el Kanban
    deployment_role: null,  // "test_deploy" | "prod_deploy" | null — vínculo estable de una subtarea
                             // AUTO-CREADA con su rol en la cadena de despliegue (ver transitionActivityStatus,
                             // edit/shared.js). Nunca se detecta por el texto de la actividad (editable por el
                             // usuario, poco confiable) — es metadata opaca que el sistema setea al crearla.
  };
}

// ── Actividades archivadas ────────────────────────────────────────────────────
// Una actividad archivada (archived: true) desapareció del Planner en una
// importación pero NO se borra: se oculta de listas, métricas y reportes, y
// queda recuperable en activities_identified. isArchived tolera actividades
// antiguas que aún no tienen el campo (undefined → false).

export const isArchived = (a) => !!a && a.archived === true;

// Tolerante a actividades antiguas sin el campo (undefined → false), mismo
// criterio que isArchived.
export const isDesarrollo = (a) => !!a && a.es_desarrollo === true;

export function visibleActivities(acts) {
  return (Array.isArray(acts) ? acts : []).filter(a => !isArchived(a));
}

export const createDefaultMilestone  = () => ({ activity: "", date: "", note: "" });
export const createDefaultComment    = () => ({ activity: "", date: "", text: "" });

export function genChecklistItemId() {
  return "chk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export const createChecklistItem = (text = "") => ({ id: genChecklistItemId(), text, done: false });

export function genKeyDateId() {
  return "kd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export const createKeyDate = (date = "", label = "") => ({ id: genKeyDateId(), date, label });
export const createDefaultEngineer   = () => ({
  engineer_id:   "",
  assigned:      0,
  completed:     0,
  in_progress:   0,
  weekly_total:  0,
  weekly_detail: [],
});
export const createDefaultIndicator  = () => ({ name: "", total: 0, completed: 0, in_progress: 0 });
export const createDefaultImpediment = (category = "blocker") => ({ category, description: "", impact: "" });
