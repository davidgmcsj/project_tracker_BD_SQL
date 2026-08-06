// ReportesView.jsx — Pestaña "Reportes": catálogo de consultas + filtros
// acumulativos + vista previa en pantalla (§6-8 del plan).
//
// Sigue el patrón de QuartersView.jsx: consulta al backend por su cuenta a
// través de storage.js, sin recibir el estado de proyectos por props — las
// consultas del registro ya devuelven nombres resueltos (proyecto, ingeniero)
// vía JOIN en SQL, así que no hace falta cruzarlas con el catálogo local.
//
// modo/consulta/filtros/columnas quedan en la URL (useUrlState, Fase 13):
// un enlace a la pestaña Reportes reproduce la misma vista sin que el
// destinatario reconfigure nada. Edición en línea (estado/responsable
// desde esta tabla) quedó fuera de esta fase a propósito: escribiría de
// vuelta en el mismo proyecto completo que ya gobierna EditView/App.jsx,
// con el mismo chequeo de versión de la Fase 8 — mezclar ese camino de
// guardado con una vista que hoy es puramente de lectura es un cambio de
// arquitectura aparte, no una extensión de una tarde.

import { useState, useEffect, useMemo } from "react";
import { loadReportRegistry, runReportQuery, exportReport } from "../utils/storage";
import { useUrlState } from "../hooks/useUrlState";
import { ReportesTemplates } from "./ReportesTemplates";
import { ReportesFilterPanel } from "./ReportesFilterPanel";
import { ReportesTable } from "./ReportesTable";
import { ReportesSavedPanel } from "./ReportesSavedPanel";
import { GlobalBoardView } from "./GlobalBoardView";
import { WorkloadMatrix } from "./WorkloadMatrix";
import {
  ESTADOS_PROYECTO, ESTADOS_INGENIERO_REPORTE, TIPOS_EVENTO_ACTIVIDAD,
  PRIORIDADES_PROYECTO, TIPOS_NOTA, ESTADOS_ACTIVIDAD_OPERACIONAL,
} from "../utils/filtroOpciones";

const MODOS = [
  { value: "tabla",   label: "📋 Tabla" },
  { value: "tablero", label: "🗂 Tablero" },
  { value: "carga",   label: "📊 Carga" },
];

// "actividades" apunta a Actividad_Eventos: cada fila es UN cambio de UN
// campo (Tipo = qué cambió: estado/progreso/fecha_inicio/fecha_fin/horas),
// no una actividad completa — de ahí el nombre "Historial de cambios" en vez
// de "Actividades", que sugería una lista de tareas.
const NOMBRES_CONSULTA = {
  actividades:        "Historial de cambios",
  ingenieros:          "Ingenieros",
  proyectos:           "Proyectos",
  vencidas:            "Vencidas",
  notas:               "Notas",
  actividades_estado:  "Actividades por estado",
};

const DESCRIPCION_CONSULTA = {
  actividades: "Registro de auditoría: cada fila es un cambio puntual (estado, progreso, fechas u horas) de una actividad, con su valor anterior y nuevo.",
};

// Traduce un valor crudo (ej. el id interno de un proyecto) a su label legible
// cuando el campo tiene opciones conocidas (opcionesPorCampo) — sin esto el
// chip mostraba literalmente el id (p.ej. "mp1pu3nh4va") en vez del nombre.
function humanizeValor(campo, valor, opcionesPorCampo) {
  const opciones = opcionesPorCampo?.[campo];
  if (!opciones) return valor;
  return opciones.find(o => o.value === valor)?.label ?? valor;
}

function humanizeFiltro(f, opcionesPorCampo) {
  const campo = f.campo.replace(/_/g, " ");
  const valor = Array.isArray(f.valor)
    ? f.valor.map(v => humanizeValor(f.campo, v, opcionesPorCampo)).join(f.operador === "between" ? " – " : ", ")
    : humanizeValor(f.campo, f.valor, opcionesPorCampo);
  return `${campo}: ${valor}`;
}

const SIN_FILTROS = [];
const SIN_COLUMNAS = [];

export function ReportesView({ projects, engineers }) {
  const [modo, setModo]                         = useUrlState("modo", "tabla"); // "tabla" | "tablero" | "carga"
  const [consulta, setConsulta]                 = useUrlState("consulta", "vencidas");
  const [filtros, setFiltros]                   = useUrlState("filtros", SIN_FILTROS);
  const [columnasVisibles, setColumnasVisibles] = useUrlState("columnas", SIN_COLUMNAS);
  const [registry, setRegistry]   = useState(null);
  const [resultado, setResultado] = useState({ total: 0, filas: [] });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [exporting, setExporting] = useState(""); // "" | "xlsx" | "pdf"

  // Cargar el registro una sola vez al montar. Si la URL ya traía una
  // consulta/columnas válidas (enlace compartido), se respetan tal cual —
  // los defaults del registro solo rellenan lo que falte.
  useEffect(() => {
    loadReportRegistry().then(reg => {
      setRegistry(reg);
      const valida = reg[consulta] ? consulta : Object.keys(reg)[0];
      if (valida !== consulta) setConsulta(valida);
      if (!columnasVisibles.length) setColumnasVisibles(reg[valida]?.columnasDefault || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr al montar
  }, []);

  const registryEntry = registry?.[consulta];

  // Opciones para los combos con buscador de ReportesFilterPanel.jsx: para
  // proyecto_id/ingeniero_id se arman desde projects/engineers (ya en
  // memoria, sin llamar al backend); para los demás campos "lista" se usan
  // los enums fijos de filtroOpciones.js que reflejan lo que graba el
  // backend. Distintas consultas pueden usar el mismo nombre de campo con
  // significado distinto (p.ej. "estado" es español en ingenieros e inglés
  // en proyectos), por eso el mapa se arma por consulta.
  const opcionesPorCampo = useMemo(() => {
    const proyectoOpciones = (projects || [])
      .map(p => ({ value: p.id, label: p.project_name || "Proyecto sin nombre" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const ingenieroOpciones = (engineers || [])
      .filter(e => e.sql_id != null)
      .map(e => ({ value: String(e.sql_id), label: e.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const porConsulta = {
      actividades:         { proyecto_id: proyectoOpciones, tipo: TIPOS_EVENTO_ACTIVIDAD },
      ingenieros:          { ingeniero_id: ingenieroOpciones, proyecto_id: proyectoOpciones, estado: ESTADOS_INGENIERO_REPORTE },
      proyectos:           { proyecto_id: proyectoOpciones, estado: ESTADOS_PROYECTO, prioridad: PRIORIDADES_PROYECTO },
      notas:               { proyecto_id: proyectoOpciones, tipo: TIPOS_NOTA },
      vencidas:            { proyecto_id: proyectoOpciones },
      actividades_estado:  { proyecto_id: proyectoOpciones, estado: ESTADOS_ACTIVIDAD_OPERACIONAL },
    };
    return porConsulta[consulta] || {};
  }, [projects, engineers, consulta]);

  // Re-ejecutar la consulta cuando cambian la consulta base o los filtros.
  // Se piden TODAS las columnas disponibles (no solo las visibles): así
  // mostrar/ocultar columnas es puramente del lado cliente, sin re-consultar.
  // Sin setState síncrono en el cuerpo del efecto (mismo patrón que
  // QuartersView.jsx y ProjectNotesPanel.jsx): "Cargando…" solo se ve en la
  // carga inicial, no en cada refetch por filtro — cambio de datos sin parpadeo.
  //
  // `vigente` descarta la respuesta si ya se disparó una consulta más nueva:
  // sin esto, agregar un filtro mientras la consulta anterior (sin ese
  // filtro) sigue en vuelo podía terminar mostrando el resultado viejo si
  // llegaba después — el filtro se aplicaba pero la tabla no lo reflejaba.
  useEffect(() => {
    if (!registryEntry) return;
    let vigente = true;
    runReportQuery({ consulta, filtros, columnas: registryEntry.columnas, limite: 500 })
      .then(data => { if (vigente) { setResultado(data); setError(""); } })
      .catch(e => { if (vigente) setError(e.message); })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
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

          {DESCRIPCION_CONSULTA[consulta] && (
            <p className="reportes-view__consulta-hint">{DESCRIPCION_CONSULTA[consulta]}</p>
          )}

          <ReportesSavedPanel
            currentConfig={{ consulta, filtros, columnas: columnasVisibles }}
            onLoad={handleLoadSaved}
          />

          <ReportesFilterPanel registryEntry={registryEntry} opcionesPorCampo={opcionesPorCampo} onAdd={handleAddFiltro} />

          {filtros.length > 0 && (
            <div className="reportes-chips">
              {filtros.map(f => (
                <span key={f.campo} className="reportes-chip">
                  {humanizeFiltro(f, opcionesPorCampo)}
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
