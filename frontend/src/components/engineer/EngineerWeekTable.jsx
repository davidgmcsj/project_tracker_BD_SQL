// EngineerWeekTable.jsx — cola de tarjetas "Qué hacer ahora" / "Próxima
// semana": actividad (con número jerárquico + tarea padre) + proyecto de
// origen + fechas + situación, cruzando TODOS los proyectos del ingeniero
// (motor: utils/weekPlanning.js vía utils/engineers.js).
//
// onToggleUrgent y onReorder son opcionales a propósito — "Próxima semana"
// recibe onReorder (si el ingeniero quiere planear el orden con antelación)
// pero no onToggleUrgent (marcar "urgente" es sobre el trabajo de AHORA).

import { useState } from "react";
import EngineerTaskCard from "./EngineerTaskCard";

export default function EngineerWeekTable({ rows, onOpenActivity, onToggleUrgent, onReorder }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  if (rows.length === 0) {
    return <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin actividades en este rango.</p>;
  }

  const canDrag = !!onReorder;

  // Arrastrar → soltar mueve draggedId a la posición de targetId dentro de
  // ESTA lista visible y persiste el orden completo resultante (mismo patrón
  // de interacción que HierarchyTable, ver componente hermano). onReorder
  // recibe el array de ids en su nuevo orden — quien llama decide dónde se
  // guarda (ver EngineerHub: orden_ahora / orden_proxima del ingeniero).
  const handleDrop = (targetId) => {
    if (draggedId && draggedId !== targetId) {
      const ids = rows.map(r => r.activity.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const next = [...ids];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        onReorder(next);
      }
    }
    setDraggedId(null);
    setDropTargetId(null);
  };

  return (
    <div className="eng-task-queue">
      {rows.map(row => (
        <EngineerTaskCard
          key={`${row.projectId}-${row.activity.id}`}
          row={row}
          onOpenActivity={onOpenActivity}
          onToggleUrgent={onToggleUrgent}
          canDrag={canDrag}
          isDragging={draggedId === row.activity.id}
          isDropTarget={canDrag && dropTargetId === row.activity.id && draggedId !== row.activity.id}
          onDragStart={() => setDraggedId(row.activity.id)}
          onDragOverCard={() => setDropTargetId(row.activity.id)}
          onDragLeaveCard={() => setDropTargetId(prev => (prev === row.activity.id ? null : prev))}
          onDropCard={() => handleDrop(row.activity.id)}
          onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
        />
      ))}
    </div>
  );
}
