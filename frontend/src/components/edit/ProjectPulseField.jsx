// ProjectPulseField.jsx — Panel "Pulso del proyecto". Reemplaza el textarea
// plano de "Estado actual". Muestra el semáforo del proyecto, chips de datos
// VIVOS calculados de las actividades (avance, bloqueantes, próxima fecha
// clave) y la nota de contexto en una tarjeta cuidada.

import { useState, useEffect, useRef } from "react";
import { projectProgress, visibleActivities, getToday } from "../../utils/formulas";

const PULSE_STATUS = {
  "on-track":        { label: "En curso",        cls: "ok",   icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cls: "warn", icon: "🟠" },
  blocked:           { label: "Bloqueado",       cls: "crit", icon: "🔴" },
  completed:         { label: "Completado",      cls: "ok",   icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cls: "info", icon: "🔵" },
};

export default function ProjectPulseField({ project, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const prevValue = useRef(value);
  useEffect(() => {
    if (!editing && value !== prevValue.current) { setDraft(value); prevValue.current = value; }
  }, [value, editing]);

  const handleEdit   = () => { setDraft(value); setEditing(true); };
  const handleSave   = () => { onChange(draft); setEditing(false); prevValue.current = draft; };
  const handleCancel = () => { setDraft(value); setEditing(false); };

  // ── Datos vivos (derivados, no capturados) ──
  const acts = visibleActivities(project.activities_identified);
  const m    = project.manual_metrics || {};
  const pct  = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
  const blockers = (project.impediments || []).filter(im => im.category === "blocker");
  const risks    = (project.impediments || []).filter(im => im.category === "risk");
  // Próxima fecha clave = due_date más cercana en el futuro entre las actividades.
  const today = getToday();
  const upcoming = acts
    .map(a => a.due_date).filter(d => d && d >= today).sort();
  const nextDate = upcoming[0] || null;
  const fmtShort = (d) => {
    if (!d) return null;
    const [, mo, da] = d.split("-");
    const MM = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${da} ${MM[Number(mo) - 1]}`;
  };
  const st = PULSE_STATUS[project.status] || PULSE_STATUS["on-track"];

  return (
    <div className={`pulse pulse--${st.cls}`}>
      <div className="pulse__head">
        <div className="pulse__status">
          <span className="pulse__icon">{st.icon}</span>
          <div>
            <div className="pulse__status-label">{st.label}</div>
            <div className="pulse__eyebrow">Estado actual del proyecto</div>
          </div>
        </div>
        {!editing && (
          <button type="button" className="pulse__edit" onClick={handleEdit}>
            {value ? "✎ Editar nota" : "+ Agregar nota"}
          </button>
        )}
      </div>

      {/* Chips de datos vivos */}
      <div className="pulse__chips">
        <span className="pulse-chip"><strong className="tabular">{pct}%</strong> avance</span>
        <span className={`pulse-chip ${blockers.length ? "pulse-chip--crit" : ""}`}>
          <strong className="tabular">{blockers.length}</strong> bloqueante{blockers.length !== 1 ? "s" : ""}
        </span>
        {risks.length > 0 && (
          <span className="pulse-chip pulse-chip--warn"><strong className="tabular">{risks.length}</strong> riesgo{risks.length !== 1 ? "s" : ""}</span>
        )}
        {nextDate && <span className="pulse-chip">📅 Próx. hito: <strong>{fmtShort(nextDate)}</strong></span>}
        <span className="pulse-chip">{acts.length} actividad{acts.length !== 1 ? "es" : ""}</span>
      </div>

      {/* Nota de contexto */}
      {editing ? (
        <div className="pulse__edit-wrap">
          <textarea
            className="field__textarea pulse__textarea" rows={5} autoFocus
            placeholder="Contexto de la semana: avances, decisiones, bloqueos, qué necesitas para destrabar…"
            value={draft} onChange={e => setDraft(e.target.value)}
          />
          <div className="pulse__edit-actions">
            <button type="button" className="btn btn--secondary" onClick={handleCancel}>Cancelar</button>
            <button type="button" className="btn btn--brand-solid" onClick={handleSave}>Guardar nota</button>
          </div>
        </div>
      ) : value ? (
        <div className="pulse__note" onClick={handleEdit} title="Clic para editar">
          {value.split("\n").map((line, i) => line.trim()
            ? <p key={i} className="pulse__note-line">{line}</p>
            : <br key={i} />)}
        </div>
      ) : (
        <p className="pulse__empty" onClick={handleEdit}>
          Sin nota de contexto. Los datos de arriba se calculan solos; agrega aquí la narrativa que no se ve en los números.
        </p>
      )}
    </div>
  );
}
