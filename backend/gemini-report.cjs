// gemini-report.cjs — Genera el análisis narrativo del informe de gestión.
// Cadena de proveedores: Gemini (4 modelos) → OpenRouter (6 modelos gratuitos) → Groq

const Groq                                  = require("groq-sdk");
const https                                 = require("https");
const { GoogleGenerativeAI }                = require("@google/generative-ai");
const { toArray, buildActivityIndex }       = require("./utils.cjs");

// ── Catálogo de Proyectos (Contexto para evitar alucinaciones) ────────────────

const PROJECT_CATALOG = require("./project-catalog.json");

function getProjectDescription(projectName) {
  if (!projectName) return "Descripción no disponible.";
  const name = projectName.trim();

  // 1. Match exacto
  if (PROJECT_CATALOG[name]) return PROJECT_CATALOG[name];

  const nameLower = name.toLowerCase();
  const keys      = Object.keys(PROJECT_CATALOG);

  // 2. Match por código PRO-XX (ej. "PRO-14" encuentra "PRO-14: ESAV")
  const codeMatch = nameLower.match(/pro-\d+/);
  if (codeMatch) {
    const found = keys.find(k => k.toLowerCase().startsWith(codeMatch[0]));
    if (found) return PROJECT_CATALOG[found];
  }

  // 3. Match parcial por nombre (uno contiene al otro)
  const found = keys.find(k => nameLower.includes(k.toLowerCase()) || k.toLowerCase().includes(nameLower));
  if (found) return PROJECT_CATALOG[found];

  // 4. Match por palabras clave (al menos 2 palabras significativas en común)
  const stopWords = new Set(["de", "del", "la", "el", "en", "y", "a", "con", "para", "por", "las", "los", "un", "una"]);
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  if (nameWords.length >= 2) {
    const bestKey = keys.reduce((best, k) => {
      const kWords  = k.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
      const matches = nameWords.filter(w => kWords.some(kw => kw.includes(w) || w.includes(kw))).length;
      return matches > best.score ? { key: k, score: matches } : best;
    }, { key: null, score: 1 }); // score mínimo 2 palabras en común
    if (bestKey.key) return PROJECT_CATALOG[bestKey.key];
  }

  return "Descripción no disponible.";
}

// ── Modelos de IA ─────────────────────────────────────────────────────────────

const OPENROUTER_MODELS = [
  "deepseek/deepseek-v4-flash:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "minimax/minimax-m2.5:free",
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

// Modelos Gemini a intentar en orden (verificados con la API key, mayo 2026).
const GEMINI_MODELS = [
  "gemini-3.5-flash",            // más capaz disponible en la key
  "gemini-3.1-pro-preview",      // razonamiento avanzado
  "gemini-3-flash-preview",      // multimodal, fuerte en razonamiento
  "gemini-2.5-pro",              // alta capacidad, 1M tokens contexto
  "gemini-2.5-flash",            // estable, buena relación calidad/latencia
  "gemini-2.0-flash",            // respaldo rápido
];

const SYSTEM_PROMPT = "Eres un Ingeniero de Software Senior redactando un informe ejecutivo sobre tu propio trabajo. El informe está escrito en voz impersonal — siempre con verbos reflexivos: 'se desarrolló', 'se completó', 'se implementó', 'se identificó'. Nunca uses primera persona ni menciones nombres de personas en el texto. Reglas absolutas: (1) Voz impersonal siempre — nunca 'yo', 'nosotros', 'el ingeniero X' ni ningún nombre propio. (2) Nunca uses adjetivos vagos como 'intensa', 'ardua', 'exhaustiva', 'robusta', 'significativa' — reemplázalos con datos concretos o elimínalos. (3) Nunca uses 'crítico', 'errores', 'problemas', 'fallas', 'retrasos graves', 'no se cumplió', 'no se ejecutó', 'incumplimiento' — usa 'desafíos técnicos', 'puntos de atención', 'actividades programadas para fases siguientes' o 'en gestión con terceros'. (4) Nunca uses frases de relleno como 'cabe destacar', 'es importante mencionar', 'en este sentido'. (5) Nunca uses vocabulario ágil como 'épica', 'sprint', 'backlog', 'story' — usa 'módulo', 'componente', 'fase' o 'entregable'. (6) Las actividades no iniciadas NUNCA son incumplimientos — son actividades identificadas cuya ejecución depende de terceros, fases previas o aprobaciones institucionales, y forman parte del plan de maduración del proyecto bajo Mejora Continua. (7) Escribe en español formal institucional con enfoque siempre positivo y propositivo. (8) Fidelidad absoluta a los datos: cada afirmación, logro, indicador, riesgo o plan debe estar respaldado por información presente en los datos del proyecto — nunca inventes actividades, módulos, fechas, integraciones ni avances que no estén registrados. Si un campo no tiene respaldo, redáctalo en términos de lo que está en curso según los datos reales. (9) Responde SIEMPRE con JSON válido y sin texto adicional fuera del JSON.";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveEngineerNames(projectEngineers, catalog) {
  if (!projectEngineers?.length) return [];
  const catMap = new Map((catalog || []).map(e => [e.id, e.name]));
  return projectEngineers.map(e => {
    if (e.engineer_id === "Otro...") return e.custom_name || "—";
    return catMap.get(e.engineer_id) || e.engineer_id || "—";
  }).filter(n => n && n !== "—");
}

function getMainEngineer(engineers, catalog) {
  const names = resolveEngineerNames(engineers, catalog);
  return names.length ? names[0] : "Equipo del proyecto";
}

function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  return Math.min(((Number(completed) + Number(inProgress) * 0.5) / Number(total)) * 100, 100);
}

// toArray y buildActivityIndex vienen de utils.cjs
function actText(index, id)  { return index.get(id)?.text ?? id ?? ""; }
function actLabel(index, id) { const e = index.get(id); return e ? `${e.position}. ${e.text}` : (id || ""); }
function resolveIds(index, ids) { return toArray(ids).map(id => actText(index, id)); }

function buildProjectSummary(project, engineerCatalog) {
  const description      = getProjectDescription(project.project_name);
  const projectDisplayName = (project.project_name || "").replace(/^PRO-\d+[-:\s]*/i, "").trim() || project.project_name || "Sin nombre";
  const m       = project.manual_metrics || {};
  const total   = Number(m.total_tasks        || 0);
  const done    = Number(m.completed_tasks    || 0);
  const wip     = Number(m.in_progress_tasks  || 0);
  const pending = Math.max(0, total - done - wip);
  const pct     = Math.round(projectProgress(total, done, wip));

  const statusMap = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado", "mejora-continua": "Mejora Continua" };
  const status    = statusMap[project.status] || project.status || "—";

  const blockers = (project.impediments || []).filter(i => i.category === "blocker");
  const risks    = (project.impediments || []).filter(i => i.category === "risk");
  const nonConf  = (project.impediments || []).filter(i => i.category === "non_conformity");

  const actIndex   = buildActivityIndex(project.activities_identified);
  const ts         = project.task_status || {};
  const tsDone     = resolveIds(actIndex, ts.completed);
  const tsWip      = resolveIds(actIndex, ts.in_progress);
  const tsNotStart = resolveIds(actIndex, ts.not_started);

  const milestones = (project.milestones || []).filter(m => m.date || m.note);
  const comments   = (project.comments   || []).filter(c => c.text);

  const catMap = new Map((engineerCatalog || []).map(e => [e.id, e.name]));
  const engLines = (project.engineers || []).map(e => {
    const name = e.engineer_id === "Otro..." ? (e.custom_name || "—") : (catMap.get(e.engineer_id) || e.engineer_id || "—");
    const detail = resolveIds(actIndex, e.weekly_detail);
    return `  - ${name}: ${e.assigned || 0} asignadas, ${e.completed || 0} completadas, ${e.in_progress || 0} en proceso${detail.length ? `. Actividades esta semana: ${detail.join("; ")}` : " (sin actividades registradas esta semana)"}`;
  });

  const indicators = (project.indicators || []).map(ind => {
    const ip = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
    return `  - ${ind.name || "Indicador"}: ${ip}% (${ind.completed}/${ind.total} completadas, ${ind.in_progress} en proceso)`;
  });

  return `
PROYECTO: ${projectDisplayName}
DESCRIPCIÓN TÉCNICA: ${description}
Fecha de reporte: ${project.report_date || "—"}
Estado: ${status}
Responsable principal: ${getMainEngineer(project.engineers, engineerCatalog)}

MÉTRICAS GENERALES:
- Total actividades: ${total}
- Completadas: ${done}
- En proceso: ${wip}
- No iniciadas: ${pending}
- Avance calculado: ${pct}%
${indicators.length ? `\nINDICADORES:\n${indicators.join("\n")}` : ""}
${engLines.length ? `\nEQUIPO DE INGENIEROS (todos los integrantes del equipo — menciónalos a todos en el informe aunque no tengan actividades registradas esta semana):\n${engLines.join("\n")}` : ""}

ACTIVIDADES IDENTIFICADAS PARA EL PERIODO:
${(project.activities_identified || []).map((a, i) => `  ${i + 1}. ${a.text}`).join("\n") || "  No registradas"}

ESTADO DETALLADO DE ACTIVIDADES:
${tsDone.length     ? `  Completadas (${tsDone.length}):\n${tsDone.map(a => `    - ${a}`).join("\n")}` : "  Sin actividades completadas registradas"}
${tsWip.length      ? `  En proceso (${tsWip.length}):\n${tsWip.map(a => `    - ${a}`).join("\n")}` : ""}
${tsNotStart.length ? `  No iniciadas (${tsNotStart.length}):\n${tsNotStart.map(a => `    - ${a}`).join("\n")}` : ""}

LOGROS DE LA SEMANA:
${resolveIds(actIndex, project.weekly_achievements).map(a => `  - ${a}`).join("\n") || "  No registrados"}

PLAN PRÓXIMA SEMANA:
${resolveIds(actIndex, project.next_week_plan).map(a => `  - ${a}`).join("\n") || "  No registrado"}

IMPEDIMENTOS Y RIESGOS:
${blockers.length ? `  Bloqueantes:\n${blockers.map(b => `    - ${b.description}${b.impact ? ` (Impacto: ${b.impact})` : ""}`).join("\n")}` : "  Sin bloqueantes"}
${risks.length    ? `  Riesgos:\n${risks.map(r => `    - ${r.description}${r.impact ? ` (Impacto: ${r.impact})` : ""}`).join("\n")}` : "  Sin riesgos registrados"}
${nonConf.length  ? `  Salidas no conformes:\n${nonConf.map(n => `    - ${n.description}${n.impact ? ` (Impacto: ${n.impact})` : ""}`).join("\n")}` : "  Sin salidas no conformes"}

FECHAS CLAVE / HITOS:
${milestones.length ? milestones.map(m => `  - [${m.date || "Sin fecha"}] ${m.activity ? actLabel(actIndex, m.activity) : "—"}${m.note ? `: ${m.note}` : ""}`).join("\n") : "  No registradas"}

COMENTARIOS:
${comments.length ? comments.map(c => `  - ${c.text}${c.date ? ` (${c.date})` : ""}`).join("\n") : "  Sin comentarios"}

ESTADO ACTUAL DEL PROYECTO (notas redactadas manualmente):
${project.status_notes && project.status_notes.trim() ? project.status_notes.trim() : "  Sin notas registradas"}

INSTRUCCIONES CONTEXTUALES ESPECÍFICAS PARA ESTE PROYECTO:
${project.status === "mejora-continua" ? `⚠ CONTEXTO MEJORA CONTINUA: Este proyecto ya fue entregado y se encuentra en operación. Las actividades registradas NO son pendientes de un desarrollo en curso — son mejoras, ajustes y evoluciones planificadas sobre un sistema funcional y en producción. El informe debe reflejar un proyecto maduro en fase de evolución continua. No uses lenguaje de proyecto en construcción ("se está desarrollando", "se avanza en la implementación") — usa lenguaje de sistema en operación que evoluciona ("se incorporó la mejora", "se optimizó el componente", "se ajustó la funcionalidad").` : ""}
${/juan|steven/i.test(project.project_name || "") ? `⚠ CONTEXTO SOPORTE TRANSVERSAL: Este no es un proyecto de desarrollo convencional. Corresponde al registro de actividades de soporte técnico transversal prestado por ingenieros a múltiples proyectos de la oficina: mejoras, ajustes, soportes, cambios y apoyo a otros equipos de desarrollo. El informe debe centrarse en el volumen y variedad de actividades ejecutadas durante el periodo, destacando la diversidad del soporte técnico brindado. No apliques la lógica de avance de proyecto ni de entregables — la métrica principal es la cantidad y tipo de actividades realizadas.` : ""}
`.trim();
}

function buildPrompt(project, quarterLabel, engineerCatalog) {
  const summary = buildProjectSummary(project, engineerCatalog);
  const teamNames = resolveEngineerNames(project.engineers, engineerCatalog);
  const responsableHint = teamNames.length
    ? `Usa el nombre real del ingeniero responsable del proyecto. Los ingenieros del equipo son: ${teamNames.join(", ")}. Asigna el responsable de cada acción al ingeniero más apropiado según su rol en el proyecto.`
    : `Usa el nombre del responsable técnico del proyecto si está disponible, o "Equipo del proyecto" si no hay ingenieros registrados.`;

  return `# ROL Y CONTEXTO
Actúa como un Ingeniero de Software Senior y Gestor de Proyectos Tecnológicos Experto. Tu tarea es analizar el reporte de actividades que se te proporciona y transformarlo en un Informe de Gestión Trimestral formal, analítico y de alto nivel ejecutivo. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código markdown.

# LINEAMIENTOS DE TONO Y REDACCIÓN
- Tono: Profesional, técnico, objetivo y orientado a resultados. El informe lo redacta el propio ingeniero para presentar su trabajo — no es un reporte de un tercero sobre otro.
- Voz: Impersonal con verbos reflexivos. Usa siempre construcciones como "se desarrolló", "se completó", "se identificó", "se implementó", "se validó". Nunca uses primera persona ("realicé", "implementé") ni menciones nombres de personas en el texto del informe.
- Estilo: Directo y preciso. Sin clichés como "se avanzó a paso firme", "gracias al esfuerzo", "de manera exitosa". Usa terminología técnica precisa: "interoperabilidad", "deuda técnica", "bloqueos de gobernanza", "despliegue en la nube".
- Enfoque siempre positivo y propositivo: el informe debe reflejar avance, control y gestión activa. Nunca redactes en términos de incumplimiento, falta de ejecución o actividades no realizadas.
- Balance: Resalta el valor técnico entregado. Describe las actividades pendientes siempre como parte planificada del ciclo de vida, no como deudas ni fallos.
- Idioma: Español formal institucional. Verbos en pasado para lo ejecutado, presente para el estado actual.
- Naturalidad: La redacción debe fluir bien al leerla en voz alta. Si una oración suena forzada o artificial, reescríbela.

# RESTRICCIONES DE VOCABULARIO
- Palabras prohibidas por negativas: "crítico", "errores", "problemas", "fallas", "retrasos graves", "no se cumplió", "no se ejecutó", "no se inició", "incumplimiento", "pendiente sin avance". Reemplaza con: "desafíos técnicos", "puntos de atención", "actividades programadas para fases siguientes", "en gestión con terceros", "sujeto a validación".
- Adjetivos intensificadores prohibidos: "intensa", "intenso", "ardua", "arduo", "exhaustiva", "exhaustivo", "robusta", "robusto", "significativa", "significativo", "amplia", "profunda", "extensa", "externo". Estos adjetivos son vagos y suenan artificiales. Reemplaza con datos concretos o elimínalos.
- Frases de relleno prohibidas: "cabe destacar que", "es importante mencionar", "en este sentido", "a lo largo del periodo", "de cara al siguiente ciclo", "en aras de". Escribe directo al punto.
- Vocabulario ágil prohibido: "épica", "sprint", "backlog", "story", "kanban", "scrum", "velocity". Reemplaza con: "módulo", "componente", "fase", "entregable", "funcionalidad", "ciclo de desarrollo".
- Siempre que se hable de actividades pendientes o en proceso, enlárcalas dentro del enfoque de Mejora Continua: son oportunidades de avance planificado, no incumplimientos.

# MARCO CONCEPTUAL — LEER ANTES DE ANALIZAR
El universo de actividades registrado en el reporte representa la identificación COMPLETA del alcance del proyecto, no el plan de ejecución del trimestre. Esto significa:
- Las actividades "no iniciadas" NO son incumplimientos. Son actividades identificadas que aún no tienen ventana de ejecución asignada, porque dependen de terceros, de fases previas, de aprobaciones institucionales o de capacidad de infraestructura.
- Las actividades "en proceso" reflejan gestión activa en curso, no retrasos.
- El avance real del proyecto se mide por las actividades completadas en relación con las planificadas para el periodo, no frente al universo total identificado.
- Todo el proyecto opera bajo Mejora Continua: cada ciclo aporta valor incremental. Las actividades futuras son parte del plan de maduración, no tareas atrasadas.
Nunca uses el total de actividades identificadas para concluir que el proyecto tiene bajo cumplimiento. No existe un número definido de actividades a ejecutar por trimestre — la priorización es dinámica y responde a dependencias, disponibilidad de infraestructura y coordinación con terceros. Por tanto, NUNCA calcules ni menciones un porcentaje de cumplimiento de actividades (ej. "se cumplió el 69% de las actividades priorizadas"). Esa métrica no existe en este modelo de gestión y su uso distorsiona la realidad del proyecto. En su lugar, describe cualitativamente el valor entregado: qué funcionalidades se completaron, qué fases avanzaron y qué componentes quedaron activos para el siguiente ciclo.

# FIDELIDAD A LOS DATOS — REGLA ABSOLUTA
Todo indicador, medición, conclusión, logro, riesgo o plan que aparezca en el informe DEBE estar respaldado por información presente en los datos del proyecto proporcionados. Está terminantemente prohibido:
- Inventar actividades, logros o avances que no estén en los datos.
- Asumir integraciones, validaciones o despliegues que no estén explícitamente mencionados.
- Generalizar con frases como "se realizaron múltiples mejoras" sin que los datos las soporten.
- Fabricar fechas, porcentajes, nombres de módulos o estados que no provengan del reporte.
Si un campo de la estructura JSON no tiene respaldo en los datos, redáctalo en términos de lo que está en curso o planificado según lo que sí está registrado — nunca lo inventes. La credibilidad del informe depende de que cada afirmación sea trazable a los datos reales del proyecto.

# LÓGICA DE ANÁLISIS SENIOR
1. Universo de tareas: Interpreta el total de actividades como el mapa completo del proyecto, no como el plan del trimestre. Agrupa las actividades completadas por componente funcional o módulo. Nunca uses términos ágiles como "épica", "sprint" o "backlog" — usa "módulo", "componente", "fase", "entregable".
2. Actividades en proceso y no iniciadas: Explícalas siempre por su causa técnica o de dependencia (ej. "en coordinación con terceros", "sujeta a ventana de despliegue", "pendiente de aprobación de infraestructura", "programada para la siguiente fase del ciclo"). Nunca las presentes como incumplimientos ni como indicadores negativos.
3. Plan de mejoramiento: Estructura propuestas concretas bajo mejora continua: refinamiento de requerimientos con usuarios, validación en ambientes de prueba antes del despliegue productivo, y ajuste del alcance frente a la capacidad real del equipo e infraestructura disponible.

# DATOS DEL PROYECTO
${summary}

PERIODO DEL INFORME: ${quarterLabel}

# ESTRUCTURA JSON DE SALIDA — OBLIGATORIA Y EXACTA

{
  "seccion1": {
    "intro": "Párrafo introductorio (3-4 oraciones) que contextualiza el proyecto, describe el objetivo del periodo y el enfoque del ciclo de vida actual. NO menciones porcentajes de cumplimiento de actividades — describe cualitativamente el valor entregado y el estado del proyecto.",
    "principales_resultados": [
      "Resultado 1: funcionalidades o componentes completados en el periodo y su aporte al sistema",
      "Resultado 2: módulo o componente funcional completado y su impacto técnico u operativo",
      "Resultado 3: estado de integraciones o interoperabilidad logradas en el periodo",
      "Resultado 4: estado de infraestructura, despliegue o validación de ambientes"
    ],
    "logros_destacados": [
      "Logro 1: hito técnico o funcional entregado con descripción de su valor para el negocio",
      "Logro 2: integración, módulo o componente completado con impacto en el sistema",
      "Logro 3: validación, prueba o aprobación técnica obtenida en el periodo"
    ],
    "dificultades": [
      "Desafío técnico 1: descripción como desafío de arquitectura, infraestructura o dependencia externa con causa raíz (no como falla)",
      "Desafío técnico 2: bloqueo de gobernanza, requerimiento en desarrollo o punto de atención identificado"
    ]
  },
  "seccion2": {
    "indicadores": [
      {
        "nombre": "Nombre técnico del indicador (ej. Cobertura de desarrollo funcional)",
        "meta": "100%",
        "resultado": "XX%",
        "cumplimiento": "Alto/Medio/Bajo",
        "analisis": "Análisis técnico: causa del gap si existe, tendencia y relación con bloqueos o dependencias identificadas"
      }
    ],
    "analisis_general": [
      "Análisis del ritmo de desarrollo frente a la velocidad de despliegue o validación de usuarios — las actividades en proceso y las programadas para fases siguientes se explican por sus dependencias técnicas o institucionales, nunca como incumplimientos",
      "Tendencia del avance cualitativo y factores técnicos que lo explican",
      "Oportunidades de mejora identificadas en el ciclo y su impacto proyectado en el siguiente periodo"
    ]
  },
  "seccion3": {
    "riesgos": [
      {
        "nombre": "Nombre del riesgo extraído de comentarios o impedimentos reales del reporte",
        "estado": "Activo",
        "impacto": "Alto/Medio/Bajo",
        "control": "Acción de mitigación técnica planificada o en ejecución (concreta, no genérica)"
      }
    ],
    "analisis": [
      "Evaluación del impacto de los puntos de atención sobre el cronograma y la ruta de entrega",
      "Análisis de dependencias externas (gobernanza, infraestructura, terceros) como origen de los bloqueos",
      "Recomendación técnica para reducir la exposición a los bloqueos identificados en el siguiente ciclo"
    ]
  },
  "seccion4": {
    "intro": "Declaración objetiva sobre desviaciones en el periodo. Si hay demoras en entornos o entregas, catalogarlas estrictamente como oportunidades de mejora del flujo de entrega, no como fallas.",
    "situaciones": [
      "Oportunidad de mejora 1: desviación identificada descrita con enfoque constructivo y su impacto en el cronograma",
      "Oportunidad de mejora 2: brecha de proceso o dependencia no resuelta con causa raíz identificada"
    ],
    "acciones": [
      "Acción correctiva 1: medida técnica inmediata implementada por el equipo con resultado esperado",
      "Acción correctiva 2: ajuste de proceso o planificación para prevenir recurrencia en el siguiente ciclo"
    ],
    "analisis": [
      "Identificación de la causa raíz de las desviaciones: si es estructural, coyuntural o por dependencia externa",
      "Evaluación de reincidencia: si el patrón es sistémico o puntual y qué lo determina",
      "Plan de seguimiento para validar la efectividad de las acciones correctivas implementadas"
    ]
  },
  "seccion5": {
    "acciones": [
      {
        "accion": "Acción de mejora continua específica y medible, orientada a resolver una causa raíz real del reporte",
        "responsable": "${responsableHint}",
        "fecha": "Mes Año",
        "estado": "Iniciada/Pendiente/Ejecutada"
      }
    ],
    "enfoque": [
      "Eje 1: refinamiento continuo de requisitos mediante revisión sistemática con usuarios finales y minutas de sesiones operativas",
      "Eje 2: aseguramiento de calidad (QA) mediante estabilización y validación previa en ambientes espejo antes del despliegue productivo",
      "Eje 3: revisión periódica del alcance (scope) frente a la capacidad real de la infraestructura y las ventanas de despliegue disponibles"
    ]
  },
  "seccion6": {
    "conclusiones": [
      "Balance técnico cuantitativo del trimestre: avance real, bloques funcionales completados y valor entregado al sistema",
      "Evaluación del estado de madurez: en qué fase se encuentra el proyecto (construcción, estabilización, integración o despliegue)"
    ],
    "prioritario": [
      "Prioridad 1: acción de mayor impacto en la ruta de entrega para el siguiente ciclo",
      "Prioridad 2: dependencia externa o interna que debe resolverse para desbloquear el avance",
      "Prioridad 3: validación o entrega pendiente con mayor impacto en el usuario final"
    ],
    "enfoque_siguiente": "Descripción del pivote estratégico bajo mejora continua: de qué fase sale el equipo y hacia qué fase entra en el siguiente ciclo (ej. de construcción a estabilización y despliegue controlado con validación de usuarios)."
  }
}`;
}

function parseAIResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("La IA no devolvió JSON válido");
  }
}

function callOpenRouterModel(model, messages, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, temperature: 0.3, messages, response_format: { type: "json_object" } });
    const req = https.request({
      hostname: "openrouter.ai",
      path:     "/api/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer":  "https://project-tracker-local",
        "X-Title":       "Project Tracker",
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(`${json.error.message || JSON.stringify(json.error)}`));
          const text = json.choices?.[0]?.message?.content || "";
          if (!text) return reject(new Error("respuesta vacía"));
          resolve(text);
        } catch (e) {
          reject(new Error(`respuesta inválida — ${e.message}`));
        }
      });
    });
    req.on("error", e => reject(new Error(`error de red — ${e.message}`)));
    req.write(body);
    req.end();
  });
}

async function callOpenRouter(messages, apiKey) {
  let lastError;
  for (const model of OPENROUTER_MODELS) {
    try {
      console.log(`[AI] OpenRouter intentando: ${model}`);
      const text = await callOpenRouterModel(model, messages, apiKey);
      console.log(`[AI] OpenRouter OK con: ${model}`);
      return text;
    } catch (e) {
      console.warn(`[AI] OpenRouter [${model}] falló: ${e.message}`);
      lastError = e;
    }
  }
  throw lastError;
}

async function callGemini(messages, apiKey) {
  const genAI      = new GoogleGenerativeAI(apiKey);
  const systemMsg  = messages.find(m => m.role === "system")?.content || "";
  const userMsg    = messages.find(m => m.role === "user")?.content   || "";
  let lastError;
  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(`[AI] Gemini intentando modelo: ${modelName}`);
      const model  = genAI.getGenerativeModel({
        model:             modelName,
        generationConfig:  { temperature: 0.3, responseMimeType: "application/json" },
        systemInstruction: systemMsg,
      });
      const result = await model.generateContent(userMsg);
      const text   = result.response.text();
      if (!text) throw new Error("respuesta vacía");
      console.log(`[AI] Gemini OK con modelo: ${modelName}`);
      return text;
    } catch (e) {
      console.warn(`[AI] Gemini [${modelName}] falló: ${e.message}`);
      lastError = e;
    }
  }
  throw lastError;
}

// Gemini (principal) → OpenRouter (respaldo) → Groq (último respaldo)
async function generateReportWithAI(project, quarterLabel, engineerCatalog = []) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildPrompt(project, quarterLabel, engineerCatalog) },
  ];

  // 1. Gemini (principal)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      console.log("[AI] Usando Gemini (principal)...");
      const text   = await callGemini(messages, geminiKey);
      const result = parseAIResponse(text);
      console.log("[AI] OK con Gemini");
      return result;
    } catch (e) {
      console.warn(`[AI] Gemini falló: ${e.message} — probando OpenRouter.`);
    }
  } else {
    console.log("[AI] GEMINI_API_KEY no configurada. Saltando Gemini.");
  }

  // 2. OpenRouter (respaldo)
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      console.log("[AI] Usando OpenRouter (respaldo)...");
      const text   = await callOpenRouter(messages, openrouterKey);
      const result = parseAIResponse(text);
      console.log("[AI] OK con OpenRouter");
      return result;
    } catch (e) {
      console.warn(`[AI] OpenRouter falló: ${e.message} — probando Groq.`);
    }
  } else {
    console.log("[AI] OPENROUTER_API_KEY no configurada. Saltando OpenRouter.");
  }

  // 3. Groq (último respaldo)
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("Ningún proveedor de IA está configurado en .env (OPENROUTER_API_KEY, GEMINI_API_KEY o GROQ_API_KEY)");
  console.log("[AI] Usando Groq (último respaldo): llama-3.3-70b-versatile");
  const groq       = new Groq({ apiKey: groqKey });
  const completion = await groq.chat.completions.create({
    model:           "llama-3.3-70b-versatile",
    temperature:     0.3,
    messages,
    response_format: { type: "json_object" },
  });
  const text = completion.choices[0]?.message?.content || "";
  return parseAIResponse(text);
}

// ── Status semanal ────────────────────────────────────────────────────────────

function buildStatusPrompt(project) {
  const summary = buildProjectSummary(project);
  return `Eres un asistente técnico de gestión de proyectos. Analiza los datos del proyecto y genera un resumen de estado actual en español formal. Responde ÚNICAMENTE con JSON válido sin texto adicional.

DATOS DEL PROYECTO:
${summary}

INSTRUCCIONES:
- "estado_general": describe el estado del proyecto en 2-3 oraciones: avance global, fase actual y contexto.
- "en_curso": lista las actividades que están actualmente en proceso según el estado de actividades.
- "pendiente": lista las actividades no iniciadas.
- "equipo_semana": para CADA ingeniero del equipo que tenga actividades registradas esta semana, incluye una entrada con su nombre y la lista de sus tareas semanales. Si un ingeniero no tiene actividades registradas esta semana, indícalo con "Sin actividades registradas esta semana". Incluye a TODOS los ingenieros del equipo.
- "proximos_pasos": 2-3 acciones concretas y específicas recomendadas para el próximo periodo, basadas en las actividades en proceso y pendientes.
- "alertas": alertas si hay impedimentos, riesgos o salidas no conformes. Si no hay ninguno, devuelve array vacío [].

Devuelve exactamente este JSON:
{
  "estado_general": "string",
  "en_curso": ["actividad 1", "actividad 2"],
  "pendiente": ["actividad 1", "actividad 2"],
  "equipo_semana": [
    { "nombre": "Nombre del ingeniero", "tareas": ["tarea 1", "tarea 2"] }
  ],
  "proximos_pasos": ["paso 1", "paso 2"],
  "alertas": ["alerta 1"]
}`;
}

async function generateStatusSummaryWithAI(project) {
  const messages = [
    { role: "system", content: "Eres un ingeniero senior experto con especialización en gerencia y gestión de proyectos. Debes responder de forma breve, concreta, organizada y estructurada que permita entender el estado actual del proyecto con la información disponible, con el objetivo de informar la situación de la mejor forma posible de qué se está haciendo, qué se hizo y qué está por hacerse. Respondes siempre con JSON válido, en español formal, sin texto adicional fuera del JSON." },
    { role: "user",   content: buildStatusPrompt(project) },
  ];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const text = await callGemini(messages, geminiKey);
      return parseAIResponse(text);
    } catch (e) {
      console.warn(`[AI-STATUS] Gemini falló: ${e.message}`);
    }
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      const text = await callOpenRouter(messages, openrouterKey);
      return parseAIResponse(text);
    } catch (e) {
      console.warn(`[AI-STATUS] OpenRouter falló: ${e.message}`);
    }
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("Ningún proveedor de IA configurado");
  const groq = new Groq({ apiKey: groqKey });
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile", temperature: 0.3, messages,
    response_format: { type: "json_object" },
  });
  return parseAIResponse(completion.choices[0]?.message?.content || "");
}

module.exports = { generateReportWithAI, generateStatusSummaryWithAI };
