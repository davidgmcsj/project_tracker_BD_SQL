// shared.js — Constantes y helpers usados por ActivityDetailModal y sus
// piezas (AttachmentsSection, DiscardConfirmDialog).

import { ESTADOS_ACTIVIDAD_OPERACIONAL } from "../../utils/filtroOpciones";

// Fuente única del vocabulario de estados (utils/filtroOpciones.js).
export const STATUS_OPTIONS = ESTADOS_ACTIVIDAD_OPERACIONAL;

// Lista de horas planeadas: 0 (sin definir), 0.5, y luego de 1 en 1 hasta 40.
export const HOURS_OPTIONS = [0, 0.5, ...Array.from({ length: 40 }, (_, i) => i + 1)];

// Redondea un número de horas a la opción más cercana disponible en HOURS_OPTIONS.
export function closestHoursOption(hours) {
  return HOURS_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - hours) < Math.abs(best - hours) ? opt : best
  , HOURS_OPTIONS[0]);
}

export function getActivityStatus(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  if ((taskStatus.not_started || []).includes(actId)) return "not_started";
  return "not_started";
}

export function formatBytes(n) {
  if (!n) return "0 B";
  const k = 1024, units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function fileIcon(mime = "", name = "") {
  const m = (mime || "").toLowerCase();
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (m.startsWith("image/")) return "🖼️";
  if (m === "application/pdf" || ext === "pdf") return "📕";
  if (m.includes("word") || ["doc", "docx"].includes(ext)) return "📘";
  if (m.includes("sheet") || m.includes("excel") || ["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (m.includes("zip") || ["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

// progressOverride: cuando la actividad tiene subtareas, el % real a
// comparar/guardar es el calculado (computedProgress en ActivityDetailModal),
// no local.progress — ver displayProgress ahí. Sin override, compara
// local.progress como siempre.
// originalStatus: el estado vive en task_status, no en la actividad — se
// pasa aparte (getActivityStatus(taskStatus, activity.id) en el caller).
export function hasChanges(activity, local, originalHistory, progressOverride, originalStatus) {
  if ((activity.text        || "")      !== local.text)        return true;
  if ((activity.parent_id   ?? null)    !== (local.parent_id ?? null)) return true;
  if (originalStatus !== undefined && originalStatus !== local.status) return true;
  if ((activity.start_date  || "")      !== local.start_date)  return true;
  if ((activity.due_date    || "")      !== local.due_date)    return true;
  if ((activity.description || "")      !== local.description) return true;
  if ((activity.objectives  || "")      !== local.objectives)  return true;
  if ((activity.solution    || "")      !== local.solution)    return true;
  const effectiveProgress = progressOverride !== undefined ? progressOverride : local.progress;
  if ((Number(activity.progress)      || 0) !== effectiveProgress)  return true;
  if ((Number(activity.planned_hours) || 0) !== local.planned_hours) return true;
  if (JSON.stringify(activity.assigned_engineers || []) !== JSON.stringify(local.assigned_engineers)) return true;
  if (JSON.stringify(activity.notes      || []) !== JSON.stringify(local.notes))      return true;
  if (JSON.stringify(activity.key_dates  || []) !== JSON.stringify(local.key_dates))  return true;
  const oh = originalHistory || {};
  if ((oh.added || "") !== local.history.added)             return true;
  if ((oh.in_progress || "") !== local.history.in_progress) return true;
  if ((oh.completed || "") !== local.history.completed)     return true;
  return false;
}
