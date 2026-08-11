import { useState } from "react";
import { GlobalMetricsTable } from "./MetricsTable";
import { projectProgress, generateReportText, generateSingleProjectReportText } from "../utils/formulas";
import { getProjectsForEngineer } from "../utils/engineers";
import { STATUS } from "./report/reportShared";
import ProjectReport from "./report/ProjectReport";

// API_BASE viene de utils/api.js — fuente única (antes duplicado en 5 archivos).

export default function ReportView({ projects, weekLabel, engineers, singleProjectIdx, onClearSingle, generatingInforme, generatingName, onGenerateInforme, onCancelInforme }) {
  const [toast, setToast] = useState("");

  // ── Filtros del reporte consolidado ──
  const [fSearch,   setFSearch]   = useState("");
  const [fProject,  setFProject]  = useState("all");   // id de proyecto o "all"
  const [fStatus,   setFStatus]   = useState("all");   // clave de estado o "all"
  const [fEngineer, setFEngineer] = useState("all");   // id de ingeniero o "all"
  const [fPriority, setFPriority] = useState(false);   // solo prioritarios
  const [fSort,     setFSort]     = useState("number"); // "number" | "progress"

  const isSingle = singleProjectIdx != null;

  // Índices reales conservados para que las acciones (informe, etc.) apunten al
  // proyecto correcto aunque la lista se filtre o reordene (patrón del Dashboard).
  const filtered = (() => {
    let list = projects.map((p, idx) => ({ p, realIdx: idx }));
    if (fSearch.trim()) {
      const term = fSearch.toLowerCase();
      list = list.filter(({ p }) => (p.project_name || "").toLowerCase().includes(term));
    }
    if (fProject !== "all") list = list.filter(({ p }) => p.id === fProject);
    if (fStatus  !== "all") list = list.filter(({ p }) => (p.status || "on-track") === fStatus);
    if (fPriority)          list = list.filter(({ p }) => !!p.priority);
    if (fEngineer !== "all") {
      const engProjIds = new Set(getProjectsForEngineer(fEngineer, projects).map(p => p.id));
      list = list.filter(({ p }) => engProjIds.has(p.id));
    }
    if (fSort === "progress") {
      list = [...list].sort((a, b) => {
        const pa = a.p.manual_metrics || {}, pb = b.p.manual_metrics || {};
        return projectProgress(pa.total_tasks, pa.completed_tasks, pa.in_progress_tasks)
             - projectProgress(pb.total_tasks, pb.completed_tasks, pb.in_progress_tasks);
      });
    }
    return list;
  })();

  const hasActiveFilters = fSearch.trim() || fProject !== "all" || fStatus !== "all" ||
    fEngineer !== "all" || fPriority || fSort !== "number";
  const clearFilters = () => {
    setFSearch(""); setFProject("all"); setFStatus("all");
    setFEngineer("all"); setFPriority(false); setFSort("number");
  };

  // displayProjects: en single = ese proyecto; en consolidado = los filtrados.
  const displayProjects = isSingle
    ? [{ p: projects[singleProjectIdx], realIdx: singleProjectIdx }]
    : filtered;
  const isGeneratingThis = generatingInforme && isSingle &&
    generatingName === (projects[singleProjectIdx]?.project_name || "");

  const handleCopy = () => {
    // En consolidado, copia lo que se está viendo (respeta los filtros activos).
    const text = isSingle
      ? generateSingleProjectReportText(projects[singleProjectIdx], weekLabel, engineers)
      : generateReportText(filtered.map(x => x.p), weekLabel, engineers);
    navigator.clipboard.writeText(text)
      .then(() => { setToast("✓ Reporte copiado al portapapeles"); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar"));
  };

  const handleExportText = (project) => {
    const text = generateSingleProjectReportText(project, weekLabel, engineers);
    navigator.clipboard.writeText(text)
      .then(() => { setToast(`✓ Reporte de "${project.project_name || "proyecto"}" copiado`); setTimeout(() => setToast(""), 2500); })
      .catch(() => setToast("No se pudo copiar al portapapeles"));
  };

  return (
    <div className="report-panel">
      <div className="report-panel__header">
        <div className="report-panel__title-group">
          {isSingle && (
            <button className="btn btn--secondary report-back-btn" onClick={onClearSingle}>
              ← Reporte consolidado
            </button>
          )}
          <h2 className="report-panel__title">
            {isSingle
              ? `Reporte: ${projects[singleProjectIdx]?.project_name || "Proyecto"}`
              : "Reporte Semanal Consolidado"}
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isSingle && (
            <>
              <button
                className="btn btn--accent"
                onClick={() => onGenerateInforme(singleProjectIdx)}
                disabled={generatingInforme}
                title="Genera el Informe de Gestión institucional en formato Word (.docx)"
              >
                📄 Generar Informe
              </button>
              {isGeneratingThis && (
                <>
                  <span className="generating-inline">
                    <span className="generating-inline__spinner" />
                    Generando informe
                  </span>
                  <button className="btn btn--danger" onClick={onCancelInforme} title="Cancelar generación del informe">
                    ✕ Cancelar
                  </button>
                </>
              )}
            </>
          )}
          <button className="btn btn--accent" onClick={handleCopy}>Copiar reporte ✎</button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {projects.length === 0 ? (
        <div className="edit-empty">Agrega proyectos para generar el reporte</div>
      ) : (
        <>
          {!isSingle && (
            <div className="report-metrics">
              <h3 className="report-section-title">Resumen Global</h3>
              <GlobalMetricsTable projects={filtered.map(x => x.p)} />
            </div>
          )}

          {/* ── Barra de filtros (solo en el reporte consolidado) ── */}
          {!isSingle && (
            <div className="report-filters">
              <input
                className="report-filters__search"
                type="text"
                placeholder="Buscar proyecto por nombre…"
                value={fSearch}
                onChange={e => setFSearch(e.target.value)}
              />
              <select className="report-filters__select" value={fProject} onChange={e => setFProject(e.target.value)}>
                <option value="all">Todos los proyectos</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_name || "Proyecto"}</option>)}
              </select>
              <select className="report-filters__select" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="all">Todos los estados</option>
                {Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.icon} {s.label}</option>)}
              </select>
              <select className="report-filters__select" value={fEngineer} onChange={e => setFEngineer(e.target.value)}>
                <option value="all">Todos los ingenieros</option>
                {(engineers || []).filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select className="report-filters__select" value={fSort} onChange={e => setFSort(e.target.value)}>
                <option value="number">Orden: por número</option>
                <option value="progress">Orden: por avance ↑</option>
              </select>
              <button
                type="button"
                className={`report-filters__priority${fPriority ? " report-filters__priority--on" : ""}`}
                onClick={() => setFPriority(v => !v)}
                aria-pressed={fPriority}
              >
                {fPriority ? "★" : "☆"} Solo prioritarios
              </button>
              <span className="report-filters__count">
                Mostrando {filtered.length} de {projects.length}
              </span>
              {hasActiveFilters && (
                <button type="button" className="report-filters__clear" onClick={clearFilters}>
                  ✕ Limpiar
                </button>
              )}
            </div>
          )}

          {displayProjects.length === 0 ? (
            <div className="edit-empty">
              Ningún proyecto coincide con los filtros.
              {hasActiveFilters && <> <button type="button" className="report-filters__clear" onClick={clearFilters}>Limpiar filtros</button></>}
            </div>
          ) : displayProjects.map(({ p, realIdx }, i) => (
            <ProjectReport
              key={p.id}
              p={p}
              i={i}
              onGenerateInforme={() => onGenerateInforme(realIdx)}
              onExportText={handleExportText}
              generating={generatingInforme}
              generatingName={generatingName}
              autoRunStatus={isSingle}
              engineerCatalog={engineers}
              weekLabel={weekLabel}
              setToast={setToast}
            />
          ))}
        </>
      )}
    </div>
  );
}
