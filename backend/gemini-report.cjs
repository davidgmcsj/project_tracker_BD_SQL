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
  "openai/gpt-oss-120b:free",              // 120B, JSON nativo, contexto 131K
  "nvidia/nemotron-3-ultra-550b-a55b:free",// 550B MoE, razonamiento avanzado, 1M contexto
  "nvidia/nemotron-3-super-120b-a12b:free",// 120B, uso general
  "google/gemma-4-31b-it:free",            // 31B, multilingüe 140+ idiomas, 256K contexto
  "google/gemma-4-26b-a4b-it:free",        // 26B MoE, balance calidad/velocidad
  "poolside/laguna-m.1:free",              // razonamiento estructurado, JSON, 256K contexto
  "openai/gpt-oss-20b:free",              // 21B, structured outputs, 131K contexto
  "meta-llama/llama-3.3-70b-instruct:free",// respaldo probado
];

// Modelos Gemini disponibles con esta API key (verificados junio 2026).
const GEMINI_MODELS = [
  "gemini-3.5-flash",         // más capaz disponible
  "gemini-3.1-pro-preview",   // razonamiento avanzado
  "gemini-3-flash-preview",   // rápido y capaz
  "gemini-2.5-pro",           // 1M contexto, alta calidad
  "gemini-2.5-flash",         // estable, buena relación calidad/latencia
  "gemini-2.5-flash-lite",    // ligero, respaldo rápido
  "gemini-2.0-flash",         // respaldo final
];

const SYSTEM_PROMPT = `Eres parte del equipo de la Oficina de Tecnología e Informática de la Corte Suprema de Justicia. Redactas informes de gestión de proyectos para presentar el trabajo realizado por el equipo.

LENGUAJE Y ESTILO:
- Escribe en voz impersonal: "se completó", "se configuró", "se avanzó", "se identificó". Nunca en primera persona.
- Usa palabras simples y directas. Si puedes decirlo con una palabra más sencilla, úsala.
- Las oraciones deben ser cortas y fluir de una a otra sin saltos bruscos.
- El texto debe sonar natural al leerlo en voz alta.
- Usa el pasado para lo que ya se hizo, y el presente o futuro para lo que está en curso o viene.

CÓMO INTERPRETAR LAS ACTIVIDADES:
- Completadas: se ejecutaron y se deben presentar como logros concretos del periodo.
- En proceso: están siendo trabajadas actualmente. Se presentan como avances en curso, no como retrasos.
- No iniciadas: son los próximos pasos planificados. Se presentan como la continuación natural del trabajo, no como tareas pendientes o incumplimientos.

PROHIBIDO INVENTAR:
- No menciones fechas, módulos, funcionalidades, integraciones ni avances que no estén en los datos recibidos.
- No generalices con frases como "se realizaron múltiples mejoras" si no hay actividades que lo respalden.
- Si un campo no tiene datos suficientes, redáctalo en función de lo que sí está registrado.

PALABRAS Y FRASES PROHIBIDAS:
- Adjetivos vacíos: "robusto", "exhaustivo", "significativo", "arduo", "intenso", "dinámico", "óptimo". Cámbialos por datos concretos o elimínalos.
- Frases de relleno: "cabe destacar", "es importante mencionar", "en este sentido", "a nivel de", "de cara al siguiente ciclo", "a lo largo del periodo".
- Palabras negativas sobre el trabajo del equipo: "error", "falla", "incumplimiento", "retraso grave". Usa en cambio: "punto de atención", "actividad en gestión", "pendiente de coordinación".
- Términos ágiles: "sprint", "backlog", "épica", "story". Usa: "tarea", "fase", "componente", "módulo".

CUANDO SE MENCIONA UN TERCERO:
- Mantén un tono tranquilo y neutral. No culpes ni señales.
- Preséntalo como una coordinación en curso o una dependencia que se está gestionando.
- Ejemplo correcto: "la actividad avanza en coordinación con el área responsable". Ejemplo incorrecto: "el tercero no ha entregado lo requerido".

RESPONDE SIEMPRE con JSON válido, sin texto fuera del JSON.`;

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
    ? `Asigna el responsable de cada acción a uno de los miembros del equipo: ${teamNames.join(", ")}.`
    : `Usa "Equipo de tecnología" si no hay ingenieros registrados.`;

  return `Analiza los datos del proyecto y genera un Informe de Gestión para el periodo indicado. Responde ÚNICAMENTE con JSON válido, sin texto fuera del JSON.

PRINCIPIO CENTRAL — LEE ESTO PRIMERO:
El informe debe ser analítico, no descriptivo. No se trata de repetir los datos en prosa — se trata de explicar qué significan, qué relación tienen entre sí y qué implican para el proyecto, usando únicamente la información disponible. Si los datos no respaldan una afirmación, no la escribas. Nunca inferir, nunca asumir, nunca completar con ideas propias.

REGLAS ANTES DE ESCRIBIR:
1. Usa solo la información presente en los datos. No inventes actividades, fechas, módulos, causas ni conclusiones que no estén en los datos.
2. Analiza, no describas: en lugar de decir "se completaron X actividades", explica qué representa ese avance para el estado del proyecto según lo que dicen los datos.
3. Cada idea debe ser distinta. Si una oración repite lo que ya dijo otra con otras palabras, elimínala.
4. Si un campo del JSON no tiene datos suficientes para escribir algo con sustancia, escribe una sola oración con lo que sí hay. No rellenes con frases genéricas.
5. Las actividades completadas son hechos: descríbelas y analiza qué aportan según los datos.
6. Las actividades en proceso son trabajo actual: descríbelas y explica qué las sostiene o qué las condiciona, según los datos.
7. Las actividades no iniciadas son pasos siguientes: preséntals como continuación planificada, explicando su relación con lo completado si los datos lo permiten.
8. Si hay terceros en un bloqueo, descríbelo de forma neutral: "se avanza en coordinación con el área correspondiente". Sin culpar.
9. Usa los números concretos de los datos: completadas, en proceso, no iniciadas, totales. Los números dan contexto al análisis.
10. No calcules ni menciones porcentajes propios. Usa solo el porcentaje de avance que ya viene en los datos.

DATOS DEL PROYECTO:
${summary}

PERIODO: ${quarterLabel}

INSTRUCCIÓN IMPORTANTE PARA INDICADORES (sección2.indicadores):
- Genera UNA entrada por cada indicador que aparezca en la sección INDICADORES de los datos.
- Si los datos tienen 4 indicadores, el array debe tener exactamente 4 entradas.
- Usa el nombre exacto de cada indicador tal como está en los datos. No los renombres ni los reemplaces.
- El campo "resultado" debe tomar el porcentaje calculado que aparece en los datos para ese indicador, no uno inventado.
- Si no hay indicadores registrados en los datos, genera una sola entrada con nombre "Avance general del proyecto" usando las métricas generales.

Devuelve exactamente este JSON:

{
  "seccion1": {
    "intro": "3 a 4 oraciones. Presenta el proyecto y su estado en el periodo usando los datos disponibles. Incluye el total de actividades, cuántas se completaron y cuántas están en curso. No repitas en las siguientes secciones lo mismo que digas aquí.",
    "principales_resultados": [
      "Qué representa el volumen de actividades completadas para el avance del proyecto — analiza su peso relativo (ej: si son 18 de 24, eso es el 75% del alcance identificado) usando solo cifras de los datos",
      "Qué aportan concretamente las actividades completadas al proyecto — según los nombres y descripciones reales de las actividades en los datos, no en términos genéricos",
      "Qué implica el estado de las actividades en proceso: cuántas son, qué representan y qué las sostiene o condiciona según los datos",
      "Qué lugar ocupan las actividades no iniciadas en el conjunto: cuántas son y cómo se relacionan con lo ya completado, según los datos"
    ],
    "logros_destacados": [
      "El logro más relevante del periodo según los datos — qué se completó y qué habilita o resuelve eso según la información disponible",
      "Otro logro concreto extraído de las actividades completadas o de los logros de la semana registrados",
      "Un tercer logro solo si los datos lo respaldan con información específica — si no, omite este elemento completamente"
    ],
    "dificultades": [
      "Si hay bloqueantes o riesgos registrados en los datos: descríbelos, explica qué efecto tienen sobre el avance según los datos, con tono neutral. Si no hay ninguno registrado, escribe exactamente: 'Sin puntos de atención registrados para el periodo.'"
    ]
  },
  "seccion2": {
    "indicadores": [
      {
        "nombre": "Nombre exacto del indicador según los datos — no lo cambies ni lo inventes",
        "meta": "100%",
        "resultado": "Porcentaje de avance del indicador según los datos — tómalo de los datos, no lo calcules",
        "cumplimiento": "Alto si es ≥ 75%, Medio si es 50-74%, Bajo si es < 50%",
        "analisis": "Explica qué significa ese resultado para el indicador: cuántas actividades lo componen, cuántas están completas y cuántas en proceso según los datos. Si hay una brecha respecto a la meta, analiza qué la origina según la información disponible — sin inventar causas."
      }
    ],
    "analisis_general": [
      "Analiza el conjunto de indicadores: qué patrón muestran, si hay consistencia entre ellos o si alguno está por encima o debajo del promedio general del proyecto — usando solo los datos",
      "Qué relación hay entre las actividades en proceso y el avance de los indicadores — según los datos disponibles",
      "Qué oportunidad de mejora concreta se identifica para el siguiente ciclo a partir de los datos actuales — solo si los datos la sugieren"
    ]
  },
  "seccion3": {
    "riesgos": [
      {
        "nombre": "Nombre del riesgo o bloqueante registrado en los datos. Si no hay ninguno, escribe: 'Sin riesgos registrados'",
        "estado": "Activo o Gestionado — según los datos",
        "impacto": "Alto, Medio o Bajo — según lo que indiquen los datos",
        "control": "Qué se está haciendo para manejarlo según los datos. Si hay terceros involucrados, usa tono neutral: 'se avanza en coordinación con el área correspondiente'."
      }
    ],
    "analisis": [
      "Analiza qué efecto concreto tienen los puntos de atención sobre el avance actual del proyecto — solo si los datos lo respaldan. Si no hay riesgos, escribe: 'No se registran puntos de atención que afecten el avance en el periodo.'",
      "Si hay dependencias externas registradas, analiza cómo condicionan el avance sin emitir juicios sobre terceros",
      "Qué acción concreta podría reducir la exposición a estos puntos en el siguiente ciclo — solo si los datos sugieren algo específico"
    ]
  },
  "seccion4": {
    "intro": "Una oración que establezca el estado general de las actividades no completadas. Si no hay situaciones de mejora identificadas, indícalo directamente.",
    "situaciones": [
      "Si hay actividades en proceso o no iniciadas que representan un punto de atención, analiza por qué y qué implican para el proyecto según los datos. Si no hay ninguna, escribe exactamente: 'No se identificaron situaciones de mejora para el periodo.'"
    ],
    "acciones": [
      "Acción concreta que se está tomando o se tomará, extraída directamente de los datos del reporte — plan de próxima semana, comentarios o actividades en proceso",
      "Otra acción solo si los datos la respaldan con información específica"
    ],
    "analisis": [
      "Analiza por qué se generó la situación si los datos lo explican — sin inferir causas no registradas",
      "Si el patrón podría repetirse, qué ajuste concreto sugieren los datos",
      "Cómo se dará seguimiento, basado en el plan registrado o en las actividades en proceso"
    ]
  },
  "seccion5": {
    "acciones": [
      {
        "accion": "Acción de mejora específica y medible, derivada directamente de las actividades en proceso o no iniciadas registradas en los datos",
        "responsable": "${responsableHint}",
        "fecha": "Mes y año del periodo o el siguiente — según los datos",
        "estado": "Iniciada, Pendiente o Ejecutada — según corresponda con los datos"
      }
    ],
    "enfoque": [
      "Primer eje para el siguiente ciclo: qué grupo de actividades no iniciadas o en proceso marca la dirección, según los datos",
      "Segundo eje: coordinaciones o validaciones pendientes que los datos mencionan explícitamente",
      "Tercer eje: solo si los datos identifican una oportunidad de mejora al proceso — si no, omite este elemento"
    ]
  },
  "seccion6": {
    "conclusiones": [
      "Balance del periodo con cifras: cuántas actividades se completaron, cuántas están en curso y cuántas quedan por iniciar. Analiza qué significa ese resultado para el estado general del proyecto según los datos.",
      "Evaluación del estado actual del proyecto: en qué punto se encuentra y qué tan cerca está de sus objetivos según la información disponible — sin proyecciones inventadas"
    ],
    "prioritario": [
      "La prioridad más importante para el siguiente ciclo según las actividades en proceso o no iniciadas registradas",
      "Segunda prioridad si los datos la respaldan con información específica",
      "Tercera prioridad solo si los datos la mencionan — si no, omite este elemento"
    ],
    "enfoque_siguiente": "Una o dos oraciones sobre la dirección del proyecto en el siguiente periodo, basadas en el plan de próxima semana o en las actividades no iniciadas registradas. Sin proyecciones ni afirmaciones que no estén en los datos."
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

// ── Status Global (multi-proyecto) ───────────────────────────────────────────

function buildGlobalStatusPrompt(projects, weekLabel, mode) {
  const withTasks = projects.filter(p => Number(p.manual_metrics?.total_tasks || 0) > 0);

  const rows = withTasks.map(p => {
    const m          = p.manual_metrics || {};
    const total      = Number(m.total_tasks      || 0);
    const done       = Number(m.completed_tasks  || 0);
    const wip        = Number(m.in_progress_tasks || 0);
    const notStarted = Math.max(0, total - done - wip);
    const pct        = Math.round(projectProgress(total, done, wip));
    const blockers   = (p.impediments || []).filter(i => i.category === "blocker").map(b => b.description).join("; ") || "Ninguno";
    const statusMap  = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado", "mejora-continua": "Mejora Continua" };
    return `- ${p.project_name || "Sin nombre"} | Estado: ${statusMap[p.status] || p.status} | Total: ${total} | Completadas: ${done} | En proceso: ${wip} | No iniciadas: ${notStarted} | Avance: ${pct}% | Bloqueantes: ${blockers}`;
  }).join("\n");

  const totalActs  = withTasks.reduce((s, p) => s + Number(p.manual_metrics?.total_tasks      || 0), 0);
  const totalDone  = withTasks.reduce((s, p) => s + Number(p.manual_metrics?.completed_tasks  || 0), 0);
  const totalWip   = withTasks.reduce((s, p) => s + Number(p.manual_metrics?.in_progress_tasks || 0), 0);
  const totalNS    = Math.max(0, totalActs - totalDone - totalWip);
  const avgPct     = withTasks.length > 0
    ? Math.round(withTasks.reduce((s, p) => {
        const m = p.manual_metrics || {};
        return s + projectProgress(Number(m.total_tasks || 0), Number(m.completed_tasks || 0), Number(m.in_progress_tasks || 0));
      }, 0) / withTasks.length)
    : 0;

  const rangoLabel = avgPct >= 91 ? "AVANCE ÓPTIMO (≥ 91%)"
    : avgPct >= 70 ? "AVANCE SATISFACTORIO (70–90%)"
    : avgPct >= 50 ? "AVANCE EN SEGUIMIENTO (50–69%)"
    : "AVANCE CRÍTICO (< 50%)";

  const globales = `Período: ${weekLabel || "Sin definir"}
Total proyectos analizados: ${withTasks.length}
Total actividades: ${totalActs} | Completadas: ${totalDone} (${totalActs > 0 ? Math.round(totalDone / totalActs * 100) : 0}%) | En proceso: ${totalWip} | No iniciadas: ${totalNS}
Avance promedio global: ${avgPct}% — ${rangoLabel}`;

  if (mode === "executive") {
    return `${globales}

PROYECTOS:
${rows}

INSTRUCCIÓN: Redacta UN ÚNICO párrafo ejecutivo en español formal institucional, voz impersonal, estilo gerencial. El párrafo debe mencionar: el período, el número de proyectos y actividades, el avance global con su rango, los proyectos con mejor desempeño y el que presenta menor avance con su causa principal si tiene bloqueante. Máximo 5 oraciones. Sin bullets. Sin secciones. Sin texto fuera del JSON.

Devuelve exactamente este JSON:
{ "parrafo": "texto del párrafo ejecutivo" }`;
  }

  return `${globales}

PROYECTOS:
${rows}

INSTRUCCIÓN: Analiza los datos anteriores y genera un informe de status global estructurado en español formal institucional, voz impersonal. Sin texto fuera del JSON.

Devuelve exactamente este JSON:
{
  "resumen_ejecutivo": "párrafo narrativo (3-5 oraciones) con: período, proyectos, actividades totales, % avance global y rango",
  "proyectos_destacados": [
    { "nombre": "nombre del proyecto", "avance": 95, "nota": "descripción breve del logro o motivo del buen avance" }
  ],
  "alertas": [
    { "nombre": "nombre del proyecto", "avance": 60, "motivo": "descripción del bloqueante o causa del bajo avance" }
  ],
  "proximos_pasos": ["acción concreta 1", "acción concreta 2", "acción concreta 3"]
}

Reglas:
- proyectos_destacados: incluye los proyectos con avance ≥ 85% (máximo 4). Si ninguno alcanza ese umbral, incluye los 2 de mayor avance.
- alertas: incluye proyectos con avance < 70% O con bloqueantes activos. Si ninguno cumple, devuelve array vacío [].
- proximos_pasos: acciones concretas basadas en los bloqueantes, proyectos en riesgo o actividades no iniciadas.`;
}

async function generateGlobalStatusWithAI(projects, weekLabel, engineerCatalog = [], mode = "full") {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildGlobalStatusPrompt(projects, weekLabel, mode) },
  ];

  const tag = `[AI-GLOBAL-${mode.toUpperCase()}]`;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      console.log(`${tag} Usando Gemini...`);
      const text   = await callGemini(messages, geminiKey);
      const result = parseAIResponse(text);
      console.log(`${tag} OK con Gemini`);
      return result;
    } catch (e) {
      console.warn(`${tag} Gemini falló: ${e.message} — probando OpenRouter.`);
    }
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      console.log(`${tag} Usando OpenRouter...`);
      const text   = await callOpenRouter(messages, openrouterKey);
      const result = parseAIResponse(text);
      console.log(`${tag} OK con OpenRouter`);
      return result;
    } catch (e) {
      console.warn(`${tag} OpenRouter falló: ${e.message} — probando Groq.`);
    }
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("Ningún proveedor de IA configurado");
  console.log(`${tag} Usando Groq...`);
  const groq = new Groq({ apiKey: groqKey });
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile", temperature: 0.3, messages,
    response_format: { type: "json_object" },
  });
  return parseAIResponse(completion.choices[0]?.message?.content || "");
}

module.exports = { generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI };
