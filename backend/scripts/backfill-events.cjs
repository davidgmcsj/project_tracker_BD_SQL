"use strict";

// backfill-events.cjs — Reconstruye Actividad_Eventos con historial retroactivo.
//
// Uso:
//   node scripts/backfill-events.cjs --dry-run     (solo cuenta, no escribe nada)
//   node scripts/backfill-events.cjs --apply        (escribe de verdad)
//
// Tres pasadas, en orden de calidad del dato (cada una dedupe contra las
// anteriores por AppActividadID+Tipo+ValorNuevo+FechaEvento):
//
//   1. migracion-rawjson    — ReportesSemanales.RawDataJSON: snapshot completo
//                              del proyecto por semana. Se diffean semanas
//                              consecutivas del mismo proyecto reutilizando
//                              diffSnapshots (misma función pura de la Fase 1,
//                              sin lógica de diff nueva). Granularidad semanal,
//                              no por cambio individual — es la limitación
//                              documentada en el plan: si una actividad cambió
//                              de estado dos veces en la misma semana, aquí
//                              solo se ve la transición neta.
//
//   2. migracion-history    — task_status.status_history de cada actividad
//                              (fechas added/in_progress/completed), leído del
//                              snapshot MÁS RECIENTE de cada proyecto porque es
//                              acumulativo (se pisa en reaperturas, no crece).
//                              Cubre huecos que la pasada 1 no puede ver porque
//                              da la fecha real de cada transición, no solo la
//                              semana en que se detectó.
//
//   3. migracion-historyjson — backend/history.json (snapshots semanales de
//                              TODOS los proyectos juntos, formato distinto a
//                              ReportesSemanales). Solo aporta lo que las
//                              pasadas 1-2 no cubrieron.

require("dotenv/config");
const fs   = require("fs");
const path = require("path");
const { getPool, syncActividadesDetalle: _unused } = require("../db-operations.cjs");
const { snapshotFromProject, diffSnapshots, insertEvents } = require("../activity-events.cjs");

const DRY_RUN = process.argv.includes("--dry-run");
const APPLY   = process.argv.includes("--apply");

function toISODate(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function eventKey(e) {
  return `${e.appActividadID}|${e.tipo}|${e.valorNuevo}|${e.fechaEvento}`;
}

// ── Pasada 1: ReportesSemanales.RawDataJSON ──────────────────────────────────

async function passRawJson(pool) {
  const res = await pool.request().query(`
    SELECT ProyectoID, Anio, NumeroSemana, FechaReporte, RawDataJSON
    FROM ReportesSemanales
    WHERE RawDataJSON IS NOT NULL
    ORDER BY ProyectoID, Anio, NumeroSemana
  `);

  const byProject = new Map(); // ProyectoID (int) -> [{ fechaReporte, project }]
  for (const row of res.recordset) {
    let project;
    try { project = JSON.parse(row.RawDataJSON); } catch { continue; }
    if (!project?.id) continue;
    const list = byProject.get(row.ProyectoID) || [];
    list.push({ fechaReporte: row.FechaReporte, project });
    byProject.set(row.ProyectoID, list);
  }

  const eventos = [];
  let semanasComparadas = 0;
  for (const snapshots of byProject.values()) {
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshotFromProject(snapshots[i - 1].project);
      const next = snapshotFromProject(snapshots[i].project);
      const fechaEvento = toISODate(snapshots[i].fechaReporte);
      const proyectoAppID = snapshots[i].project.id;
      eventos.push(...diffSnapshots(prev, next, { proyectoAppID, fechaEvento, origen: "migracion-rawjson" }));
      semanasComparadas++;
    }
  }
  return { eventos, semanasComparadas, proyectos: byProject.size };
}

// ── Pasada 2: status_history del snapshot más reciente por proyecto ─────────

async function passStatusHistory(pool, yaVistos) {
  const res = await pool.request().query(`
    SELECT ProyectoID, Anio, NumeroSemana, RawDataJSON
    FROM ReportesSemanales
    WHERE RawDataJSON IS NOT NULL
    ORDER BY ProyectoID, Anio DESC, NumeroSemana DESC
  `);

  const latestByProject = new Map();
  for (const row of res.recordset) {
    if (latestByProject.has(row.ProyectoID)) continue; // ya tenemos el más reciente de este proyecto
    let project;
    try { project = JSON.parse(row.RawDataJSON); } catch { continue; }
    if (project?.id) latestByProject.set(row.ProyectoID, project);
  }

  const eventos = [];
  for (const project of latestByProject.values()) {
    const hist = project.task_status?.status_history || {};
    const actIds = new Set((project.activities_identified || []).map(a => a.id));

    for (const [actId, h] of Object.entries(hist)) {
      if (!actIds.has(actId)) continue; // la actividad ya no existe en el proyecto actual
      const transitions = [
        h?.added       ? ["not_started", h.added] : null,
        h?.in_progress ? ["in_progress", h.in_progress] : null,
        h?.completed   ? ["completed", h.completed] : null,
      ].filter(Boolean);

      let prevEstado = "not_started";
      for (const [estado, fecha] of transitions) {
        const fechaEvento = toISODate(fecha);
        const prevMap = new Map([[actId, { estado: prevEstado, progreso: 0, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
        const nextMap = new Map([[actId, { estado, progreso: 0, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
        const candidatos = diffSnapshots(prevMap, nextMap, { proyectoAppID: project.id, fechaEvento, origen: "migracion-history" });
        candidatos.forEach(e => {
          const key = eventKey(e);
          if (!yaVistos.has(key)) { eventos.push(e); yaVistos.add(key); }
        });
        prevEstado = estado;
      }
    }
  }
  return eventos;
}

// ── Pasada 3: backend/history.json (solo huecos restantes) ──────────────────

function passHistoryJson(yaVistos) {
  const filePath = path.join(__dirname, "..", "history.json");
  if (!fs.existsSync(filePath)) return [];

  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return []; }
  const reports = Array.isArray(data.reports) ? data.reports : [];
  const ordered = [...reports].sort((a, b) => String(a.report_date || a.week_key).localeCompare(String(b.report_date || b.week_key)));

  const byProject = new Map(); // appId (string) -> [{ fecha, project }]
  ordered.forEach(rep => {
    (Array.isArray(rep.projects) ? rep.projects : []).forEach(project => {
      if (!project?.id) return;
      const list = byProject.get(project.id) || [];
      list.push({ fecha: rep.report_date || rep.week_key, project });
      byProject.set(project.id, list);
    });
  });

  const eventos = [];
  for (const [proyectoAppID, snapshots] of byProject.entries()) {
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshotFromProject(snapshots[i - 1].project);
      const next = snapshotFromProject(snapshots[i].project);
      const fechaEvento = toISODate(snapshots[i].fecha);
      const candidatos = diffSnapshots(prev, next, { proyectoAppID, fechaEvento, origen: "migracion-historyjson" });
      candidatos.forEach(e => {
        const key = eventKey(e);
        if (!yaVistos.has(key)) { eventos.push(e); yaVistos.add(key); }
      });
    }
  }
  return eventos;
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!DRY_RUN && !APPLY) {
    console.error("Uso: node scripts/backfill-events.cjs --dry-run   (o --apply para escribir)");
    process.exit(1);
  }

  const pool = await getPool();

  console.log("── Pasada 1: migracion-rawjson ──");
  const p1 = await passRawJson(pool);
  console.log(`  ${p1.proyectos} proyectos, ${p1.semanasComparadas} comparaciones semana-a-semana, ${p1.eventos.length} eventos candidatos`);
  const yaVistos = new Set(p1.eventos.map(eventKey));

  console.log("── Pasada 2: migracion-history ──");
  const p2 = await passStatusHistory(pool, yaVistos);
  console.log(`  ${p2.length} eventos candidatos nuevos (no cubiertos por pasada 1)`);

  console.log("── Pasada 3: migracion-historyjson ──");
  const p3 = passHistoryJson(yaVistos);
  console.log(`  ${p3.length} eventos candidatos nuevos (no cubiertos por pasadas 1-2)`);

  const todos = [...p1.eventos, ...p2, ...p3];
  const porOrigen = {};
  todos.forEach(e => { porOrigen[e.origen] = (porOrigen[e.origen] || 0) + 1; });

  console.log(`\nTotal de eventos candidatos: ${todos.length}`);
  console.table(porOrigen);

  if (DRY_RUN) {
    console.log("\n--dry-run: no se insertó nada. Revisa los conteos y corre con --apply para escribir.");
    process.exit(0);
  }

  await insertEvents(pool, todos);
  console.log("Backfill aplicado. Correrlo de nuevo debe dar 0 eventos nuevos (idempotencia por HashCambio).");
  process.exit(0);
}

main().catch(e => {
  console.error("Error en backfill:", e.message);
  process.exit(1);
});
