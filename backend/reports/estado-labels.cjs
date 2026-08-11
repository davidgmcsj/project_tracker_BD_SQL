"use strict";

// ── Traducción de estado para exportaciones (Excel/PDF) ──────────────────────
// Los exportadores reciben las filas ya consultadas de SQL, con el estado tal
// cual se guarda ahí (en inglés/slug) — la vista previa en pantalla lo
// traduce vía ReportesTable.jsx (frontend/src/components/engineer/
// StatusBadge.jsx + filtroOpciones.js), pero /export nunca pasa por React,
// así que sin esto el Excel/PDF mostraba el valor crudo. Mismos dos
// vocabularios que ya existen en frontend/src/utils/filtroOpciones.js —
// duplicados a propósito (igual criterio que ese archivo respecto al
// backend): si un enum cambia en un lado hay que actualizar el otro.

// Actividades_Detalle.Estado / Estado_Actividades_Reporte — actividad.
// ambiente_pruebas/ambiente_produccion: flujo de despliegue de actividades
// de desarrollo (ver frontend/src/utils/filtroOpciones.js, misma pareja de
// vocabularios duplicados a propósito).
const ESTADO_ACTIVIDAD_LABEL = {
  not_started:          "No iniciada",
  in_progress:          "En proceso",
  ambiente_pruebas:     "Ambiente Pruebas",
  ambiente_produccion:  "Ambiente Producción",
  completed:            "Completada",
};

// ReportesSemanales.EstadoProyecto — proyecto.
const ESTADO_PROYECTO_LABEL = {
  "on-track":        "En curso",
  "at-risk":         "En riesgo",
  "blocked":         "Bloqueado",
  "completed":       "Completado",
  "mejora-continua": "Mejora Continua",
};

// Traduce un valor de la columna "estado" si coincide con alguno de los dos
// vocabularios conocidos; si no coincide con ninguno (o la columna no es
// "estado"), devuelve el valor tal cual — nunca inventa una traducción.
function translateEstado(columna, valor) {
  if (columna !== "estado" || valor == null) return valor;
  return ESTADO_ACTIVIDAD_LABEL[valor] ?? ESTADO_PROYECTO_LABEL[valor] ?? valor;
}

module.exports = { ESTADO_ACTIVIDAD_LABEL, ESTADO_PROYECTO_LABEL, translateEstado };
