"use strict";

// ── Router del módulo de reportes (Fase 2) ───────────────────────────────────
// Se monta en server.cjs DESPUÉS de requireApiKey y generalLimiter (línea 378),
// así hereda auth y rate limit por prefijo sin tocar nada del resto de rutas.

const express = require("express");
const { getPool } = require("../db-operations.cjs");
const { REGISTRY } = require("./query-registry.cjs");
const { buildQuery, ReportQueryError, MAX_LIMITE_QUERY, MAX_LIMITE_EXPORT } = require("./query-builder.cjs");
const { listNotes, upsertNote, deleteNote } = require("./project-notes.cjs");
const { listSaved, createSaved, deleteSaved } = require("./saved-reports.cjs");
const { toXlsxBuffer } = require("./export-excel.cjs");
const { toPdfBuffer } = require("./export-pdf.cjs");

const MAX_FILAS_PDF = 10000;

const router = express.Router();

// Metadatos públicos: qué consultas existen y qué se puede filtrar/proyectar
// en cada una. El frontend dibuja el panel de facetas a partir de esto, sin
// tener los campos hardcodeados (§5.3 del plan).
function publicRegistry() {
  const out = {};
  for (const [nombre, consulta] of Object.entries(REGISTRY)) {
    out[nombre] = {
      filtros: Object.fromEntries(
        Object.entries(consulta.filtros).map(([campo, def]) => [campo, { tipo: def.tipo, operador: def.operador }])
      ),
      columnas: Object.keys(consulta.columnasPermitidas),
      columnasDefault: consulta.columnasDefault,
    };
  }
  return out;
}

router.get("/registry", (req, res) => res.json(publicRegistry()));
router.get("/catalog", (req, res) => res.json(publicRegistry())); // alias — ver decisión #9 de Fase 2

router.post("/query", async (req, res) => {
  try {
    const pool = await getPool();
    const built = buildQuery(req.body || {}, { maxLimite: MAX_LIMITE_QUERY });

    const dataReq = pool.request();
    built.bind(dataReq);
    const countReq = pool.request();
    built.bind(countReq);

    const [dataRes, countRes] = await Promise.all([
      dataReq.query(built.dataSql),
      countReq.query(built.countSql),
    ]);

    res.json({ total: countRes.recordset[0]?.total ?? 0, filas: dataRes.recordset });
  } catch (e) {
    if (e instanceof ReportQueryError) return res.status(400).json({ error: e.message });
    console.error("[REPORTS] ✗ /query:", e.message);
    res.status(500).json({ error: "Error ejecutando la consulta" });
  }
});

// ── Exportación (Fase 5) ──────────────────────────────────────────────────
// Mismo body que /query + "formato": "xlsx" | "pdf". Llama al mismo
// buildQuery, así que el archivo nunca puede mostrar datos distintos a los
// que ya se vieron en pantalla — solo más filas, porque el límite de la
// vista previa (500) no aplica aquí. El límite propio de exportación
// (ignora cualquier "limite" que venga del body) sí aplica.
router.post("/export", async (req, res) => {
  const formato = req.body?.formato;
  if (formato !== "xlsx" && formato !== "pdf") {
    return res.status(400).json({ error: 'formato debe ser "xlsx" o "pdf"' });
  }

  const maxLimite = formato === "pdf" ? MAX_FILAS_PDF : MAX_LIMITE_EXPORT;
  const consultaNombre = req.body.consulta;

  try {
    const pool = await getPool();
    const built = buildQuery({ ...req.body, limite: maxLimite, offset: 0 }, { maxLimite });

    const countReq = pool.request();
    built.bind(countReq);
    const countRes = await countReq.query(built.countSql);
    const total = countRes.recordset[0]?.total ?? 0;

    if (formato === "pdf" && total > MAX_FILAS_PDF) {
      return res.status(400).json({
        error: `El PDF admite hasta ${MAX_FILAS_PDF.toLocaleString("es-CO")} filas (esta consulta tiene ${total.toLocaleString("es-CO")}). Exporta a Excel en su lugar.`,
      });
    }

    const dataReq = pool.request();
    built.bind(dataReq);
    const dataRes = await dataReq.query(built.dataSql);

    const payload = {
      titulo: consultaNombre, consulta: consultaNombre,
      columnas: built.columnas, filas: dataRes.recordset,
      filtrosAplicados: req.body.filtros || [], total,
    };

    if (formato === "xlsx") {
      const buffer = await toXlsxBuffer(payload);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${consultaNombre}.xlsx"`);
      return res.send(buffer);
    }

    const buffer = await toPdfBuffer(payload);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${consultaNombre}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e instanceof ReportQueryError) return res.status(400).json({ error: e.message });
    console.error("[REPORTS] ✗ /export:", e.message);
    res.status(500).json({ error: "Error generando la exportación" });
  }
});

// ── Notas de proyecto (Fase 3) ────────────────────────────────────────────

router.get("/notes/:proyectoAppID", async (req, res) => {
  try {
    const pool = await getPool();
    res.json(await listNotes(pool, req.params.proyectoAppID));
  } catch (e) {
    console.error("[REPORTS] ✗ /notes/:id:", e.message);
    res.status(500).json({ error: "Error leyendo notas" });
  }
});

router.post("/notes", async (req, res) => {
  const nota = req.body?.nota;
  if (!nota?.id || !nota?.proyectoAppID) {
    return res.status(400).json({ error: "nota.id y nota.proyectoAppID son obligatorios" });
  }
  // Con sesión activa, el backend toma el autor del login e ignora lo que
  // mande el cliente — un campo de texto libre no es una fuente confiable
  // una vez que existe identidad real (Fase 9 revisada).
  if (req.user?.name) nota.author = req.user.name;
  try {
    const pool = await getPool();
    res.json(await upsertNote(pool, nota));
  } catch (e) {
    console.error("[REPORTS] ✗ POST /notes:", e.message);
    res.status(500).json({ error: "Error guardando la nota" });
  }
});

router.post("/notes/delete", async (req, res) => {
  const appNotaID = req.body?.id;
  if (!appNotaID) return res.status(400).json({ error: "id es obligatorio" });
  try {
    const pool = await getPool();
    await deleteNote(pool, appNotaID);
    res.json({ ok: true });
  } catch (e) {
    console.error("[REPORTS] ✗ POST /notes/delete:", e.message);
    res.status(500).json({ error: "Error borrando la nota" });
  }
});

// ── Reportes guardados (Fase 6) ───────────────────────────────────────────

router.get("/saved", async (req, res) => {
  try {
    const pool = await getPool();
    res.json(await listSaved(pool));
  } catch (e) {
    console.error("[REPORTS] ✗ GET /saved:", e.message);
    res.status(500).json({ error: "Error leyendo reportes guardados" });
  }
});

router.post("/saved", async (req, res) => {
  const { nombre, config, autor } = req.body || {};
  if (!nombre || !config?.consulta) {
    return res.status(400).json({ error: "nombre y config.consulta son obligatorios" });
  }
  try {
    const pool = await getPool();
    res.json(await createSaved(pool, { nombre, config, autor }));
  } catch (e) {
    console.error("[REPORTS] ✗ POST /saved:", e.message);
    res.status(500).json({ error: "Error guardando el reporte" });
  }
});

router.post("/saved/delete", async (req, res) => {
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: "id es obligatorio" });
  try {
    const pool = await getPool();
    await deleteSaved(pool, id);
    res.json({ ok: true });
  } catch (e) {
    console.error("[REPORTS] ✗ POST /saved/delete:", e.message);
    res.status(500).json({ error: "Error borrando el reporte guardado" });
  }
});

module.exports = router;
