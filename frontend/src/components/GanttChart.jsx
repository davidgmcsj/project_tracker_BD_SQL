import { useMemo, useState } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────

const BAR_COLOR = "#003399"; // azul institucional, único color de barra

const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Escalas de zoom: ancho en px por día.
const ZOOM_LEVELS = [
  { label: "Mes",     pxPerDay: 4  },
  { label: "Semana",  pxPerDay: 14 },
  { label: "Día",     pxPerDay: 34 },
];

const ROW_H     = 34;   // alto de cada fila
const LABEL_W   = 220;  // ancho de la columna de nombres a la izquierda

// ── Helpers de fecha ──────────────────────────────────────────────────────────

const toDate = (str) => (str ? new Date(str + "T12:00:00") : null);

const dayDiff = (a, b) => Math.round((b - a) / 86400000);

const fmtDay = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

function statusOf(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function GanttChart({ activities, taskStatus, onOpenActivity }) {
  const [zoom, setZoom] = useState(1); // índice en ZOOM_LEVELS
  const [showCompleted, setShowCompleted] = useState(false);
  const pxPerDay = ZOOM_LEVELS[zoom].pxPerDay;

  // Numeración: posición (1-based) de cada actividad en la lista COMPLETA,
  // para que el número del Gantt coincida con el de la lista de actividades.
  const numberById = useMemo(() => {
    const map = new Map();
    (activities || []).forEach((a, i) => { if (a?.id) map.set(a.id, i + 1); });
    return map;
  }, [activities]);

  // Cuántas actividades con fecha están completadas (para el toggle).
  const completedCount = useMemo(
    () => (activities || []).filter(a => (a.start_date || a.due_date) && statusOf(taskStatus, a.id) === "completed").length,
    [activities, taskStatus]
  );

  // Actividades con al menos una fecha. Por defecto se OCULTAN las completadas;
  // el usuario puede mostrarlas con el toggle "Mostrar completadas".
  const dated = useMemo(
    () => (activities || []).filter(a =>
      (a.start_date || a.due_date) &&
      (showCompleted || statusOf(taskStatus, a.id) !== "completed")
    ),
    [activities, taskStatus, showCompleted]
  );

  // Rango temporal global
  const range = useMemo(() => {
    let min = null, max = null;
    dated.forEach(a => {
      const s = toDate(a.start_date) || toDate(a.due_date);
      const e = toDate(a.due_date)   || toDate(a.start_date);
      if (s && (!min || s < min)) min = s;
      if (e && (!max || e > max)) max = e;
    });
    if (!min || !max) return null;
    // Padding de 2 días a cada lado
    const start = new Date(min); start.setDate(start.getDate() - 2);
    const end   = new Date(max); end.setDate(end.getDate() + 2);
    return { start, end, days: dayDiff(start, end) + 1 };
  }, [dated]);

  if (!dated.length || !range) {
    // Caso especial: hay actividades con fecha, pero todas están completadas y ocultas.
    if (!showCompleted && completedCount > 0) {
      return (
        <div className="gantt-empty">
          Todas las actividades con fechas están completadas y se ocultan de la línea de tiempo.{" "}
          <button type="button" className="gantt-empty__link" onClick={() => setShowCompleted(true)}>
            Mostrar {completedCount} completada{completedCount !== 1 ? "s" : ""}
          </button>
        </div>
      );
    }
    return (
      <div className="gantt-empty">
        Ninguna actividad tiene fechas de inicio o fin. Asigna fechas en el detalle de cada
        actividad para verlas en la línea de tiempo.
      </div>
    );
  }

  const chartW = range.days * pxPerDay;

  // Marcas de fecha en el eje: cada N días según zoom
  const tickEvery = pxPerDay >= 30 ? 1 : pxPerDay >= 12 ? 7 : 14;
  const ticks = [];
  for (let i = 0; i <= range.days; i += tickEvery) {
    const d = new Date(range.start);
    d.setDate(d.getDate() + i);
    ticks.push({ left: i * pxPerDay, label: fmtDay(d), weekend: d.getDay() === 0 || d.getDay() === 6 });
  }

  // Línea de "hoy"
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const todayOffset = (today >= range.start && today <= range.end)
    ? dayDiff(range.start, today) * pxPerDay
    : null;

  return (
    <div className="gantt">
      {/* Controles */}
      <div className="gantt__toolbar">
        <span className="gantt__zoom-label">Zoom:</span>
        {ZOOM_LEVELS.map((z, i) => (
          <button
            key={z.label}
            type="button"
            className={`gantt__zoom-btn${i === zoom ? " gantt__zoom-btn--active" : ""}`}
            onClick={() => setZoom(i)}
          >
            {z.label}
          </button>
        ))}
        {completedCount > 0 && (
          <label className="gantt__toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={e => setShowCompleted(e.target.checked)}
            />
            Mostrar completadas ({completedCount})
          </label>
        )}
      </div>

      <div className="gantt__scroll">
        <div className="gantt__inner" style={{ width: LABEL_W + chartW }}>

          {/* Cabecera del eje temporal */}
          <div className="gantt__header" style={{ height: 28 }}>
            <div className="gantt__corner" style={{ width: LABEL_W }} />
            <div className="gantt__timeline" style={{ width: chartW }}>
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className={`gantt__tick${t.weekend ? " gantt__tick--weekend" : ""}`}
                  style={{ left: t.left }}
                >
                  <span className="gantt__tick-label">{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filas */}
          <div className="gantt__body" style={{ position: "relative" }}>
            {/* Línea de hoy */}
            {todayOffset !== null && (
              <div
                className="gantt__today"
                style={{ left: LABEL_W + todayOffset, height: dated.length * ROW_H }}
                title="Hoy"
              />
            )}

            {dated.map((a) => {
              const s = toDate(a.start_date) || toDate(a.due_date);
              const e = toDate(a.due_date)   || toDate(a.start_date);
              const offset = dayDiff(range.start, s) * pxPerDay;
              const span   = (dayDiff(s, e) + 1) * pxPerDay;
              const st      = statusOf(taskStatus, a.id);
              const prog    = Math.max(0, Math.min(100, Number(a.progress) || 0));

              return (
                <div
                  key={a.id}
                  className="gantt__row"
                  style={{ height: ROW_H }}
                  onClick={() => onOpenActivity?.(a.id)}
                >
                  <div className="gantt__row-label" style={{ width: LABEL_W }} title={`${numberById.get(a.id)}. ${a.text}`}>
                    <span className="gantt__row-num">{numberById.get(a.id)}.</span>
                    <span className="gantt__row-text">{a.text || "(sin nombre)"}</span>
                  </div>
                  <div className="gantt__row-track" style={{ width: chartW }}>
                    <div
                      className={`gantt__bar gantt__bar--${st}`}
                      style={{ left: offset, width: Math.max(span, 6), borderColor: BAR_COLOR }}
                      title={`${a.text}\n${a.start_date || "?"} → ${a.due_date || "?"} · ${prog}%`}
                    >
                      <div
                        className="gantt__bar-fill"
                        style={{ width: `${prog}%`, background: BAR_COLOR }}
                      />
                      {span > 40 && (
                        <span className="gantt__bar-pct">{prog}%</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="gantt__legend">
        <span className="gantt__legend-item"><span className="gantt__legend-today" /> Hoy</span>
        <span className="gantt__legend-item gantt__legend-item--hint">El relleno de la barra indica el % de cumplimiento. Clic en una barra para editar.</span>
      </div>
    </div>
  );
}
