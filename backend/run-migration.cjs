"use strict";

require("dotenv/config");
const fs   = require("fs");
const path = require("path");
const sql  = require("mssql");

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

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: node run-migration.cjs migrations/005_add_solucion.sql");
    process.exit(1);
  }

  const fullPath = path.resolve(__dirname, file);
  const script = fs.readFileSync(fullPath, "utf8");

  console.log(`Conectando a ${config.server}/${config.database} como ${config.user}...`);
  const pool = await sql.connect(config);

  console.log(`Ejecutando ${file}...`);
  const result = await pool.request().query(script);
  if (result.recordsets?.length) console.log(result.recordsets);

  await pool.close();
  console.log("Migración completada.");
}

main().catch(e => {
  console.error("Error ejecutando migración:", e.message);
  process.exit(1);
});
