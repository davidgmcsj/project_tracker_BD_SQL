"use strict";

// users.repo.cjs — Administración de usuarios (migración 019, solo accesible
// vía requireAdmin, ver routes/users.routes.cjs).
//
// Sin endpoint de auto-registro (ver scripts/create-user.cjs): estas
// funciones solo se llaman desde rutas protegidas, nunca públicas.
// PasswordHash/PasswordSalt nunca salen de aquí hacia el cliente.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");
const { hashPassword } = require("../auth.cjs");

async function listUsers() {
  const pool = await getPool();
  const res = await pool.request().query(`
    SELECT UsuarioID, NombreUsuario, Email, NombreCompleto, Activo, IngenieroID, EsAdmin, CreadoEn
    FROM Usuarios ORDER BY NombreCompleto
  `);
  return res.recordset.map(r => ({
    id: r.UsuarioID, username: r.NombreUsuario, email: r.Email || "", name: r.NombreCompleto,
    active: !!r.Activo, ingenieroId: r.IngenieroID ?? null, esAdmin: !!r.EsAdmin, createdAt: r.CreadoEn,
  }));
}

// Crea un usuario nuevo. password es obligatorio en creación (no hay forma
// de "crear sin contraseña" — no tendría con qué loguearse).
async function createUser({ username, name, email, password, ingenieroId, esAdmin }) {
  const pool = await getPool();
  const clean = String(username || "").trim();
  if (!clean || !name || !password) throw new Error("Usuario, nombre y contraseña son obligatorios");
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");

  const { hash, salt } = hashPassword(password);
  const ins = await pool.request()
    .input("usuario",     sql.NVarChar(100), clean)
    .input("nombre",      sql.NVarChar(150), name)
    .input("email",       sql.NVarChar(200), email || null)
    .input("hash",        sql.Char(128), hash)
    .input("salt",        sql.Char(32),  salt)
    .input("ingenieroId", sql.Int, ingenieroId || null)
    .input("esAdmin",     sql.Bit, !!esAdmin)
    .query(`
      INSERT INTO Usuarios (NombreUsuario, NombreCompleto, Email, PasswordHash, PasswordSalt, IngenieroID, EsAdmin)
      OUTPUT INSERTED.UsuarioID
      VALUES (@usuario, @nombre, @email, @hash, @salt, @ingenieroId, @esAdmin)
    `);
  return ins.recordset[0].UsuarioID;
}

// Actualiza nombre/email/vínculo/rol/activo de un usuario existente.
// password es opcional: si viene, se resetea; si no, se conserva la actual.
async function updateUser(userId, { name, email, ingenieroId, esAdmin, active, password }) {
  const pool = await getPool();
  if (!name) throw new Error("El nombre es obligatorio");

  const req = pool.request()
    .input("id",          sql.Int, userId)
    .input("nombre",      sql.NVarChar(150), name)
    .input("email",       sql.NVarChar(200), email || null)
    .input("ingenieroId", sql.Int, ingenieroId || null)
    .input("esAdmin",     sql.Bit, !!esAdmin)
    .input("activo",      sql.Bit, active !== false);

  let setClause = "NombreCompleto=@nombre, Email=@email, IngenieroID=@ingenieroId, EsAdmin=@esAdmin, Activo=@activo";
  if (password) {
    if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
    const { hash, salt } = hashPassword(password);
    req.input("hash", sql.Char(128), hash).input("salt", sql.Char(32), salt);
    setClause += ", PasswordHash=@hash, PasswordSalt=@salt";
  }

  await req.query(`UPDATE Usuarios SET ${setClause} WHERE UsuarioID=@id`);
}

module.exports = { listUsers, createUser, updateUser };
