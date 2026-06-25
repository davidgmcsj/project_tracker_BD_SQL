// generateQuarterlyReport.js — Rellena la plantilla DOCX institucional con análisis generado por IA.
//
// Flujo:
//   1. Llama al backend /api/generate-report con los datos del proyecto
//   2. Gemini AI analiza y redacta las 6 secciones del informe
//   3. El JSON devuelto se inserta en los marcadores del document.xml de la plantilla
//   4. Se reempaqueta y descarga el .docx con formato institucional intacto

import JSZip from "jszip";

const MONTHS     = ["enero","febrero","marzo","abril","mayo","junio","julio",
                    "agosto","septiembre","octubre","noviembre","diciembre"];
const MONTHS_CAP = MONTHS.map(m => m.charAt(0).toUpperCase() + m.slice(1));
const API_BASE   = import.meta.env.VITE_API_URL || "";

function fmtDateLong(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

function getQuarterLabel(dateStr) {
  if (!dateStr) return "";
  const m = parseInt(dateStr.split("-")[1], 10);
  const y = parseInt(dateStr.split("-")[0], 10);
  const names = ["Primer", "Segundo", "Tercer", "Cuarto"];
  return `${names[Math.ceil(m / 3) - 1]} trimestre ${y}`;
}

function resolveEngineerName(engineerId, catalog) {
  if (!engineerId) return "—";
  if (engineerId === "Otro...") return "—";
  const found = (catalog || []).find(e => e.id === engineerId);
  return found ? found.name : engineerId;
}

function getMainEngineer(projectEngineers, catalog) {
  if (!projectEngineers?.length) return "Equipo del proyecto";
  const e = projectEngineers[0];
  if (e.engineer_id === "Otro...") return e.custom_name || "—";
  return resolveEngineerName(e.engineer_id, catalog);
}

function nextMonthLabel(dateStr) {
  const base = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  return `${MONTHS_CAP[next.getMonth()]} ${next.getFullYear()}`;
}

// ── Convierte el JSON de la IA en el mapa de reemplazos para la plantilla ────

function buildReplacements(project, analysis, catalog) {
  const date             = project.report_date || new Date().toISOString().slice(0, 10);
  const responsible      = getMainEngineer(project.engineers, catalog);
  const projectDisplayName = (project.project_name || "").replace(/^PRO-\d+[-:\s]*/i, "").trim() || project.project_name || "—";
  const allEngineers     = (project.engineers || [])
    .map(e => e.engineer_id === "Otro..." ? (e.custom_name || "") : resolveEngineerName(e.engineer_id, catalog))
    .filter(Boolean)
    .join(", ") || responsible;
  const quarterLabel = getQuarterLabel(date);

  const s1 = analysis.seccion1 || {};
  const s2 = analysis.seccion2 || {};
  const s3 = analysis.seccion3 || {};
  const s4 = analysis.seccion4 || {};
  const s5 = analysis.seccion5 || {};
  const s6 = analysis.seccion6 || {};

  const res  = s1.principales_resultados || [];
  const log  = s1.logros_destacados || [];
  const dif  = s1.dificultades || [];
  const ag   = s2.analisis_general || [];
  const ar   = s3.analisis || [];
  const a4   = s4.analisis || [];
  const sit  = s4.situaciones || [];
  const acc4 = s4.acciones || [];
  const enf  = s5.enfoque || [];
  const conc = s6.conclusiones || [];
  const prio = s6.prioritario || [];

  // Indicadores: usa los de la IA o genera uno genérico
  const indRows = (s2.indicadores || []);
  // Primera fila de indicador en la plantilla tiene marcadores [Nombre], [%], [%], Alto/Medio/Bajo, [Breve interpretación]
  const ind0 = indRows[0] || { nombre: "Avance del proyecto", meta: "100%", resultado: "—", cumplimiento: "—", analisis: "Ver datos del proyecto." };

  // Riesgos: primera y segunda entrada
  const r0 = (s3.riesgos || [])[0] || { nombre: "Sin riesgos registrados", estado: "—", impacto: "—", control: "—" };
  const r1 = (s3.riesgos || [])[1] || { nombre: "Sin riesgos adicionales", estado: "—", impacto: "—", control: "—" };

  // Acciones plan de mejoramiento
  const acc0 = (s5.acciones || [])[0] || { accion: "Completar actividades pendientes", responsable: responsible, fecha: nextMonthLabel(date), estado: "Iniciada" };
  const acc1 = (s5.acciones || [])[1] || { accion: "Ejecutar pruebas y validación", responsable: responsible, fecha: nextMonthLabel(date), estado: "Pendiente" };

  return [
    // ── Metadatos ──────────────────────────────────────────────────────────
    ["[Mes/Año o rango de fechas]",       quarterLabel],
    ["[Nombre del proceso ]",             projectDisplayName],
    ["proceso",                           projectDisplayName],
    ["[Nombre]",                          allEngineers],
    ["[Fecha de elaboración]",            fmtDateLong(date)],

    // ── Sección 1 ──────────────────────────────────────────────────────────
    ["Durante el periodo evaluado, el área/proceso desarrolló las actividades planificadas conforme a los objetivos establecidos.",
      s1.intro || "Durante el periodo evaluado se desarrollaron las actividades planificadas conforme a los objetivos establecidos."],

    ["[Resultado 1: Ej. Cumplimiento del X% de las actividades programadas] ", res[0] || "Ver métricas del proyecto."],
    ["[Resultado 2] ",   res[1] || ""],
    ["[Resultado 3] ",   res[2] || ""],

    ["[Logro relevante] ",      log[0] || ""],
    ["[Avance significativo] ", log[1] || ""],

    ["[Situación o limitación] ", dif[0] || "No se registraron dificultades significativas."],
    ["[Impacto generado] ",       dif[1] || ""],

    // ── Sección 2 — tabla indicadores ──────────────────────────────────────
    ["[Nombre]",              ind0.nombre],
    ["[%]",                   ind0.meta],
    ["[%]",                   ind0.resultado],
    ["Alto/Medio/Bajo",       ind0.cumplimiento],
    ["[Breve interpretación]", ind0.analisis],

    // Análisis general
    ["[Interpretación de resultados] ", ag[0] || ""],
    ["[Tendencias observadas] ",        ag[1] || ""],
    ["[Causas de cumplimiento o incumplimiento] ", ag[2] || ""],

    // ── Sección 3 — riesgos ────────────────────────────────────────────────
    ["[Riesgo 1]: [Estado / Control / Impacto] ",
      `${r0.nombre} — Estado: ${r0.estado} — Impacto: ${r0.impacto} — Control: ${r0.control}`],
    ["[Riesgo 2] ",
      `${r1.nombre} — Estado: ${r1.estado} — Impacto: ${r1.impacto} — Control: ${r1.control}`],

    ["[Evaluación de la efectividad de los controles] ", ar[0] || ""],
    ["[Cambios en probabilidad o impacto] ",             ar[1] || ""],
    ["[Nuevos riesgos identificados, si aplica] ",       ar[2] || ""],

    // ── Sección 4 ──────────────────────────────────────────────────────────
    ["Durante el periodo se identificaron las siguientes salidas no conformes:",
      "No se presentaron salidas no conformes en este trimestre."],

    ["[Descripción breve de la no conformidad] ", "No aplica."],
    ["[Cantidad o frecuencia] ",                  "No aplica."],

    ["[Correcciones realizadas] ",            "No aplica."],
    ["[Acciones correctivas implementadas] ", "No aplica."],

    ["[Causas principales] ",          "No aplica."],
    ["[Reincidencia o no] ",           "No aplica."],
    ["[Efectividad de las acciones] ", "No aplica."],

    // ── Sección 5 — tabla plan de mejoramiento ─────────────────────────────
    ["[Acción 1]",         acc0.accion],
    ["[Nombre]",           acc0.responsable || responsible],
    ["[Fecha]",            acc0.fecha || nextMonthLabel(date)],
    ["Pendiente/En proceso", acc0.estado || "Iniciada"],
    ["[Acción 2]",         acc1.accion],

    // Enfoque del plan
    ["Fortalecimiento de [aspecto] ", enf[0] || ""],
    ["Mejora en [proceso/indicador] ", enf[1] || ""],
    ["Mitigación de [riesgo o causa raíz] ", enf[2] || ""],

    // ── Sección 6 ──────────────────────────────────────────────────────────
    ["[Conclusión general sobre el desempeño] ", conc[0] || ""],
    ["[Nivel de cumplimiento de objetivos] ",    conc[1] || ""],
    ["[Aspectos a priorizar en el siguiente periodo]",
      [...prio, s6.enfoque_siguiente || ""].filter(Boolean).join(" ")],

    // ── Firma ──────────────────────────────────────────────────────────────
    ["Firma del líder de cada proceso", "Emirt Lorenzo Adams Saenz"],
  ];
}

// ── Aplica reemplazos sobre el XML ────────────────────────────────────────────

function applyReplacements(xml, replacements) {
  let result = xml;
  for (const [marker, value] of replacements) {
    if (result.includes(marker)) {
      result = result.replace(marker, String(value ?? ""));
    }
  }
  return result;
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function generateQuarterlyReport(project, engineerCatalog = [], signal = null) {
  const date         = project.report_date || new Date().toISOString().slice(0, 10);
  const quarterLabel = getQuarterLabel(date);

  // 1. Llamar al backend para que Gemini genere el análisis
  let analysis;
  try {
    const res = await fetch(`${API_BASE}/api/generate-report`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ project, quarterLabel }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    analysis   = data.analysis;
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(`Error al generar análisis con IA: ${e.message}`);
  }

  // 2. Cargar la plantilla DOCX
  const templatePath = "/templates/MODELO INFORME DE GESTIÓN.docx";
  const response = await fetch(templatePath);
  if (!response.ok) throw new Error(`No se pudo cargar la plantilla: ${response.status}`);
  const templateBuffer = await response.arrayBuffer();

  // 3. Desempaquetar, editar XML, reempaquetar
  const zip        = await JSZip.loadAsync(templateBuffer);
  const docXmlRaw  = await zip.file("word/document.xml").async("string");
  const replacements = buildReplacements(project, analysis, engineerCatalog);
  const docXmlNew  = applyReplacements(docXmlRaw, replacements);
  zip.file("word/document.xml", docXmlNew);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });

  // 4. Descargar con nombre que incluye proyecto y fecha (sobreescribe si se genera el mismo día)
  const safeName = (project.project_name || "proyecto")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 \-_]/g, "").trim()
    .replace(/\s+/g, "_");
  const exportDate = new Date().toISOString().slice(0, 10);
  const fileName   = `informetrimestral_${safeName}_${exportDate}.docx`;

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
