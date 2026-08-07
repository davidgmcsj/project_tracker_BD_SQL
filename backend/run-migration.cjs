"use strict";

require("dotenv/config");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const sql    = require("mssql");
const { buildConfig } = require("./db/pool.cjs");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Configuración compartida con db-operations.cjs (db/pool.cjs). Sin sección
// `pool`: el runner abre una conexión, aplica las migraciones y termina.
// trustServerCertificate se fuerza a true — este script se ejecuta a mano
// desde una máquina de operaciones, no dentro del servidor de producción.
const config = buildConfig({ withPool: false, trustServerCertificate: true });

function checksumOf(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function ensureControlTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Migraciones_Aplicadas')
    BEGIN
      CREATE TABLE Migraciones_Aplicadas (
        Nombre      NVARCHAR(200) PRIMARY KEY,
        AplicadaEn  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        Checksum    CHAR(64) NULL
      );
    END
  `);
}

async function getAppliedNames(pool) {
  const res = await pool.request().query("SELECT Nombre FROM Migraciones_Aplicadas");
  return new Set(res.recordset.map(r => r.Nombre));
}

// Corre un script dentro de una transacción y registra su checksum al final.
// Si el script falla a mitad de camino, la transacción revierte todo su
// contenido — no queda un ALTER TABLE aplicado sin su índice, por ejemplo.
async function runOne(pool, file) {
  const fullPath = path.join(MIGRATIONS_DIR, file);
  const script = fs.readFileSync(fullPath, "utf8");
  const hash = checksumOf(script);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).query(script);
    await new sql.Request(tx)
      .input("nombre", sql.NVarChar(200), file)
      .input("checksum", sql.Char(64), hash)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM Migraciones_Aplicadas WHERE Nombre = @nombre)
          INSERT INTO Migraciones_Aplicadas (Nombre, Checksum) VALUES (@nombre, @checksum)
        ELSE
          UPDATE Migraciones_Aplicadas SET Checksum = @checksum WHERE Nombre = @nombre
      `);
    await tx.commit();
    console.log(`✓ ${file}`);
  } catch (e) {
    await tx.rollback();
    console.error(`✗ ${file}: ${e.message}`);
    throw e;
  }
}

// Modo histórico: un archivo pasado como argumento, sin control de estado.
// Se mantiene para migraciones puntuales fuera de la carpeta migrations/.
async function runSingleFileMode(pool, file) {
  console.log(`Ejecutando ${file}...`);
  const fullPath = path.resolve(__dirname, file);
  const script = fs.readFileSync(fullPath, "utf8");
  const result = await pool.request().query(script);
  if (result.recordsets?.length) console.log(result.recordsets);
  console.log("Migración completada.");
}

// Modo por defecto: aplica todas las migraciones de migrations/ que todavía
// no estén registradas en Migraciones_Aplicadas, en orden alfabético (los
// nombres empiezan con número de 3 dígitos, así que coincide con el orden
// de creación).
async function runAllPendingMode(pool) {
  await ensureControlTable(pool);
  const applied = await getAppliedNames(pool);
  const all = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  const pending = all.filter(f => !applied.has(f));

  if (!pending.length) {
    console.log("0 migraciones pendientes.");
    return;
  }

  console.log(`${pending.length} migraciones pendientes: ${pending.join(", ")}`);
  for (const file of pending) {
    await runOne(pool, file);
  }
  console.log("Migraciones aplicadas.");
}

async function main() {
  const file = process.argv[2];
  console.log(`Conectando a ${config.server}/${config.database} como ${config.user}...`);
  const pool = await sql.connect(config);

  try {
    if (file) await runSingleFileMode(pool, file);
    else await runAllPendingMode(pool);
  } finally {
    await pool.close();
  }
}

main().catch(e => {
  console.error("Error ejecutando migración:", e.message);
  process.exit(1);
});
