"use strict";

// backfill-attachments-to-blob.cjs — Mueve a Azure Blob Storage los adjuntos
// que quedaron subidos ANTES de la Fase 10 (Contenido poblado, BlobUrl aún
// null). Ver plan-blob-storage.md §5.5.
//
// Uso:
//   node scripts/backfill-attachments-to-blob.cjs --dry-run   (solo cuenta, no escribe nada)
//   node scripts/backfill-attachments-to-blob.cjs --apply      (sube a Blob y actualiza SQL)
//
// Idempotente por construcción: solo toca filas con BlobUrl IS NULL — una
// fila ya migrada nunca se vuelve a tocar, así que correrlo de nuevo tras un
// corte a mitad de camino retoma donde quedó, sin duplicar nada.

require("dotenv/config");
const sql = require("mssql");
const { getPool } = require("../db-operations.cjs");
const { uploadBlob } = require("../blob-storage.cjs");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY   = process.argv.includes("--apply");

async function main() {
  if (!DRY_RUN && !APPLY) {
    console.error("Uso: node scripts/backfill-attachments-to-blob.cjs --dry-run   (o --apply para escribir)");
    process.exit(1);
  }

  const pool = await getPool();
  const pendientes = await pool.request().query(`
    SELECT AppAdjuntoID, NombreArchivo, TipoMime, DATALENGTH(Contenido) AS Bytes
    FROM dbo.Actividad_Adjuntos
    WHERE BlobUrl IS NULL AND Contenido IS NOT NULL
  `);
  const filas = pendientes.recordset;
  const totalBytes = filas.reduce((sum, f) => sum + (f.Bytes || 0), 0);

  console.log(`${filas.length} adjunto(s) pendientes de migrar, ${(totalBytes / 1024 / 1024).toFixed(2)} MB en total.`);

  if (DRY_RUN) {
    console.log("\n--dry-run: no se subió ni modificó nada. Corre con --apply para migrar de verdad.");
    return;
  }

  let migrados = 0, fallidos = 0;
  for (const fila of filas) {
    try {
      // El buffer se lee aparte (no vino en el SELECT de arriba —
      // DATALENGTH evita traer todos los bytes solo para contar).
      const r = await pool.request()
        .input("appId", sql.NVarChar(60), fila.AppAdjuntoID)
        .query(`SELECT Contenido FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
      const buffer = r.recordset[0]?.Contenido;
      if (!buffer) continue; // se vació entre el SELECT de arriba y este (concurrencia) — lo recoge la próxima corrida

      const blobUrl = await uploadBlob(fila.AppAdjuntoID, buffer, fila.TipoMime);
      await pool.request()
        .input("appId", sql.NVarChar(60), fila.AppAdjuntoID)
        .input("blobUrl", sql.NVarChar(1000), blobUrl)
        .query(`UPDATE dbo.Actividad_Adjuntos SET BlobUrl = @blobUrl, Contenido = NULL WHERE AppAdjuntoID = @appId`);

      migrados++;
      console.log(`  ✓ ${fila.AppAdjuntoID} (${fila.NombreArchivo})`);
    } catch (e) {
      fallidos++;
      console.error(`  ✗ ${fila.AppAdjuntoID} (${fila.NombreArchivo}): ${e.message}`);
    }
  }

  console.log(`\nMigrados: ${migrados}. Fallidos: ${fallidos} (quedan con Contenido intacto, reintentables corriendo de nuevo).`);
  console.log("Verificar: SELECT SUM(DATALENGTH(Contenido)) FROM dbo.Actividad_Adjuntos debe bajar a 0 (o solo los fallidos).");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("Error fatal:", e); process.exit(1); });
