import { useState, useRef, useEffect } from "react";
import { createChecklistItem, createKeyDate } from "../utils/formulas";

// ── Constantes ────────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: "alta",  label: "Alta",  color: "#CC0033" },
  { value: "media", label: "Media", color: "#f59e0b" },
  { value: "baja",  label: "Baja",  color: "#10b981" },
];

const PRIORITY_META = Object.fromEntries(PRIORITY_OPTIONS.map(o => [o.value, o]));

const STATUS_OPTIONS = [
  { value: "not_started", label: "No iniciada" },
  { value: "in_progress", label: "En proceso"  },
  { value: "completed",   label: "Completada"  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActivityStatus(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  if ((taskStatus.not_started || []).includes(actId)) return "not_started";
  return "not_started";
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

// ── Sub-componentes del modal ─────────────────────────────────────────────────

function PriorityDot({ value }) {
  const meta = PRIORITY_META[value] || PRIORITY_META.media;
  return (
    <span
      className="adm-priority-dot"
      style={{ background: meta.color }}
      title={`Prioridad ${meta.label}`}
    />
  );
}

function DateBadgesSection({ status, history }) {
  // history = taskStatus.status_history[actId] || {}
  // Lógica de qué fechas mostrar según el depósito:
  //   no_started  → Inscripción
  //   in_progress → Inscripción + En proceso
  //   completed   → Solo Completada

  if (status === "completed") {
    return (
      <div className="adm-dates-row">
        <span className="adm-date-badge adm-date-badge--completed">
          <span className="adm-date-badge__icon">✅</span>
          <span className="adm-date-badge__label">Completada</span>
          <span className="adm-date-badge__value">{formatDate(history?.completed)}</span>
        </span>
      </div>
    );
  }

  if (status === "in_progress") {
    return (
      <div className="adm-dates-row">
        <span className="adm-date-badge adm-date-badge--added">
          <span className="adm-date-badge__icon">📌</span>
          <span className="adm-date-badge__label">Inscrita</span>
          <span className="adm-date-badge__value">{formatDate(history?.added)}</span>
        </span>
        <span className="adm-date-badge adm-date-badge--inprogress">
          <span className="adm-date-badge__icon">🔄</span>
          <span className="adm-date-badge__label">En proceso</span>
          <span className="adm-date-badge__value">{formatDate(history?.in_progress)}</span>
        </span>
      </div>
    );
  }

  // not_started
  return (
    <div className="adm-dates-row">
      {history?.added && (
        <span className="adm-date-badge adm-date-badge--added">
          <span className="adm-date-badge__icon">📌</span>
          <span className="adm-date-badge__label">Inscrita</span>
          <span className="adm-date-badge__value">{formatDate(history.added)}</span>
        </span>
      )}
    </div>
  );
}

function ChecklistSection({ items, onChange }) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const toggle = (id) =>
    onChange(items.map(it => it.id === id ? { ...it, done: !it.done } : it));

  const updateText = (id, text) =>
    onChange(items.map(it => it.id === id ? { ...it, text } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const confirm = () => {
    const t = draft.trim();
    if (t) onChange([...items, createChecklistItem(t)]);
    setDraft("");
    setAdding(false);
  };

  const done  = items.filter(it => it.done).length;
  const total = items.length;

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">
          Subactividades
          {total > 0 && (
            <span className="adm-checklist-progress">
              {done}/{total}
              <span className="adm-checklist-bar">
                <span
                  className="adm-checklist-bar__fill"
                  style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                />
              </span>
            </span>
          )}
        </span>
        {!adding && (
          <button
            type="button"
            className="adm-add-btn"
            onClick={() => setAdding(true)}
          >
            + Agregar
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="adm-checklist">
          {items.map(it => (
            <li key={it.id} className={`adm-checklist__item${it.done ? " adm-checklist__item--done" : ""}`}>
              <input
                type="checkbox"
                className="adm-checklist__chk"
                checked={it.done}
                onChange={() => toggle(it.id)}
              />
              <input
                type="text"
                className="adm-checklist__text-input"
                value={it.text}
                onChange={e => updateText(it.id, e.target.value)}
              />
              <button
                type="button"
                className="adm-checklist__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft">
          <input
            ref={inputRef}
            type="text"
            className="adm-inline-draft__input"
            placeholder="Descripción del paso…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirm(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={confirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraft(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}

function KeyDatesSection({ items, onChange }) {
  const confirm = (date, label) => {
    if (date || label) onChange([...items, createKeyDate(date, label)]);
  };

  const [draftDate,  setDraftDate]  = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const update = (id, field, val) =>
    onChange(items.map(it => it.id === id ? { ...it, [field]: val } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const handleConfirm = () => {
    confirm(draftDate, draftLabel.trim());
    setDraftDate(""); setDraftLabel(""); setAdding(false);
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Fechas clave</span>
        {!adding && (
          <button
            type="button"
            className="adm-add-btn"
            onClick={() => setAdding(true)}
          >
            + Agregar
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="adm-keydate-list">
          {items.map(it => (
            <li key={it.id} className="adm-keydate-item">
              <span className="adm-keydate-item__icon">📅</span>
              <input
                type="date"
                className="adm-keydate-item__date"
                value={it.date || ""}
                onChange={e => update(it.id, "date", e.target.value)}
              />
              <input
                type="text"
                className="adm-keydate-item__label"
                value={it.label || ""}
                placeholder="Descripción…"
                onChange={e => update(it.id, "label", e.target.value)}
              />
              <button
                type="button"
                className="adm-keydate-item__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft adm-inline-draft--keydate">
          <input
            type="date"
            className="adm-inline-draft__date"
            value={draftDate}
            onChange={e => setDraftDate(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className="adm-inline-draft__input"
            placeholder="Descripción del hito…"
            value={draftLabel}
            onChange={e => setDraftLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
              if (e.key === "Escape") { setDraftDate(""); setDraftLabel(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={handleConfirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraftDate(""); setDraftLabel(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}

function NotesSection({ items, onChange }) {
  const [draftDate, setDraftDate]   = useState("");
  const [draftText, setDraftText]   = useState("");
  const [adding, setAdding] = useState(false);

  const genId = () => "note_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const update = (id, field, val) =>
    onChange(items.map(it => it.id === id ? { ...it, [field]: val } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const handleConfirm = () => {
    const t = draftText.trim();
    if (t) onChange([...items, { id: genId(), date: draftDate, text: t }]);
    setDraftDate(""); setDraftText(""); setAdding(false);
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Notas</span>
        {!adding && (
          <button
            type="button"
            className="adm-add-btn"
            onClick={() => setAdding(true)}
          >
            + Agregar
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="adm-notes-list">
          {items.map(it => (
            <li key={it.id} className="adm-note-item">
              <input
                type="date"
                className="adm-note-item__date"
                value={it.date || ""}
                onChange={e => update(it.id, "date", e.target.value)}
              />
              <input
                type="text"
                className="adm-note-item__text"
                value={it.text || ""}
                placeholder="Nota…"
                onChange={e => update(it.id, "text", e.target.value)}
              />
              <button
                type="button"
                className="adm-note-item__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft adm-inline-draft--keydate">
          <input
            type="date"
            className="adm-inline-draft__date"
            value={draftDate}
            onChange={e => setDraftDate(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className="adm-inline-draft__input"
            placeholder="Escribe la nota…"
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
              if (e.key === "Escape") { setDraftDate(""); setDraftText(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={handleConfirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraftDate(""); setDraftText(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ── Detección de cambios ──────────────────────────────────────────────────────

function hasChanges(activity, local) {
  if ((activity.text        || "")      !== local.text)        return true;
  if ((activity.priority    || "media") !== local.priority)    return true;
  if ((activity.start_date  || "")      !== local.start_date)  return true;
  if ((activity.due_date    || "")      !== local.due_date)    return true;
  if ((activity.description || "")      !== local.description) return true;
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
    priority:           activity.priority           || "media",
    start_date:         activity.start_date         || "",
    due_date:           activity.due_date           || "",
    description:        activity.description        || "",
    assigned_engineers: Array.isArray(activity.assigned_engineers) ? activity.assigned_engineers : [],
    checklist:          Array.isArray(activity.checklist) ? activity.checklist : [],
    notes:              Array.isArray(activity.notes)     ? activity.notes     : [],
    key_dates:          Array.isArray(activity.key_dates) ? activity.key_dates : [],
  });

  const [showConfirm,    setShowConfirm]    = useState(false);
  const [showDelConfirm, setShowDelConfirm] = useState(false);

  const set = (field, val) => setLocal(prev => ({ ...prev, [field]: val }));

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
  const priorityMeta = PRIORITY_META[local.priority] || PRIORITY_META.media;
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
            <PriorityDot value={local.priority} />
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

          {/* ── Fila: Prioridad / Fecha inicio / Fecha fin ── */}
          <div className="adm-row-3">
            <div className="adm-field">
              <label className="adm-label">Prioridad</label>
              <select
                className="adm-select"
                value={local.priority}
                onChange={e => set("priority", e.target.value)}
                style={{ borderColor: priorityMeta.color }}
              >
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
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
