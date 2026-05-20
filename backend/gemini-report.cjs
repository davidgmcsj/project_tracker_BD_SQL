// gemini-report.cjs — Genera el análisis narrativo del informe de gestión usando Groq AI.

const Groq = require("groq-sdk");

function getMainEngineer(engineers) {
  if (!engineers?.length) return "Equipo del proyecto";
  const e = engineers[0];
  return e.engineer_id === "Otro..." ? (e.custom_name || "—") : (e.engineer_id || "—");
}

function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  return Math.min(((Number(completed) + Number(inProgress) * 0.5) / Number(total)) * 100, 100);
}

function toLines(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

function buildProjectSummary(project) {
  const m       = project.manual_metrics || {};
  const total   = Number(m.total_tasks        || 0);
  const done    = Number(m.completed_tasks    || 0);
  const wip     = Number(m.in_progress_tasks  || 0);
  const pending = Math.max(0, total - done - wip);
  const pct     = Math.round(projectProgress(total, done, wip));

  const statusMap = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado" };
  const status    = statusMap[project.status] || project.status || "—";

  const blockers = (project.impediments || []).filter(i => i.category === "blocker");
  const risks    = (project.impediments || []).filter(i => i.category === "risk");
  const nonConf  = (project.impediments || []).filter(i => i.category === "non_conformity");

  const ts         = project.task_status || {};
  const tsDone     = (ts.completed   || []).filter(Boolean);
  const tsWip      = (ts.in_progress || []).filter(Boolean);
  const tsNotStart = (ts.not_started || []).filter(Boolean);

  const milestones = (project.milestones || []).filter(m => m.date || m.note);
  const comments   = (project.comments   || []).filter(c => c.text);

  const engLines = (project.engineers || []).map(e => {
    const name   = e.engineer_id === "Otro..." ? (e.custom_name || "—") : (e.engineer_id || "—");
    const detail = toLines(e.weekly_detail);
    return `  - ${name}: ${e.assigned || 0} asignadas, ${e.completed || 0} completadas, ${e.in_progress || 0} en proceso${detail.length ? `. Esta semana: ${detail.join("; ")}` : ""}`;
  });

  const indicators = (project.indicators || []).map(ind => {
    const ip = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
    return `  - ${ind.name || "Indicador"}: ${ip}% (${ind.completed}/${ind.total} completadas, ${ind.in_progress} en proceso)`;
  });

  return `
PROYECTO: ${project.project_name || "Sin nombre"}
Fecha de reporte: ${project.report_date || "—"}
Estado: ${status}
Responsable principal: ${getMainEngineer(project.engineers)}

MÉTRICAS GENERALES:
- Total actividades: ${total}
- Completadas: ${done}
- En proceso: ${wip}
- No iniciadas: ${pending}
- Avance calculado: ${pct}%
${indicators.length ? `\nINDICADORES:\n${indicators.join("\n")}` : ""}
${engLines.length ? `\nEQUIPO DE INGENIEROS:\n${engLines.join("\n")}` : ""}

ACTIVIDADES IDENTIFICADAS PARA EL PERIODO:
${toLines(project.activities_identified).map((a, i) => `  ${i + 1}. ${a}`).join("\n") || "  No registradas"}

ESTADO DETALLADO DE ACTIVIDADES:
${tsDone.length     ? `  Completadas (${tsDone.length}):\n${tsDone.map(a => `    - ${a}`).join("\n")}` : "  Sin actividades completadas registradas"}
${tsWip.length      ? `  En proceso (${tsWip.length}):\n${tsWip.map(a => `    - ${a}`).join("\n")}` : ""}
${tsNotStart.length ? `  No iniciadas (${tsNotStart.length}):\n${tsNotStart.map(a => `    - ${a}`).join("\n")}` : ""}

LOGROS DE LA SEMANA:
${toLines(project.weekly_achievements).map(a => `  - ${a}`).join("\n") || "  No registrados"}

PLAN PRÓXIMA SEMANA:
${toLines(project.next_week_plan).map(a => `  - ${a}`).join("\n") || "  No registrado"}

IMPEDIMENTOS Y RIESGOS:
${blockers.length ? `  Bloqueantes:\n${blockers.map(b => `    - ${b.description}${b.impact ? ` (Impacto: ${b.impact})` : ""}`).join("\n")}` : "  Sin bloqueantes"}
${risks.length    ? `  Riesgos:\n${risks.map(r => `    - ${r.description}${r.impact ? ` (Impacto: ${r.impact})` : ""}`).join("\n")}` : "  Sin riesgos registrados"}
${nonConf.length  ? `  Salidas no conformes:\n${nonConf.map(n => `    - ${n.description}${n.impact ? ` (Impacto: ${n.impact})` : ""}`).join("\n")}` : "  Sin salidas no conformes"}

FECHAS CLAVE / HITOS:
${milestones.length ? milestones.map(m => `  - [${m.date || "Sin fecha"}] ${m.activity || "—"}${m.note ? `: ${m.note}` : ""}`).join("\n") : "  No registradas"}

COMENTARIOS:
${comments.length ? comments.map(c => `  - ${c.text}${c.date ? ` (${c.date})` : ""}`).join("\n") : "  Sin comentarios"}
`.trim();
}

function buildPrompt(project, quarterLabel) {
  const summary = buildProjectSummary(project);

  return `# ROL Y CONTEXTO
Actúa como un Ingeniero de Software Senior y Gestor de Proyectos Tecnológicos Experto. Tu tarea es analizar el reporte de actividades que se te proporciona y transformarlo en un Informe de Gestión Trimestral formal, analítico y de alto nivel ejecutivo. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código markdown.

# LINEAMIENTOS DE TONO Y REDACCIÓN
- Tono: Profesional, técnico, objetivo y orientado a resultados de negocio y arquitectura.
- Estilo: Evita la complacencia, el lenguaje conformista y las frases genéricas o clichés (ej. "se avanzó a paso firme", "gracias al esfuerzo"). Usa terminología técnica precisa y fluida (ej. "interoperabilidad", "deuda técnica", "bloqueos de gobernanza", "despliegue en la nube").
- Balance: Resalta los éxitos y el valor técnico entregado sin alardear. Describe las dificultades no como fallas, sino como desafíos de arquitectura, infraestructura o dependencias de gobernanza externa.
- Idioma: Español formal institucional, tercera persona, presente o pasado según corresponda.

# RESTRICCIONES DE VOCABULARIO
- Queda prohibido usar: "crítico", "errores", "problemas", "fallas", "retrasos graves". En su lugar usa: "desafíos técnicos", "puntos de atención", "desviaciones en el cronograma", "bloqueos de infraestructura".
- Evita palabras rebuscadas o que generen lenguaje forzado. La redacción debe ser fluida, directa y fácil de leer para cualquier stakeholder.
- Siempre que se hable de desviaciones, debilidades o tareas pendientes, el enfoque debe ser de Mejora Continua. Usa "oportunidades de mejora" cuando aplique, planteando de inmediato una alternativa de mitigación.

# LÓGICA DE ANÁLISIS SENIOR
1. Universo de tareas: Entiende que el proyecto tiene un total de tareas identificadas en su radar. No todas se ejecutan en el trimestre debido a complejidad técnica, gestión de ventanas de tiempo o bloqueos externos. Clasifica el avance agrupando las tareas completadas por bloques funcionales de valor (épicas), no por ID individual.
2. Causa raíz de cuellos de botella: Cruza las tareas "En Proceso" y "No Iniciadas" con los comentarios y fechas clave para deducir la causa raíz del estado actual (ej. "fase de recolección de requerimientos de terceros en desarrollo", "dependencia de aprobación de infraestructura Azure", "ventana de despliegue condicionada a validación de usuarios").
3. Plan de mejoramiento (Mejora Continua): Estructura las propuestas demostrando análisis sistemático y proactivo basado en mejora continua: evolución de requisitos de usuarios finales y mesas de trabajo, feedback de sesiones operativas, revisión del alcance frente a capacidad de infraestructura, y aseguramiento de calidad (QA) mediante estabilización y validación de ambientes espejo.

# DATOS DEL PROYECTO
${summary}

PERIODO DEL INFORME: ${quarterLabel}

# ESTRUCTURA JSON DE SALIDA — OBLIGATORIA Y EXACTA

{
  "seccion1": {
    "intro": "Párrafo introductorio (3-4 oraciones) que contextualiza el proyecto, describe el objetivo del periodo, el enfoque del ciclo de vida actual y menciona métricas reales (% avance, tareas completadas de total).",
    "principales_resultados": [
      "Resultado 1: avance porcentual analítico con contexto técnico (tareas completadas vs universo identificado)",
      "Resultado 2: bloque funcional o épica completada y su valor para el sistema",
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
      "Análisis del ritmo de desarrollo frente a la velocidad de despliegue o validación de usuarios (apoyado en tareas En Proceso y No Iniciadas)",
      "Tendencia del indicador principal y factores técnicos que la explican",
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
        "responsable": "Nombre del ingeniero o líder responsable",
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

async function generateReportWithAI(project, quarterLabel) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no está configurada en .env");

  const groq = new Groq({ apiKey });

  const completion = await groq.chat.completions.create({
    model:       "llama-3.3-70b-versatile",
    temperature: 0.3,
    messages: [
      {
        role:    "system",
        content: "Eres un Ingeniero de Software Senior y Gestor de Proyectos Tecnológicos Experto. Redactas informes de gestión ejecutivos con análisis técnico profundo, enfoque de mejora continua y visión estratégica. Tu vocabulario es constructivo: nunca usas 'crítico', 'errores', 'problemas', 'fallas' ni 'retrasos graves'. Siempre encuadras las desviaciones como oportunidades de mejora con mitigación inmediata. Respondes SIEMPRE con JSON válido y sin texto adicional fuera del JSON.",
      },
      {
        role:    "user",
        content: buildPrompt(project, quarterLabel),
      },
    ],
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content || "";

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("La IA no devolvió JSON válido");
  }
}

module.exports = { generateReportWithAI };
