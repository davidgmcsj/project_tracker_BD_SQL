"use strict";

// create-user.cjs — Crea (o resetea la contraseña de) un usuario de login.
//
// No hay endpoint HTTP de registro a propósito: sin roles todavía, exponer
// un POST /api/auth/register público dejaría que cualquiera con la
// X-API-Key se cree una cuenta. Provisionar usuarios queda en manos de
// quien tiene acceso al servidor/BD, vía este script.
//
// Uso:
//   node scripts/create-user.cjs

require("dotenv/config");
const readline = require("readline");
const sql = require("mssql");
const { getPool } = require("../db-operations.cjs");
const { hashPassword } = require("../auth.cjs");

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const username = (await ask(rl, "Usuario (para iniciar sesión): ")).trim();
  const nombre   = (await ask(rl, "Nombre completo: ")).trim();
  const email    = (await ask(rl, "Correo (opcional, Enter para omitir): ")).trim();
  const password = await ask(rl, "Contraseña (se muestra en pantalla, no hay entrada oculta en este script): ");
  // Migración 019 — necesario para el primer admin: la pantalla de
  // administración de usuarios (Fase 3) solo es accesible para EsAdmin=1,
  // así que ese primer usuario tiene que crearse por aquí antes de existir
  // ninguno. El resto de usuarios normalmente se crean desde esa pantalla.
  const esAdminRaw = (await ask(rl, "¿Es administrador? (s/N): ")).trim().toLowerCase();
  rl.close();

  if (!username || !nombre || !password) {
    console.error("Usuario, nombre y contraseña son obligatorios.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }

  const esAdmin = esAdminRaw === "s" || esAdminRaw === "si" || esAdminRaw === "sí";
  const { hash, salt } = hashPassword(password);
  const pool = await getPool();

  const existing = await pool.request()
    .input("usuario", sql.NVarChar(100), username)
    .query("SELECT UsuarioID FROM Usuarios WHERE NombreUsuario = @usuario");

  if (existing.recordset.length) {
    await pool.request()
      .input("usuario", sql.NVarChar(100), username)
      .input("nombre",  sql.NVarChar(150), nombre)
      .input("email",   sql.NVarChar(200), email || null)
      .input("hash",    sql.Char(128), hash)
      .input("salt",    sql.Char(32),  salt)
      .input("esAdmin", sql.Bit, esAdmin)
      .query(`
        UPDATE Usuarios
        SET NombreCompleto = @nombre, Email = @email, PasswordHash = @hash, PasswordSalt = @salt,
            Activo = 1, EsAdmin = @esAdmin
        WHERE NombreUsuario = @usuario
      `);
    console.log(`✓ Usuario "${username}" actualizado (contraseña reseteada${esAdmin ? ", admin" : ""}).`);
  } else {
    await pool.request()
      .input("usuario", sql.NVarChar(100), username)
      .input("nombre",  sql.NVarChar(150), nombre)
      .input("email",   sql.NVarChar(200), email || null)
      .input("hash",    sql.Char(128), hash)
      .input("salt",    sql.Char(32),  salt)
      .input("esAdmin", sql.Bit, esAdmin)
      .query(`
        INSERT INTO Usuarios (NombreUsuario, NombreCompleto, Email, PasswordHash, PasswordSalt, EsAdmin)
        VALUES (@usuario, @nombre, @email, @hash, @salt, @esAdmin)
      `);
    console.log(`✓ Usuario "${username}" creado${esAdmin ? " (admin)" : ""}.`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
