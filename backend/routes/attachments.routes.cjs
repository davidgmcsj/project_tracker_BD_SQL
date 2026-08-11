"use strict";

// attachments.routes.cjs — Adjuntos de actividades. Archivos guardados como
// bytes en SQL (tabla Actividad_Adjuntos), enviados en base64. Límite ~10 MB
// por archivo.
//
// ⚠️ POST /:  el parser de este router (attachmentJsonParser, límite 14 MB)
// se pasa por parámetro y se monta EXPLÍCITAMENTE solo en esta ruta, no a
// nivel de router — así el resto de rutas de este mismo archivo (GET/DELETE,
// sin body grande) siguen usando el parser genérico de 2 MB montado en
// app.cjs. Si se moviera el parser grande a router.use(), TODAS las rutas de
// este archivo heredarían el límite de 14 MB sin necesidad.

const express = require("express");

/**
 * @param {object} deps
 * @param {import("express").RequestHandler} deps.attachmentJsonParser
 * @param {Function} [deps.saveAttachmentToDB]
 * @param {Function} [deps.getAttachmentFromDB]
 * @param {Function} [deps.deleteAttachmentFromDB]
 * @param {Function} deps.errorBody
 */
function crearAttachmentsRouter({ attachmentJsonParser, saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB, errorBody }) {
  const router = express.Router();
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

  // Limpia el nombre de archivo antes de guardarlo: quita caracteres de
  // control (que podrían usarse para inyección de headers al descargarlo) y
  // lo recorta a una longitud razonable. No restringe el charset a ASCII —
  // nombres con acentos/ñ son normales en este contexto — solo bloquea lo
  // peligroso.
  function sanitizeFilename(name) {
    return String(name || "")
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim()
      .slice(0, 255) || "adjunto";
  }

  router.post("/upload", attachmentJsonParser, async (req, res) => {
    if (!saveAttachmentToDB) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { appAdjuntoID, appActividadID, proyectoAppID, nombre, mime, dataBase64 } = req.body || {};
      if (!appAdjuntoID || !appActividadID || !nombre || !dataBase64) {
        return res.status(400).json({ error: "Faltan campos del adjunto" });
      }
      const buffer = Buffer.from(dataBase64, "base64");
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        return res.status(413).json({ error: `El archivo supera el límite de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` });
      }
      await saveAttachmentToDB({
        appAdjuntoID, appActividadID, proyectoAppID,
        nombre: sanitizeFilename(nombre), mime, size: buffer.length, buffer,
      });
      res.json({ ok: true, size: buffer.length });
    } catch (e) {
      console.error("[SQL] Error guardando adjunto:", e.message);
      res.status(500).json(errorBody("Error guardando adjunto", e));
    }
  });

  router.get("/:id", async (req, res) => {
    if (!getAttachmentFromDB) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const att = await getAttachmentFromDB(req.params.id);
      if (!att || !att.buffer) return res.status(404).json({ error: "Adjunto no encontrado" });
      const safeName = sanitizeFilename(att.nombre);
      // RFC 5987: filename* con UTF-8 percent-encoded, más robusto para
      // nombres con acentos/ñ que el solo encodeURIComponent en el atributo
      // filename clásico. Se incluyen ambas variantes para compatibilidad con
      // navegadores antiguos.
      res.setHeader("Content-Type", att.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
      );
      res.setHeader("Content-Length", att.buffer.length);
      res.send(att.buffer);
    } catch (e) {
      console.error("[SQL] Error descargando adjunto:", e.message);
      res.status(500).json(errorBody("Error descargando adjunto", e));
    }
  });

  router.post("/delete", async (req, res) => {
    if (!deleteAttachmentFromDB) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { appAdjuntoID } = req.body || {};
      if (!appAdjuntoID) return res.status(400).json({ error: "Falta el id del adjunto" });
      await deleteAttachmentFromDB(appAdjuntoID);
      res.json({ ok: true });
    } catch (e) {
      console.error("[SQL] Error borrando adjunto:", e.message);
      res.status(500).json(errorBody("Error borrando adjunto", e));
    }
  });

  return router;
}

module.exports = { crearAttachmentsRouter };
