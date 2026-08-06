// DatesCell.jsx — tres columnas de fecha de transición (Inscrita/En proceso/
// Completada), leídas de task_status.status_history. Reutilizado por todas
// las tablas de actividades del ingeniero.

export default function DatesCell({ history }) {
  const h = history || {};
  return (
    <>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.added || "—"}</td>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.in_progress || "—"}</td>
      <td style={{ fontSize: "11px", color: "var(--text-2)" }}>{h.completed || "—"}</td>
    </>
  );
}
