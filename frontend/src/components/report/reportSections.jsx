// reportSections.jsx — Sub-secciones del reporte de un proyecto individual
// (bullets, impedimentos, hitos, comentarios, estado de tareas, tarjeta de
// ingeniero). Todas devuelven null cuando no hay datos que mostrar.

import { activityText, activityLabel, engineerName } from "../../utils/formulas";
import { FIELD_CONFIG, IMPEDIMENT_UI, fmtDate, toLines, groupByActivity } from "./reportShared";

export function BulletSection({ fieldKey, value }) {
  const lines = toLines(value);
  if (!lines.length) return null;
  const cfg        = FIELD_CONFIG[fieldKey] || { label: fieldKey, icon: "•", variant: "gray" };
  const isNumbered = fieldKey === "activities_identified";

  return (
    <div className={`rpt-section rpt-section--${cfg.variant}`}>
      <div className="rpt-section__header">
        <span className="rpt-section__icon">{cfg.icon}</span>
        <span className="rpt-section__label">{cfg.label}</span>
        <span className="rpt-section__count">{lines.length}</span>
      </div>
      {isNumbered ? (
        <ol className="rpt-bullets rpt-bullets--numbered">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item rpt-bullets__item--numbered">{line}</li>)}
        </ol>
      ) : (
        <ul className="rpt-bullets">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ImpedimentSection({ impediments }) {
  if (!impediments?.length) return null;
  const byCategory = {};
  impediments.forEach(im => { (byCategory[im.category] ||= []).push(im); });

  return (
    <>
      {Object.entries(byCategory).map(([cat, items]) => {
        const cfg = IMPEDIMENT_UI[cat] || { label: cat, icon: "⚠️", variant: "red-soft" };
        return (
          <div key={cat} className={`rpt-section rpt-section--${cfg.variant}`}>
            <div className="rpt-section__header">
              <span className="rpt-section__icon">{cfg.icon}</span>
              <span className="rpt-section__label">{cfg.label}</span>
              <span className="rpt-section__count">{items.length}</span>
            </div>
            <ul className="rpt-bullets">
              {items.map((im, i) => (
                <li key={i} className="rpt-bullets__item">
                  {im.description}
                  {im.impact && (
                    <span style={{ display: "block", marginLeft: 16, fontSize: "12px", color: "var(--text-2)", marginTop: 2 }}>
                      → Impacto: {im.impact}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function MilestoneSection({ milestones, activitiesIndex }) {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  const validItems = milestones.filter(m => m.date || m.note);
  if (!validItems.length) return null;
  const groups = groupByActivity(validItems);

  return (
    <div className="rpt-section rpt-section--teal rpt-section--full">
      <div className="rpt-section__header">
        <span className="rpt-section__icon">📅</span>
        <span className="rpt-section__label">Fechas Clave</span>
        <span className="rpt-section__count">{validItems.length}</span>
      </div>
      <div className="milestone-report">
        {groups.map(([actKey, items]) => (
          <div key={actKey} className="milestone-report__group">
            {actKey !== "__sin__" && <div className="milestone-report__act">{activityLabel(activitiesIndex, actKey)}</div>}
            {items.map((m, i) => (
              <div key={i} className="milestone-report__row">
                {m.date && <span className="milestone-report__date">{fmtDate(m.date)}</span>}
                {m.note && <span className="milestone-report__note">{m.note}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommentSection({ comments, activitiesIndex }) {
  if (!Array.isArray(comments) || !comments.length) return null;
  const validItems = comments.filter(c => c.text);
  if (!validItems.length) return null;
  const groups = groupByActivity(validItems);

  return (
    <div className="rpt-section rpt-section--gray rpt-section--full">
      <div className="rpt-section__header">
        <span className="rpt-section__icon">💬</span>
        <span className="rpt-section__label">Comentarios</span>
        <span className="rpt-section__count">{validItems.length}</span>
      </div>
      <div className="milestone-report">
        {groups.map(([actKey, items]) => (
          <div key={actKey} className="milestone-report__group">
            {actKey !== "__sin__" && <div className="milestone-report__act">{activityLabel(activitiesIndex, actKey)}</div>}
            {items.map((c, i) => (
              <div key={i} className="milestone-report__row">
                {c.date && <span className="milestone-report__date">{fmtDate(c.date)}</span>}
                <span className="milestone-report__note">{c.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskStatusSection({ taskStatus, activitiesIndex }) {
  if (!taskStatus || typeof taskStatus !== "object") return null;
  const done = (taskStatus.completed   || []).filter(Boolean);
  const wip  = (taskStatus.in_progress || []).filter(Boolean);
  const not  = (taskStatus.not_started || []).filter(Boolean);
  if (!done.length && !wip.length && !not.length) return null;

  const cols = [
    { items: done, label: "Completadas",  icon: "✅", variant: "green" },
    { items: wip,  label: "En proceso",   icon: "🔄", variant: "amber" },
    { items: not,  label: "No iniciadas", icon: "○",  variant: "gray"  },
  ].filter(c => c.items.length > 0);

  return (
    <div className="rpt-task-status">
      {cols.map(col => (
        <div key={col.label} className={`rpt-section rpt-section--${col.variant}`}>
          <div className="rpt-section__header">
            <span className="rpt-section__icon">{col.icon}</span>
            <span className="rpt-section__label">{col.label}</span>
            <span className="rpt-section__count">{col.items.length}</span>
          </div>
          <ul className="rpt-bullets">
            {col.items.map((id) => <li key={id} className="rpt-bullets__item">{activityText(activitiesIndex, id)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function EngineerWeekCard({ eng, activitiesIndex, engineerIndex }) {
  const name  = eng.engineer_id ? engineerName(engineerIndex, eng.engineer_id) : "—";
  const lines = toLines(eng.weekly_detail).map(id => activityText(activitiesIndex, id));
  if (!eng.weekly_total && !lines.length) return null;

  return (
    <div className="rpt-eng-card">
      <div className="rpt-eng-card__header">
        <span className="rpt-eng-card__name">{name}</span>
        {eng.weekly_total > 0 && (
          <span className="rpt-eng-card__badge">{eng.weekly_total} tarea{eng.weekly_total !== 1 ? "s" : ""}</span>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="rpt-bullets rpt-bullets--compact">
          {lines.map((line, i) => <li key={i} className="rpt-bullets__item">{line}</li>)}
        </ul>
      )}
    </div>
  );
}
