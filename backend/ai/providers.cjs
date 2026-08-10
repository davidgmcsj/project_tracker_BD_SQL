// providers.cjs — Clientes de bajo nivel para cada proveedor de IA
// (Gemini, OpenRouter, Groq) y el parser de respuesta JSON compartido.

const Groq                   = require("groq-sdk");
const https                  = require("https");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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

async function callGroq(messages, apiKey) {
  const groq       = new Groq({ apiKey });
  const completion = await groq.chat.completions.create({
    model:           "llama-3.3-70b-versatile",
    temperature:     0.3,
    messages,
    response_format: { type: "json_object" },
  });
  return completion.choices[0]?.message?.content || "";
}

module.exports = {
  OPENROUTER_MODELS, GEMINI_MODELS,
  parseAIResponse, callOpenRouter, callGemini, callGroq,
};
