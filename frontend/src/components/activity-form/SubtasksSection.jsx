// SubtasksSection.jsx — Subtareas reales (jerarquía). Distinta de
// "Subactividades" (ChecklistSection): esto son actividades hijas reales
// (parent_id) con su propia tarjeta completa, fechas y estado, visibles
// también en HierarchyTable/Gantt — no un checklist de texto plano.

import { ESTADO_ACTIVIDAD_LABEL } from "../../utils/filtroOpciones";

const SUBTASK_STATUS_CLASS = { not_started: "adm-subtask-status--not-started", in_progress: "adm-subtask-status--in-progress", completed: "adm-subtask-status--completed" };

function subtaskStatusOf(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

export default function SubtasksSection({ subtasks, taskStatus, onCreate, onOpen, onRemove }) {
  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">
          Subtareas
          {subtasks.length > 0 && <span className="adm-checklist-progress">{subtasks.length}</span>}
        </span>
        <button type="button" className="adm-add-btn" onClick={onCreate}>
          + Crear subtarea
        </button>
      </div>

      {subtasks.length > 0 ? (
        <ul className="adm-subtask-list">
          {subtasks.map((s, i) => {
            const st = subtaskStatusOf(taskStatus, s.id);
            return (
              <li key={s.id} className="adm-subtask-item">
                <span className="adm-subtask-item__num">{i + 1}.</span>
                <button type="button" className="adm-subtask-item__name" onClick={() => onOpen(s.id)} title="Abrir tarjeta completa">
                  {s.text || "(sin nombre)"}
                </button>
                <span className={`adm-subtask-status ${SUBTASK_STATUS_CLASS[st]}`}>{ESTADO_ACTIVIDAD_LABEL[st]}</span>
                {(s.start_date || s.due_date) && (
                  <span className="adm-subtask-item__dates">{s.start_date || "—"} → {s.due_date || "—"}</span>
                )}
                <button type="button" className="adm-subtask-item__remove" onClick={() => onRemove(s.id)} title="Eliminar subtarea">✕</button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="adm-empty-hint">Sin subtareas. Crea una para dividir esta actividad en tareas propias con su fecha y responsable.</p>
      )}
    </div>
  );
}
