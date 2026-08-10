// ReportesTable.jsx — Tabla de vista previa del módulo de reportes.
//
// Implementación propia (no TanStack Table): ordenar y ocultar columnas son
// ~150 líneas sobre useState/useMemo, cero dependencias nuevas. Punto de
// reevaluación fijado más adelante (edición en línea) — migrar una tabla de
// este tamaño es barato, arrastrar una dependencia infrautilizada no.
//
// El orden es solo del lado cliente, sobre las filas ya traídas del servidor
// (el servidor ya aplicó su propio ORDER BY por defecto). Para el volumen de
// una vista previa (cientos de filas, no decenas de miles) es suficiente.

import { useState, useMemo } from "react";
import StatusBadge from "./engineer/StatusBadge";
import { ESTADOS_PROYECTO } from "../utils/filtroOpciones";

function humanize(key) {
  return key.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

// Las consultas "actividades", "ingenieros" y "vencidas" traen el estado tal
// cual lo guarda Actividades_Detalle/Estado_Actividades_Reporte en SQL
// (not_started/in_progress/completed) — sin traducir se veía en inglés y sin
// color. Reutiliza el mismo StatusBadge que ya traduce/colorea en Ingenieros.
const STATUS_COLUMNS = new Set(["estado"]);
const KNOWN_STATUSES = new Set(["not_started", "in_progress", "completed"]);

// La consulta "proyectos" usa OTRO vocabulario de estado (on-track/at-risk/
// blocked/completed/mejora-continua, EstadoProyecto en SQL) — distinto del de
// actividad, así que no encaja en StatusBadge (sus colores son para
// completada/en proceso/no iniciada). Se traduce a texto con el mismo enum
// que ya usa el filtro (filtroOpciones.js), en vez de dejarlo en crudo.
const ESTADO_PROYECTO_LABEL = Object.fromEntries(ESTADOS_PROYECTO.map(e => [e.value, e.label]));

function formatCell(col, value) {
  if (value == null) return "—";
  if (STATUS_COLUMNS.has(col) && KNOWN_STATUSES.has(value)) return <StatusBadge status={value} />;
  if (STATUS_COLUMNS.has(col) && ESTADO_PROYECTO_LABEL[value]) return ESTADO_PROYECTO_LABEL[value];
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

export function ReportesTable({ columnasDisponibles, columnasVisibles, onToggleColumna, filas, total, loading }) {
  const [sort, setSort] = useState(null); // { key, dir: 'asc'|'desc' }

  const filasOrdenadas = useMemo(() => {
    if (!sort) return filas;
    const { key, dir } = sort;
    const copia = [...filas];
    copia.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return copia;
  }, [filas, sort]);

  const handleSort = (key) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  return (
    <div className="reportes-table-wrap">
      <div className="reportes-table__toolbar">
        <div className="reportes-table__columns">
          <span className="reportes-table__columns-label">Columnas:</span>
          {columnasDisponibles.map(col => (
            <button
              type="button" key={col}
              className={`reportes-col-chip ${columnasVisibles.includes(col) ? "reportes-col-chip--on" : ""}`}
              onClick={() => onToggleColumna(col)}
            >
              {humanize(col)}
            </button>
          ))}
        </div>
        <span className="report-filters__count">
          {loading ? "Cargando…" : `Mostrando ${filas.length} de ${total} registro${total !== 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="reportes-table__scroll">
        <table className="reportes-table">
          <thead>
            <tr>
              {columnasVisibles.map(col => (
                <th key={col} onClick={() => handleSort(col)} className="reportes-table__th">
                  {humanize(col)}
                  {sort?.key === col && <span className="reportes-table__sort-icon">{sort.dir === "asc" ? " ▲" : " ▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.length === 0 ? (
              <tr><td className="reportes-table__empty" colSpan={columnasVisibles.length || 1}>
                {loading ? "Cargando…" : "Sin resultados para estos filtros."}
              </td></tr>
            ) : (
              filasOrdenadas.map((fila, i) => (
                <tr key={i}>
                  {columnasVisibles.map(col => <td key={col}>{formatCell(col, fila[col])}</td>)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
