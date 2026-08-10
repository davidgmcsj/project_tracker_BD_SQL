// prompts.cjs — Construcción de los prompts enviados a la IA para cada tipo
// de informe (semanal por proyecto, status semanal, status global).

const { buildProjectSummary, resolveEngineerNames, projectProgress } = require("./project-summary.cjs");

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

module.exports = { SYSTEM_PROMPT, buildPrompt, buildStatusPrompt, buildGlobalStatusPrompt };
