"use strict";

// engineers.repo.cjs — Sync del catálogo de ingenieros y colaboradores
// externos con Azure SQL.
//
// resolveEngineer es la ÚNICA función interna (no exportada por
// db-operations.cjs): la usa saveProject (weekly-report.repo.cjs) como
// fallback de compatibilidad cuando un ingeniero del reporte todavía no
// tiene sql_id resuelto — el camino normal es que ya venga resuelto vía
// syncEngineerToSQL desde que se creó/editó en la app.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");

// ── Resolve por nombre con fuzzy-match (compatibilidad) ───────────────────────

async function resolveEngineer(pool, rawName, engCache) {
  const name = (rawName || "").trim();
  if (!name || name === "Otro...") return null;

  const parts = name.split(/\s+/).filter(Boolean);

  const exact = engCache.find(r => r.Nombre === name);
  if (exact) return exact.IngenieroID;

  for (const row of engCache) {
    const dbParts = row.Nombre.split(/\s+/).filter(Boolean);
    const matches = parts.filter(p => dbParts.some(d => d.toLowerCase() === p.toLowerCase()));
    if (matches.length >= 2) return row.IngenieroID;
  }

  const ins = await pool.request()
    .input("nombre", sql.NVarChar, name)
    .query("INSERT INTO Ingenieros (Nombre) OUTPUT INSERTED.IngenieroID VALUES (@nombre)");
  const newId = ins.recordset[0].IngenieroID;
  engCache.push({ IngenieroID: newId, Nombre: name });
  return newId;
}

// ── Sync directo del catálogo local (data.engineers) con la tabla Ingenieros ──
// Cada ingeniero del catálogo local guarda un sql_id (IngenieroID real de SQL).
// Crear/editar/desactivar en la app empuja el cambio a SQL de inmediato — ya no
// se depende del fuzzy-match de resolveEngineer para estos ingenieros.

async function syncEngineerToSQL(engineer) {
  const pool = await getPool();
  const name   = (engineer.name || "").trim();
  const role   = engineer.role || "";
  const active = engineer.active !== false;

  if (engineer.sql_id) {
    await pool.request()
      .input("id",     sql.Int,          engineer.sql_id)
      .input("nombre", sql.NVarChar(150),name)
      .input("cargo",  sql.NVarChar(100),role)
      .input("estado", sql.Bit,          active)
      .query("UPDATE Ingenieros SET Nombre=@nombre, Cargo=@cargo, Estado=@estado WHERE IngenieroID=@id");
    return engineer.sql_id;
  }

  const ins = await pool.request()
    .input("nombre", sql.NVarChar(150), name)
    .input("cargo",  sql.NVarChar(100), role)
    .input("estado", sql.Bit,           active)
    .query("INSERT INTO Ingenieros (Nombre, Cargo, Estado) OUTPUT INSERTED.IngenieroID VALUES (@nombre, @cargo, @estado)");
  return ins.recordset[0].IngenieroID;
}

// ── Sync de colaboradores externos ───────────────────────────────────────────
// Crea o actualiza un registro en Colaboradores_Externos.
// Devuelve el ColaboradorID de SQL para guardarlo como sql_id en el catálogo local.

async function syncExternalContactToSQL(contact) {
  const pool    = await getPool();
  const name    = (contact.name    || "").trim();
  const company = (contact.company || "").trim();
  const active  = contact.active !== false ? 1 : 0;

  if (contact.sql_id) {
    await pool.request()
      .input("id",      sql.Int,           contact.sql_id)
      .input("nombre",  sql.NVarChar(150),  name)
      .input("empresa", sql.NVarChar(150),  company)
      .input("activo",  sql.Bit,            active)
      .query("UPDATE Colaboradores_Externos SET Nombre=@nombre, Empresa=@empresa, Activo=@activo WHERE ColaboradorID=@id");
    return contact.sql_id;
  }

  const ins = await pool.request()
    .input("nombre",  sql.NVarChar(150), name)
    .input("empresa", sql.NVarChar(150), company)
    .input("activo",  sql.Bit,           active)
    .query("INSERT INTO Colaboradores_Externos (Nombre, Empresa, Activo) OUTPUT INSERTED.ColaboradorID VALUES (@nombre, @empresa, @activo)");
  return ins.recordset[0].ColaboradorID;
}

module.exports = { resolveEngineer, syncEngineerToSQL, syncExternalContactToSQL };
