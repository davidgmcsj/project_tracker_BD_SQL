// filtroOpciones.js — Opciones fijas (valor SQL real + etiqueta legible) para
// campos "lista" del módulo de Reportes que no tienen una fuente en memoria
// (a diferencia de proyecto_id/ingeniero_id, que se arman desde projects/
// engineers ya cargados). Estos son enums cerrados que hoy solo existen
// hardcodeados en el backend, así que se duplican aquí a propósito — mismo
// patrón que frontend/src/utils/isoWeek.js frente a backend/utils.cjs. Si el
// enum cambia en el backend hay que actualizar esta lista junto con él:
//   - ESTADOS_PROYECTO      → project.status en toda la app (EstadoProyecto)
//   - ESTADOS_INGENIERO_REPORTE → backend/db-operations.cjs statusMap
//   - ESTADOS_ACTIVIDAD_OPERACIONAL → Actividades_Detalle.Estado (utils/engineers.js activityStatusIn)
//   - TIPOS_EVENTO_ACTIVIDAD    → backend/activity-events.cjs TIPOS
//   - ORIGENES_EVENTO          → backend/db-operations.cjs y backfill-events.cjs
//   - PRIORIDADES_PROYECTO     → backend/migrations/015_*.sql
//   - TIPOS_NOTA               → backend/reports/project-notes.cjs TIPOS_VALIDOS

export const ESTADOS_PROYECTO = [
  { value: "on-track",        label: "En curso" },
  { value: "at-risk",         label: "En riesgo" },
  { value: "blocked",         label: "Bloqueado" },
  { value: "completed",       label: "Completado" },
  { value: "mejora-continua", label: "Mejora Continua" },
];

export const ESTADOS_INGENIERO_REPORTE = [
  { value: "Completada",  label: "Completada" },
  { value: "En_Proceso",  label: "En proceso" },
  { value: "No_Iniciada", label: "No iniciada" },
];

export const TIPOS_EVENTO_ACTIVIDAD = [
  { value: "estado",       label: "Estado" },
  { value: "progreso",     label: "Progreso" },
  { value: "fecha_inicio", label: "Fecha inicio" },
  { value: "fecha_fin",    label: "Fecha fin" },
  { value: "horas",        label: "Horas" },
];

export const ORIGENES_EVENTO = [
  { value: "app",                   label: "App" },
  { value: "migracion-rawjson",     label: "Migración (raw JSON)" },
  { value: "migracion-history",     label: "Migración (history)" },
  { value: "migracion-historyjson", label: "Migración (history JSON)" },
];

export const PRIORIDADES_PROYECTO = [
  { value: "1", label: "Alta" },
  { value: "2", label: "Media" },
  { value: "3", label: "Baja" },
];

export const TIPOS_NOTA = [
  { value: "comentario", label: "Comentario", icon: "💬" },
  { value: "decision",   label: "Decisión",   icon: "🧭" },
  { value: "riesgo",     label: "Riesgo",      icon: "⚠️" },
  { value: "compromiso", label: "Compromiso", icon: "🤝" },
];

// Estado operacional vivo de una actividad (Actividades_Detalle.Estado) —
// distinto del vocabulario de ESTADOS_PROYECTO. Usado por la consulta
// "actividades_estado" para filtrar en proceso / no iniciadas / completadas.
//
// ambiente_pruebas/ambiente_produccion: depósitos intermedios entre
// "en proceso" y "completada" para actividades marcadas "es_desarrollo"
// (ver activityModel.js) — una actividad de desarrollo no puede completarse
// hasta pasar por ambos, con subtareas de control creadas automáticamente
// (ver transitionActivityStatus, components/edit/shared.js). Para
// actividades SIN esa marca, estos 2 valores nunca aparecen: ni se muestran
// en los selectores (ActivityDetailModal los oculta), ni son alcanzables
// (canTransitionTo, formulas/activityHierarchy.js, los bloquea).
//
// NOTA: EngineerTaskModal.jsx (tareas adicionales del ingeniero, sin
// jerarquía padre/hijo) usa su PROPIA lista de 3 estados en vez de esta —
// el flujo de ambiente no aplica ahí.
export const ESTADOS_ACTIVIDAD_OPERACIONAL = [
  { value: "not_started",         label: "No iniciada" },
  { value: "in_progress",         label: "En proceso" },
  { value: "ambiente_pruebas",    label: "Ambiente Pruebas" },
  { value: "ambiente_produccion", label: "Ambiente Producción" },
  { value: "completed",           label: "Completada" },
];

// ── Derivados de ESTADOS_ACTIVIDAD_OPERACIONAL ───────────────────────────────
// Este vocabulario estaba redefinido a mano en 10 componentes distintos, con
// dos versiones del mapa inverso (label → clave) escritas por separado. Se
// derivan todos de la lista de arriba para que exista UNA sola definición:
// cambiar una etiqueta ahí la cambia en toda la app, incluido el mapa inverso.

/** Clave → etiqueta. Ej: ESTADO_ACTIVIDAD_LABEL.in_progress === "En proceso" */
export const ESTADO_ACTIVIDAD_LABEL = Object.fromEntries(
  ESTADOS_ACTIVIDAD_OPERACIONAL.map(e => [e.value, e.label])
);

/**
 * Etiqueta → clave. Necesario porque algunas fuentes (RawDataJSON, tablas
 * jerárquicas) traen el estado ya traducido al español y hay que volver a la
 * clave interna para comparar y aplicar estilos.
 */
export const ESTADO_ACTIVIDAD_KEY = Object.fromEntries(
  ESTADOS_ACTIVIDAD_OPERACIONAL.map(e => [e.label, e.value])
);

/**
 * Devuelve la etiqueta en español de un estado de actividad. Acepta tanto la
 * clave interna ("in_progress") como una etiqueta ya traducida ("En proceso"),
 * porque los datos llegan en ambos formatos según la fuente.
 * Cae en "No iniciada" ante un valor desconocido o nulo — mismo criterio que
 * ya aplicaban StatusBadge y las tablas.
 */
export function estadoActividadLabel(estado) {
  if (!estado) return ESTADO_ACTIVIDAD_LABEL.not_started;
  return ESTADO_ACTIVIDAD_LABEL[estado]
    ?? (ESTADO_ACTIVIDAD_KEY[estado] ? estado : ESTADO_ACTIVIDAD_LABEL.not_started);
}

/** Normaliza a clave interna, venga como clave o como etiqueta en español. */
export function estadoActividadKey(estado) {
  if (!estado) return "not_started";
  if (ESTADO_ACTIVIDAD_LABEL[estado]) return estado;
  return ESTADO_ACTIVIDAD_KEY[estado] ?? "not_started";
}
