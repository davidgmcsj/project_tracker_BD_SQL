// gemini-report.cjs — Genera el análisis narrativo del informe de gestión.
// Cadena de proveedores: Gemini (4 modelos) → OpenRouter (6 modelos gratuitos) → Groq

const Groq                                  = require("groq-sdk");
const https                                 = require("https");
const { GoogleGenerativeAI, SchemaType }    = require("@google/generative-ai");

// ── Catálogo de Proyectos (Contexto para evitar alucinaciones) ────────────────

const PROJECT_CATALOG = {
  "PRO-01: Modernización Base de datos ESAV": "Proceso de migración de la base de datos de ESAV desde SQL Server 2008 hacia Azure SQL Database (versión 2022), mejorando el rendimiento, seguridad y disponibilidad del sistema.",
  "PRO-02: Gestor solicitudes": "Herramienta digital diseñada para automatizar la recepción, gestión y control de solicitudes internas dirigidas a la Oficina de Tecnología, permitiendo un manejo organizado y trazable de los requerimientos técnicos.",
  "PRO-03: Interoperabilidad entre Salas especializadas de la corporación": "Este proyecto surge como respuesta a la necesidad técnica de optimizar el intercambio de información entre las salas de la Corporación ante trámites de impugnación. Mediante una integración directa en la plataforma ESAV, se habilitó el envío digital de expedientes entre las distintas salas, sustituyendo los flujos de trabajo manuales que históricamente generaban una alta carga de reproceso. La automatización de esta funcionalidad garantiza una transición ágil de los procesos, reduciendo tiempos de espera y asegurando la integridad de la información judicial en el entorno digital.",
  "PRO-04: Modulo de Alertas de procesos Previamente Radicados en Esav (Alerta Radicado Cuestionado)": "Sistema desarrollado sobre la plataforma ESAV, orientado a la gestión, control y seguimiento de procesos previamente radicados. Este módulo permite identificar y generar alertas automáticas sobre radicados que presentan inconsistencias o requieren validación adicional, optimizando la trazabilidad y reduciendo riesgos operativos. La solución está diseñada específicamente para la Sala Civil (Secretaría), facilitando la supervisión continua de los procesos y mejorando la eficiencia en la toma de decisiones. A través de la automatización de alertas, se fortalece la gestión documental y se garantiza un control más riguroso sobre el estado de los radicados.",
  "PRO-05: Automatización del reparto de procesos disciplinarios contra procurador": "Desarrollo e implementación de un módulo especializado para la automatización del reparto y asignación de procesos disciplinarios dirigidos contra el Procurador General de la Nación. Integrado directamente al ecosistema ESAV, el sistema utiliza algoritmos de selección aleatoria para designar a los Magistrados encargados de la evaluación y conducción de las etapas procesales. Esta solución elimina la discrecionalidad en la asignación, garantizando la transparencia, la equidad en la carga prestacional y el estricto cumplimiento de los términos legales mediante una trazabilidad digital inalterable de cada sorteo.",
  "PRO-06: CLID (Conservación y localización de la Información Digital)": "Automatizar la gestión documental electrónica en sincronía con las tablas de retención documental, el portal institucional y los aplicativos que manejan las diferentes dependencias de la Corte Suprema de Justicia. Gestiona la Información Electronica que Nace y se Archiva en Corte Suprema.",
  "PRO-07: Factor Calidad": "Solución digital institucional diseñada para operacionalizar el mecanismo de evaluación interna de la Corte Suprema de Justicia, enfocado en medir el desempeño cualitativo de los despachos judiciales, magistrados y dependencias a nivel nacional. Superando el enfoque tradicional de medición por volumen de procesos, la plataforma permite estructurar, registrar y consultar la calificación de la excelencia jurídica mediante criterios técnicos específicos, facilitando la firma electrónica de las evaluaciones y garantizando la trazabilidad del proceso. Esta herramienta transforma la evaluación del Factor Calidad en un activo de información estratégica para fortalecer la carrera judicial y la mejora continua de la función jurisdiccional en Colombia.",
  "PRO-08: Migración y robustecimiento en la nube de la arquitectura de software para el sitio web": "Este proyecto tuvo como enfoques principales mejorar y estabilizar el sitio web de la Corte Suprema de Justicia, el cual inicialmente se encontraba alojado en una infraestructura local. Incluye el fortalecimiento de la postura de seguridad mediante la identificación y remediación de vulnerabilidades.",
  "PRO-09: Notificaciones electrónicas automatizadas ESAV (notificaciones automáticas sala civil)": "Solución desarrollado sobre la plataforma ESAV para la automatización del envío de notificaciones electrónicas asociadas a providencias en procesos de impugnación de tutela. El sistema programa de manera automática el envío de correos electrónicos a los sujetos procesales intervinientes, una vez se consolida la providencia, garantizando oportunidad y consistencia en la comunicación. Este módulo, implementado para la Sala Civil (Secretaría), elimina la dependencia de procesos manuales, reduce tiempos operativos y minimiza errores en la gestión de notificaciones. Como resultado, se mejora significativamente la agilidad en la administración de los procesos y se fortalece el cumplimiento de los tiempos procesales.",
  "PRO-10: GTH (Gestor de talento humano)": "GTH es una aplicación web desarrollada para modernizar y optimizar la gestión del archivo digital de historias laborales en la Corte Suprema de Justicia. Esta herramienta centraliza el registro, consulta y trazabilidad de los documentos laborales de los servidores judiciales y magistrados del país, automatizando procesos clave como nombramientos, licencias, comisiones, desvinculaciones y otras novedades administrativas. Entre sus funcionalidades destacan: generación de certificados laborales firmadas electrónicamente verificadas con código QR, reportes interactivos, organigrama actualizado de la planta de personal, creación y control de cargos y dependencias, así como la visualización estructurada de documentos históricos, alineadas con las políticas de gestión documental. Es una solución tecnológica impulsada por la Secretaría General y desarrollada por la Oficina de Tecnología como parte del compromiso con la transformación digital institucional.",
  "PRO-11: Voto electrónico": "Aplicativo interno desarrollado para la gestión y ejecución de procesos de votación en la corte, orientado a la toma de decisiones estratégicas como la elección de magistrados, candidatos a procurador, entre otros procesos institucionales de alta relevancia. El sistema opera bajo un esquema de roles diferenciados: un rol administrador (Secretaría General), encargado de la configuración del proceso —incluyendo la definición de candidatos, votantes y rondas de votación—, y un rol de votante, que permite el acceso controlado al sistema para la emisión del voto de manera segura y estructurada. La solución incorpora capacidades de actualización automática y seguimiento en tiempo real, lo que garantiza transparencia, trazabilidad y eficiencia en cada etapa del proceso. Este enfoque digital reduce la carga operativa, minimiza errores y fortalece la confiabilidad en los mecanismos de decisión institucional.",
  "PRO-12: Firma electrónica de documentos para todas las dependencias": "Servicio que permite a los funcionarios de la Corte firmar electrónicamente documentos institucionales, garantizando seguridad, trazabilidad y eficiencia en la gestión documental.",
  "PRO-13: Super Supremo para consulta de providencias": "Solución avanzada de recuperación de información jurídica diseñada para centralizar, indexar y analizar la memoria jurisprudencial de la Corte Suprema de Justicia. Mediante la integración de Inteligencia Artificial y Procesamiento de Lenguaje Natural (NLP), el sistema trasciende la búsqueda por palabras clave para permitir consultas semánticas y estructuradas sobre las providencias. Su implementación optimiza los ciclos de investigación jurídica, garantiza la relevancia de los resultados y fortalece la seguridad jurídica, facilitando un acceso ágil y preciso al conocimiento judicial tanto para la Corporación como para la ciudadanía.",
  "PRO-14: ESAV": "ESAV es el sistema de gestión procesal de la Corte Suprema de Justicia, diseñado para centralizar y optimizar la radicación y el reparto de los procesos judiciales de la Corporación. Esta plataforma permite la gestión integral de actuaciones, la notificación a sujetos procesales y la firma electrónica de documentos, culminando en la generación de sentencias y su correspondiente registro en relatoría. ESAV opera bajo un esquema de seguridad basado en roles, garantizando accesos y permisos diferenciados para Secretarías, Despachos, Magistrados y Relatoría.",
  "PRO-15: Interoperabilidad En ESAV con registraduría y RUES": "Este proyecto establece un ecosistema de interoperabilidad técnica entre la Corporación, la Registraduría Nacional del Estado Civil y el RUES, mediante el desarrollo y despliegue de una API de integración diseñada para el consumo de datos desde aplicativos core como ESAV. La solución permite la consulta automatizada y en tiempo real de información ciudadana —incluyendo el estado de cédulas, registros civiles de nacimiento y actas de defunción—, con el propósito de centralizar el acceso a fuentes primarias, eliminar procesos manuales y garantizar una respuesta ágil y directa a los requerimientos de los usuarios de la institución.",
  "PRO-16: Ciberseguridad de la información": "Programa integral de ciberseguridad institucional.",
  "PRO-17: Ventanilla Virtual Penal": "Este proyecto representa la transición de la recepción de acciones de tutela desde canales informales, como el correo electrónico, hacia una plataforma web institucional especializada. El aplicativo permite a los ciudadanos interponer acciones de tutela ante la Sala Penal de manera estructurada, capturando los datos mínimos necesarios para asegurar una radicación precisa. Esta modernización optimiza el punto de contacto inicial entre el usuario y la Corporación, garantizando que la información ingrese de forma organizada y agilizando el inicio del trámite judicial.",
  "PRO-18: Analizar la necesidad de mejorar métodos Encriptación Firma Electrónica": "Análisis para fortalecer algoritmos y mecanismos de firma electrónica.",
  "PRO-19: Modernización Chatbot \"LuCA\" Coordinación Administrativa": "LuCA es un chatbot institucional de la Coordinación Administrativa de la Corte Suprema de Justicia que automatiza la atención de consultas frecuentes, facilita el acceso a información y trámites administrativos, y mejora la eficiencia del servicio mediante atención disponible 24/7 a través de canales digitales, el número del chat bot es: 3014471317",
  "PRO-20: Gestor Despacho": "Plataforma integral de gestión del flujo de trabajo judicial diseñada para automatizar y estandarizar el ciclo de vida de los proyectos de sentencia. La solución facilita el registro centralizado, la asignación estratégica y el monitoreo en tiempo real de los estados procesales, garantizando una trazabilidad técnica absoluta desde la radicación hasta la firma. Su implementación optimiza la coordinación operativa del despacho y asegura el cumplimiento de los principios de oportunidad y celeridad, fortaleciendo la organización institucional y el control sobre la producción jurídica.",
  "PRO-21: Identidad Digital": "1. Llave única de acceso: Identidad Digital es la llave única que permite a funcionarios y servidores judiciales acceder de forma segura a todos los aplicativos de la Rama Judicial (GestorRH, gestión documental, reportes, etc.) con un solo usuario corporativo. Adiós a las contraseñas duplicadas y a la fragmentación de credenciales. 2. Gobierno y trazabilidad de accesos: Centraliza la gobernanza mediante un modelo RBAC (control de acceso basado en roles) que permite saber en tiempo real quién puede hacer qué, en qué aplicativo y con qué alcance. Cada acción queda auditada, fortaleciendo el cumplimiento normativo y la rendición de cuentas. 3. Modernización y ciberseguridad: Migra la autenticación de soluciones legadas (IdentityServer4 / .NET Core 3.1) hacia Microsoft EntraID, el estándar empresarial de identidad en la nube. Habilita MFA, acceso condicional, detección de amenazas e integración nativa con Microsoft 365 -- alineando a la Corte con las mejores prácticas internacionales. 4. Habilitador estratégico de la transformación digital: No es solo autenticación: es la base sobre la que cada nuevo aplicativo de la Rama Judicial nace con identidad, roles y permisos consistentes desde el día uno. Acelera el desarrollo, reduce costos de integración y garantiza una experiencia uniforme para todos los usuarios institucionales.",
  "PRO-22: Ventanilla Sala Civil": "Ventanilla Sala Civil es el desarrollo tecnológico especializado en la recepción y gestión inicial de procesos judiciales. Su propósito principal es optimizar la labor de los radicadores mediante la entrega de información técnica estructurada, lo que agiliza significativamente las etapas de radicación y reparto. Al estandarizar los datos de entrada, el sistema garantiza una transición eficiente de los expedientes hacia las fases de gestión procesal de la Sala Civil.",
  "PRO-23: Interoperabilidad envío de tutelas a Corte Constitucional": "Interoperabilidad C.C. es un proyecto de transformación digital diseñado para automatizar el flujo de remisión de tutelas entre la Corte Suprema de Justicia y la Corte Constitucional. A través de la integración técnica de los sistemas ESAV y SICCOR, la plataforma simplifica el envío de expedientes mediante un proceso intuitivo de selección y transmisión directa. Esta iniciativa, desarrollada en colaboración por la Corte Suprema, la Corte Constitucional y la UTDI, reduce significativamente los tiempos de trámite y las cargas administrativas, fortaleciendo la eficiencia en la comunicación entre las altas cortes.",
  "PRO-24: Automatización aplicativo de Consecutivos": "El Aplicativo de Automatización de Consecutivos es una solución técnica integrada nativamente en la plataforma ESAV, diseñada para la generación sistemática de números consecutivos para oficios y telegramas. Este módulo permite a la Corporación realizar una gestión, seguimiento y control exhaustivo de la comunicación oficial desde una infraestructura centralizada. Actualmente, su implementación en las secretarías de las salas Penal y Laboral garantiza la integridad documental y optimiza la trazabilidad de los trámites administrativos.",
  "PRO-25: Analítica de datos con I.A.": "Implementación de una solución de analítica predictiva y descriptiva basada en Inteligencia Artificial para la extracción de conocimiento desde datos no estructurados presentes en las providencias judiciales. El sistema utiliza modelos entrenados de Procesamiento de Lenguaje Natural (NLP) para identificar, extraer y estructurar variables críticas, las cuales son almacenadas en una base de datos centralizada. Actualmente, el proyecto es funcional para la casuística de delitos sexuales contra menores de 14 años, transformando textos complejos en tableros de control en Power BI que proporcionan a los Magistrados reportes estadísticos precisos para una toma de decisiones informada y basada en evidencia.",
  "PRO-26: Automatización procesos Coordinación Administrativa": "Automatización y digitalización de procesos internos.",
  "PRO-27: Evolución y modernización Índice Electrónico": "Modernización del índice electrónico institucional.",
  "PRO-28: Interoperabilidad ESAV - SGDE": "Este proyecto tiene como objetivo principal la integración técnica entre el sistema ESAV de la Corte Suprema de Justicia y el Sistema de Gestión Documental Electrónica (SGDE) del Consejo Superior de la Judicatura. A través de este desarrollo, se busca centralizar el repositorio de archivos de los procesos judiciales, garantizando la integridad y disponibilidad de la información en una plataforma única. Esta unificación facilita el flujo de retorno de los expedientes a los tribunales de origen, optimizando los tiempos de respuesta y asegurando una trazabilidad completa en la devolución de la información procesal.",
  "PRO-29: Migración Directorio Activo a Nube": "Este proyecto busca eliminar la criticidad de los servicios de identidad mediante la implementación de un Directorio Activo moderno y redundante. La solución se basa en el despliegue de controladores de dominio bajo Windows Server 2022, distribuidos estratégicamente entre la infraestructura on-premise y máquinas virtuales en Azure. Este diseño permite que la nube funcione como un nodo de respaldo activo, asegurando que los servicios de autenticación, DNS y políticas de grupo permanecezcan disponibles ante contingencias locales. La integración se completa con la sincronización hacia Microsoft Entra ID, optimizando la gestión de identidades tanto para cargas de trabajo tradicionales como para servicios en la nube.",
  "PRO-30: Interoperabilidad Firma Electrónica": "Servicios de interoperabilidad relacionados con firma electrónica.",
  "PRO-31: Chatbot": "Desarrollo de un chatbot inteligente para atención automatizada.",
  "PRO-32: Software Convocatoria": "Plataforma para gestión de convocatorias y procesos de selección.",
  "PRO-33: Ventanilla PQRS Presidencia": "Portal de gestión de PQRS de la Presidencia.",
  "PRO-34: Actualización Tecnológica Inventarios GLPI": "Actualización del sistema GLPI de inventario de activos TI.",
  "PRO-35: Métricas con Inteligencia Artificial (Prueba piloto aplicativo copilot)": "Prueba piloto para generación de métricas y análisis con IA.",
  "PRO-36: Eventos y encuentros presidencia": "Aplicativo para planificación, organización y seguimiento de eventos.",
  "PRO-37: Administración y Monitoreo Infraestructura Nube Azure": "Implementación, administración y monitoreo de servicios en Azure para garantizar seguridad, alta disponibilidad y escalabilidad.",
  "PRO-38: Gestión y Apoyo a Audiencias de la Corte Suprema de Justicia": "Agendamiento y seguimiento de audiencias presenciales y virtuales, asegurando el funcionamiento de equipos y el cargue de grabaciones.",
  "PRO-39: JSReport - Generador de Reportes": "Solución técnica integrada para la producción dinámica de informes y plantillas editables. Esta funcionalidad permite transformar información estructurada en documentos finales en formato PDF y Microsoft Word, facilitando la estandarización de reportes en todas las áreas de la corporación. Gracias a su alta flexibilidad, el sistema puede ser empleado para cualquier tipo de requerimiento documental, optimizando los tiempos de respuesta y garantizando la precisión en la presentación de la información judicial y administrativa.",
  "PRO-40: Firma Service": "Servicio en Python diseñado para insertar firmas digitales y validaciones en documentos PDF, integrado al flujo de ESAV.",
  "PRO-41: Sitio Web Ambiente ON-Premise": "Este proyecto tuvo como enfoques principales mejorar y estabilizar el sitio web de la Corte Suprema de Justicia, el cual inicialmente se encontraba alojado en una infraestructura local (conocida como on-premise). Este término significa que los servidores y sistemas que soportaban el sitio web estaban físicamente instalados y gestionados dentro de las instalaciones de la institución, a diferencia de utilizar servicios en la nube.",
  "PRO-42: Modelos de Inteligencia Artificial Aplicados a la Consulta de Jurisprudencia": "El Proyecto de extracción mediante Inteligencia Artificial consistió en el desarrollo y ejecución de un sistema de extracción automatizada de información a partir de providencias judiciales relacionadas con delitos contra menores de 14 años y casos de extradición, el objetivo fue entrenar y validar modelos de procesamiento de lenguaje natural (PLN) para identificar, extraer y clasificar datos relevantes dentro de documentos judiciales no estructurados, optimizando así la búsqueda y el análisis de este tipo de providencias.",
  "PRO-43: Proyecto Transmedia - Presidencia": "Iniciativa multimedia desarrollada durante la presidencia del Magistrado Dr. Gerson Chaverra Castro, orientada a visibilizar el trabajo de los jueces en las zonas más apartadas del país, resaltando su labor y compromiso con la justicia."
};

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

  const ts         = project.task_status || {};
  const tsDone     = (ts.completed   || []).filter(Boolean);
  const tsWip      = (ts.in_progress || []).filter(Boolean);
  const tsNotStart = (ts.not_started || []).filter(Boolean);

  const milestones = (project.milestones || []).filter(m => m.date || m.note);
  const comments   = (project.comments   || []).filter(c => c.text);

  const engLines = (project.engineers || []).map(e => {
    const name   = e.engineer_id === "Otro..." ? (e.custom_name || "—") : (e.engineer_id || "—");
    const detail = toLines(e.weekly_detail);
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
Responsable principal: ${getMainEngineer(project.engineers)}

MÉTRICAS GENERALES:
- Total actividades: ${total}
- Completadas: ${done}
- En proceso: ${wip}
- No iniciadas: ${pending}
- Avance calculado: ${pct}%
${indicators.length ? `\nINDICADORES:\n${indicators.join("\n")}` : ""}
${engLines.length ? `\nEQUIPO DE INGENIEROS (todos los integrantes del equipo — menciónalos a todos en el informe aunque no tengan actividades registradas esta semana):\n${engLines.join("\n")}` : ""}

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

INSTRUCCIONES CONTEXTUALES ESPECÍFICAS PARA ESTE PROYECTO:
${project.status === "mejora-continua" ? `⚠ CONTEXTO MEJORA CONTINUA: Este proyecto ya fue entregado y se encuentra en operación. Las actividades registradas NO son pendientes de un desarrollo en curso — son mejoras, ajustes y evoluciones planificadas sobre un sistema funcional y en producción. El informe debe reflejar un proyecto maduro en fase de evolución continua. No uses lenguaje de proyecto en construcción ("se está desarrollando", "se avanza en la implementación") — usa lenguaje de sistema en operación que evoluciona ("se incorporó la mejora", "se optimizó el componente", "se ajustó la funcionalidad").` : ""}
${/juan|steven/i.test(project.project_name || "") ? `⚠ CONTEXTO SOPORTE TRANSVERSAL: Este no es un proyecto de desarrollo convencional. Corresponde al registro de actividades de soporte técnico transversal prestado por ingenieros a múltiples proyectos de la oficina: mejoras, ajustes, soportes, cambios y apoyo a otros equipos de desarrollo. El informe debe centrarse en el volumen y variedad de actividades ejecutadas durante el periodo, destacando la diversidad del soporte técnico brindado. No apliques la lógica de avance de proyecto ni de entregables — la métrica principal es la cantidad y tipo de actividades realizadas.` : ""}
`.trim();
}

function buildPrompt(project, quarterLabel) {
  const summary = buildProjectSummary(project);

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
        "responsable": "Rol o área responsable (ej. Desarrollo, Infraestructura, Gestión) — nunca nombres propios",
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
async function generateReportWithAI(project, quarterLabel) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: buildPrompt(project, quarterLabel) },
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

module.exports = { generateReportWithAI };
