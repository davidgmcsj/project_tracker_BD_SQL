// EngineerTaskModal.jsx — Edición rica de una tarea adicional del ingeniero.
// Análogo a ActivityDetailModal, pero el estado y las fechas de transición viven
// dentro de la propia tarea (task.status / task.history), no en un task_status
// externo del proyecto. Reutiliza las secciones de ActivityFormSections.

import { useState, useRef, useEffect } from "react";
import { normalizeEngineerTask, applyEngineerTaskStatus, suggestedWorkHours, businessDaysBetween } from "../utils/formulas";
import { ChecklistSection, KeyDatesSection, NotesSection, DateBadgesSection } from "./ActivityFormSections";

const STATUS_OPTIONS = [
  { value: "not_started", label: "No iniciada" },
  { value: "in_progress", label: "En proceso"  },
  { value: "completed",   label: "Completada"  },
];

const HOURS_OPTIONS = [0, 0.5, ...Array.from({ length: 40 }, (_, i) => i + 1)];

function closestHoursOption(hours) {
  return HOURS_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - hours) < Math.abs(best - hours) ? opt : best
  , HOURS_OPTIONS[0]);
}

function hasChanges(a, b) {
  const keys = ["description", "status", "detail", "objectives", "solution", "start_date", "due_date"];
  for (const k of keys) if ((a[k] || "") !== (b[k] || "")) return true;
  if ((Number(a.progress)      || 0) !== (Number(b.progress)      || 0)) return true;
  if ((Number(a.planned_hours) || 0) !== (Number(b.planned_hours) || 0)) return true;
  for (const k of ["checklist", "notes", "key_dates"]) {
    if (JSON.stringify(a[k] || []) !== JSON.stringify(b[k] || [])) return true;
  }
  return false;
}

function DiscardConfirmDialog({ onSaveAndClose, onDiscard, onCancel }) {
  return (
    <div className="adm-confirm-overlay">
      <div className="adm-confirm-dialog">
        <p className="adm-confirm-dialog__msg">
          Tienes cambios sin guardar. ¿Qué deseas hacer?
        </p>
        <div className="adm-confirm-dialog__actions">
          <button type="button" className="adm-confirm-btn adm-confirm-btn--cancel"  onClick={onCancel}>Seguir editando</button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--discard" onClick={onDiscard}>Descartar cambios</button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--save"    onClick={onSaveAndClose}>Guardar y cerrar</button>
        </div>
      </div>
    </div>
  );
}

export default function EngineerTaskModal({ task, engineerName, onSave, onClose, onDelete }) {
  const overlayRef = useRef(null);

  const original = normalizeEngineerTask(task);
  const [local, setLocal] = useState(original);
  const [showConfirm,    setShowConfirm]    = useState(false);
  const [showDelConfirm, setShowDelConfirm] = useState(false);

  const set = (field, val) => setLocal(prev => ({ ...prev, [field]: val }));

  // Cambiar el estado auto-registra las fechas de transición (added/in_progress/completed).
  const changeStatus = (val) => setLocal(prev => applyEngineerTaskStatus(prev, val));

  const dirty = hasChanges(original, local);

  const requestClose = () => {
    if (dirty) { setShowConfirm(true); return; }
    onClose();
  };

  const handleSaveAndClose = () => { onSave(local); onClose(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) requestClose();
  };

  // Sugerencias automáticas (mismas que en actividades de proyecto)
  const checklistTotal = local.checklist.length;
  const checklistDone  = local.checklist.filter(it => it.done).length;
  const suggestedProgress = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : null;
  const bizDays   = businessDaysBetween(local.start_date, local.due_date);
  const suggHours = suggestedWorkHours(local.start_date, local.due_date);

  const statusLabel = STATUS_OPTIONS.find(o => o.value === local.status)?.label || "—";
  const statusClass =
    local.status === "completed"   ? "adm-status-pill--completed" :
    local.status === "in_progress" ? "adm-status-pill--inprogress" :
                                     "adm-status-pill--notstarted";

  return (
    <div className="adm-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="adm-panel">

        {showConfirm && (
          <DiscardConfirmDialog
            onSaveAndClose={handleSaveAndClose}
            onDiscard={onClose}
            onCancel={() => setShowConfirm(false)}
          />
        )}

        {/* ── Cabecera ── */}
        <div className="adm-header">
          <div className="adm-header__top">
            <span className="adm-header__project">{engineerName} · Tarea adicional</span>
            <span className={`adm-status-pill ${statusClass}`}>{statusLabel}</span>
            {dirty && <span className="adm-dirty-badge">Sin guardar</span>}
            <div className="adm-header__spacer" />
            <button type="button" className="adm-close-btn" onClick={requestClose} title="Cerrar">✕</button>
          </div>
          <textarea
            className="adm-header__title-input"
            value={local.description}
            onChange={e => {
              set("description", e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onFocus={e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            ref={el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
            rows={1}
            placeholder="Nombre de la tarea…"
          />

          <DateBadgesSection status={local.status} history={local.history} />
        </div>

        <div className="adm-body">

          {/* ── Estado ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">Estado</label>
              <select
                className="adm-select"
                value={local.status}
                onChange={e => changeStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="adm-field" />
          </div>

          {/* ── Fecha inicio / Fecha fin ── */}
          <div className="adm-row-2">
            <div className="adm-field">
              <label className="adm-label">Fecha inicio</label>
              <input type="date" className="adm-input" value={local.start_date} onChange={e => set("start_date", e.target.value)} />
            </div>
            <div className="adm-field">
              <label className="adm-label">Fecha fin</label>
              <input type="date" className="adm-input" value={local.due_date} onChange={e => set("due_date", e.target.value)} />
            </div>
          </div>

          {/* ── % Cumplimiento / Horas planeadas ── */}
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
                  type="range" className="adm-range"
                  min={0} max={100} step={5}
                  value={local.progress}
                  onChange={e => set("progress", Number(e.target.value))}
                />
                <input
                  type="number" className="adm-input adm-input--pct"
                  min={0} max={100}
                  value={local.progress}
                  onChange={e => set("progress", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
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
                  {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h} h</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Objetivos ── */}
          <div className="adm-section">
            <div className="adm-section__header"><span className="adm-section__title">Objetivos</span></div>
            <textarea
              className="adm-textarea" rows={3}
              placeholder="¿Qué se busca cumplir con esta tarea?"
              value={local.objectives}
              onChange={e => set("objectives", e.target.value)}
            />
          </div>

          {/* ── Descripción / Detalle ── */}
          <div className="adm-section">
            <div className="adm-section__header"><span className="adm-section__title">Descripción</span></div>
            <textarea
              className="adm-textarea" rows={3}
              placeholder="Agrega una descripción detallada de la tarea…"
              value={local.detail}
              onChange={e => set("detail", e.target.value)}
            />
          </div>

          {/* ── Solución ── */}
          <div className="adm-section">
            <div className="adm-section__header"><span className="adm-section__title">Solución / Resultado</span></div>
            <textarea
              className="adm-textarea" rows={3}
              placeholder="¿Cómo se resolvió o qué resultado se obtuvo?"
              value={local.solution}
              onChange={e => set("solution", e.target.value)}
            />
          </div>

          {/* ── Subactividades ── */}
          <ChecklistSection items={local.checklist} onChange={v => set("checklist", v)} />

          {/* ── Fechas clave ── */}
          <KeyDatesSection items={local.key_dates} onChange={v => set("key_dates", v)} />

          {/* ── Notas ── */}
          <NotesSection items={local.notes} onChange={v => set("notes", v)} />

        </div>

        {/* ── Pie ── */}
        <div className="adm-footer">
          <div>
            {onDelete && (
              showDelConfirm ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span>¿Eliminar esta tarea?</span>
                  <button type="button" className="adm-confirm-btn adm-confirm-btn--cancel" onClick={() => setShowDelConfirm(false)}>No</button>
                  <button type="button" className="adm-confirm-btn adm-confirm-btn--discard" onClick={() => { onDelete(); onClose(); }}>Sí, eliminar</button>
                </span>
              ) : (
                <button type="button" className="btn btn--danger" onClick={() => setShowDelConfirm(true)}>🗑 Eliminar tarea</button>
              )
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn--secondary" onClick={requestClose}>Cancelar</button>
            <button type="button" className="btn btn--accent" onClick={handleSaveAndClose}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
