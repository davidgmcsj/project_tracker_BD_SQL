// backfill-engineer-sql-ids.cjs — Asigna sql_id (IngenieroID real de Azure SQL) a cada
// ingeniero del catálogo local (data.engineers), cruzando por nombre exacto.
//
// Por qué: con la sincronización nueva, cada ingeniero local guarda el IngenieroID de
// SQL para que crear/editar/desactivar lo actualice directo, sin depender del
// fuzzy-match de resolveEngineer. Los 15 ingenieros migrados en la sesión anterior
// (migrate-engineer-catalog.cjs) nunca tuvieron sql_id — este script se los asigna
// retroactivamente, sin tocar nada en SQL (solo lee).
//
// Nombres duplicados en SQL: la tabla Ingenieros tiene varias filas para el mismo
// nombre (creadas por el fuzzy-match antiguo cuando no encontraba la existente).
// Verificado con datos reales: el IngenieroID más antiguo por nombre es siempre el
// que tiene todo el historial de reportes; los duplicados más nuevos están vacíos
// (0 filas en Estadisticas_Ingeniero_Semana). Este script elige siempre el ID más
// bajo por nombre — no borra ni toca los duplicados, solo los ignora.
//
// Uso:
//   node backfill-engineer-sql-ids.cjs           → asigna sql_id en backend/data.json
//   node backfill-engineer-sql-ids.cjs --dry-run → solo reporta, no escribe nada

require("dotenv/config");
const sql  = require("mssql");
const fs   = require("fs");
const path = require("path");

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

function normName(name) {
  return (name || "").trim().toLowerCase();
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp  = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = filePath.replace(/\.json$/, `.sqlid-backfill-backup-${stamp}.json`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

async function main() {
  console.log(DRY_RUN ? "Modo DRY-RUN — no se escribirá nada.\n" : "Asignando sql_id a ingenieros del catálogo local...\n");

  const dataPath = path.join(__dirname, "data.json");
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  if (!Array.isArray(raw.engineers) || !raw.engineers.length) {
    console.log("[SKIP] data.engineers vacío o no existe.");
    return;
  }

  const pool = await sql.connect(config);
  console.log(`Conectado a ${config.server} / ${config.database}\n`);

  const result = await pool.request().query("SELECT IngenieroID, Nombre FROM Ingenieros ORDER BY IngenieroID");
  await pool.close();

  // Por nombre, el IngenieroID más bajo (más antiguo) gana — los duplicados se ignoran.
  const idByName = new Map();
  result.recordset.forEach(row => {
    const key = normName(row.Nombre);
    if (!idByName.has(key)) idByName.set(key, row.IngenieroID);
  });

  let assigned = 0, alreadyHad = 0, notFound = 0;
  raw.engineers = raw.engineers.map(eng => {
    if (eng.sql_id) { alreadyHad++; return eng; }
    const sqlId = idByName.get(normName(eng.name));
    if (!sqlId) {
      console.log(`  [NO ENCONTRADO] "${eng.name}" no existe en la tabla Ingenieros — quedará sin sql_id (se creará en SQL la próxima vez que se edite).`);
      notFound++;
      return eng;
    }
    console.log(`  [OK] "${eng.name}" -> IngenieroID ${sqlId}`);
    assigned++;
    return { ...eng, sql_id: sqlId };
  });

  console.log(`\nResumen: ${assigned} asignados, ${alreadyHad} ya tenían sql_id, ${notFound} sin coincidencia en SQL.`);

  if (DRY_RUN) {
    console.log("\n(dry-run: no se escribió data.json)");
    return;
  }
  if (!assigned) {
    console.log("\nNada que escribir.");
    return;
  }

  const backup = backupFile(dataPath);
  if (backup) console.log(`Backup creado: ${backup}`);
  fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2));
  console.log(`Escrito: ${dataPath}`);
}

main().catch(e => {
  console.error("Error en el backfill:", e.message);
  process.exit(1);
});
