// AdditionalTasksTable.jsx — tabla de "Tareas adicionales" (Tarea, Estado,
// Avance, Inscrita, En proceso, Completada). Antes existían dos versiones:
// EngineersView (editable: clic para editar + botón eliminar) y
// EngineerReportView (solo lectura) — unificadas con la prop `mode`.
//
// El alta/edición/borrado real (modal, estado de "agregando") se queda en el
// caller — esta tabla es solo presentación de las filas.

import StatusBadge from "./StatusBadge";
import DatesCell from "./DatesCell";

function taskHistory(t) {
  return { added: t.date || "", in_progress: "", completed: "", ...(t.history || {}) };
}

export default function AdditionalTasksTable({ tasks, mode = "read", onEdit, onRemove }) {
  const list = tasks || [];
  const editable = mode === "edit";

  return (
    <div className="metrics-container" style={{ overflowX: "auto" }}>
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr>
            <th>Tarea</th>
            <th style={{ width: "120px" }}>Estado</th>
            <th style={{ width: "80px", textAlign: "center" }}>Avance</th>
            <th style={{ width: "110px" }}>Inscrita</th>
            <th style={{ width: "110px" }}>En proceso</th>
            <th style={{ width: "110px" }}>Completada</th>
            {editable && <th style={{ width: "40px" }}></th>}
          </tr>
        </thead>
        <tbody>
          {list.map(t => {
            const h = taskHistory(t);
            return (
              <tr
                key={t.id}
                onClick={editable ? () => onEdit(t.id) : undefined}
                style={editable ? { cursor: "pointer" } : undefined}
                title={editable ? "Clic para editar el detalle de la tarea" : undefined}
              >
                <td>{t.description}</td>
                <td><StatusBadge status={t.status} /></td>
                <td style={{ textAlign: "center" }}>{Number(t.progress) ? `${t.progress}%` : "—"}</td>
                <DatesCell history={h} />
                {editable && (
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button" className="act-list__remove"
                      onClick={e => { e.stopPropagation(); onRemove(t.id); }}
                      title="Eliminar"
                    >✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
