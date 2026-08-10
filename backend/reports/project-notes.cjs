"use strict";

// ── Notas de proyecto (Fase 3) ───────────────────────────────────────────────
// CRUD simple sobre Proyecto_Notas, con AppNotaID (note_xxx) como referencia
// estable del lado app — mismo patrón que act_xxx/chk_xxx del resto del modelo.

const sql = require("mssql");

const TIPOS_VALIDOS = ["comentario", "decision", "riesgo", "compromiso"];

async function listNotes(pool, proyectoAppID) {
  const res = await pool.request()
    .input("proyId", sql.NVarChar(60), proyectoAppID)
    .query(`
      SELECT AppNotaID, Fecha, Autor, Tipo, Texto, IncluirEnReporte
      FROM Proyecto_Notas
      WHERE AppProyectoID = @proyId
      ORDER BY Fecha DESC, NotaID DESC
    `);
  return res.recordset.map(r => ({
    id:                  r.AppNotaID,
    date:                r.Fecha ? r.Fecha.toISOString().slice(0, 10) : "",
    author:              r.Autor || "",
    type:                r.Tipo,
    text:                r.Texto,
    include_in_report:   !!r.IncluirEnReporte,
  }));
}

// Upsert por AppNotaID: si existe, actualiza; si no, inserta. `nota` viene
// del frontend con la forma { id, proyectoAppID, date, author, type, text, include_in_report }.
async function upsertNote(pool, nota) {
  const tipo = TIPOS_VALIDOS.includes(nota.type) ? nota.type : "comentario";

  const existing = await pool.request()
    .input("appId", sql.NVarChar(60), nota.id)
    .query("SELECT NotaID FROM Proyecto_Notas WHERE AppNotaID = @appId");

  if (existing.recordset.length) {
    await pool.request()
      .input("appId",   sql.NVarChar(60),  nota.id)
      .input("fecha",   sql.Date,          nota.date || null)
      .input("autor",   sql.NVarChar(150), nota.author || null)
      .input("tipo",    sql.NVarChar(20),  tipo)
      .input("texto",   sql.NVarChar(sql.MAX), nota.text || "")
      .input("incluir", sql.Bit,           nota.include_in_report !== false)
      .query(`
        UPDATE Proyecto_Notas
        SET Fecha=@fecha, Autor=@autor, Tipo=@tipo, Texto=@texto, IncluirEnReporte=@incluir
        WHERE AppNotaID=@appId
      `);
    return { id: nota.id, created: false };
  }

  await pool.request()
    .input("appId",    sql.NVarChar(60),  nota.id)
    .input("proyId",   sql.NVarChar(60),  nota.proyectoAppID)
    .input("fecha",    sql.Date,          nota.date || null)
    .input("autor",    sql.NVarChar(150), nota.author || null)
    .input("tipo",     sql.NVarChar(20),  tipo)
    .input("texto",    sql.NVarChar(sql.MAX), nota.text || "")
    .input("incluir",  sql.Bit,           nota.include_in_report !== false)
    .query(`
      INSERT INTO Proyecto_Notas (AppNotaID, AppProyectoID, Fecha, Autor, Tipo, Texto, IncluirEnReporte)
      VALUES (@appId, @proyId, @fecha, @autor, @tipo, @texto, @incluir)
    `);
  return { id: nota.id, created: true };
}

async function deleteNote(pool, appNotaID) {
  await pool.request()
    .input("appId", sql.NVarChar(60), appNotaID)
    .query("DELETE FROM Proyecto_Notas WHERE AppNotaID = @appId");
}

module.exports = { listNotes, upsertNote, deleteNote, TIPOS_VALIDOS };
