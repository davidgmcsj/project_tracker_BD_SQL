import { getConnection, sql } from './database.js';
import { createRequire } from 'module';
import { readFileSync }  from 'fs';

const require = createRequire(import.meta.url);
const { saveWeekReportToDB } = require('./db-operations.cjs');

async function testConexion() {
  console.log("── Test 1: Conexión básica ──────────────────────────");
  const pool = await getConnection();
  const res  = await pool.request().query("SELECT GETDATE() AS FechaServidor");
  console.log("OK — Fecha servidor:", res.recordset[0].FechaServidor);
}

async function testGuardarReporte() {
  console.log("── Test 2: Guardar reporte del historial ───────────");
  const raw     = readFileSync('./history.json', 'utf-8');
  const history = JSON.parse(raw);
  const reporte = history.reports[0]; // El del 14 mayo

  await saveWeekReportToDB(reporte.projects, reporte.weekLabel, reporte.saved_at);
  console.log(`OK — Reporte ${reporte.report_date} guardado en SQL Server`);
  console.log(`     Proyectos procesados: ${reporte.projects.length}`);
}

async function testLeerDatos() {
  console.log("── Test 3: Verificar datos guardados ───────────────");
  const pool = await getConnection();

  const proyectos = await pool.request().query("SELECT ProyectoID, AppID, NombreProyecto FROM Proyectos");
  console.log("Proyectos en BD:", proyectos.recordset.length);
  proyectos.recordset.forEach(p => console.log(`  [${p.ProyectoID}] ${p.NombreProyecto}`));

  const reportes = await pool.request().query(`
    SELECT r.ReporteID, p.NombreProyecto, r.NumeroSemana, r.Anio, r.FechaReporte, r.EstadoProyecto, r.AvancePromedio
    FROM ReportesSemanales r
    JOIN Proyectos p ON p.ProyectoID = r.ProyectoID
    ORDER BY r.ReporteID
  `);
  console.log("\nReportes en BD:", reportes.recordset.length);
  reportes.recordset.forEach(r =>
    console.log(`  [${r.ReporteID}] ${r.NombreProyecto} — Sem ${r.NumeroSemana}/${r.Anio} — ${r.EstadoProyecto} — ${r.AvancePromedio}%`)
  );

  const ingenieros = await pool.request().query("SELECT IngenieroID, Nombre FROM Ingenieros");
  console.log("\nIngenieros en BD:", ingenieros.recordset.length);
  ingenieros.recordset.forEach(i => console.log(`  [${i.IngenieroID}] ${i.Nombre}`));
}

async function main() {
  try {
    await testConexion();
    await testGuardarReporte();
    await testLeerDatos();
    console.log("\n✓ Todos los tests pasaron");
  } catch (err) {
    console.error("\n✗ Error:", err.message);
    console.error(err.stack);
  } finally {
    await sql.close();
  }
}

main();
