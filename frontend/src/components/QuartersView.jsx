import { useState, useEffect } from "react";
import { loadQuartersList, loadQuarterById } from "../utils/storage";
import QuarterResetModal from "./QuarterResetModal";

// ── QuartersView ──────────────────────────────────────────────────────────────
//
// Módulo de consulta y administración de trimestres. Permite:
//   - Ver la lista de todos los trimestres archivados (metadatos).
//   - Entrar a un trimestre y ver sus proyectos en modo SOLO LECTURA.
//   - Buscar actividades por texto dentro del trimestre seleccionado.
//   - Cerrar el trimestre actual (Nuevo trimestre) o limpiar sus estadísticas.
//     Estas dos últimas viven aquí (no en el Dashboard) por ser acciones de
//     mantenimiento trimestral, no de uso diario.
//
// Navegación interna:
//   "list"    → lista de trimestres disponibles
//   "detail"  → proyectos y actividades de un trimestre específico
//
// Props:
//   projects      → proyectos actuales (para el modal de reinicio)
//   quarterInfo   → { label, nextLabel } del trimestre en curso
//   onQuarterReset → (…) => Promise — ejecuta el reinicio de trimestre
//   onCleanStats   → () => Promise — limpia estadísticas sin archivar

export default function QuartersView({ projects: currentProjects, quarterInfo, onQuarterReset, onCleanStats }) {
  const [innerView,       setInnerView]       = useState("list");
  const [quarters,        setQuarters]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState("");
  const [selectedQ,       setSelectedQ]       = useState(null);   // metadatos del trimestre
  const [quarterData,     setQuarterData]     = useState(null);   // JSON completo del trimestre
  const [loadingDetail,   setLoadingDetail]   = useState(false);
  const [searchText,      setSearchText]      = useState("");
  const [expandedProject, setExpandedProject] = useState(null);   // ID del proyecto expandido
  const [showResetModal,  setShowResetModal]  = useState(false);
  const [cleaningStats,   setCleaningStats]   = useState(false);
  const [toast,           setToast]           = useState("");

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

  // ── Cargar lista de trimestres al montar ────────────────────────────────────
  useEffect(() => {
    loadQuartersList()
      .then(data => { setQuarters(data.quarters || []); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, []);

  // ── Abrir un trimestre específico ───────────────────────────────────────────
  const openQuarter = async (q) => {
    setSelectedQ(q);
    setLoadingDetail(true);
    setSearchText("");
    setExpandedProject(null);
    try {
      const data = await loadQuarterById(q.TrimestreID);
      setQuarterData(data);
      setInnerView("detail");
    } catch (e) {
      setError(`Error cargando ${q.QuarterLabel}: ${e.message}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── Filtrar actividades por búsqueda ────────────────────────────────────────
  // Busca dentro del texto de la actividad y el nombre del proyecto.
  // Si hay búsqueda activa, todos los proyectos con coincidencias se muestran expandidos.
  const filterProjects = (projects) => {
    if (!searchText.trim()) return projects;
    const term = searchText.toLowerCase();
    return projects
      .map(p => ({
        ...p,
        activities_identified: (p.activities_identified || []).filter(a =>
          (a.text || "").toLowerCase().includes(term) ||
          (a.description || "").toLowerCase().includes(term)
        ),
      }))
      .filter(p =>
        p.activities_identified.length > 0 ||
        (p.project_name || "").toLowerCase().includes(term)
      );
  };

  // ── Helpers de formato ──────────────────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const statusLabel = (actId, ts) => {
    if ((ts?.completed   || []).includes(actId)) return { label: "Completada",  cls: "qv-pill--done"    };
    if ((ts?.in_progress || []).includes(actId)) return { label: "En proceso",  cls: "qv-pill--wip"     };
    return                                              { label: "No iniciada", cls: "qv-pill--pending" };
  };

  // ── Vista: lista de trimestres ──────────────────────────────────────────────
  if (innerView === "list") {
    return (
      <div className="qv-container">
        {toast && <div className="toast">{toast}</div>}

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

        <div className="qv-list-header">
          <h2 className="qv-list-title">Trimestres archivados</h2>
          <p className="qv-list-sub">
            Cada trimestre es un snapshot completo del estado de todos los proyectos al momento del reinicio. Solo lectura.
          </p>
        </div>

        {loading && <div className="qv-loading">Cargando trimestres...</div>}
        {error   && <div className="qv-error">{error}</div>}

        {!loading && !error && quarters.length === 0 && (
          <div className="qv-empty">
            <div className="qv-empty-icon">🗂</div>
            <p>Aún no hay trimestres archivados.</p>
            <p className="qv-empty-sub">Cuando hagas tu primer reinicio trimestral, aparecerá aquí.</p>
          </div>
        )}

        <div className="qv-list">
          {quarters.map(q => (
            <button
              key={q.TrimestreID}
              className="qv-card"
              onClick={() => openQuarter(q)}
            >
              <div className="qv-card__label">{q.QuarterLabel}</div>
              <div className="qv-card__meta">
                <span>📅 Cerrado: {fmtDate(q.FechaReset)}</span>
                <span>📁 {q.TotalProyectos} proyectos</span>
                {q.ActividadesArchivadas != null && (
                  <span>📦 {q.ActividadesArchivadas} archivadas</span>
                )}
                {q.ActividadesTransferidas != null && (
                  <span>➡ {q.ActividadesTransferidas} transferidas</span>
                )}
              </div>
              <div className="qv-card__arrow">›</div>
            </button>
          ))}
        </div>

        {showResetModal && quarterInfo && (
          <QuarterResetModal
            quarterInfo={quarterInfo}
            projects={currentProjects}
            onConfirm={onQuarterReset}
            onClose={() => setShowResetModal(false)}
          />
        )}
      </div>
    );
  }

  // ── Vista: detalle de un trimestre ─────────────────────────────────────────
  const projects     = filterProjects(quarterData?.projects || []);
  const hasSearch    = searchText.trim().length > 0;

  return (
    <div className="qv-container">
      {/* Cabecera del detalle */}
      <div className="qv-detail-header">
        <button className="qv-back-btn" onClick={() => { setInnerView("list"); setQuarterData(null); }}>
          ← Volver
        </button>
        <div className="qv-detail-title-group">
          <h2 className="qv-detail-title">{selectedQ?.QuarterLabel}</h2>
          <span className="qv-detail-badge">Solo lectura</span>
        </div>
        <input
          className="qv-search"
          type="text"
          placeholder="Buscar actividad o proyecto..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
      </div>

      {loadingDetail && <div className="qv-loading">Cargando trimestre...</div>}

      {/* Lista de proyectos con sus actividades */}
      {!loadingDetail && (
        <div className="qv-projects">
          {projects.length === 0 && (
            <div className="qv-empty">
              <p>No se encontraron resultados para "{searchText}".</p>
            </div>
          )}

          {projects.map(p => {
            const ts         = p.task_status || {};
            const acts       = p.activities_identified || [];
            const isExpanded = hasSearch || expandedProject === p.id;
            const completadas  = (ts.completed   || []).length;
            const enProceso    = (ts.in_progress || []).length;
            const noIniciadas  = (ts.not_started || []).length;

            return (
              <div key={p.id} className="qv-project">
                {/* Cabecera del proyecto — clic para expandir/colapsar */}
                <button
                  className="qv-project__header"
                  onClick={() => setExpandedProject(isExpanded && !hasSearch ? null : p.id)}
                >
                  <div className="qv-project__name">{p.project_name || "Proyecto sin nombre"}</div>
                  <div className="qv-project__pills">
                    <span className="qv-pill qv-pill--done">{completadas} ✓</span>
                    <span className="qv-pill qv-pill--wip">{enProceso} ⟳</span>
                    <span className="qv-pill qv-pill--pending">{noIniciadas} ◌</span>
                  </div>
                  <span className="qv-project__chevron">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {/* Actividades del proyecto (expandibles) */}
                {isExpanded && (
                  <div className="qv-acts">
                    {acts.length === 0 && (
                      <div className="qv-acts__empty">Sin actividades en este trimestre.</div>
                    )}
                    {acts.map(act => {
                      const { label: stLabel, cls: stCls } = statusLabel(act.id, ts);
                      return (
                        <div key={act.id} className="qv-act">
                          <div className="qv-act__top">
                            <span className="qv-act__text">{act.text}</span>
                            <span className={`qv-pill ${stCls}`}>{stLabel}</span>
                          </div>

                          {/* Mostrar descripción si existe */}
                          {act.description && (
                            <div className="qv-act__desc">{act.description}</div>
                          )}

                          {/* Fechas */}
                          {(act.start_date || act.due_date) && (
                            <div className="qv-act__dates">
                              {act.start_date && <span>Inicio: {fmtDate(act.start_date)}</span>}
                              {act.due_date   && <span>Fin: {fmtDate(act.due_date)}</span>}
                            </div>
                          )}

                          {/* Checklist (si tiene ítems) */}
                          {act.checklist?.length > 0 && (
                            <div className="qv-act__checklist">
                              {act.checklist.map(item => (
                                <div key={item.id} className={`qv-chk ${item.done ? "qv-chk--done" : ""}`}>
                                  <span className="qv-chk__icon">{item.done ? "☑" : "☐"}</span>
                                  <span className="qv-chk__text">{item.text}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Notas (si tiene) */}
                          {act.notes?.length > 0 && (
                            <div className="qv-act__notes">
                              <span className="qv-act__notes-label">Notas:</span>
                              {act.notes.map(n => (
                                <div key={n.id} className="qv-note">
                                  {n.date && <span className="qv-note__date">{fmtDate(n.date)}</span>}
                                  <span className="qv-note__text">{n.text}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Fechas clave (si tiene) */}
                          {act.key_dates?.length > 0 && (
                            <div className="qv-act__keydates">
                              {act.key_dates.map(kd => (
                                <div key={kd.id} className="qv-keydate">
                                  <span className="qv-keydate__icon">📌</span>
                                  <span className="qv-keydate__label">{kd.label}</span>
                                  <span className="qv-keydate__date">{fmtDate(kd.date)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
