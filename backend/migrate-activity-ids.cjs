// migrate-activity-ids.cjs — Migra activities_identified de array de strings a array de {id, text}.
//
// Por qué: antes, comentarios/fechas/estado referenciaban la actividad por el texto
// "N. texto" (número de posición + texto). Borrar o reordenar actividades desplazaba
// las posiciones y rompía esas referencias (quedaban pegadas a la actividad equivocada).
// Ahora cada actividad tiene un id estable que nunca cambia; todo lo demás referencia el id.
//
// Uso:
//   node migrate-activity-ids.cjs           → migra backend/data.json y backend/history.json
//   node migrate-activity-ids.cjs --dry-run → solo reporta, no escribe nada
//
// Es idempotente: si una actividad ya es {id, text} (formato nuevo), el proyecto se salta.

const fs   = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");

function genActivityId() {
  return "act_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// Algunos snapshots de history.json son anteriores a la migración legada de
// comments/milestones (string → array) que server.cjs aplica solo sobre data.json.
// Se normaliza aquí también para poder migrar IDs sin reventar con datos viejos.
function normalizeLegacyArrayFields(project) {
  const needsMigration =
    typeof project.activities_identified === "string" ||
    typeof project.weekly_achievements   === "string" ||
    typeof project.next_week_plan        === "string" ||
    typeof project.milestones            === "string" ||
    typeof project.comments              === "string";
  if (!needsMigration) return project;

  const milestonesArr = typeof project.milestones === "string" && project.milestones.trim()
    ? toArr(project.milestones).map(note => ({ activity: "", date: "", note }))
    : (Array.isArray(project.milestones) ? project.milestones : []);

  const commentsArr = typeof project.comments === "string" && project.comments.trim()
    ? toArr(project.comments).map(text => ({ activity: "", date: "", text }))
    : (Array.isArray(project.comments) ? project.comments : []);

  return {
    ...project,
    activities_identified: toArr(project.activities_identified),
    weekly_achievements:   toArr(project.weekly_achievements),
    next_week_plan:        toArr(project.next_week_plan),
    milestones:            milestonesArr,
    comments:              commentsArr,
    engineers: (project.engineers || []).map(e => ({
      ...e,
      weekly_detail: toArr(e.weekly_detail),
    })),
  };
}

function isAlreadyMigrated(activities) {
  return Array.isArray(activities) && activities.length > 0 && typeof activities[0] === "object" && activities[0] !== null;
}

// Migra un proyecto. Devuelve { project, report } donde report tiene conteos para verificación.
function migrateProject(rawProject) {
  const project = normalizeLegacyArrayFields(rawProject);
  const oldActs = project.activities_identified;
  if (!Array.isArray(oldActs)) return { project, report: null };
  if (isAlreadyMigrated(oldActs)) return { project, report: { name: project.project_name, skipped: true } };

  const newActs = oldActs.map(text => ({ id: genActivityId(), text }));

  const keyToId = new Map();
  oldActs.forEach((text, i) => keyToId.set(`${i + 1}. ${text}`, newActs[i].id));

  let orphans = 0;
  const remapKey = (k) => {
    if (k == null || k === "") return k;
    if (keyToId.has(k)) return keyToId.get(k);
    orphans++;
    return k; // referencia huérfana preexistente — se conserva tal cual para inspección manual
  };
  const remapArr = (arr) => (Array.isArray(arr) ? arr.map(remapKey) : arr);
  const remapObjKeys = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [remapKey(k), v]));
  };

  const ts = project.task_status && typeof project.task_status === "object" ? project.task_status : {};

  const migrated = {
    ...project,
    activities_identified: newActs,
    task_status: {
      ...ts,
      completed:       remapArr(ts.completed),
      in_progress:     remapArr(ts.in_progress),
      not_started:     remapArr(ts.not_started),
      completed_dates: remapObjKeys(ts.completed_dates),
      status_history:  remapObjKeys(ts.status_history),
    },
    weekly_achievements: remapArr(project.weekly_achievements),
    next_week_plan:      remapArr(project.next_week_plan),
    engineers: (project.engineers || []).map(e => ({ ...e, weekly_detail: remapArr(e.weekly_detail) })),
    milestones: (project.milestones || []).map(m => ({ ...m, activity: m.activity ? remapKey(m.activity) : m.activity })),
    comments:   (project.comments   || []).map(c => ({ ...c, activity: c.activity ? remapKey(c.activity) : c.activity })),
  };

  return {
    project: migrated,
    report: {
      name: project.project_name,
      activities: oldActs.length,
      orphans,
    },
  };
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = filePath.replace(/\.json$/, `.migration-backup-${stamp}.json`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

function migrateDataFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIP] ${filePath} no existe`);
    return;
  }
  const raw  = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(raw.projects) || !raw.projects.length) {
    console.log(`[SKIP] ${filePath} no tiene proyectos`);
    return;
  }

  const reports = [];
  raw.projects = raw.projects.map(p => {
    const { project, report } = migrateProject(p);
    if (report) reports.push(report);
    return project;
  });

  console.log(`\n=== ${path.basename(filePath)} ===`);
  reports.forEach(r => {
    if (r.skipped) console.log(`  [YA MIGRADO] ${r.name}`);
    else console.log(`  [OK] ${r.name}: ${r.activities} actividades${r.orphans ? ` — ⚠ ${r.orphans} referencias huérfanas preexistentes` : ""}`);
  });

  if (DRY_RUN) {
    console.log(`  (dry-run: no se escribió ${filePath})`);
    return;
  }

  const backup = backupFile(filePath);
  if (backup) console.log(`  Backup creado: ${backup}`);
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
  console.log(`  Escrito: ${filePath}`);
}

function migrateHistoryFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIP] ${filePath} no existe`);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(raw.reports) || !raw.reports.length) {
    console.log(`[SKIP] ${filePath} no tiene reportes`);
    return;
  }

  let totalProjects = 0;
  let totalOrphans  = 0;
  raw.reports.forEach(entry => {
    if (!Array.isArray(entry.projects)) return;
    entry.projects = entry.projects.map(p => {
      const { project, report } = migrateProject(p);
      if (report && !report.skipped) {
        totalProjects++;
        totalOrphans += report.orphans || 0;
      }
      return project;
    });
  });

  console.log(`\n=== ${path.basename(filePath)} ===`);
  console.log(`  ${raw.reports.length} snapshots semanales, ${totalProjects} proyectos migrados${totalOrphans ? `, ⚠ ${totalOrphans} referencias huérfanas preexistentes` : ""}`);

  if (DRY_RUN) {
    console.log(`  (dry-run: no se escribió ${filePath})`);
    return;
  }

  const backup = backupFile(filePath);
  if (backup) console.log(`  Backup creado: ${backup}`);
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
  console.log(`  Escrito: ${filePath}`);
}

function main() {
  console.log(DRY_RUN ? "Modo DRY-RUN — no se escribirá ningún archivo.\n" : "Migrando activities_identified a IDs estables...\n");
  migrateDataFile(path.join(__dirname, "data.json"));
  migrateHistoryFile(path.join(__dirname, "history.json"));
  console.log("\nListo.");
}

main();
