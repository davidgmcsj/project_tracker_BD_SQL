import { useState, useRef, useEffect } from "react";
import { suggestedWorkHours, businessDaysBetween } from "../utils/formulas";
import { uploadAttachment, deleteAttachment, attachmentDownloadUrl } from "../utils/storage";
import { ChecklistSection, KeyDatesSection, NotesSection, DateBadgesSection } from "./ActivityFormSections";

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "not_started", label: "No iniciada" },
  { value: "in_progress", label: "En proceso"  },
  { value: "completed",   label: "Completada"  },
];

// Lista de horas planeadas: 0 (sin definir), 0.5, y luego de 1 en 1 hasta 40.
const HOURS_OPTIONS = [0, 0.5, ...Array.from({ length: 40 }, (_, i) => i + 1)];

// Redondea un número de horas a la opción más cercana disponible en HOURS_OPTIONS.
function closestHoursOption(hours) {
  return HOURS_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - hours) < Math.abs(best - hours) ? opt : best
  , HOURS_OPTIONS[0]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActivityStatus(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  if ((taskStatus.not_started || []).includes(actId)) return "not_started";
  return "not_started";
}

// ── Adjuntos ──────────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (!n) return "0 B";
  const k = 1024, units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fileIcon(mime = "", name = "") {
  const m = (mime || "").toLowerCase();
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (m.startsWith("image/")) return "🖼️";
  if (m === "application/pdf" || ext === "pdf") return "📕";
  if (m.includes("word") || ["doc", "docx"].includes(ext)) return "📘";
  if (m.includes("sheet") || m.includes("excel") || ["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (m.includes("zip") || ["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

function AttachmentsSection({ items, activityId, projectId, onChange }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const MAX_BYTES = 10 * 1024 * 1024;

  const handleFiles = async (fileList) => {
    setError("");
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" supera el límite de 10 MB.`);
        continue;
      }
      setBusy(true);
      try {
        const meta = await uploadAttachment(file, {
          appActividadID: activityId,
          proyectoAppID:  projectId,
        });
        onChange([...items, meta]);
      } catch (e) {
        setError(`No se pudo subir "${file.name}". ${e.message || ""}`);
      } finally {
        setBusy(false);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = async (att) => {
    setError("");
    try {
      await deleteAttachment(att.id);
    } catch {
      // aunque falle el borrado en SQL, lo quitamos de la lista local
    }
    onChange(items.filter(a => a.id !== att.id));
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Adjuntos</span>
        <button
          type="button"
          className="adm-add-btn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Subiendo…" : "+ Subir archivo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {error && <p className="adm-attach-error">{error}</p>}

      {items.length > 0 ? (
        <ul className="adm-attach-list">
          {items.map(att => (
            <li key={att.id} className="adm-attach-item">
              <span className="adm-attach-item__icon">{fileIcon(att.mime, att.filename)}</span>
              <a
                className="adm-attach-item__name"
                href={attachmentDownloadUrl(att.id)}
                target="_blank"
                rel="noreferrer"
                title="Descargar"
              >
                {att.filename}
              </a>
              <span className="adm-attach-item__size">{formatBytes(att.size)}</span>
              <button
                type="button"
                className="adm-attach-item__remove"
                onClick={() => handleRemove(att)}
                title="Eliminar adjunto"
              >✕</button>
            </li>
          ))}
        </ul>
      ) : (
        !busy && <p className="adm-empty-hint">Sin archivos adjuntos. Máx. 10 MB por archivo.</p>
      )}
    </div>
  );
}

// ── Detección de cambios ──────────────────────────────────────────────────────

function hasChanges(activity, local) {
  if ((activity.text        || "")      !== local.text)        return true;
  if ((activity.start_date  || "")      !== local.start_date)  return true;
  if ((activity.due_date    || "")      !== local.due_date)    return true;
  if ((activity.description || "")      !== local.description) return true;
  if ((activity.objectives  || "")      !== local.objectives)  return true;
  if ((activity.solution    || "")      !== local.solution)    return true;
  if ((Number(activity.progress)      || 0) !== local.progress)      return true;
  if ((Number(activity.planned_hours) || 0) !== local.planned_hours) return true;
  if (JSON.stringify(activity.assigned_engineers || []) !== JSON.stringify(local.assigned_engineers)) return true;
  if (JSON.stringify(activity.checklist  || []) !== JSON.stringify(local.checklist))  return true;
  if (JSON.stringify(activity.notes      || []) !== JSON.stringify(local.notes))      return true;
  if (JSON.stringify(activity.key_dates  || []) !== JSON.stringify(local.key_dates))  return true;
  return false;
}

// ── Modal de confirmación de cierre ──────────────────────────────────────────

function DiscardConfirmDialog({ onSaveAndClose, onDiscard, onCancel }) {
  return (
    <div className="adm-confirm-overlay">
      <div className="adm-confirm-dialog">
        <p className="adm-confirm-dialog__msg">
          Tienes cambios sin guardar. ¿Qué deseas hacer?
        </p>
        <div className="adm-confirm-dialog__actions">
          <button type="button" className="adm-confirm-btn adm-confirm-btn--cancel"  onClick={onCancel}>
            Seguir editando
          </button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--discard" onClick={onDiscard}>
            Descartar cambios
          </button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--save"    onClick={onSaveAndClose}>
            Guardar y cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const dirty = hasChanges(activity, local);

  const requestClose = () => {
    if (dirty) { setShowConfirm(true); return; }
    onClose();
  };

  const handleSaveAndClose = () => {
    onSave({ ...activity, ...local });
    onClose();
  };

  const handleDiscard = () => {
    onClose();
  };

  // Escape respeta la misma lógica
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);

  // Click en overlay
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) requestClose();
  };

  const assigned = activity.assigned_engineers || [];

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

          {/* Fechas de depósito según estado */}
          <DateBadgesSection status={status} history={history} />
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
