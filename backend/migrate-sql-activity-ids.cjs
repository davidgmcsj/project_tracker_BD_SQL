// migrate-sql-activity-ids.cjs — Migra RawDataJSON en Azure SQL a IDs estables de actividad.
//
// Por qué: ReportesSemanales.RawDataJSON guarda el JSON completo de cada proyecto,
// con el mismo formato que data.json/history.json. Ya se migró activities_identified
// de array de strings a array de {id, text} en esos archivos locales — esta es la
// misma migración, pero sobre la columna RawDataJSON en la base de datos. Es la
// ÚNICA columna que lo necesita: /api/restore-from-db es la única ruta que vuelve
// a leer ese JSON hacia la app. El resto de las tablas (Estado_Actividades_Reporte,
// Eventos_Reporte, Estadisticas_Ingeniero_Semana) son snapshots de solo texto que
// se borran y reescriben completos en cada guardado — ya quedan bien con el próximo
// /api/report, no necesitan migración histórica.
//
// Uso:
//   node migrate-sql-activity-ids.cjs --dry-run   → solo reporta, no escribe en la BD
//   node migrate-sql-activity-ids.cjs             → migra de verdad (pide confirmación)
//
// Antes de tocar la BD, exporta un backup local de los RawDataJSON originales
// (backend/sql-rawdata-backup-<timestamp>.json) para poder revertir manualmente si algo sale mal.
//
// Es idempotente: si una fila ya tiene activities_identified en formato {id,text}, se salta.

require("dotenv/config");
const sql  = require("mssql");
const fs   = require("fs");
const path = require("path");
const readline = require("readline");

const DRY_RUN = process.argv.includes("--dry-run");

const config = {
  user:              process.env.DB_USER,
  password:          process.env.DB_PASSWORD,
  server:            process.env.DB_SERVER || "localhost",
  port:              1433,
  database:          process.env.DB_NAME,
  connectionTimeout: 60000,
  requestTimeout:    60000,
  options:           { encrypt: true, trustServerCertificate: true },
};

function genActivityId() {
  return "act_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

function isAlreadyMigrated(activities) {
  return Array.isArray(activities) && activities.length > 0 && typeof activities[0] === "object" && activities[0] !== null;
}

// Misma normalización legado que migrate-activity-ids.cjs, por si algún RawDataJSON
// antiguo nunca pasó por la migración string→array de comments/milestones.
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
    engineers: (project.engineers || []).map(e => ({ ...e, weekly_detail: toArr(e.weekly_detail) })),
  };
}

// Idéntica lógica a migrate-activity-ids.cjs (mismo contrato de migración por proyecto).
function migrateProject(rawProject) {
  const project = normalizeLegacyArrayFields(rawProject);
  const oldActs = project.activities_identified;
  if (!Array.isArray(oldActs)) return { project, report: null };
  if (isAlreadyMigrated(oldActs)) return { project, report: { skipped: true } };

  const newActs = oldActs.map(text => ({ id: genActivityId(), text }));
  const keyToId = new Map();
  oldActs.forEach((text, i) => keyToId.set(`${i + 1}. ${text}`, newActs[i].id));

  let orphans = 0;
  const remapKey = (k) => {
    if (k == null || k === "") return k;
    if (keyToId.has(k)) return keyToId.get(k);
    orphans++;
    return k;
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

  return { project: migrated, report: { activities: oldActs.length, orphans } };
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

async function main() {
  console.log(DRY_RUN ? "Modo DRY-RUN — no se escribirá nada en la base de datos.\n" : "Migrando RawDataJSON en Azure SQL...\n");

  const pool = await sql.connect(config);
  console.log(`Conectado a ${config.server} / ${config.database}\n`);

  const result = await pool.request().query(
    "SELECT ReporteID, RawDataJSON FROM ReportesSemanales WHERE RawDataJSON IS NOT NULL AND RawDataJSON != ''"
  );

  console.log(`Filas con RawDataJSON: ${result.recordset.length}\n`);

  const backupRows = [];
  const updates     = []; // { ReporteID, newJson }
  let migratedCount = 0, skippedCount = 0, errorCount = 0, orphanTotal = 0;

  for (const row of result.recordset) {
    let parsed;
    try {
      parsed = JSON.parse(row.RawDataJSON);
    } catch (e) {
      console.log(`[ERROR] ReporteID ${row.ReporteID}: RawDataJSON no es JSON válido — se omite (${e.message})`);
      errorCount++;
      continue;
    }

    const { project, report } = migrateProject(parsed);
    if (!report || report.skipped) { skippedCount++; continue; }

    backupRows.push({ ReporteID: row.ReporteID, RawDataJSON: row.RawDataJSON });
    updates.push({ ReporteID: row.ReporteID, newJson: JSON.stringify(project) });
    migratedCount++;
    orphanTotal += report.orphans || 0;
    console.log(`[OK] ReporteID ${row.ReporteID} (${project.project_name || "sin nombre"}): ${report.activities} actividades${report.orphans ? ` — ⚠ ${report.orphans} referencias huérfanas preexistentes` : ""}`);
  }

  console.log(`\nResumen: ${migratedCount} para migrar, ${skippedCount} ya migradas, ${errorCount} con error de parseo${orphanTotal ? `, ⚠ ${orphanTotal} referencias huérfanas preexistentes` : ""}.`);

  if (!updates.length) {
    console.log("Nada que migrar.");
    await pool.close();
    return;
  }

  if (DRY_RUN) {
    console.log("\n(dry-run: no se escribió nada en la BD)");
    await pool.close();
    return;
  }

  const stamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `sql-rawdata-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(backupRows, null, 2));
  console.log(`\nBackup de los ${backupRows.length} valores originales guardado en: ${backup}`);

  const answer = await confirm(`\n¿Confirmas escribir ${updates.length} filas en ReportesSemanales.RawDataJSON? (escribe "si" para continuar): `);
  if (answer !== "si" && answer !== "sí") {
    console.log("Cancelado por el usuario. No se escribió nada.");
    await pool.close();
    return;
  }

  let written = 0;
  for (const { ReporteID, newJson } of updates) {
    await pool.request()
      .input("rid",  sql.Int,      ReporteID)
      .input("json", sql.NVarChar, newJson)
      .query("UPDATE ReportesSemanales SET RawDataJSON = @json WHERE ReporteID = @rid");
    written++;
  }
  console.log(`\nListo. ${written} filas actualizadas.`);

  await pool.close();
}

main().catch(e => {
  console.error("Error en la migración:", e.message);
  process.exit(1);
});
