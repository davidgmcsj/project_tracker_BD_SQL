// LooseTasksSection.jsx — Tareas sueltas del ingeniero, no asociadas a
// ningún proyecto (ej. una actividad extra que le hicieron encima y le
// retrasa lo que tenía planeado). Vive en engineer.tasks[] (mismo catálogo
// que engineer.name/role, no en activities_identified de ningún proyecto).
//
// Extraído de EngineersView.jsx ("Equipo") para reutilizarlo tal cual en
// EngineerHub ("Mi semana") — un ingeniero no-admin no ve "Equipo" (esa
// pestaña también permite editar a OTROS ingenieros), pero sí debe poder
// gestionar sus PROPIAS tareas sueltas sin pasar por ahí.

import { useState } from "react";
import { createEngineerTask } from "../../utils/formulas";
import EngineerTaskModal from "../EngineerTaskModal";
import AdditionalTasksTable from "./AdditionalTasksTable";

export default function LooseTasksSection({ tasks, onChange, engineerName }) {
  const [draft,     setDraft]     = useState("");
  const [adding,    setAdding]    = useState(false);
  const [editingId, setEditingId] = useState(null);

  const list = tasks || [];

  // Al confirmar, abre de inmediato la tarjeta de detalle completa de la
  // tarea recién creada (fechas, descripción, checklist, etc.) — mismo
  // patrón que crear una subtarea en Planificación (handleCreateSubtaskFromModal,
  // EditView.jsx: crear y abrir es un solo paso, no dos). Antes solo quedaba
  // agregada a la tabla, sin abrir nada, y había que volver a hacer clic
  // sobre la fila para completar el resto de los datos.
  const confirmAdd = () => {
    const t = draft.trim();
    if (t) {
      const newTask = createEngineerTask(t);
      onChange([...list, newTask]);
      setEditingId(newTask.id);
    }
    setDraft(""); setAdding(false);
  };

  const saveTask = (updated) => onChange(list.map(t => t.id === updated.id ? updated : t));
  const remove   = (id)      => onChange(list.filter(t => t.id !== id));

  const editingTask = list.find(t => t.id === editingId) || null;

  return (
    <div className="field" style={{ marginTop: 24 }}>
      <div className="field__header">
        <label className="field__label">
          Tareas adicionales
          {list.length > 0 && <span className="act-count">{list.length}</span>}
        </label>
        {!adding && (
          <button type="button" className="btn-add-item" onClick={() => setAdding(true)}>
            + Agregar tarea
          </button>
        )}
      </div>

      {adding && (
        <div className="list-field-draft">
          <input
            className="field__input list-field-draft__input"
            autoFocus value={draft}
            placeholder="Descripción de la tarea… (Enter para confirmar)"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirmAdd(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
          />
          <button type="button" className="list-field-draft__ok"     onClick={confirmAdd}                          title="Confirmar">✓</button>
          <button type="button" className="list-field-draft__cancel" onClick={() => { setDraft(""); setAdding(false); }} title="Cancelar">✕</button>
        </div>
      )}

      {list.length > 0 ? (
        <AdditionalTasksTable tasks={list} mode="edit" onEdit={setEditingId} onRemove={remove} />
      ) : (
        !adding && <p className="act-list__empty">Sin tareas adicionales registradas.</p>
      )}

      {editingTask && (
        <EngineerTaskModal
          task={editingTask}
          engineerName={engineerName}
          onSave={saveTask}
          onDelete={() => remove(editingTask.id)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
