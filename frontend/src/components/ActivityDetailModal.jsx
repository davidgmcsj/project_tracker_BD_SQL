import { useState, useRef, useEffect } from "react";
import { suggestedWorkHours, businessDaysBetween } from "../utils/formulas";
import { ChecklistSection, KeyDatesSection, NotesSection, DateBadgesSection, SubtasksSection } from "./ActivityFormSections";
import { STATUS_OPTIONS, HOURS_OPTIONS, closestHoursOption, getActivityStatus, hasChanges } from "./activity-detail/shared";
import AttachmentsSection from "./activity-detail/AttachmentsSection";
import DiscardConfirmDialog from "./activity-detail/DiscardConfirmDialog";

// ── Modal principal ───────────────────────────────────────────────────────────

export default function ActivityDetailModal({
  activity,
  projectName,
  projectId,
  taskStatus,
  engineerCatalog,
  externalContacts,
  onSave,
  onClose,
  onDelete, // opcional — si se pasa, muestra el botón "Eliminar actividad"
  // Subtareas reales (jerarquía) — opcionales: si no se pasan, la sección no se muestra.
  subtasks,          // actividades hijas de esta (parent_id === activity.id)
  onCreateSubtask,   // () => void — crea una subtarea y abre su tarjeta de inmediato
  onOpenSubtask,     // (id) => void — abre la tarjeta de una subtarea existente
  onDeleteSubtask,   // (id) => void
}) {
  const overlayRef = useRef(null);

  const status  = getActivityStatus(taskStatus, activity.id);
  const history = taskStatus?.status_history?.[activity.id] || {};

  const [local, setLocal] = useState({
    text:               activity.text               || "",
    start_date:         activity.start_date         || "",
    due_date:           activity.due_date           || "",
    description:        activity.description        || "",
    objectives:         activity.objectives         || "",
    solution:           activity.solution           || "",
    progress:           Number(activity.progress)      || 0,
    planned_hours:      closestHoursOption(Number(activity.planned_hours) || 0),
    assigned_engineers: Array.isArray(activity.assigned_engineers) ? activity.assigned_engineers : [],
    checklist:          Array.isArray(activity.checklist) ? activity.checklist : [],
    notes:              Array.isArray(activity.notes)     ? activity.notes     : [],
    key_dates:          Array.isArray(activity.key_dates) ? activity.key_dates : [],
    attachments:        Array.isArray(activity.attachments) ? activity.attachments : [],
    // Fechas de transición (Inscrita/En proceso/Completada). Viven en
    // task_status.status_history, no en la actividad — se propagan por _history al guardar.
    history:            { added: history.added || "", in_progress: history.in_progress || "", completed: history.completed || "" },
  });

  const [showConfirm,    setShowConfirm]    = useState(false);
  const [showDelConfirm, setShowDelConfirm] = useState(false);

  const set = (field, val) => setLocal(prev => ({ ...prev, [field]: val }));

  // Los adjuntos se guardan/eliminan en SQL al instante. Para que su metadata
  // no se pierda si el usuario descarta otros cambios, la persistimos de inmediato
  // combinando la actividad ORIGINAL con la nueva lista de adjuntos (sin arrastrar
  // otros edits sin confirmar del formulario).
  const handleAttachmentsChange = (nextAttachments) => {
    setLocal(prev => ({ ...prev, attachments: nextAttachments }));
    onSave({ ...activity, attachments: nextAttachments });
  };

  const dirty = hasChanges(activity, local, history);

  // Separa el history (va a task_status) del resto de campos de la actividad.
  // EditView lee _history y lo escribe en task_status.status_history.
  const buildSaved = () => {
    const { history: hist, ...actFields } = local;
    return { ...activity, ...actFields, _history: hist };
  };

  const requestClose = () => {
    if (dirty) { setShowConfirm(true); return; }
    onClose();
  };

  const handleSaveAndClose = () => {
    onSave(buildSaved());
    onClose();
  };

  const handleDiscard = () => {
    onClose();
  };

  // Crear/abrir una subtarea reemplaza esta tarjeta por la de la subtarea
  // (mismo modal, otro id) — si hay cambios sin guardar aquí, se guardan
  // primero para no perderlos al navegar, igual que "Guardar y cerrar".
  const handleCreateSubtask = () => {
    if (dirty) onSave(buildSaved());
    onCreateSubtask();
  };
  const handleOpenSubtask = (id) => {
    if (dirty) onSave(buildSaved());
    onOpenSubtask(id);
  };

  // Escape respeta la misma lógica
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Click en overlay
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) requestClose();
  };

  // Sugerencias automáticas
  const checklistTotal = local.checklist.length;
  const checklistDone  = local.checklist.filter(it => it.done).length;
  const suggestedProgress = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : null;
  const bizDays  = businessDaysBetween(local.start_date, local.due_date);
  const suggHours = suggestedWorkHours(local.start_date, local.due_date);
  const statusLabel  = STATUS_OPTIONS.find(o => o.value === status)?.label || "—";
  const statusClass =
    status === "completed"   ? "adm-status-pill--completed" :
    status === "in_progress" ? "adm-status-pill--inprogress" :
                               "adm-status-pill--notstarted";

  return (
    <div className="adm-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="adm-panel">

        {showConfirm && (
          <DiscardConfirmDialog
            onSaveAndClose={handleSaveAndClose}
            onDiscard={handleDiscard}
            onCancel={() => setShowConfirm(false)}
          />
        )}

        {/* ── Cabecera ── */}
        <div className="adm-header">
          <div className="adm-header__top">
            <span className="adm-header__project">{projectName}</span>
            <span className={`adm-status-pill ${statusClass}`}>{statusLabel}</span>
            {dirty && <span className="adm-dirty-badge">Sin guardar</span>}
            <div className="adm-header__spacer" />
            <button
              type="button"
              className="adm-close-btn"
              onClick={requestClose}
              title="Cerrar"
            >✕</button>
          </div>
          <textarea
            className="adm-header__title-input"
            value={local.text}
            onChange={e => {
              set("text", e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onFocus={e => {
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            ref={el => {
              if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
            }}
            rows={1}
            placeholder="Nombre de la actividad…"
          />

          {/* Fechas de transición (editables — útil al importar de Planner) */}
          <DateBadgesSection status={status} history={local.history} onChange={val => set("history", val)} />
        </div>

        <div className="adm-body">

          {/* ── Fila: Fecha inicio / Fecha fin ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">Fecha inicio</label>
              <input
                type="date"
                className="adm-input"
                value={local.start_date}
                onChange={e => set("start_date", e.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-label">Fecha fin</label>
              <input
                type="date"
                className="adm-input"
                value={local.due_date}
                onChange={e => set("due_date", e.target.value)}
              />
            </div>
          </div>

          {/* ── Fila: % Cumplimiento / Horas planeadas ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">
                % Cumplimiento
                {suggestedProgress !== null && suggestedProgress !== local.progress && (
                  <button
                    type="button"
                    className="adm-suggest-link"
                    onClick={() => set("progress", suggestedProgress)}
                    title="Usar el % según subactividades marcadas"
                  >
                    usar {suggestedProgress}% (checklist)
                  </button>
                )}
              </label>
              <div className="adm-progress-field">
                <input
                  type="range"
                  className="adm-range"
                  min={0}
                  max={100}
                  step={5}
                  value={local.progress}
                  onChange={e => set("progress", Number(e.target.value))}
                />
                <input
                  type="number"
                  className="adm-input adm-input--pct"
                  min={0}
                  max={100}
                  value={local.progress}
                  onChange={e => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    set("progress", v);
                  }}
                />
                <span className="adm-pct-sign">%</span>
              </div>
            </div>
            <div className="adm-field">
              <label className="adm-label">
                Horas planeadas
                {suggHours > 0 && closestHoursOption(suggHours) !== local.planned_hours && (
                  <button
                    type="button"
                    className="adm-suggest-link"
                    onClick={() => set("planned_hours", closestHoursOption(suggHours))}
                    title={`${bizDays} día(s) hábil(es) × 8h, sin fines de semana ni festivos`}
                  >
                    usar {closestHoursOption(suggHours)}h ({bizDays} días háb.)
                  </button>
                )}
              </label>
              <div className="adm-progress-field">
                <select
                  className="adm-select"
                  value={local.planned_hours}
                  onChange={e => set("planned_hours", Number(e.target.value))}
                >
                  {HOURS_OPTIONS.map(h => (
                    <option key={h} value={h}>{h} h</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Responsables (editable) ── */}
          <div className="adm-section">
            <div className="adm-section__header">
              <span className="adm-section__title">Responsables</span>
            </div>
            {/* Chips de responsables asignados */}
            <div className="adm-assignees">
              {local.assigned_engineers.map(e => {
                const isExt = e.id?.startsWith("ext_");
                return (
                  <span
                    key={e.id}
                    className={`adm-assignee-chip${isExt ? " adm-assignee-chip--ext" : ""}`}
                  >
                    {isExt && <span className="adm-assignee-chip__ext">Ext</span>}
                    {e.name}
                    <button
                      type="button"
                      className="adm-assignee-chip__remove"
                      onClick={() => set("assigned_engineers", local.assigned_engineers.filter(x => x.id !== e.id))}
                      title="Quitar"
                    >✕</button>
                  </span>
                );
              })}
              {local.assigned_engineers.length === 0 && (
                <p className="adm-empty-hint">Sin responsables asignados.</p>
              )}
            </div>
            {/* Selector para agregar */}
            {(() => {
              const allOptions = [
                ...(engineerCatalog || []).filter(e => e.active !== false).map(e => ({ id: e.id, name: e.name })),
                ...(externalContacts || []).map(e => ({ id: e.id, name: e.name })),
              ];
              const assignedIds = new Set(local.assigned_engineers.map(e => e.id));
              const available   = allOptions.filter(e => !assignedIds.has(e.id));
              if (available.length === 0) return null;
              return (
                <select
                  className="adm-select adm-select--assignee"
                  value=""
                  onChange={ev => {
                    const opt = available.find(e => e.id === ev.target.value);
                    if (opt) set("assigned_engineers", [...local.assigned_engineers, opt]);
                  }}
                >
                  <option value="">+ Agregar responsable…</option>
                  {available.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              );
            })()}
          </div>

          {/* ── Objetivos ── */}
          <div className="adm-section">
            <div className="adm-section__header">
              <span className="adm-section__title">Objetivos</span>
            </div>
            <textarea
              className="adm-textarea"
              rows={3}
              placeholder="¿Qué se busca cumplir con esta actividad?"
              value={local.objectives}
              onChange={e => set("objectives", e.target.value)}
            />
          </div>

          {/* ── Descripción ── */}
          <div className="adm-section">
            <div className="adm-section__header">
              <span className="adm-section__title">Descripción</span>
            </div>
            <textarea
              className="adm-textarea"
              rows={3}
              placeholder="Agrega una descripción detallada de la actividad…"
              value={local.description}
              onChange={e => set("description", e.target.value)}
            />
          </div>

          {/* ── Solución ── */}
          <div className="adm-section">
            <div className="adm-section__header">
              <span className="adm-section__title">Solución</span>
            </div>
            <textarea
              className="adm-textarea"
              rows={3}
              placeholder="Describe la solución aplicada o propuesta…"
              value={local.solution}
              onChange={e => set("solution", e.target.value)}
            />
          </div>

          {/* ── Lista de comprobación ── */}
          <ChecklistSection
            items={local.checklist}
            onChange={val => set("checklist", val)}
          />

          {/* ── Subtareas reales (jerarquía) ── */}
          {subtasks !== undefined && (
            <SubtasksSection
              subtasks={subtasks}
              taskStatus={taskStatus}
              onCreate={handleCreateSubtask}
              onOpen={handleOpenSubtask}
              onRemove={onDeleteSubtask}
            />
          )}

          {/* ── Fechas clave ── */}
          <KeyDatesSection
            items={local.key_dates}
            onChange={val => set("key_dates", val)}
          />

          {/* ── Notas ── */}
          <NotesSection
            items={local.notes}
            onChange={val => set("notes", val)}
          />

          {/* ── Adjuntos ── */}
          <AttachmentsSection
            items={local.attachments}
            activityId={activity.id}
            projectId={projectId}
            onChange={handleAttachmentsChange}
          />

        </div>

        {/* ── Pie ── */}
        <div className="adm-footer">
          {/* Botón eliminar a la izquierda — solo si el padre lo soporta */}
          {onDelete && (
            <button
              type="button"
              className="adm-delete-btn"
              onClick={() => setShowDelConfirm(true)}
              title="Eliminar esta actividad"
            >
              🗑 Eliminar
            </button>
          )}
          <button
            type="button"
            className="adm-save-btn"
            onClick={handleSaveAndClose}
          >
            {dirty ? "💾 Guardar y cerrar" : "Cerrar"}
          </button>
        </div>

        {/* Diálogo de confirmación de eliminación — cubre solo el panel del modal */}
        {showDelConfirm && (
          <div className="adm-confirm-overlay">
            <div className="adm-confirm-dialog">
              <p style={{ fontWeight: 700, marginBottom: 6 }}>¿Eliminar actividad?</p>
              <p style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
                "{activity.text}"
              </p>
              <p style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
                Esta acción no se puede deshacer.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="adm-confirm-btn adm-confirm-btn--cancel"
                  onClick={() => setShowDelConfirm(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="adm-confirm-btn adm-confirm-btn--discard"
                  onClick={() => { onDelete(activity.id); onClose(); }}
                >
                  Eliminar definitivamente
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
