import { useState, useRef, useEffect } from "react";
import { suggestedWorkHours, businessDaysBetween, wouldCreateCycle, buildActivityIndex, activityLabel, flattenTree, getToday } from "../utils/formulas";
import { validateStartEnd, validateTransitionDates } from "../utils/dateValidation";
import { KeyDatesSection, NotesSection, DateBadgesSection, SubtasksSection } from "./ActivityFormSections";
import { STATUS_OPTIONS, HOURS_OPTIONS, closestHoursOption, getActivityStatus, hasChanges } from "./activity-detail/shared";
import { buildAssignables } from "./edit/shared";
import AssigneeDropdown from "./edit/AssigneeDropdown";
import AttachmentsSection from "./activity-detail/AttachmentsSection";
import DiscardConfirmDialog from "./activity-detail/DiscardConfirmDialog";
import ParentSelectDropdown from "./activity-detail/ParentSelectDropdown";
import DelayCascadePreview from "./activity-detail/DelayCascadePreview";

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
  // Progreso agregado, calculado por el padre (tiene el árbol completo de
  // actividades, ver EditView/ProjectPlanningOverlays) — no null cuando esta
  // actividad tiene subtareas. En ese caso el % deja de ser editable a mano:
  // es siempre el promedio de las subtareas.
  computedProgress,
  // Todas las actividades del proyecto (no solo subtasks, que son únicamente
  // las hijas directas) — necesarias para poblar el selector "Es subtarea
  // de" y validar con wouldCreateCycle que el nuevo padre no sea la propia
  // actividad ni uno de sus descendientes. Opcional: si no se pasa, el
  // selector de padre no se muestra (mismo criterio que subtasks !== undefined).
  allActivities,
  // (patches[]) => void — mismo canal que ya usa HierarchyTable para aplicar
  // varios cambios de fecha en una sola actualización. Necesario para el
  // botón "Agregar retraso" (DelayCascadePreview). Opcional: si no se pasa,
  // el botón no se muestra (mismo criterio que allActivities).
  onApplyDateChange,
}) {
  const hasSubtasks = Array.isArray(subtasks) && subtasks.length > 0;
  const overlayRef = useRef(null);
  const [showDelayDialog, setShowDelayDialog] = useState(false);
  const [showDelayPreview, setShowDelayPreview] = useState(false);
  const [delayDays, setDelayDays] = useState(1);

  const status  = getActivityStatus(taskStatus, activity.id);
  const history = taskStatus?.status_history?.[activity.id] || {};

  const [local, setLocal] = useState({
    text:               activity.text               || "",
    parent_id:          activity.parent_id           ?? null,
    status:             status,
    es_desarrollo:      activity.es_desarrollo === true,
    start_date:         activity.start_date         || "",
    due_date:           activity.due_date           || "",
    description:        activity.description        || "",
    objectives:         activity.objectives         || "",
    solution:           activity.solution           || "",
    progress:           Number(activity.progress) || 0,
    planned_hours:      closestHoursOption(Number(activity.planned_hours) || 0),
    assigned_engineers: Array.isArray(activity.assigned_engineers) ? activity.assigned_engineers : [],
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

  // Con subtareas, el % mostrado y guardado es SIEMPRE computedProgress —
  // nunca local.progress. Es un valor derivado, no estado propio: calcularlo
  // en cada render (en vez de copiarlo a local con un efecto) evita que quede
  // congelado si computedProgress cambia mientras el modal sigue abierto
  // (agregar o quitar una subtarea no cierra este modal, solo recalcula el
  // árbol en el padre — ver SubtasksSection.onRemove).
  const displayProgress = hasSubtasks && computedProgress !== null ? computedProgress : local.progress;

  // Poner (no quitar) la fecha de "completada" a mano fuerza el % a 100 —
  // misma regla que aplica el Kanban al mover una tarjeta a esa columna
  // (ver ProjectPlanningOverlays.commit), para que una actividad completada
  // muestre 100% sin importar por cuál de los dos caminos se marcó.
  const setHistory = (val) => {
    setLocal(prev => {
      const justCompleted = val.completed && !prev.history.completed;
      return { ...prev, history: val, progress: justCompleted ? 100 : prev.progress };
    });
  };

  // Cambia el estado (columna del Kanban) desde el selector del modal. El
  // estado en sí no vive en la actividad — vive en task_status del proyecto
  // — así que no se persiste aquí directo: buildSaved lo manda como
  // _newStatus y el padre (EditView/ProjectPlanningOverlays) mueve el id
  // entre buckets, igual que hace TaskStatusSelector.move() al arrastrar una
  // tarjeta. Auto-registra la fecha de transición (mismo criterio que el
  // Kanban) y fuerza 100% al pasar a completada.
  const changeStatus = (newStatus) => {
    setLocal(prev => {
      const nextHistory = { ...prev.history };
      if (!nextHistory.added) nextHistory.added = getToday();
      if (newStatus === "in_progress" && !nextHistory.in_progress) nextHistory.in_progress = getToday();
      if (newStatus === "completed" && !nextHistory.completed) nextHistory.completed = getToday();
      return {
        ...prev,
        status: newStatus,
        history: nextHistory,
        progress: newStatus === "completed" ? 100 : prev.progress,
      };
    });
  };

  const dateErrors = {
    startEnd: validateStartEnd(local.start_date, local.due_date),
    transitions: validateTransitionDates({
      startDate: local.start_date, dueDate: local.due_date,
      added: local.history.added, inProgress: local.history.in_progress, completed: local.history.completed,
    }),
  };
  const hasDateErrors = !!(dateErrors.startEnd || dateErrors.transitions);

  // Los adjuntos se guardan/eliminan en SQL al instante. Para que su metadata
  // no se pierda si el usuario descarta otros cambios, la persistimos de inmediato
  // combinando la actividad ORIGINAL con la nueva lista de adjuntos (sin arrastrar
  // otros edits sin confirmar del formulario).
  const handleAttachmentsChange = (nextAttachments) => {
    setLocal(prev => ({ ...prev, attachments: nextAttachments }));
    onSave({ ...activity, attachments: nextAttachments });
  };

  // Si el % guardado quedó desactualizado respecto al promedio real de las
  // subtareas (ej. alguien completó una subtarea desde otra pantalla y esta
  // actividad nunca se reabrió), dirty da true apenas se abre el modal, sin
  // que el usuario haya tocado nada — es intencional: fuerza a persistir el
  // valor correcto en el próximo guardado en vez de dejarlo desincronizado.

  const dirty = hasChanges(activity, local, history, displayProgress, status);

  // Separa el history (va a task_status) del resto de campos de la actividad.
  // EditView lee _history y lo escribe en task_status.status_history.
  // progress usa displayProgress, no local.progress — ver su comentario.
  // _newStatus solo se manda si el estado cambió: el caller lo usa para
  // mover el id entre los buckets de task_status (igual que
  // TaskStatusSelector.move() al arrastrar una tarjeta en el Kanban).
  const buildSaved = () => {
    const { history: hist, status: newStatus, ...actFields } = local;
    return {
      ...activity,
      ...actFields,
      progress: displayProgress,
      _history: hist,
      ...(newStatus !== status ? { _newStatus: newStatus } : {}),
    };
  };

  const requestClose = () => {
    if (dirty) { setShowConfirm(true); return; }
    onClose();
  };

  // onSave puede devolver el id de una subtarea de despliegue recién creada
  // (transitionActivityStatus/_newStatus — ver ProjectPlanningOverlays y
  // useActivityHandlers) cuando el cambio de estado disparó la cadena
  // automática de ambientes. En ese caso el padre YA navegó a esa tarjeta
  // (setModalActId(id) dentro de onSave) — llamar onClose() aquí encima la
  // cerraría de inmediato (mismo componente, mismo tick de React: el último
  // setState gana). Si no hay id, comportamiento de siempre.
  const handleSaveAndClose = () => {
    if (hasDateErrors) return;
    const openedActivityId = onSave(buildSaved());
    if (!openedActivityId) onClose();
  };

  const handleDiscard = () => {
    onClose();
  };

  // Crear/abrir una subtarea reemplaza esta tarjeta por la de la subtarea
  // (mismo modal, otro id) — si hay cambios sin guardar aquí, se guardan
  // primero para no perderlos al navegar, igual que "Guardar y cerrar". Con
  // fechas inválidas no se guarda, pero tampoco se bloquea la navegación —
  // el usuario puede seguir sin perder lo escrito, solo no se persiste hasta
  // que corrija.
  const handleCreateSubtask = () => {
    if (dirty && !hasDateErrors) onSave(buildSaved());
    onCreateSubtask();
  };
  const handleOpenSubtask = (id) => {
    if (dirty && !hasDateErrors) onSave(buildSaved());
    onOpenSubtask(id);
  };

  // Escape respeta la misma lógica. stopImmediatePropagation es necesario
  // porque este modal suele abrirse ENCIMA de otro overlay de pantalla
  // completa (ProjectPlanningOverlays), que también escucha Escape en
  // window — ambos listeners viven en el MISMO target, así que un
  // stopPropagation normal no los separa. Sin esto, un solo Escape disparaba
  // los dos: este mostraba el diálogo de "cambios sin guardar" y, en el
  // mismo evento, el overlay padre igual cerraba todo por encima, perdiendo
  // el diálogo (y los cambios) sin que el usuario llegara a confirmar nada.
  // Depende de que este listener se registre DESPUÉS que el del padre (se
  // monta más tarde, ver orden de mount en ProjectPlanningOverlays) — los
  // listeners de un mismo target corren en orden de registro.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); requestClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // Click en overlay
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) requestClose();
  };

  // Sugerencias automáticas
  const bizDays  = businessDaysBetween(local.start_date, local.due_date);
  const suggHours = suggestedWorkHours(local.start_date, local.due_date);
  const statusClass = {
    completed:            "adm-status-pill--completed",
    in_progress:          "adm-status-pill--inprogress",
    ambiente_pruebas:     "adm-status-pill--ambientepruebas",
    ambiente_produccion:  "adm-status-pill--ambienteproduccion",
  }[local.status] || "adm-status-pill--notstarted";

  // Las 2 opciones de ambiente solo se muestran si la actividad está
  // marcada "Es de desarrollo" — se OCULTAN del <select> (no solo se
  // deshabilitan) para no confundir con opciones inalcanzables.
  const visibleStatusOptions = STATUS_OPTIONS.filter(o =>
    local.es_desarrollo || !["ambiente_pruebas", "ambiente_produccion"].includes(o.value)
  );

  // Opciones válidas para "Es subtarea de": todo el proyecto MENOS la propia
  // actividad y sus descendientes (wouldCreateCycle cubre ambos casos) —
  // convertirla en hija de su propia hija formaría un ciclo. Solo se muestra
  // si el caller pasó allActivities (mismo criterio opcional que subtasks).
  // Se recorre vía flattenTree (preorden jerárquico, respeta sequence_order)
  // en vez de allActivities.filter() directo — antes la lista salía en el
  // orden crudo del array (orden de creación), no en 1, 1.1, 1.2, 2, 2.1…
  // aunque el label de cada opción ya mostraba el número correcto.
  const parentOptions = Array.isArray(allActivities)
    ? flattenTree(allActivities)
        .map(({ activity: a }) => a)
        .filter(a => a.id !== activity.id && !wouldCreateCycle(allActivities, activity.id, a.id))
    : null;
  const parentOptionsIndex = parentOptions ? buildActivityIndex(allActivities) : null;

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
            <select
              className={`adm-status-pill adm-status-pill--select ${statusClass}`}
              value={local.status}
              onChange={e => changeStatus(e.target.value)}
              title="Cambiar estado"
            >
              {visibleStatusOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label
              className="adm-dev-checkbox"
              title="Habilita los estados Ambiente Pruebas / Ambiente Producción en el Kanban"
            >
              <input
                type="checkbox"
                checked={local.es_desarrollo}
                disabled={["ambiente_pruebas", "ambiente_produccion"].includes(local.status)}
                onChange={e => set("es_desarrollo", e.target.checked)}
              />
              Es de desarrollo
            </label>
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

          {/* "Es subtarea de" — mover esta actividad a otro padre, o subirla
              a raíz eligiendo "Ninguno". Solo se muestra si el caller pasó
              allActivities (ver comentario del prop). Con buscador (filtra
              por número o texto) y ya en orden jerárquico (ver parentOptions). */}
          {parentOptions && (
            <div className="adm-parent-select">
              <label className="adm-label" htmlFor="adm-parent-select">Es subtarea de</label>
              <ParentSelectDropdown
                options={parentOptions.map(a => ({ id: a.id, label: activityLabel(parentOptionsIndex, a.id) }))}
                selectedId={local.parent_id}
                onSelect={id => set("parent_id", id)}
              />
            </div>
          )}

          {/* Fechas de transición (editables — útil al importar de Planner) */}
          <DateBadgesSection status={local.status} history={local.history} onChange={setHistory} />
          {dateErrors.transitions && (
            <p className="adm-date-error">
              {dateErrors.transitions.in_progress || dateErrors.transitions.completed}
            </p>
          )}
        </div>

        <div className="adm-body">

          {/* ── Fila: Fecha inicio / Fecha fin ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">Fecha inicio</label>
              <input
                type="date"
                className={`adm-input${dateErrors.startEnd ? " adm-input--error" : ""}`}
                value={local.start_date}
                onChange={e => set("start_date", e.target.value)}
              />
            </div>
            <div className="adm-field">
              <label className="adm-label">Fecha fin</label>
              <input
                type="date"
                className={`adm-input${dateErrors.startEnd ? " adm-input--error" : ""}`}
                value={local.due_date}
                onChange={e => set("due_date", e.target.value)}
              />
            </div>
          </div>
          {dateErrors.startEnd && <p className="adm-date-error">{dateErrors.startEnd}</p>}

          {/* ── Fila: % Cumplimiento / Horas planeadas ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">
                % Cumplimiento
                {hasSubtasks && (
                  <span className="adm-label__hint"> — calculado automáticamente según las subtareas</span>
                )}
              </label>
              <div className="adm-progress-field">
                <input
                  type="range"
                  className="adm-range"
                  min={0}
                  max={100}
                  step={5}
                  value={displayProgress}
                  disabled={hasSubtasks}
                  onChange={e => set("progress", Number(e.target.value))}
                />
                <input
                  type="number"
                  className="adm-input adm-input--pct"
                  min={0}
                  max={100}
                  value={displayProgress}
                  disabled={hasSubtasks}
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
            {/* Selector para agregar, con buscador. buildAssignables (mismo
                criterio que EditView/ActivitiesList) exige active===true en
                ambos catálogos — el <select> anterior era más laxo con
                ingenieros (active !== false) y no filtraba externos por
                activo en absoluto; se unifica al criterio del resto de la
                app en vez de mantener un tercer criterio ad-hoc. */}
            {(() => {
              const allAssignables = buildAssignables(engineerCatalog, externalContacts);
              const assignedIds    = new Set(local.assigned_engineers.map(e => e.id));
              if (allAssignables.every(a => assignedIds.has(a.id))) return null;
              return (
                <AssigneeDropdown
                  assignables={allAssignables}
                  assignedIds={assignedIds}
                  placeholder="+ Agregar responsable…"
                  onSelect={id => {
                    const opt = allAssignables.find(a => a.id === id);
                    if (opt) set("assigned_engineers", [...local.assigned_engineers, { id: opt.id, name: opt.name }]);
                  }}
                />
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
          <div className="adm-footer__left">
            {/* Botón eliminar — solo si el padre lo soporta */}
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
            {/* Solo si hay fecha de fin (desde dónde calcular candidatas) y el
                caller pasó allActivities + onApplyDateChange. */}
            {onApplyDateChange && allActivities && local.due_date && (
              <button
                type="button"
                className="adm-delay-btn"
                onClick={() => setShowDelayDialog(true)}
                title="Retrasar esta actividad y ver qué otras se moverían"
              >
                ⏱ Agregar retraso
              </button>
            )}
          </div>
          <button
            type="button"
            className="adm-save-btn"
            onClick={handleSaveAndClose}
            disabled={dirty && hasDateErrors}
            title={dirty && hasDateErrors ? "Corrige las fechas antes de guardar" : undefined}
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

        {/* Diálogo inline "Agregar retraso" — cuántos días, antes de ver el
            detalle de qué otras actividades se moverían. */}
        {showDelayDialog && (
          <div className="adm-confirm-overlay">
            <div className="adm-delay-dialog">
              <p style={{ fontWeight: 700, marginBottom: 4 }}>Agregar retraso</p>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 4 }}>
                Esta actividad y las que terminen el mismo día o después se moverán la cantidad
                de días que indiques. Podrás revisar y elegir cuáles antes de confirmar.
              </p>
              <label className="adm-delay-dialog__row">
                Retraso de
                <input
                  type="number"
                  min={1}
                  className="adm-delay-dialog__input"
                  value={delayDays}
                  onChange={e => setDelayDays(Math.max(1, Number(e.target.value) || 1))}
                />
                día(s) hábil(es)
              </label>
              <div className="adm-delay-dialog__actions">
                <button type="button" className="adm-confirm-btn adm-confirm-btn--cancel" onClick={() => setShowDelayDialog(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn--accent"
                  onClick={() => { setShowDelayDialog(false); setShowDelayPreview(true); }}
                >
                  Ver actividades afectadas
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Pantalla de vista previa — overlay propio, por ENCIMA de este modal
          (ver z-index en activity-detail.css). Usa `activity` (no `local`)
          como referencia: el retraso opera sobre la fecha ya persistida, no
          sobre ediciones sin guardar en el formulario. */}
      {showDelayPreview && (
        <DelayCascadePreview
          activity={activity}
          allActivities={allActivities}
          taskStatus={taskStatus}
          initialDays={delayDays}
          onApplyPatches={onApplyDateChange}
          onClose={() => setShowDelayPreview(false)}
        />
      )}
    </div>
  );
}
