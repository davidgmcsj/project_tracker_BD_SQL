// filtroOpciones.js — Opciones fijas (valor SQL real + etiqueta legible) para
// campos "lista" del módulo de Reportes que no tienen una fuente en memoria
// (a diferencia de proyecto_id/ingeniero_id, que se arman desde projects/
// engineers ya cargados). Estos son enums cerrados que hoy solo existen
// hardcodeados en el backend, así que se duplican aquí a propósito — mismo
// patrón que frontend/src/utils/isoWeek.js frente a backend/utils.cjs. Si el
// enum cambia en el backend hay que actualizar esta lista junto con él:
//   - ESTADOS_PROYECTO      → project.status en toda la app (EstadoProyecto)
//   - ESTADOS_INGENIERO_REPORTE → backend/db-operations.cjs statusMap
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
