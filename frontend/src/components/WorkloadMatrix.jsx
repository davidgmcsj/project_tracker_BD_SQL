// WorkloadMatrix.jsx — Matriz ingeniero × semana ISO con horas planeadas
// (Fase 12 — Planner A). Suma planned_hours de las actividades asignadas a
// cada ingeniero cuya fecha de fin cae en esa semana; resalta en rojo si
// supera 40h. Mismo motivo que GlobalBoardView para ser 100% del lado
// cliente: la asignación de ingeniero por actividad no vive en SQL.

import { useMemo } from "react";
import { visibleActivities } from "../utils/formulas";
import { isoWeek, isoWeekStart, isoWeekEnd, todayISO } from "../utils/isoWeek";

const SEMANAS_A_MOSTRAR = 6;
const LIMITE_SEMANAL_HORAS = 40;

function generarSemanas(desde) {
  const semanas = [];
  let cursor = isoWeekStart(desde);
  for (let i = 0; i < SEMANAS_A_MOSTRAR; i++) {
    semanas.push({ key: isoWeek(cursor), start: cursor, end: isoWeekEnd(cursor) });
    const next = new Date(cursor + "T12:00:00");
    next.setDate(next.getDate() + 7);
    cursor = next.toISOString().slice(0, 10);
  }
  return semanas;
}

const fmtCorto = (d) => {
  const [, m, day] = d.split("-");
  const MM = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${day} ${MM[Number(m) - 1]}`;
};

export function WorkloadMatrix({ projects, engineers }) {
  const semanas = useMemo(() => generarSemanas(todayISO()), []);

  // Map<engineerId, Map<semanaKey, horas>>
  const cargaPorIngeniero = useMemo(() => {
    const map = new Map();
    (engineers || []).filter(e => e.active !== false).forEach(e => map.set(e.id, new Map()));

    (projects || []).forEach(p => {
      visibleActivities(p.activities_identified).forEach(a => {
        if (!a.due_date) return;
        const semanaKey = isoWeek(a.due_date);
        if (!semanas.some(s => s.key === semanaKey)) return; // fuera del rango visible
        (a.assigned_engineers || []).forEach(eng => {
          if (!map.has(eng.id)) return; // ingeniero inactivo/borrado
          const porSemana = map.get(eng.id);
          porSemana.set(semanaKey, (porSemana.get(semanaKey) || 0) + (Number(a.planned_hours) || 0));
        });
      });
    });
    return map;
  }, [projects, engineers, semanas]);

  const ingenierosActivos = (engineers || []).filter(e => e.active !== false);

  return (
    <div className="workload-matrix-wrap">
      <table className="workload-matrix">
        <thead>
          <tr>
            <th className="workload-matrix__eng-col">Ingeniero</th>
            {semanas.map(s => (
              <th key={s.key} title={`${s.start} – ${s.end}`}>
                {s.key}<br /><span className="workload-matrix__week-range">{fmtCorto(s.start)}–{fmtCorto(s.end)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ingenierosActivos.length === 0 && (
            <tr><td colSpan={semanas.length + 1} className="reportes-table__empty">Sin ingenieros activos.</td></tr>
          )}
          {ingenierosActivos.map(e => {
            const porSemana = cargaPorIngeniero.get(e.id) || new Map();
            return (
              <tr key={e.id}>
                <td className="workload-matrix__eng-col">{e.name}</td>
                {semanas.map(s => {
                  const horas = porSemana.get(s.key) || 0;
                  const sobrecarga = horas > LIMITE_SEMANAL_HORAS;
                  return (
                    <td key={s.key} className={sobrecarga ? "workload-matrix__cell--over" : ""}>
                      {horas > 0 ? `${horas}h` : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="workload-matrix__legend">
        <span className="workload-matrix__legend-swatch" /> más de {LIMITE_SEMANAL_HORAS}h planeadas esa semana
      </p>
    </div>
  );
}
