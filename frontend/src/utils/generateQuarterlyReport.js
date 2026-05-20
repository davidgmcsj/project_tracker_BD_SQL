// generateQuarterlyReport.js — Rellena la plantilla DOCX institucional con datos del proyecto.
//
// Estrategia: lee la plantilla como ZIP, extrae word/document.xml,
// reemplaza los marcadores [texto] con los datos reales, reempaqueta y descarga.
// Esto preserva 100% el formato, fuentes y estilos institucionales de la plantilla.

import JSZip from "jszip";
import { projectProgress } from "./formulas";

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto",
                "septiembre","octubre","noviembre","diciembre"];
const MONTHS_CAP = MONTHS.map(m => m.charAt(0).toUpperCase() + m.slice(1));

function fmtDateLong(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

function getQuarterLabel(dateStr) {
  if (!dateStr) return "[Trimestre]";
  const m = parseInt(dateStr.split("-")[1], 10);
  const y = parseInt(dateStr.split("-")[0], 10);
  const q = Math.ceil(m / 3);
  const names = ["Primer", "Segundo", "Tercer", "Cuarto"];
  return `${names[q - 1]} trimestre ${y}`;
}

function toLines(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

function getStatusLabel(status) {
  const map = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado" };
  return map[status] || status || "—";
}

function getCumplimiento(pct) {
  if (pct >= 80) return "Alto";
  if (pct >= 50) return "Medio";
  return "Bajo";
}

function getMainEngineer(engineers) {
  if (!engineers?.length) return "Equipo del proyecto";
  const e = engineers[0];
  return e.engineer_id === "Otro..." ? (e.custom_name || "—") : (e.engineer_id || "—");
}

function nextMonthLabel(dateStr) {
  const base = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  return `${MONTHS_CAP[next.getMonth()]} ${next.getFullYear()}`;
}

// ── Construye el mapa de reemplazos a partir del proyecto ────────────────────

function buildReplacements(project) {
  const m       = project.manual_metrics || {};
  const total   = Number(m.total_tasks        || 0);
  const done    = Number(m.completed_tasks    || 0);
  const wip     = Number(m.in_progress_tasks  || 0);
  const pending = Math.max(0, total - done - wip);
  const pct     = Math.round(projectProgress(total, done, wip));

  const date        = project.report_date || new Date().toISOString().slice(0, 10);
  const responsible = getMainEngineer(project.engineers);
  const status      = getStatusLabel(project.status);

  const achievements  = toLines(project.weekly_achievements);
  const activities    = toLines(project.activities_identified);
  const nextPlan      = toLines(project.next_week_plan);
  const blockers      = (project.impediments || []).filter(i => i.category === "blocker");
  const risks         = (project.impediments || []).filter(i => i.category === "risk");
  const nonConf       = (project.impediments || []).filter(i => i.category === "non_conformity");
  const allImpediments = [...blockers, ...risks];

  const ts         = project.task_status || {};
  const notStarted = (ts.not_started || []).filter(Boolean);

  const indicadores = project.indicators?.length
    ? project.indicators.map(ind => {
        const ip = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
        return `${ind.name || "Indicador"}: ${ip}% (${ind.completed}/${ind.total} completadas)`;
      }).join(". ")
    : `Avance general: ${pct}% (${done} de ${total} actividades completadas, ${wip} en proceso)`;

  // ── Sección 1 ──────────────────────────────────────────────────────────────

  const introText = `Durante el periodo evaluado, el proyecto ${project.project_name || "—"} desarrolló las actividades planificadas conforme a los objetivos establecidos. Estado actual: ${status}. Al corte del ${fmtDateLong(date)}, el avance es del ${pct}%, con ${done} actividades completadas de ${total} programadas.`;

  const resultado1 = `Cumplimiento del ${pct}% de las actividades programadas: ${done} completadas, ${wip} en proceso${pending > 0 ? `, ${pending} no iniciadas` : ""}.`;
  const resultado2 = activities.length
    ? `${activities.length} actividades identificadas para el periodo de ejecución.`
    : `Avance consolidado en las fases de desarrollo e implementación del proyecto.`;
  const resultado3 = blockers.length === 0 && risks.length === 0
    ? "Sin bloqueantes ni riesgos activos registrados en el periodo."
    : `${allImpediments.length} impedimento(s) identificado(s): ${allImpediments.map(i => i.description).join("; ")}.`;

  const logro1 = achievements[0] || (notStarted.length ? `Avance del ${pct}% en actividades planificadas.` : `Completadas ${done} de ${total} actividades programadas.`);
  const logro2 = achievements[1] || (activities[0] ? `Ejecución de: ${activities[0]}.` : "Mantenimiento del ritmo de ejecución del equipo.");
  const logro3 = achievements[2] || (nextPlan[0] ? `Plan definido: ${nextPlan[0]}.` : "Seguimiento continuo de hitos y fechas clave del proyecto.");

  const dificultad1 = blockers[0]?.description || (pending > 0
    ? `${pending} actividades no iniciadas pendientes de ejecución.`
    : "No se registraron dificultades significativas en el periodo.");
  const dificultad2 = risks[0]?.description || (blockers[1]?.description) || "Se mantiene monitoreo preventivo sobre posibles dependencias externas.";

  // ── Sección 2 ──────────────────────────────────────────────────────────────

  const analisisGeneral1 = `El proyecto registra un avance del ${pct}% en el cumplimiento de actividades, con ${done} de ${total} tareas completadas${wip > 0 ? ` y ${wip} en proceso` : ""}.`;
  const analisisGeneral2 = pending > 0
    ? `Quedan ${pending} actividades no iniciadas que requieren atención en el siguiente periodo.`
    : "El avance es consistente con los objetivos del periodo. No hay actividades críticas sin iniciar.";
  const analisisGeneral3 = nextPlan.length
    ? `El equipo tiene plan de trabajo definido para las próximas actividades: ${nextPlan.slice(0, 2).join("; ")}.`
    : "Se recomienda definir el plan de trabajo para el siguiente periodo.";

  // ── Sección 3 ──────────────────────────────────────────────────────────────

  const riesgo1Nombre = allImpediments[0]?.description || "No se identificaron riesgos relevantes en el periodo.";
  const riesgo1Control = allImpediments[0]?.impact
    ? `Impacto: ${allImpediments[0].impact}. En gestión por el equipo del proyecto.`
    : "En gestión. Se aplican controles preventivos y seguimiento semanal.";
  const riesgo2Nombre = allImpediments[1]?.description || "Sin riesgos adicionales identificados.";
  const riesgo2Control = allImpediments[1]?.impact
    ? `Impacto: ${allImpediments[1].impact}. En gestión por el equipo del proyecto.`
    : "Se mantiene monitoreo de posibles riesgos emergentes.";

  const analisisRiesgos1 = allImpediments.length > 0
    ? `Los riesgos identificados (${allImpediments.length}) tienen impacto directo en los hitos del proyecto y requieren monitoreo continuo.`
    : "Los controles actuales son efectivos. No se han materializado riesgos significativos en el periodo.";
  const analisisRiesgos2 = allImpediments.length > 0
    ? `Se evidencia la necesidad de definir planes de contingencia para los riesgos identificados.`
    : "Se recomienda mantener el monitoreo preventivo de riesgos potenciales.";
  const analisisRiesgos3 = "Se recomienda monitoreo continuo y seguimiento semanal para verificar la efectividad de los controles implementados.";

  // ── Sección 4 ──────────────────────────────────────────────────────────────

  const salidaIntro = nonConf.length > 0
    ? `Durante el periodo se identificaron ${nonConf.length} salida(s) no conforme(s) en el proceso.`
    : "Durante el periodo evaluado no se registraron salidas no conformes formales en el proceso.";
  const noConformidad1 = nonConf[0]?.description || "No se registraron no conformidades formales.";
  const noConformidad2 = nonConf[0]?.impact || (pending > 0
    ? `${pending} actividades no iniciadas que representan el ${Math.round((pending/total)*100)}% del total programado.`
    : "Sin salidas no conformes adicionales identificadas.");
  const accion1 = nextPlan[0] || "Priorización de actividades pendientes en el cronograma del proyecto.";
  const accion2 = nextPlan[1] || "Ajuste en la planificación de las fases en ejecución para garantizar el cierre oportuno.";
  const causaPrincipal = blockers.length > 0
    ? `La causa principal está asociada a: ${blockers[0].description}.`
    : "No se evidencia causa estructural recurrente. Las desviaciones son puntuales y gestionables.";
  const reincidencia = "No se evidencia reincidencia estructural en el periodo evaluado.";
  const efectividad = "Las acciones implementadas requieren seguimiento para validar su efectividad en el siguiente periodo.";

  // ── Sección 5 ──────────────────────────────────────────────────────────────

  const accionMejora1 = nextPlan[0] || "Completar actividades identificadas y pendientes del periodo.";
  const accionMejora2 = nextPlan[1] || "Ejecutar pruebas y validación funcional con usuarios.";
  const accionMejora3 = nextPlan[2] || "Actualizar cronograma y definir hitos del siguiente trimestre.";
  const fechaMejora   = nextMonthLabel(date);
  const enfoqueplan1  = `Fortalecimiento de las actividades de ejecución y aseguramiento de calidad del ${project.project_name || "proyecto"}.`;
  const enfoqueplan2  = "Mejora en el cumplimiento del cronograma y cierre de actividades no iniciadas.";
  const enfoqueplan3  = allImpediments.length > 0
    ? `Mitigación de los ${allImpediments.length} riesgo(s) identificado(s) y resolución de dependencias externas.`
    : "Mitigación de riesgos potenciales y consolidación de los entregables del periodo.";

  // ── Sección 6 ──────────────────────────────────────────────────────────────

  const conclusion1 = `El proyecto ${project.project_name || "—"} presenta un avance del ${pct}% al cierre del periodo, con ${done} de ${total} actividades completadas.`;
  const conclusion2 = "La base funcional del proyecto se encuentra en proceso de consolidación conforme al plan de trabajo establecido.";
  const conclusion3 = notStarted[0] || (nextPlan[0] ? `Ejecutar: ${nextPlan[0]}.` : "Completar las actividades pendientes del periodo.");
  const conclusion4 = notStarted[1] || (nextPlan[1] ? `Avanzar en: ${nextPlan[1]}.` : "Ejecutar pruebas y validación funcional con usuarios.");
  const conclusion5 = notStarted[2] || "Garantizar la validación funcional con usuarios y áreas involucradas.";
  const conclusion6 = nextPlan.length
    ? `El enfoque del siguiente periodo deberá centrarse en: ${nextPlan.slice(0, 2).join(" y ")}.`
    : "El enfoque del siguiente periodo deberá centrarse en el cierre de actividades y preparación para la siguiente fase.";

  // ── Mapa final de reemplazos ──────────────────────────────────────────────
  // Cada entrada: [marcador_en_plantilla, valor_a_insertar]

  return [
    // Metadatos
    ["[Mes/Año o rango de fechas]",                     getQuarterLabel(date)],
    ["[Nombre del proceso ]",                           project.project_name || "—"],
    ["[Nombre del\nproceso]",                           project.project_name || "—"],
    ["proceso",                                         project.project_name || "—"],  // split en XML
    ["[Nombre]",                                        responsible],
    ["[Fecha de elaboración]",                          fmtDateLong(date)],

    // Sección 1
    ["Durante el periodo evaluado, el área/proceso desarrolló las actividades planificadas conforme a los objetivos establecidos.",
      introText],
    ["[Resultado 1: Ej. Cumplimiento del X% de las actividades programadas] ",  resultado1],
    ["[Resultado 2] ",                                  resultado2],
    ["[Resultado 3] ",                                  resultado3],
    ["[Logro relevante] ",                              logro1],
    ["[Avance significativo] ",                         logro2],
    ["[Situación o limitación] ",                       dificultad1],
    ["[Impacto generado] ",                             dificultad2],

    // Sección 2 — tabla
    ["[Nombre]",                                        `Cumplimiento de actividades — ${project.project_name || "Proyecto"}`],
    ["[%]",                                             "100%"],        // Meta (primera aparición)
    ["[%]",                                             `${pct}%`],     // Resultado (segunda)
    ["Alto/Medio/Bajo",                                 getCumplimiento(pct)],
    ["[Breve interpretación]",                          indicadores],

    // Análisis general sección 2
    ["[Interpretación de resultados] ",                 analisisGeneral1],
    ["[Tendencias observadas] ",                        analisisGeneral2],
    ["[Causas de cumplimiento o incumplimiento] ",      analisisGeneral3],

    // Sección 3
    ["[Riesgo 1]: [Estado / Control / Impacto] ",       `${riesgo1Nombre} — Estado: Activo — ${riesgo1Control}`],
    ["[Riesgo 2] ",                                     `${riesgo2Nombre} — ${riesgo2Control}`],
    ["[Evaluación de la efectividad de los controles] ", analisisRiesgos1],
    ["[Cambios en probabilidad o impacto] ",            analisisRiesgos2],
    ["[Nuevos riesgos identificados, si aplica] ",      analisisRiesgos3],

    // Sección 4
    ["Durante el periodo se identificaron las siguientes salidas no conformes:",
      salidaIntro],
    ["[Descripción breve de la no conformidad] ",       noConformidad1],
    ["[Cantidad o frecuencia] ",                        noConformidad2],
    ["[Correcciones realizadas] ",                      accion1],
    ["[Acciones correctivas implementadas] ",           accion2],
    ["[Causas principales] ",                           causaPrincipal],
    ["[Reincidencia o no] ",                            reincidencia],
    ["[Efectividad de las acciones] ",                  efectividad],

    // Sección 5 — tabla
    ["[Acción 1]",                                      accionMejora1],
    ["[Nombre]",                                        responsible],
    ["[Fecha]",                                         fechaMejora],
    ["Pendiente/En proceso",                            "Iniciada"],
    ["[Acción 2]",                                      accionMejora2],

    // Enfoque del plan
    ["Fortalecimiento de [aspecto] ",                   enfoqueplan1],
    ["Mejora en [proceso/indicador] ",                  enfoqueplan2],
    ["Mitigación de [riesgo o causa raíz] ",            enfoqueplan3],

    // Sección 6
    ["[Conclusión general sobre el desempeño] ",        conclusion1],
    ["[Nivel de cumplimiento de objetivos] ",           conclusion2],
    ["[Aspectos a priorizar en el siguiente periodo]",  `${conclusion3} ${conclusion4} ${conclusion5} ${conclusion6}`],
  ];
}

// ── Aplica reemplazos sobre el XML ────────────────────────────────────────────
// El XML de Word puede partir un texto visible en múltiples <w:t> por las revisiones.
// Para los marcadores simples basta reemplazar el texto directamente en el XML string.

function applyReplacements(xml, replacements) {
  let result = xml;
  const notFound = [];
  for (const [marker, value] of replacements) {
    if (result.includes(marker)) {
      result = result.replace(marker, value);
    } else {
      notFound.push(marker.slice(0, 60));
    }
  }
  if (notFound.length) {
    console.warn("[Informe] Marcadores no encontrados:", notFound);
  }
  return result;
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function generateQuarterlyReport(project) {
  // 1. Cargar la plantilla DOCX como ArrayBuffer
  const templatePath = "/templates/MODELO INFORME DE GESTIÓN.docx";
  const response = await fetch(templatePath);
  if (!response.ok) throw new Error(`No se pudo cargar la plantilla: ${response.status}`);
  const templateBuffer = await response.arrayBuffer();

  // 2. Desempaquetar como ZIP
  const zip = await JSZip.loadAsync(templateBuffer);

  // 3. Leer y modificar word/document.xml
  const docXmlRaw = await zip.file("word/document.xml").async("string");
  const replacements = buildReplacements(project);
  const docXmlNew = applyReplacements(docXmlRaw, replacements);

  // 4. Reemplazar el archivo modificado en el ZIP
  zip.file("word/document.xml", docXmlNew);

  // 5. Generar el nuevo DOCX y descargarlo
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });

  const safeName = (project.project_name || "proyecto")
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ \-_]/g, "").trim();
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = `Informe de Gestion - ${safeName}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
