// DatesCell.jsx — tres columnas de fecha de transición (Inscrita/En proceso/
// Completada), leídas de task_status.status_history. Reutilizado por todas
// las tablas de actividades del ingeniero.

import { formatDateDMY } from "../../utils/formulas";

export default function DatesCell({ history }) {
  const h = history || {};
  return (
    <>
      <td style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-2)" }}>{formatDateDMY(h.added)}</td>
      <td style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-2)" }}>{formatDateDMY(h.in_progress)}</td>
      <td style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-2)" }}>{formatDateDMY(h.completed)}</td>
    </>
  );
}
