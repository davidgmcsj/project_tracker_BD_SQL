// reportShared.js — Constantes y helpers usados por varias piezas del reporte
// (ReportView, ProjectReport y las secciones de reportSections.jsx).

export const STATUS = {
  "on-track":        { label: "En curso",        cssClass: "on-track",        icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cssClass: "at-risk",         icon: "🟠" },
  blocked:           { label: "Bloqueado",       cssClass: "blocked",         icon: "🔴" },
  completed:         { label: "Completado",      cssClass: "completed",       icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cssClass: "mejora-continua", icon: "🔵" },
};

export const IMPEDIMENT_UI = {
  blocker:        { label: "Bloqueantes",          icon: "🚫", variant: "red"      },
  risk:           { label: "Riesgos",              icon: "🔶", variant: "amber"    },
  non_conformity: { label: "Salidas no conformes", icon: "⚠️", variant: "red-soft" },
};

export const FIELD_CONFIG = {
  activities_identified: { label: "Actividades Identificadas",   icon: "📋", variant: "blue"  },
  weekly_achievements:   { label: "Qué se hizo esta semana",     icon: "✅", variant: "green" },
  next_week_plan:        { label: "Plan para la próxima semana", icon: "→",  variant: "blue"  },
};

export const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function fmtDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

export function toLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split("\n").map(l => l.trim()).filter(Boolean);
}

export function groupByActivity(items) {
  const grouped = {};
  items.forEach((item, i) => {
    const key = item.activity || "__sin__";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...item, _idx: i });
  });
  return Object.entries(grouped);
}
