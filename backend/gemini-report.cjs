// gemini-report.cjs — Fachada. La lógica real vive en ./ai/*:
// providers.cjs (clientes de Gemini/OpenRouter/Groq), project-catalog.cjs
// (descripciones de proyecto), project-summary.cjs (resumen para el prompt),
// prompts.cjs (plantillas) y report-generator.cjs (orquestación por tipo de
// informe). Se mantiene este archivo para no tocar los require() existentes.

module.exports = require("./ai/report-generator.cjs");
