import { useState } from "react";
import { GlobalMetricsTable, ProjectMetricsTableCompact } from "./MetricsTable";
import { generateAssignmentsByEngineer } from "../utils/formulas";
import QuarterResetModal from "./QuarterResetModal";

const STATUS = {
  "on-track":        { label: "En curso",        cssClass: "on-track",        icon: "🟡" },
  "at-risk":         { label: "En riesgo",       cssClass: "at-risk",         icon: "🟠" },
  blocked:           { label: "Bloqueado",       cssClass: "blocked",         icon: "🔴" },
  completed:         { label: "Completado",      cssClass: "completed",       icon: "🟢" },
  "mejora-continua": { label: "Mejora Continua", cssClass: "mejora-continua", icon: "🔵" },
};

// Orden de urgencia en el dashboard: lo que necesita atención primero.
const STATUS_ORDER = { blocked: 0, "at-risk": 1, "on-track": 2, "mejora-continua": 3, completed: 4 };

export default function Dashboard({ projects, engineers, onEdit, onAdd, onViewReport, onExportReport, onGenerateInforme, generatingInforme, generatingName, onCancelInforme, includedInAvg, onToggleIncludeInAvg, globalStatus, globalStatusMode, generatingGlobalStatus, globalStatusOpen, onToggleGlobalStatusOpen, onGenerateGlobalStatus, quarterInfo, onQuarterReset, onCleanStats }) {
  const [toast,            setToast]            = useState("");
  const [showResetModal,   setShowResetModal]   = useState(false);
  const [cleaningStats,    setCleaningStats]    = useState(false);
  const [search,           setSearch]           = useState("");

  const handleCleanStats = async () => {
    if (!window.confirm("¿Aplicar limpieza de trimestre a los proyectos actuales?\n\nSe reiniciará:\n• Estado del proyecto → En curso\n• Indicadores → en cero\n• Logros, plan, impedimentos, comentarios → vacíos\n• Actividades completadas → eliminadas\n• Historial de fechas de depósito → borrado\n• Estadísticas semanales de ingenieros → cero\n\nSe conservará:\n• Actividades en proceso y no iniciadas (con sus responsables y detalle)\n\n¿Continuar?")) return;
    setCleaningStats(true);
    try {
      await onCleanStats();
      setToast("✓ Estadísticas limpiadas correctamente");
    } catch {
      setToast("Error al limpiar estadísticas");
    } finally {
      setCleaningStats(false);
      setTimeout(() => setToast(""), 3000);
    }
  };

  const handleCopyAssign = (p, i, e) => {
    e.stopPropagation();
    // Usa solo los ingenieros del catálogo que están en el equipo del proyecto
    const projectEngIds = new Set((p.engineers || []).map(r => r.engineer_id).filter(Boolean));
    const projectEngCatalog = projectEngIds.size > 0
      ? (engineers || []).filter(e => projectEngIds.has(e.id))
      : engineers || [];
    const txt = generateAssignmentsByEngineer([p], projectEngCatalog, p.project_name || `Proyecto ${i + 1}`);
    navigator.clipboard.writeText(txt)
      .then(() => { setToast(`✓ Asignaciones de "${p.project_name || `Proyecto ${i + 1}`}" copiadas`); setTimeout(() => setToast(""), 2500); })
      .catch(() => { setToast("No se pudo copiar"); setTimeout(() => setToast(""), 2500); });
  };

  return (
    <div>
      {projects.length > 0 && (
        <div className="dashboard-metrics">
          <h3 className="dashboard-metrics__title">Resumen Global</h3>
          <GlobalMetricsTable projects={projects} includedIds={includedInAvg} />
        </div>
      )}

      {projects.length > 0 && (
        <div className="global-status-bar">
          <button
            className="btn btn--global-status btn--executive"
            onClick={() => onGenerateGlobalStatus("executive")}
            disabled={generatingGlobalStatus}
            title="Párrafo ejecutivo resumido para compartir"
          >
            {generatingGlobalStatus && globalStatusMode === "executive" ? "⏳ Analizando…" : "✨ Status Ejecutivo"}
          </button>
          <button
            className="btn btn--global-status btn--full"
            onClick={() => onGenerateGlobalStatus("full")}
            disabled={generatingGlobalStatus}
            title="Análisis estructurado con secciones"
          >
            {generatingGlobalStatus && globalStatusMode === "full" ? "⏳ Analizando…" : "📊 Análisis Completo"}
          </button>
          {(globalStatus || generatingGlobalStatus) && (
            <button className="btn btn--global-status-toggle" onClick={onToggleGlobalStatusOpen}>
              {globalStatusOpen ? "▲ Ocultar" : "▼ Ver análisis"}
            </button>
          )}
        </div>
      )}

      {globalStatusOpen && (globalStatus || generatingGlobalStatus) && (
        <div className="global-status-panel">
          {generatingGlobalStatus && (
            <p className="global-status-panel__loading">Generando análisis con IA…</p>
          )}

          {globalStatus && globalStatusMode === "executive" && (
            <div className="global-status-panel__section">
              <h4>Status Ejecutivo</h4>
              <p>{globalStatus.parrafo}</p>
            </div>
          )}

          {globalStatus && globalStatusMode === "full" && (
            <>
              {globalStatus.resumen_ejecutivo && (
                <div className="global-status-panel__section">
                  <h4>Resumen ejecutivo</h4>
                  <p>{globalStatus.resumen_ejecutivo}</p>
                </div>
              )}
              {globalStatus.proyectos_destacados?.length > 0 && (
                <div className="global-status-panel__section">
                  <h4>Proyectos destacados</h4>
                  <ul>
                    {globalStatus.proyectos_destacados.map((p, i) => (
                      <li key={i}><strong>{p.nombre}</strong> — {p.avance}% — {p.nota}</li>
                    ))}
                  </ul>
                </div>
              )}
              {globalStatus.alertas?.length > 0 && (
                <div className="global-status-panel__section global-status-panel__section--alert">
                  <h4>Alertas</h4>
                  <ul>
                    {globalStatus.alertas.map((a, i) => (
                      <li key={i}><strong>{a.nombre}</strong> — {a.avance}% — {a.motivo}</li>
                    ))}
                  </ul>
                </div>
              )}
              {globalStatus.proximos_pasos?.length > 0 && (
                <div className="global-status-panel__section">
                  <h4>Próximos pasos</h4>
                  <ul>
                    {globalStatus.proximos_pasos.map((paso, i) => <li key={i}>{paso}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}

          {globalStatus && (
            <div className="global-status-panel__actions">
              <button className="btn btn--card-export" onClick={() => {
                const text = globalStatusMode === "executive"
                  ? (globalStatus.parrafo || "")
                  : [
                      globalStatus.resumen_ejecutivo || "",
                      (globalStatus.proyectos_destacados?.length ? "\nProyectos destacados:\n" + globalStatus.proyectos_destacados.map(p => `• ${p.nombre} (${p.avance}%): ${p.nota}`).join("\n") : ""),
                      (globalStatus.alertas?.length ? "\nAlertas:\n" + globalStatus.alertas.map(a => `• ${a.nombre} (${a.avance}%): ${a.motivo}`).join("\n") : ""),
                      (globalStatus.proximos_pasos?.length ? "\nPróximos pasos:\n" + globalStatus.proximos_pasos.map(p => `• ${p}`).join("\n") : ""),
                    ].filter(Boolean).join("\n");
                navigator.clipboard.writeText(text);
              }}>
                📋 Copiar análisis
              </button>
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {/* Barra de acciones de trimestre */}
      {quarterInfo && onQuarterReset && (
        <div className="dashboard-quarter-bar">
          <div className="dashboard-quarter-bar__info">
            <span className="dashboard-quarter-bar__label">Trimestre actual:</span>
            <span className="dashboard-quarter-bar__name">{quarterInfo.label}</span>
          </div>
          <button
            className="btn btn--new-quarter"
            onClick={() => setShowResetModal(true)}
            title={`Cerrar ${quarterInfo.label} e iniciar ${quarterInfo.nextLabel}`}
          >
            🗂 Nuevo trimestre
          </button>
          {onCleanStats && (
            <button
              className="btn btn--clean-stats"
              onClick={handleCleanStats}
              disabled={cleaningStats}
              title="Limpiar estadísticas semanales e historial sin archivar"
            >
              {cleaningStats ? "⏳ Limpiando…" : "🧹 Limpiar estadísticas"}
            </button>
          )}
        </div>
      )}

      {/* Buscador de proyectos */}
      <div className="dashboard-search-bar">
        <input
          className="dashboard-search-input"
          type="text"
          placeholder="Buscar proyecto…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="dashboard-search-clear" onClick={() => setSearch("")} title="Limpiar">✕</button>
        )}
      </div>

      <div className="dashboard-grid">
        {projects
          .map((p, i) => ({ p, i }))           // conserva el índice real para onEdit/onViewReport
          .filter(({ p }) => {
            if (!search.trim()) return true;
            const term = search.toLowerCase();
            return (p.project_name || "").toLowerCase().includes(term);
          })
          .sort((a, b) => (STATUS_ORDER[a.p.status] ?? 9) - (STATUS_ORDER[b.p.status] ?? 9))  // urgencia primero
          .map(({ p, i }) => {
          const st = STATUS[p.status] || STATUS["on-track"];
          const isGeneratingThis = generatingInforme && generatingName === (p.project_name || `Proyecto ${i + 1}`);

          return (
            <div key={p.id} className={`project-card project-card--${st.cssClass}`} onClick={() => onEdit(i)}>
              <div className="project-card__header">
                <h3 className="project-card__name">
                  <span style={{ marginRight: 6 }}>{st.icon}</span>
                  {p.project_name || `Proyecto ${i + 1}`}
                </h3>
                <span className={`status-pill status-pill--${st.cssClass}`}>{st.label}</span>
              </div>
              <label className="project-card__avg-toggle" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={!includedInAvg || includedInAvg.has(p.id)}
                  onChange={() => onToggleIncludeInAvg && onToggleIncludeInAvg(p.id)}
                />
                <span>Incluir en promedio</span>
              </label>
              <div className="project-card__metrics" onClick={e => e.stopPropagation()}>
                <ProjectMetricsTableCompact project={p} />
              </div>
              <div className="project-card__actions" onClick={e => e.stopPropagation()}>
                <button className="btn btn--card-report" onClick={() => onViewReport(i)}>
                  📄 Ver reporte
                </button>
                <button className="btn btn--card-export" onClick={() => onExportReport(i)}>
                  📋 Copiar reporte
                </button>
                {isGeneratingThis ? (
                  <button className="btn btn--card-cancel" onClick={onCancelInforme}>
                    ✕ Cancelar
                  </button>
                ) : (
                  <button
                    className="btn btn--card-informe"
                    onClick={() => onGenerateInforme(i)}
                    disabled={generatingInforme}
                    title="Generar Informe de Gestión (.docx)"
                  >
                    {generatingInforme && !isGeneratingThis ? "⏳ Generando…" : "📝 Informe"}
                  </button>
                )}
                <button
                  className="btn btn--card-assign"
                  onClick={(e) => handleCopyAssign(p, i, e)}
                  title="Copiar actividades por ingeniero"
                >
                  👥 Asignaciones
                </button>
              </div>
            </div>
          );
        })}

        <div className="add-card" onClick={onAdd}>
          <span className="add-card__icon">+</span>
          <span className="add-card__text">Agregar proyecto</span>
        </div>
      </div>

      {/* Modal de doble confirmación para reinicio de trimestre */}
      {showResetModal && quarterInfo && (
        <QuarterResetModal
          quarterInfo={quarterInfo}
          projects={projects}
          onConfirm={onQuarterReset}
          onClose={() => setShowResetModal(false)}
        />
      )}
    </div>
  );
}
