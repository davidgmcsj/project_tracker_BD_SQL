"use strict";

// ── Login por base de datos (Fase 9 revisada) ────────────────────────────────
// Convive con X-API-Key: esa clave sigue siendo el candado general del
// backend (server.cjs la sigue exigiendo en todo /api/*). Esto agrega
// identidad real ENCIMA — sin roles todavía, cualquier usuario logueado
// puede hacer lo mismo que ya permite la API_KEY. El objetivo es saber
// QUIÉN hizo cada acción (autor real en Proyecto_Notas, base para
// auditoría futura), no restringir permisos.
//
// Contraseñas con scrypt (módulo `crypto` nativo de Node) — sin dependencia
// nueva. N=16384 (2^14) es el costo por defecto de Node, adecuado para un
// login humano de baja frecuencia.

const crypto = require("crypto");
const sql = require("mssql");

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 horas
const SCRYPT_KEYLEN = 64;

// Parser manual de cookies — evita agregar cookie-parser como dependencia
// nueva solo para leer un único valor. res.cookie()/res.clearCookie() para
// ESCRIBIR ya vienen incluidos en Express, sin necesitar el paquete.
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[decodeURIComponent(key)] = decodeURIComponent(val);
  });
  return out;
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = hashPassword(password, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHashHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createSession(pool, usuarioId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiraEn = new Date(Date.now() + SESSION_TTL_MS);
  await pool.request()
    .input("token", sql.Char(64), token)
    .input("usuarioId", sql.Int, usuarioId)
    .input("expira", sql.DateTime2, expiraEn)
    .query("INSERT INTO Sesiones (Token, UsuarioID, ExpiraEn) VALUES (@token, @usuarioId, @expira)");
  return { token, expiraEn };
}

// Devuelve { id, username, name, email, ingenieroId, esAdmin } o null si el
// token falta, no existe, expiró, o el usuario fue desactivado.
// ingenieroId/esAdmin vienen de la migración 019 — un usuario sin ingeniero
// vinculado devuelve ingenieroId: null (ej. un admin puro).
async function getSessionUser(pool, token) {
  if (!token) return null;
  const res = await pool.request()
    .input("token", sql.Char(64), token)
    .query(`
      SELECT u.UsuarioID, u.NombreUsuario, u.NombreCompleto, u.Email, u.Activo, u.IngenieroID, u.EsAdmin, s.ExpiraEn
      FROM Sesiones s
      JOIN Usuarios u ON u.UsuarioID = s.UsuarioID
      WHERE s.Token = @token
    `);
  const row = res.recordset[0];
  if (!row || !row.Activo) return null;
  if (new Date(row.ExpiraEn) < new Date()) return null;
  return {
    id: row.UsuarioID, username: row.NombreUsuario, name: row.NombreCompleto, email: row.Email || "",
    ingenieroId: row.IngenieroID ?? null, esAdmin: !!row.EsAdmin,
  };
}

async function deleteSession(pool, token) {
  if (!token) return;
  await pool.request().input("token", sql.Char(64), token).query("DELETE FROM Sesiones WHERE Token = @token");
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_MS,
  parseCookies, hashPassword, verifyPassword, createSession, getSessionUser, deleteSession,
};
