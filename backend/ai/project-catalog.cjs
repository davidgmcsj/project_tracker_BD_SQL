// project-catalog.cjs — Resuelve la descripción técnica de un proyecto a
// partir del catálogo estático, usada como contexto para evitar
// alucinaciones de la IA sobre qué hace cada proyecto.

const PROJECT_CATALOG = require("../project-catalog.json");

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

module.exports = { getProjectDescription };
