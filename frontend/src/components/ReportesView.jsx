// ReportesView.jsx — Pestaña "Reportes": catálogo de consultas + filtros
// acumulativos + vista previa en pantalla (§6-8 del plan).
//
// Sigue el patrón de QuartersView.jsx: consulta al backend por su cuenta a
// través de storage.js, sin recibir el estado de proyectos por props — las
// consultas del registro ya devuelven nombres resueltos (proyecto, ingeniero)
// vía JOIN en SQL, así que no hace falta cruzarlas con el catálogo local.

import { useState, useEffect } from "react";
import { loadReportRegistry, runReportQuery, exportReport } from "../utils/storage";
import { ReportesTemplates } from "./ReportesTemplates";
import { ReportesFilterPanel } from "./ReportesFilterPanel";
import { ReportesTable } from "./ReportesTable";
import { ReportesSavedPanel } from "./ReportesSavedPanel";
import { GlobalBoardView } from "./GlobalBoardView";
import { WorkloadMatrix } from "./WorkloadMatrix";

const MODOS = [
  { value: "tabla",   label: "📋 Tabla" },
  { value: "tablero", label: "🗂 Tablero" },
  { value: "carga",   label: "📊 Carga" },
];

const NOMBRES_CONSULTA = {
  actividades: "Actividades",
  ingenieros:  "Ingenieros",
  proyectos:   "Proyectos",
  vencidas:    "Vencidas",
  notas:       "Notas",
};

function humanizeFiltro(f) {
  const campo = f.campo.replace(/_/g, " ");
  const valor = Array.isArray(f.valor) ? f.valor.join(f.operador === "between" ? " – " : ", ") : f.valor;
  return `${campo}: ${valor}`;
}

export function ReportesView({ projects, engineers }) {
  const [modo, setModo]           = useState("tabla"); // "tabla" | "tablero" | "carga"
  const [registry, setRegistry]   = useState(null);
  const [consulta, setConsulta]   = useState("vencidas");
  const [filtros, setFiltros]     = useState([]);
  const [columnasVisibles, setColumnasVisibles] = useState([]);
  const [resultado, setResultado] = useState({ total: 0, filas: [] });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [exporting, setExporting] = useState(""); // "" | "xlsx" | "pdf"

  // Cargar el registro una sola vez al montar.
  useEffect(() => {
    loadReportRegistry().then(reg => {
      setRegistry(reg);
      const primera = reg[consulta] ? consulta : Object.keys(reg)[0];
      setConsulta(primera);
      setColumnasVisibles(reg[primera]?.columnasDefault || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr al montar
  }, []);

  const registryEntry = registry?.[consulta];

  // Re-ejecutar la consulta cuando cambian la consulta base o los filtros.
  // Se piden TODAS las columnas disponibles (no solo las visibles): así
  // mostrar/ocultar columnas es puramente del lado cliente, sin re-consultar.
  // Sin setState síncrono en el cuerpo del efecto (mismo patrón que
  // QuartersView.jsx y ProjectNotesPanel.jsx): "Cargando…" solo se ve en la
  // carga inicial, no en cada refetch por filtro — cambio de datos sin parpadeo.
  useEffect(() => {
    if (!registryEntry) return;
    runReportQuery({ consulta, filtros, columnas: registryEntry.columnas, limite: 500 })
      .then(data => { setResultado(data); setError(""); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [consulta, filtros, registryEntry]);

  const handleSelectConsulta = (nueva) => {
    setConsulta(nueva);
    setFiltros([]);
    setColumnasVisibles(registry?.[nueva]?.columnasDefault || []);
  };

  const handleTemplate = ({ consulta: c, filtros: f }) => {
    setConsulta(c);
    setFiltros(f);
    setColumnasVisibles(registry?.[c]?.columnasDefault || []);
  };

  const handleAddFiltro = (nuevoFiltro) => {
    setFiltros(prev => [...prev.filter(f => f.campo !== nuevoFiltro.campo), nuevoFiltro]);
  };

  const handleRemoveFiltro = (campo) => {
    setFiltros(prev => prev.filter(f => f.campo !== campo));
  };

  const handleToggleColumna = (col) => {
    setColumnasVisibles(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const handleLoadSaved = (config) => {
    setConsulta(config.consulta);
    setFiltros(config.filtros || []);
    setColumnasVisibles(config.columnas || registry?.[config.consulta]?.columnasDefault || []);
  };

  // Mismo consulta+filtros que la vista previa — el backend vuelve a correr
  // buildQuery, así que el archivo nunca puede mostrar datos distintos.
  const handleExport = async (formato) => {
    setExporting(formato);
    setError("");
    try {
      await exportReport({ consulta, filtros, columnas: columnasVisibles }, formato);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="reportes-view">
      <ReportesTemplates onSelect={handleTemplate} />

      <div className="reportes-view__modos">
        {MODOS.map(m => (
          <button
            key={m.value} type="button"
            className={`reportes-col-chip ${modo === m.value ? "reportes-col-chip--on" : ""}`}
            onClick={() => setModo(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modo === "tablero" && <GlobalBoardView projects={projects} engineers={engineers} />}
      {modo === "carga" && <WorkloadMatrix projects={projects} engineers={engineers} />}

      {modo === "tabla" && (!registry ? (
        <p>Cargando catálogo de reportes…</p>
      ) : (
        <>
          <div className="report-filters reportes-view__toolbar">
            <select className="report-filters__select" value={consulta} onChange={e => handleSelectConsulta(e.target.value)}>
              {Object.keys(registry).map(c => <option key={c} value={c}>{NOMBRES_CONSULTA[c] || c}</option>)}
            </select>
            {filtros.length > 0 && (
              <button type="button" className="report-filters__clear" onClick={() => setFiltros([])}>Limpiar filtros</button>
            )}
            <div className="reportes-view__export">
              <button type="button" className="btn btn--secondary btn--sm" disabled={!!exporting || !resultado.total} onClick={() => handleExport("xlsx")}>
                {exporting === "xlsx" ? "Generando…" : "⬇ Excel"}
              </button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={!!exporting || !resultado.total} onClick={() => handleExport("pdf")}>
                {exporting === "pdf" ? "Generando…" : "⬇ PDF"}
              </button>
            </div>
          </div>

          <ReportesSavedPanel
            currentConfig={{ consulta, filtros, columnas: columnasVisibles }}
            onLoad={handleLoadSaved}
          />

          <ReportesFilterPanel registryEntry={registryEntry} onAdd={handleAddFiltro} />

          {filtros.length > 0 && (
            <div className="reportes-chips">
              {filtros.map(f => (
                <span key={f.campo} className="reportes-chip">
                  {humanizeFiltro(f)}
                  <button type="button" className="reportes-chip__remove" onClick={() => handleRemoveFiltro(f.campo)}>✕</button>
                </span>
              ))}
            </div>
          )}

          {error && <p className="reportes-view__error">⚠ {error}</p>}

          <ReportesTable
            columnasDisponibles={registryEntry?.columnas || []}
            columnasVisibles={columnasVisibles}
            onToggleColumna={handleToggleColumna}
            filas={resultado.filas}
            total={resultado.total}
            loading={loading}
          />
        </>
      ))}
    </div>
  );
}
