// report-generator.cjs — Orquesta la cadena de proveedores de IA (Gemini →
// OpenRouter → Groq) para cada tipo de informe. Cada función mantiene su
// propio logging tal como estaba antes de la división en módulos: no son
// idénticas entre sí (distinto tag de log, distinto detalle en el mensaje
// de "sin proveedor configurado"), así que no se unifican en un helper
// genérico para no cambiar el comportamiento observable en logs.

const Groq = require("groq-sdk");
const { parseAIResponse, callOpenRouter, callGemini } = require("./providers.cjs");
const { SYSTEM_PROMPT, buildPrompt, buildStatusPrompt, buildGlobalStatusPrompt } = require("./prompts.cjs");

// ── Informe semanal por proyecto ─────────────────────────────────────────────
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
