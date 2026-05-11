import { useState, useEffect, useCallback } from "react";
import Dashboard from "./components/Dashboard";
import EditView from "./components/EditView";
import ReportView from "./components/ReportView";
import ProgressRing from "./components/ProgressRing";
import {
  globalStats,
  getWeekLabel,
  createDefaultProject,
} from "./utils/formulas";
import {
  saveProjects,
  loadProjects,
  saveWeekLabel,
  loadWeekLabel,
  saveWeekSnapshot,
} from "./utils/storage";
import "./App.css";

export default function App() {
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState("dashboard");
  const [editingIdx, setEditingIdx] = useState(null);
  const [weekLabel, setWeekLabel] = useState(getWeekLabel());
  const [editingWeekLabel, setEditingWeekLabel] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [reportProjectIdx, setReportProjectIdx] = useState(null);

  useEffect(() => {
    async function init() {
      const saved = await loadProjects();
      const savedWeek = await loadWeekLabel();

      if (saved && saved.length > 0) {
        setProjects(saved);
        localStorage.setItem("weekly-tracker-projects", JSON.stringify(saved));
        if (savedWeek) {
          setWeekLabel(savedWeek);
          localStorage.setItem("weekly-tracker-week", savedWeek);
        }
      } else {
        const localSaved = JSON.parse(localStorage.getItem("weekly-tracker-projects") || '[]');
        const localWeek = localStorage.getItem("weekly-tracker-week");
        if (localSaved.length > 0) {
          setProjects(localSaved);
          if (localWeek) setWeekLabel(localWeek);
          await saveProjects(localSaved);
        }
      }
    }
    init();
  }, []);

  const persist = useCallback(async (data) => {
    setProjects(data);
    await saveProjects(data);
    setHasUnsavedChanges(false);
  }, []);

  const navigateTo = (newView) => {
    if (hasUnsavedChanges) {
      const confirmLeave = window.confirm(
        "Tienes cambios sin guardar en la edición del proyecto. ¿Deseas guardarlos antes de salir?"
      );
      if (confirmLeave) {
        return;
      } else {
        setHasUnsavedChanges(false);
      }
    }
    
    if (newView === "report") {
      setReportProjectIdx(null);
    }
    setView(newView);
  };

  const updateProject = (idx, field, value) => {
    const next = [...projects];
    next[idx] = { ...next[idx], [field]: value };
    setProjects(next);
    setHasUnsavedChanges(true);
  };

  const saveChanges = () => {
    persist(projects);
  };

  const addProject = () => {
    const next = [...projects, createDefaultProject()];
    setProjects(next);
    setHasUnsavedChanges(true);
    setEditingIdx(next.length - 1);
    setView("edit");
  };

  const viewProjectReport = (idx) => {
    setReportProjectIdx(idx);
    setView("report");
  };

  const removeProject = (idx) => {
    const next = projects.filter((_, i) => i !== idx);
    persist(next);
    if (editingIdx === idx) {
      setEditingIdx(null);
      setView("dashboard");
    } else if (editingIdx > idx) {
      setEditingIdx(editingIdx - 1);
    }
  };

  const reorderProjects = (fromIdx, toIdx) => {
    const next = [...projects];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    persist(next);
    setEditingIdx(toIdx);
  };

  const resetWeek = async () => {
    if (hasUnsavedChanges) {
      alert("Por favor, guarda o descarta los cambios actuales antes de iniciar una nueva semana.");
      return;
    }

    if (!window.confirm("¿Estás seguro de iniciar una nueva semana? Se limpiarán los campos de avance semanal.")) return;

    await saveWeekSnapshot(weekLabel, projects);

    const next = projects.map((p) => ({
      ...p,
      pendingActivities: "",
      blockers: "",
      blockersImpact: "",
      weekAccomplishments: "",
      weekPlanned: "",
      showFridayFields: false,
      engineers: (p.engineers || []).map(e => ({
        ...e,
        weekTotal: 0,
        weekInProgress: 0,
        weekActivities: "",
      })),
    }));
    const newWeek = getWeekLabel();
    await persist(next);
    setWeekLabel(newWeek);
    await saveWeekLabel(newWeek);
  };

  const stats = globalStats(projects);

  return (
    <div className="app">
      {/* ═══ HEADER ═══ */}
      <header className="header">
        <div className="header__info">
          <h1 className="header__title">Seguimiento Semanal</h1>
          {editingWeekLabel ? (
            <input
              className="header__week-input"
              value={weekLabel}
              autoFocus
              onChange={async (e) => { 
                const val = e.target.value;
                setWeekLabel(val); 
                await saveWeekLabel(val); 
              }}
              onBlur={() => setEditingWeekLabel(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingWeekLabel(false); }}
            />
          ) : (
            <span
              className="header__week header__week--editable"
              title="Haz clic para editar la fecha"
              onClick={() => setEditingWeekLabel(true)}
            >
              {weekLabel} ✎
            </span>
          )}
        </div>
        <div className="header__actions">
          <button
            className={`tab-btn ${view === "dashboard" ? "tab-btn--active" : ""}`}
            onClick={() => navigateTo("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`tab-btn ${view === "edit" ? "tab-btn--active" : ""}`}
            onClick={() => navigateTo("edit")}
          >
            Editar
          </button>
          <button
            className={`tab-btn ${view === "report" ? "tab-btn--active" : ""}`}
            onClick={() => navigateTo("report")}
          >
            Reporte
          </button>
          <button className="btn btn--reset" onClick={resetWeek}>
            ↻ Nueva semana
          </button>
        </div>
      </header>

      <main className="main-content">
        {/* ═══ RESUMEN GLOBAL ═══ */}
        {view !== "edit" && (
          <section className="summary">
            <div className="summary__progress">
              <ProgressRing percent={stats.percent} color="var(--accent)" />
              <div>
                <div className="summary__label">Avance Promedio</div>
                <div className="summary__value">
                  {Math.round(stats.percent)}%
                </div>
              </div>
            </div>

            <div className="summary__stats">
              <div className="stat-card">
                <span className="stat-card__dot stat-card__dot--done" />
                <div>
                  <div className="stat-card__num">{stats.completed}</div>
                  <div className="stat-card__label">Completadas</div>
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-card__dot stat-card__dot--wip" />
                <div>
                  <div className="stat-card__num">{stats.inProgress}</div>
                  <div className="stat-card__label">En proceso</div>
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-card__dot stat-card__dot--pending" />
                <div>
                  <div className="stat-card__num">{stats.total - stats.completed - stats.inProgress}</div>
                  <div className="stat-card__label">No iniciados</div>
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-card__dot stat-card__dot--projects" />
                <div>
                  <div className="stat-card__num">{projects.length}</div>
                  <div className="stat-card__label">Proyectos</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ═══ VISTAS INDEPENDIENTES ═══ */}
        {view === "report" && (
          <ReportView
            projects={projects}
            weekLabel={weekLabel}
            singleProjectIdx={reportProjectIdx}
            onClearSingle={() => setReportProjectIdx(null)}
          />
        )}

        {view === "dashboard" && (
          <Dashboard
            projects={projects}
            onEdit={(idx) => {
              setEditingIdx(idx);
              setView("edit");
            }}
            onAdd={addProject}
            onViewReport={viewProjectReport}
          />
        )}

        {view === "edit" && (
          <EditView
            projects={projects}
            editingIdx={editingIdx}
            hasUnsavedChanges={hasUnsavedChanges}
            onSelectProject={setEditingIdx}
            onUpdateProject={updateProject}
            onSaveChanges={saveChanges}
            onReorderProjects={reorderProjects}
            onAddProject={addProject}
            onRemoveProject={removeProject}
            onViewReport={viewProjectReport}
          />
        )}
      </main>
    </div>
  );
}
