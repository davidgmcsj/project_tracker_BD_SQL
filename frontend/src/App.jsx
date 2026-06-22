import { useState, useEffect, useCallback } from "react";
import Dashboard     from "./components/Dashboard";
import EditView      from "./components/EditView";
import ReportView    from "./components/ReportView";
import EngineersView from "./components/EngineersView";
import ProgressRing  from "./components/ProgressRing";
import {
  globalStats, getWeekLabel, getToday, getNextFriday, getWeekRangeLabel,
  isSameWeek, createDefaultProject, generateSingleProjectReportText,
  createEngineer,
} from "./utils/formulas";
import {
  loadProjects, saveProjects, saveWeekReport, getStoredWeekLabel, storeWeekLabel,
} from "./utils/storage";
import "./App.css";

const STAT_CARDS = [
  { dot: "done",     label: "Completadas"  },
  { dot: "wip",      label: "En proceso"   },
  { dot: "pending",  label: "No iniciados" },
  { dot: "projects", label: "Proyectos"    },
];

function getStatValue(dot, stats, projects) {
  switch (dot) {
    case "done":     return stats.completed;
    case "wip":      return stats.inProgress;
    case "pending":  return stats.total - stats.completed - stats.inProgress;
    case "projects": return projects.length;
  }
}

export default function App() {
  const [projects,          setProjects]          = useState([]);
  const [engineers,         setEngineers]         = useState([]);
  const [view,              setView]              = useState("dashboard");
  const [editingIdx,        setEditingIdx]        = useState(null);
  const [weekLabel,         setWeekLabel]         = useState(getWeekLabel());
  const [reportDate,        setReportDate]        = useState(getToday());
  const [hasUnsavedChanges, setHasUnsaved]        = useState(false);
  const [reportProjectIdx,  setReportProjectIdx]  = useState(null);
  const [saveToast,         setSaveToast]         = useState("");

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { projects: saved, weekLabel: savedWeek, engineers: savedEngineers } = await loadProjects();
      if (saved?.length) {
        setProjects(saved);
        const firstDate = saved[0]?.report_date;
        if (firstDate) setReportDate(firstDate);
      }
      if (savedEngineers?.length) setEngineers(savedEngineers);
      const wl = savedWeek || getStoredWeekLabel();
      if (wl) setWeekLabel(wl);
    }
    init();
  }, []);

  // ── Persistencia ───────────────────────────────────────────────────────────
  const persist = useCallback(async (data, engs) => {
    setProjects(data);
    await saveProjects(data, weekLabel, engs !== undefined ? engs : engineers);
    setHasUnsaved(false);
  }, [weekLabel, engineers]);

  const persistEngineers = useCallback(async (nextEngineers) => {
    setEngineers(nextEngineers);
    await saveProjects(projects, weekLabel, nextEngineers);
  }, [projects, weekLabel]);

  // ── Limpiado de campos semanales ───────────────────────────────────────────
  const applyWeekReset = async (newDate, newLabel) => {
    await saveWeekReport(projects, weekLabel);
    const next = projects.map(p => ({
      ...p,
      report_date:         newDate,
      weekly_achievements: [],
      next_week_plan:      [],
      show_closing_fields: false,
      impediments: (p.impediments || []).filter(im => im.category !== "blocker"),
      engineers:   (p.engineers   || []).map(e => ({ ...e, weekly_total: 0, weekly_detail: [] })),
    }));
    setReportDate(newDate);
    setWeekLabel(newLabel);
    storeWeekLabel(newLabel);
    await persist(next);
  };

  // ── Cambio de fecha del reporte ────────────────────────────────────────────
  const handleReportDateChange = async (date) => {
    if (date === reportDate) return;

    if (isSameWeek(date, reportDate)) {
      const updated = projects.map(p => ({ ...p, report_date: date }));
      setReportDate(date);
      setProjects(updated);
      await saveProjects(updated, weekLabel, engineers);
    } else {
      const ok = window.confirm(
        `⚠ Cambiar a una semana diferente borrará los campos semanales de todos los proyectos:\n\n` +
        `  • Logros de esta semana\n` +
        `  • Plan para la próxima semana\n` +
        `  • Bloqueantes\n` +
        `  • Actividades semanales de ingenieros\n\n` +
        `Los datos se guardarán en el historial antes de borrarlos.\n\n` +
        `¿Confirmas el cambio de semana a ${date}?`
      );
      if (!ok) return;
      await applyWeekReset(date, weekLabel);
    }
  };

  // ── Guardar snapshot ───────────────────────────────────────────────────────
  const handleSaveReport = async () => {
    const range = getWeekRangeLabel(reportDate);
    const ok = window.confirm(
      `¿Deseas guardar el reporte?\n\n` +
      `Esto sobreescribirá el reporte de la semana:\n${range}\n\n` +
      `¿Confirmas?`
    );
    if (!ok) return;
    await saveWeekReport(projects, weekLabel);
    setSaveToast("✓ Reporte guardado en el historial");
    setTimeout(() => setSaveToast(""), 2500);
  };

  // ── Navegación protegida ───────────────────────────────────────────────────
  const navigateTo = (newView) => {
    if (hasUnsavedChanges) {
      const ok = window.confirm("Tienes cambios sin guardar. ¿Descartar y salir?");
      if (!ok) return;
      setHasUnsaved(false);
    }
    if (newView === "report") setReportProjectIdx(null);
    setView(newView);
  };

  // ── Acciones sobre proyectos ───────────────────────────────────────────────
  const updateProject = (idx, field, value) => {
    const next = [...projects];
    next[idx] = { ...next[idx], [field]: value };
    setProjects(next);
    setHasUnsaved(true);
  };

  const updateProjectFull = (idx, updatedProject) => {
    const next = [...projects];
    next[idx] = updatedProject;
    setProjects(next);
    setHasUnsaved(true);
  };

  const addProject = () => {
    const p    = { ...createDefaultProject(), report_date: reportDate };
    const next = [...projects, p];
    setProjects(next);
    setHasUnsaved(true);
    setEditingIdx(next.length - 1);
    setView("edit");
  };

  const removeProject = (idx) => {
    const next = projects.filter((_, i) => i !== idx);
    persist(next);
    if (editingIdx === idx)   { setEditingIdx(null); setView("dashboard"); }
    else if (editingIdx > idx)  setEditingIdx(editingIdx - 1);
  };

  const reorderProjects = (fromIdx, toIdx) => {
    const next = [...projects];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    persist(next);
    setEditingIdx(toIdx);
  };

  const viewProjectReport = (idx) => { setReportProjectIdx(idx); setView("report"); };

  const exportProjectReport = (idx) => {
    const text = generateSingleProjectReportText(projects[idx], weekLabel, engineers);
    navigator.clipboard.writeText(text).then(() => {
      setSaveToast(`✓ Reporte de "${projects[idx]?.project_name || "proyecto"}" copiado al portapapeles`);
      setTimeout(() => setSaveToast(""), 2500);
    }).catch(() => {
      setSaveToast("No se pudo copiar al portapapeles");
      setTimeout(() => setSaveToast(""), 2500);
    });
  };

  // ── Catálogo de ingenieros ─────────────────────────────────────────────────
  const addEngineer = (name, role) => {
    const eng = createEngineer(name, role);
    persistEngineers([...engineers, eng]);
    return eng.id;
  };

  const updateEngineer = (id, name, role) => {
    persistEngineers(engineers.map(e => e.id === id ? { ...e, name, role } : e));
  };

  const toggleEngineerActive = (id) => {
    persistEngineers(engineers.map(e => e.id === id ? { ...e, active: !e.active } : e));
  };

  const updateEngineerTasks = (id, tasks) => {
    persistEngineers(engineers.map(e => e.id === id ? { ...e, tasks } : e));
  };

  // ── Restaurar desde BD ────────────────────────────────────────────────────
  const handleRestoreFromDB = async () => {
    const ok = window.confirm(
      `⚠ RESTAURAR RESPALDO\n\n` +
      `Esto sobreescribirá todos los datos actuales con el último respaldo guardado en la base de datos.\n\n` +
      `Úsalo solo si perdiste información o el aplicativo quedó en un estado incorrecto.\n\n` +
      `¿Confirmas la restauración?`
    );
    if (!ok) return;
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_BASE}/api/restore-from-db`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alert(`✓ Restauración exitosa — ${data.restored} proyectos recuperados.\n\nEl aplicativo se recargará ahora.`);
      window.location.reload();
    } catch (e) {
      alert(`Error al restaurar: ${e.message}`);
    }
  };

  // ── Nueva semana ───────────────────────────────────────────────────────────
  const resetWeek = async () => {
    if (hasUnsavedChanges) {
      alert("Guarda o descarta los cambios antes de iniciar una nueva semana.");
      return;
    }
    const newFriday = getNextFriday();
    const newLabel  = getWeekLabel();
    const ok = window.confirm(
      `⚠ Iniciar nueva semana borrará los campos semanales de todos los proyectos:\n\n` +
      `  • Logros de esta semana\n` +
      `  • Plan para la próxima semana\n` +
      `  • Bloqueantes\n` +
      `  • Actividades semanales de ingenieros\n\n` +
      `Los datos actuales se guardarán en el historial.\n` +
      `La fecha del reporte pasará a: ${newFriday}\n\n` +
      `¿Confirmas iniciar la nueva semana?`
    );
    if (!ok) return;
    await applyWeekReset(newFriday, newLabel);
  };

  const stats = globalStats(projects);

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <img src="/imagenes/logo_institucional.png" alt="Logo Corte Suprema de Justicia" className="header__logo" />
          <div className="header__info">
            <h1 className="header__title">Seguimiento Semanal</h1>
            <span className="header__week-range">{getWeekRangeLabel(reportDate)}</span>
            <div className="header__meta">
              <div className="header__date-group">
                <label className="header__date-label">Fecha del Reporte</label>
                <input
                  type="date" className="header__date-input"
                  value={reportDate}
                  onChange={e => handleReportDateChange(e.target.value)}
                  title="Fecha del reporte — cambia dentro de la semana sin perder datos"
                />
                <button className="btn btn--save-report" onClick={handleSaveReport} title="Guardar snapshot en el historial">
                  💾 Guardar reporte
                </button>
              </div>
              {saveToast && <span className="header__toast">{saveToast}</span>}
            </div>
          </div>
        </div>

        <div className="header__actions">
          {["dashboard", "edit", "report", "engineers"].map(v => (
            <button
              key={v}
              className={`tab-btn ${view === v ? "tab-btn--active" : ""}`}
              onClick={() => navigateTo(v)}
            >
              {v === "dashboard" ? "Dashboard" : v === "edit" ? "Editar" : v === "report" ? "Reporte" : "Ingenieros"}
            </button>
          ))}
          <button className="btn btn--reset" onClick={resetWeek}>↻ Nueva semana</button>
          <button className="btn btn--restore" onClick={handleRestoreFromDB} title="Restaurar datos desde el último respaldo en la base de datos">⬇ Restaurar respaldo</button>
        </div>
      </header>

      <main className="main-content">
        {view !== "edit" && (
          <section className="summary">
            <div className="summary__progress">
              <ProgressRing percent={stats.percent} color="var(--accent)" />
              <div>
                <div className="summary__label">Avance Promedio</div>
                <div className="summary__value">{Math.round(stats.percent)}%</div>
              </div>
            </div>
            <div className="summary__stats">
              {STAT_CARDS.map(({ dot, label }) => (
                <div key={dot} className="stat-card">
                  <span className={`stat-card__dot stat-card__dot--${dot}`} />
                  <div>
                    <div className="stat-card__num">{getStatValue(dot, stats, projects)}</div>
                    <div className="stat-card__label">{label}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {view === "report" && (
          <ReportView
            projects={projects} weekLabel={weekLabel} engineers={engineers}
            singleProjectIdx={reportProjectIdx}
            onClearSingle={() => setReportProjectIdx(null)}
          />
        )}
        {view === "engineers" && (
          <EngineersView
            engineers={engineers}
            projects={projects}
            onAdd={addEngineer}
            onUpdate={updateEngineer}
            onToggleActive={toggleEngineerActive}
            onUpdateTasks={updateEngineerTasks}
          />
        )}
        {view === "dashboard" && (
          <Dashboard
            projects={projects}
            onEdit={idx => { setEditingIdx(idx); setView("edit"); }}
            onAdd={addProject}
            onViewReport={viewProjectReport}
            onExportReport={exportProjectReport}
          />
        )}
        {view === "edit" && (
          <EditView
            projects={projects} editingIdx={editingIdx}
            hasUnsavedChanges={hasUnsavedChanges}
            onSelectProject={setEditingIdx}
            onUpdateProject={updateProject}
            onUpdateProjectFull={updateProjectFull}
            onSaveChanges={() => persist(projects)}
            onReorderProjects={reorderProjects}
            onAddProject={addProject}
            onRemoveProject={removeProject}
            onViewReport={viewProjectReport}
            onExportReport={exportProjectReport}
            engineerCatalog={engineers}
            onCreateEngineer={addEngineer}
          />
        )}
      </main>

      <footer className="footer">
        <span className="footer__copy">© 2026 Oficina de Tecnología — Corte Suprema de Justicia. Todos los derechos reservados.</span>
        <span className="footer__credit">Desarrollado internamente por la Oficina de Tecnología - Corte Suprema de Justicia</span>
      </footer>
    </div>
  );
}
