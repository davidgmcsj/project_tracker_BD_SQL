"use strict";

// ── Reportes guardados (Fase 6) ──────────────────────────────────────────────
// CRUD simple sobre Reportes_Guardados. Config se guarda y se devuelve como
// JSON opaco — la validación real ocurre en query-builder.cjs cuando el
// frontend vuelve a correr la consulta guardada, no aquí.

const sql = require("mssql");

async function listSaved(pool) {
  const res = await pool.request().query(`
    SELECT ReporteID, Nombre, Config, Autor, EsPlantillaSistema, CreadoEn
    FROM Reportes_Guardados
    ORDER BY CreadoEn DESC
  `);
  return res.recordset.map(r => ({
    id:       r.ReporteID,
    nombre:   r.Nombre,
    config:   JSON.parse(r.Config),
    autor:    r.Autor || "",
    creadoEn: r.CreadoEn,
  }));
}

async function createSaved(pool, { nombre, config, autor }) {
  const ins = await pool.request()
    .input("nombre", sql.NVarChar(150), nombre)
    .input("config", sql.NVarChar(sql.MAX), JSON.stringify(config))
    .input("autor",  sql.NVarChar(150), autor || null)
    .query(`
      INSERT INTO Reportes_Guardados (Nombre, Config, Autor)
      OUTPUT INSERTED.ReporteID
      VALUES (@nombre, @config, @autor)
    `);
  return { id: ins.recordset[0].ReporteID };
}

async function deleteSaved(pool, id) {
  await pool.request()
    .input("id", sql.Int, id)
    .query("DELETE FROM Reportes_Guardados WHERE ReporteID = @id");
}

module.exports = { listSaved, createSaved, deleteSaved };
