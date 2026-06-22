// migrate-engineer-catalog.cjs — Crea el catálogo data.engineers y migra engineers[].engineer_id
// en cada proyecto de data.json, de nombre libre (o "Otro..."+custom_name) a id estable de catálogo.
//
// Por qué: antes, "ingeniero" era solo un string suelto (de ENGINEER_LIST hardcodeada en
// EditView.jsx, o un nombre libre vía "Otro..."). Para la vista por ingeniero (agregación
// cross-proyecto) se necesita una entidad real con id estable — mismo patrón que ya se usó
// para activities_identified (migrate-activity-ids.cjs).
//
// Alcance: SOLO migra backend/data.json (estado actual). NO toca backend/history.json:
// los snapshots semanales quedan congelados con el engineer_id que tenían en su momento,
// igual como ya pasa con activities_identified en los snapshots históricos.
//
// Uso:
//   node migrate-engineer-catalog.cjs           → migra backend/data.json
//   node migrate-engineer-catalog.cjs --dry-run → solo reporta, no escribe nada
//
// Es idempotente: si data.engineers ya existe y no está vacío, se asume ya migrado y se sale.

const fs   = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");

// Mismo orden que ENGINEER_LIST en frontend/src/components/EditView.jsx (sin "Otro...").
const ENGINEER_LIST = [
  "Alvaro Antonio Baena Rubio",
  "Andres Esteban Romero Romero",
  "Aseneth Quintero Bernate",
  "Brayan Jair Robayo Vera",
  "Cristian Mauricio Ortegon Martinez",
  "David Alejandro Gonzalez Mateus",
  "David Alzate Gomez",
  "Emirt Lorenzo Adams Saenz",
  "Ingrid Jhulieth Estacio Carvajal",
  "John Ervey Sanchez Velandia",
  "Juan Carlos Verano Estrada",
  "Moises Bernardo Suarez Gamez",
  "Oscar Andres Mancera Garzón",
  "Steven Osorio Tipan",
];

function genEngineerId() {
  return "eng_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normName(name) {
  return (name || "").trim().toLowerCase();
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = filePath.replace(/\.json$/, `.engineer-migration-backup-${stamp}.json`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

function main() {
  console.log(DRY_RUN ? "Modo DRY-RUN — no se escribirá nada.\n" : "Migrando catálogo de ingenieros...\n");

  const dataPath = path.join(__dirname, "data.json");
  if (!fs.existsSync(dataPath)) {
    console.log("[SKIP] data.json no existe");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  if (Array.isArray(raw.engineers) && raw.engineers.length) {
    console.log("[SKIP] data.engineers ya existe y no está vacío — se asume ya migrado.");
    return;
  }
  if (!Array.isArray(raw.projects) || !raw.projects.length) {
    console.log("[SKIP] data.json no tiene proyectos");
    return;
  }

  // 1. Catálogo base desde ENGINEER_LIST.
  const catalog  = [];
  const idByName = new Map(); // nombre normalizado -> id

  ENGINEER_LIST.forEach(name => {
    const eng = { id: genEngineerId(), name, role: "", active: true, created_at: today(), tasks: [] };
    catalog.push(eng);
    idByName.set(normName(name), eng.id);
  });

  // 2. Escanear proyectos por nombres "Otro..." + custom_name no presentes ya en el catálogo.
  const customNames = new Set();
  raw.projects.forEach(p => {
    (p.engineers || []).forEach(e => {
      if (e.engineer_id === "Otro..." && e.custom_name && e.custom_name.trim()) {
        const norm = normName(e.custom_name);
        if (!idByName.has(norm)) customNames.add(e.custom_name.trim());
      }
    });
  });
  customNames.forEach(name => {
    const eng = { id: genEngineerId(), name, role: "", active: true, created_at: today(), tasks: [] };
    catalog.push(eng);
    idByName.set(normName(name), eng.id);
  });

  console.log(`Catálogo: ${ENGINEER_LIST.length} de ENGINEER_LIST + ${customNames.size} nombres "Otro..." = ${catalog.length} ingenieros.\n`);

  // 3. Remapear engineers[].engineer_id en cada proyecto.
  let remapped = 0, orphans = 0;
  raw.projects.forEach(p => {
    p.engineers = (p.engineers || []).map(e => {
      let name;
      if (e.engineer_id === "Otro...") name = e.custom_name || "";
      else name = e.engineer_id || "";

      const id = idByName.get(normName(name));
      if (!name) return { ...e, engineer_id: "" }; // sin ingeniero asignado — se conserva vacío
      if (!id) {
        console.log(`  [ORPHAN] ${p.project_name}: "${name}" no calza con ningún ingeniero del catálogo`);
        orphans++;
        return e; // se deja sin tocar para inspección manual
      }
      remapped++;
      const { custom_name, ...rest } = e;
      return { ...rest, engineer_id: id };
    });
  });

  console.log(`Referencias remapeadas: ${remapped}${orphans ? ` — ⚠ ${orphans} huérfanas` : ""}\n`);

  raw.engineers = catalog;

  if (DRY_RUN) {
    console.log("(dry-run: no se escribió data.json)");
    return;
  }

  const backup = backupFile(dataPath);
  if (backup) console.log(`Backup creado: ${backup}`);
  fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2));
  console.log(`Escrito: ${dataPath}`);
  console.log("\nNota: backend/history.json NO se modifica — los snapshots históricos quedan");
  console.log("congelados con el engineer_id/custom_name que tenían en su momento.");
}

main();
