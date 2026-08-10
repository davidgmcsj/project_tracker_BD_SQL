import { useState, useEffect, useCallback, useRef } from "react";
import Dashboard     from "./components/Dashboard";
import EditView, { TaskStatusSelector } from "./components/EditView";
import ProjectPlanningOverlays from "./components/ProjectPlanningOverlays";
import ReportView    from "./components/ReportView";
import EngineerHub from "./components/EngineerHub";
import QuartersView  from "./components/QuartersView";
import { ReportesView } from "./components/ReportesView";
import SaveConflictModal from "./components/SaveConflictModal";
import { LoginScreen } from "./components/LoginScreen";
import { CommandPalette } from "./components/CommandPalette";
import ProgressRing  from "./components/ProgressRing";
import NavGroup from "./components/NavGroup";
import UserMenu from "./components/UserMenu";
import UsersAdminView from "./components/UsersAdminView";
import {
  globalStats, getWeekLabel, getToday, getNextFriday, getWeekRangeLabel,
  isSameWeek, createDefaultProject, generateSingleProjectReportText,
  createEngineer, createExternalContact,
} from "./utils/formulas";
import {
  loadProjects, saveProjects, saveWeekReport, getStoredWeekLabel, storeWeekLabel,
  syncEngineerToSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL,
  syncExternalContactToSQL, executeQuarterReset, reloadProjectsFromServer, cleanCurrentStats,
  authHeaders, getCurrentUser, logout,
} from "./utils/storage";
import { apiUrl } from "./utils/api";
import { generateQuarterlyReport } from "./utils/generateQuarterlyReport";
import { recomputeWeeklyFields } from "./utils/weekPlanning";
import { useUrlState } from "./hooks/useUrlState";
import { buildTabs, tabContainsView, STAT_CARDS, getStatValue, countByStatus, getCurrentQuarterInfo } from "./appNav";
import "./App.css";

export default function App() {
  const [projects,          setProjects]          = useState([]);
  const [engineers,         setEngineers]         = useState([]);
  const [externalContacts,  setExternalContacts]  = useState([]);
  // Sincronizado con la URL (Fase 13): un enlace compartido abre la pestaña
  // correcta directamente, no solo los filtros internos de Reportes.
  const [view,              setView]              = useUrlState("view", "dashboard");
  const [editingIdx,        setEditingIdx]        = useState(null);
  const [weekLabel,         setWeekLabel]         = useState(getWeekLabel());
  const [reportDate,        setReportDate]        = useState(getToday());
  const [hasUnsavedChanges, setHasUnsaved]        = useState(false);
  const [reportProjectIdx,  setReportProjectIdx]  = useState(null);
  const [saveToast,         setSaveToast]         = useState("");
  const [generatingInforme,     setGeneratingInforme]     = useState(false);
  const [generatingName,        setGeneratingName]        = useState("");
  const [includedInAvg,         setIncludedInAvg]         = useState(null);
  const [globalStatus,          setGlobalStatus]          = useState(null);
  const [globalStatusMode,      setGlobalStatusMode]      = useState(null);
  const [generatingGlobalStatus,setGeneratingGlobalStatus]= useState(false);
  const [globalStatusOpen,      setGlobalStatusOpen]      = useState(false);
  const [theme,                 setTheme]                 = useState(() => localStorage.getItem("wt-theme") || "light");
  // undefined = verificando sesión, null = sin sesión (mostrar login), objeto = logueado.
  const [currentUser,           setCurrentUser]            = useState(undefined);
  const abortCtrlRef = useRef(null);

  // ── Sesión (Fase 9 revisada) ────────────────────────────────────────────────
  useEffect(() => {
    getCurrentUser().then(setCurrentUser);
  }, []);

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
  };

  // ── Restricción de navegación para usuarios sin rol admin (migración 019) ──
  // Sin esto, un usuario no-admin podía llegar a Dashboard/Editar/Reportes/
  // Administración por el valor por defecto de useUrlState ("dashboard") o
  // por un enlace compartido con ?view=algo — el botón oculto en la nav
  // (buildTabs) no alcanza para bloquear eso, solo evita el clic normal.
  // Corre cada vez que currentUser o view cambian: cubre tanto el estado
  // inicial como cualquier intento de navegar directo por URL después.
  useEffect(() => {
    if (!currentUser || currentUser.esAdmin) return;
    if (view !== "engineers" && view !== "engineer-report") setView("engineers");
  }, [currentUser, view, setView]);

  // Aplica el tema al documento y lo persiste. data-theme en <html> activa los
  // tokens del tema oscuro definidos en App.css.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("wt-theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  // ── Carga inicial ──────────────────────────────────────────────────────────
  // No carga datos de proyecto hasta confirmar la sesión — evita una carrera
  // donde se pide /api/projects mientras el login todavía se está resolviendo.
  useEffect(() => {
    if (!currentUser) return;
    async function init() {
      const { projects: saved, weekLabel: savedWeek, engineers: savedEngineers, externalContacts: savedExternals } = await loadProjects();
      if (saved?.length) {
        setProjects(saved);
        setIncludedInAvg(new Set(saved.map(p => p.id)));
        const firstDate = saved[0]?.report_date;
        if (firstDate) setReportDate(firstDate);
      }
      if (savedEngineers?.length) setEngineers(savedEngineers);
      if (savedExternals?.length) setExternalContacts(savedExternals);
      const wl = savedWeek || getStoredWeekLabel();
      if (wl) setWeekLabel(wl);
    }
    init();
  }, [currentUser]);

  // ── Persistencia ───────────────────────────────────────────────────────────
  // Patrón dual-write: localStorage (síncrono, fuente de verdad del cliente) +
  // servidor/SQL (async, fire-and-forget). Si el servidor falla, el dato no se
  // pierde — vive en localStorage hasta el siguiente save exitoso.
  const persist = useCallback(async (data, engs, changedProjectId, expectedVersion) => {
    setProjects(data);
    const result = await saveProjects(
      data, weekLabel, engs !== undefined ? engs : engineers, externalContacts, changedProjectId, expectedVersion
    );
    setHasUnsaved(false);
    if (result.ok && changedProjectId && result.version != null) {
      setProjects(prev => prev.map(p => (p.id === changedProjectId ? { ...p, version: result.version } : p)));
    }
    return result;
  }, [weekLabel, engineers, externalContacts]);

  // ── Conflicto de edición (Fase 8 — versión optimista) ──────────────────────
  // Solo se activa desde el botón "Guardar cambios" del editor: es el único
  // punto donde dos personas realistamente pueden estar editando EL MISMO
  // proyecto a la vez. Autosaves de modales y toggles del dashboard no
  // mandan expectedVersion, así que nunca disparan este modal.
  const [saveConflict, setSaveConflict] = useState(null); // { projectId, localProject, serverProject }
  const [planning, setPlanning] = useState(null); // { idx, view } — overlay de planificación abierto desde el dashboard

  const handleSaveEditedProject = useCallback(async () => {
    const editing = projects[editingIdx];
    if (!editing) { await persist(projects); return; }
    const result = await persist(projects, undefined, editing.id, editing.version || 1);
    if (result.conflict) {
      setSaveConflict({ projectId: editing.id, localProject: editing, serverProject: result.serverProject });
    }
  }, [projects, editingIdx, persist]);

  const resolveConflictOverwrite = useCallback(async () => {
    if (!saveConflict) return;
    const { projectId } = saveConflict;
    setSaveConflict(null);
    // Reintenta sin expectedVersion: el backend salta el chequeo y guarda igual.
    await persist(projects, undefined, projectId);
  }, [saveConflict, projects, persist]);

  // ── Paleta de comandos (Fase 14 — Ctrl+K) ──────────────────────────────────
  // Mismo guard de cambios sin guardar que navigateTo, pero en el orden
  // correcto: solo cambia editingIdx si la navegación se confirma — si no,
  // editingIdx quedaría apuntando a otro proyecto sin que la vista cambiara.
  const handleGoToProject = useCallback((idx) => {
    if (hasUnsavedChanges) {
      const ok = window.confirm("Tienes cambios sin guardar. ¿Descartar y salir?");
      if (!ok) return;
      setHasUnsaved(false);
    }
    setEditingIdx(idx);
    setView("edit");
  }, [hasUnsavedChanges, setView]);

  const resolveConflictDiscard = useCallback(() => {
    if (!saveConflict) return;
    const { projectId, serverProject } = saveConflict;
    if (serverProject) {
      setProjects(prev => prev.map(p => (p.id === projectId ? serverProject : p)));
    }
    setHasUnsaved(false);
    setSaveConflict(null);
  }, [saveConflict]);

  const persistEngineers = useCallback(async (nextEngineers) => {
    setEngineers(nextEngineers);
    await saveProjects(projects, weekLabel, nextEngineers, externalContacts);
  }, [projects, weekLabel, externalContacts]);

  const persistExternals = useCallback(async (nextExternals) => {
    setExternalContacts(nextExternals);
    await saveProjects(projects, weekLabel, engineers, nextExternals);
  }, [projects, weekLabel, engineers]);

  // ── Limpiado de campos semanales ───────────────────────────────────────────
  const applyWeekReset = async (newDate, newLabel) => {
    // weekly_achievements/next_week_plan/weekly_detail se recalculan en vivo
    // con un useEffect en EditView/EngineerReportView, pero ese efecto solo
    // corre si alguien abrió ese proyecto durante la semana — uno que nadie
    // tocó llegaría al snapshot con datos de la semana anterior (o vacío).
    // Se recalculan aquí de forma explícita, para TODOS los proyectos, ANTES
    // de archivar el snapshot — así el historial siempre queda correcto sin
    // depender de qué se vio en pantalla.
    const projectsWithFreshWeekly = projects.map(p => recomputeWeeklyFields(p));
    await saveWeekReport(projectsWithFreshWeekly, weekLabel);
    const next = projectsWithFreshWeekly.map(p => ({
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

  // ── Reinicio de trimestre ──────────────────────────────────────────────────
  //
  // Ejecuta el reset trimestral: archiva el estado actual y limpia el JSON.
  // Esta función se llama SOLO después de que el usuario confirmó dos veces en el modal.
  // Devuelve el resultado del backend para que el modal muestre el resumen.
  // Lanza error si algo falla — el modal lo captura y muestra al usuario.
  const applyQuarterReset = async () => {
    const { label, startDate } = getCurrentQuarterInfo(reportDate, getToday);

    const result = await executeQuarterReset({
      projects,
      engineers,
      externalContacts,
      weekLabel,
      quarterLabel: label,
      quarterStart: startDate,
    });

    if (!result.ok) throw new Error(result.error || "Error desconocido en el reset");

    // El backend ya sobreescribió data.json — recargar estado limpio desde el servidor
    const freshData = await reloadProjectsFromServer();
    setProjects(freshData.projects        || []);
    setEngineers(freshData.engineers      || []);
    setExternalContacts(freshData.externalContacts || []);
    setHasUnsaved(false);
    setEditingIdx(null);
    setView("dashboard");

    return result; // { activitiesArchived, activitiesTransferred, totalProyectos, quarterLabel }
  };

  // Limpia estadísticas del trimestre actual sin archivar (para corregir resets incompletos).
  const applyCleanStats = async () => {
    await cleanCurrentStats();
    const freshData = await reloadProjectsFromServer();
    setProjects(freshData.projects       || []);
    setEngineers(freshData.engineers     || []);
    setExternalContacts(freshData.externalContacts || []);
    setHasUnsaved(false);
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

  const toggleIncludeInAvg = (id) => {
    setIncludedInAvg(prev => {
      // Si null (aún no cargado), inicializar con todos los IDs actuales
      const base = prev ?? new Set(projects.map(p => p.id));
      const next = new Set(base);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const addProject = () => {
    const p    = { ...createDefaultProject(), report_date: reportDate };
    const next = [...projects, p];
    setProjects(next);
    setIncludedInAvg(prev => new Set([...(prev ?? projects.map(q => q.id)), p.id]));
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

  // Alterna la marca de prioritario de un proyecto y persiste de inmediato.
  const togglePriority = (id) => {
    const next = projects.map(p => p.id === id ? { ...p, priority: !p.priority } : p);
    setProjects(next);
    saveProjects(next, weekLabel, engineers, externalContacts, id);
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

  const generateInforme = async (idx) => {
    const project = projects[idx];
    if (!project) return;
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    setGeneratingInforme(true);
    setGeneratingName(project.project_name || "proyecto");
    try {
      await generateQuarterlyReport(project, engineers, ctrl.signal);
      setSaveToast(`✓ Informe de "${project.project_name || "proyecto"}" generado y descargado`);
    } catch (e) {
      if (e.name === "AbortError") {
        setSaveToast("Generación cancelada");
      } else {
        setSaveToast("Error generando informe: " + e.message);
      }
    } finally {
      abortCtrlRef.current = null;
      setGeneratingInforme(false);
      setGeneratingName("");
      setTimeout(() => setSaveToast(""), 3500);
    }
  };

  const cancelInforme = () => { abortCtrlRef.current?.abort(); };

  const handleGenerateGlobalStatus = async (mode) => {
    const projectsToAnalyze = filteredForAvg.filter(p => Number(p.manual_metrics?.total_tasks || 0) > 0);
    if (!projectsToAnalyze.length) return;
    setGeneratingGlobalStatus(true);
    setGlobalStatusMode(mode);
    setGlobalStatusOpen(true);
    setGlobalStatus(null);
    try {
      const res = await fetch(apiUrl("/api/generate-global-status"), {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({ projects: projectsToAnalyze, weekLabel, engineerCatalog: engineers, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGlobalStatus(data.analysis);
    } catch (e) {
      setSaveToast("Error generando status: " + e.message);
      setTimeout(() => setSaveToast(""), 3000);
    } finally {
      setGeneratingGlobalStatus(false);
    }
  };

  // ── Catálogo de ingenieros ─────────────────────────────────────────────────
  // Cada cambio se guarda localmente de inmediato (respuesta instantánea en la UI)
  // y en paralelo se empuja a SQL. Cuando vuelve el sql_id (creación), se guarda
  // en el catálogo para que las siguientes ediciones ya actualicen esa fila directo.
  const syncAndStoreSqlId = async (engineerSnapshot) => {
    const sqlId = await syncEngineerToSQL(engineerSnapshot);
    if (sqlId && !engineerSnapshot.sql_id) {
      setEngineers(curr => {
        const next = curr.map(e => e.id === engineerSnapshot.id ? { ...e, sql_id: sqlId } : e);
        saveProjects(projects, weekLabel, next);
        return next;
      });
    }
  };

  const addEngineer = (name, role) => {
    const eng = createEngineer(name, role);
    const next = [...engineers, eng];
    persistEngineers(next);
    syncAndStoreSqlId(eng);
    return eng.id;
  };

  const updateEngineer = (id, name, role) => {
    const next = engineers.map(e => e.id === id ? { ...e, name, role } : e);
    persistEngineers(next);
    const updated = next.find(e => e.id === id);
    syncAndStoreSqlId(updated);
  };

  const toggleEngineerActive = (id) => {
    const next = engineers.map(e => e.id === id ? { ...e, active: !e.active } : e);
    persistEngineers(next);
    const updated = next.find(e => e.id === id);
    syncAndStoreSqlId(updated);
  };

  // Sincroniza cada tarea nueva/editada a SQL y borra las que ya no están en la
  // lista nueva. El cambio local ya se guardó por persistEngineers antes de esto,
  // así que un fallo de red aquí no pierde nada — solo queda desactualizado en SQL
  // hasta el siguiente cambio.
  const updateEngineerTasks = (id, tasks) => {
    const eng = engineers.find(e => e.id === id);
    const oldTasks = eng?.tasks || [];
    persistEngineers(engineers.map(e => e.id === id ? { ...e, tasks } : e));

    const newIds = new Set(tasks.map(t => t.id));
    oldTasks.forEach(t => { if (!newIds.has(t.id)) deleteEngineerTaskFromSQL(t.id); });
    tasks.forEach(t => syncEngineerTaskToSQL(eng, t));
  };

  // ── Catálogo de colaboradores externos ────────────────────────────────────
  const syncAndStoreSqlIdExternal = async (contactSnapshot) => {
    const sqlId = await syncExternalContactToSQL(contactSnapshot);
    if (sqlId && !contactSnapshot.sql_id) {
      setExternalContacts(curr => {
        const next = curr.map(c => c.id === contactSnapshot.id ? { ...c, sql_id: sqlId } : c);
        saveProjects(projects, weekLabel, engineers, next);
        return next;
      });
    }
  };

  const addExternalContact = (name, company) => {
    const contact = createExternalContact(name, company);
    const next = [...externalContacts, contact];
    persistExternals(next);
    syncAndStoreSqlIdExternal(contact);
    return contact.id;
  };

  const toggleExternalContactActive = (id) => {
    const next = externalContacts.map(c => c.id === id ? { ...c, active: !c.active } : c);
    persistExternals(next);
    const updated = next.find(c => c.id === id);
    syncAndStoreSqlIdExternal(updated);
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
      const res = await fetch(apiUrl("/api/restore-from-db"), { method: "POST", headers: authHeaders() });
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

  const filteredForAvg = includedInAvg ? projects.filter(p => includedInAvg.has(p.id)) : projects;
  const stats = globalStats(filteredForAvg);
  const statusCounts = countByStatus(projects);

  // ── Puerta de sesión (Fase 9 revisada) ──────────────────────────────────────
  // Todos los hooks del componente ya se declararon arriba — este early
  // return solo decide qué JSX renderizar, no cambia el orden de hooks.
  if (currentUser === undefined) {
    return <div className="login-screen"><p style={{ color: "#fff" }}>Verificando sesión…</p></div>;
  }
  if (currentUser === null) {
    return <LoginScreen onLoginSuccess={setCurrentUser} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <img src="/imagenes/logo_institucional.png" alt="Logo Corte Suprema de Justicia" className="header__logo" />
          <div className="header__info">
            <h1 className="header__title">Seguimiento Semanal</h1>
            <span className="header__week-range">{getWeekRangeLabel(reportDate)}</span>
            {/* Fecha del reporte + "Guardar reporte" son acciones de cierre
                semanal del PORTAFOLIO completo — no tienen sentido para un
                usuario restringido a su propio dashboard de ingeniero. */}
            {currentUser?.esAdmin && (
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
            )}
          </div>
        </div>

        <div className="header__actions">
          <nav className="header__nav">
            {buildTabs(currentUser?.esAdmin).map(tab => tab.key ? (
              <button
                key={tab.key}
                className={`tab-btn ${view === tab.key ? "tab-btn--active" : ""}`}
                onClick={() => navigateTo(tab.key)}
              >
                {tab.label}
              </button>
            ) : (
              <NavGroup
                key={tab.label}
                label={tab.label}
                options={tab.options}
                activeKey={view}
                active={tabContainsView(tab, view)}
                onSelect={navigateTo}
              />
            ))}
          </nav>
          {/* "Nueva semana" (borra campos semanales de TODOS los proyectos) y
              "Restaurar respaldo" son acciones destructivas/globales de
              administración del portafolio — solo para admins. */}
          {currentUser?.esAdmin && (
            <>
              <button className="btn btn--reset" onClick={resetWeek}>↻ Nueva semana</button>
              <button className="btn btn--restore" onClick={handleRestoreFromDB} title="Restaurar datos desde el último respaldo en la base de datos">⬇ Restaurar respaldo</button>
            </>
          )}
          <UserMenu user={currentUser} theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} />
        </div>
      </header>

      <main className="main-content">
        {/* Avance/KPIs del PORTAFOLIO completo — un no-admin ya queda forzado
            a view==="engineers" (ver useEffect de arriba), pero esta franja
            mostraría el avance de TODOS los proyectos, no solo los suyos. */}
        {currentUser?.esAdmin && view !== "edit" && view !== "reportes" && view !== "admin-users" && (
          <section className="summary">
            <div className="summary__progress">
              <ProgressRing percent={stats.percent} color="var(--accent)" />
              <div>
                <div className="summary__label">Avance Promedio</div>
                <div className="summary__value">{Math.round(stats.percent)}%</div>
                <div className="summary__hint">{projects.length} proyecto{projects.length !== 1 ? "s" : ""} en seguimiento</div>
              </div>
            </div>
            {view === "dashboard" ? (
              <div className="summary__stats">
                <div className="kpi-card kpi-card--ok">
                  <div className="kpi-card__num">{statusCounts.onTrack}</div>
                  <div className="kpi-card__label">En curso</div>
                </div>
                <div className="kpi-card kpi-card--warn">
                  <div className="kpi-card__num">{statusCounts.atRisk}</div>
                  <div className="kpi-card__label">En riesgo</div>
                </div>
                <div className="kpi-card kpi-card--crit">
                  <div className="kpi-card__num">{statusCounts.blocked}</div>
                  <div className="kpi-card__label">Bloqueados</div>
                </div>
                <div className="kpi-card kpi-card--info">
                  <div className="kpi-card__num">{statusCounts.other}</div>
                  <div className="kpi-card__label">Otros estados</div>
                </div>
              </div>
            ) : (
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
            )}
          </section>
        )}

        {view === "report" && (
          <ReportView
            projects={projects} weekLabel={weekLabel} engineers={engineers}
            singleProjectIdx={reportProjectIdx}
            onClearSingle={() => setReportProjectIdx(null)}
            generatingInforme={generatingInforme}
            generatingName={generatingName}
            onGenerateInforme={generateInforme}
            onCancelInforme={cancelInforme}
          />
        )}
        {(view === "engineers" || view === "engineer-report") && (
          <EngineerHub
            key={view}
            initialSubtab={view === "engineer-report" ? "historial" : "mi-semana"}
            engineers={engineers}
            projects={projects}
            lockedEngineerId={currentUser?.esAdmin ? null : currentUser?.ingenieroId ?? null}
            onAdd={addEngineer}
            onUpdate={updateEngineer}
            onToggleActive={toggleEngineerActive}
            onUpdateTasks={updateEngineerTasks}
            onOpenActivity={(projectId, activityId) => {
              const idx = projects.findIndex(p => p.id === projectId);
              if (idx === -1) return;
              setPlanning({ idx, view: "hierarchy", activityId });
            }}
          />
        )}
        {view === "dashboard" && (
          <Dashboard
            projects={projects}
            engineers={engineers}
            onEdit={idx => { setEditingIdx(idx); setView("edit"); }}
            onAdd={addProject}
            onViewReport={viewProjectReport}
            onExportReport={exportProjectReport}
            onGenerateInforme={generateInforme}
            generatingInforme={generatingInforme}
            generatingName={generatingName}
            onCancelInforme={cancelInforme}
            includedInAvg={includedInAvg}
            onToggleIncludeInAvg={toggleIncludeInAvg}
            onTogglePriority={togglePriority}
            globalStatus={globalStatus}
            globalStatusMode={globalStatusMode}
            generatingGlobalStatus={generatingGlobalStatus}
            globalStatusOpen={globalStatusOpen}
            onToggleGlobalStatusOpen={() => setGlobalStatusOpen(o => !o)}
            onGenerateGlobalStatus={handleGenerateGlobalStatus}
            onOpenPlanning={(idx, which) => setPlanning({ idx, view: which })}
          />
        )}
        {view === "quarters" && (
          <QuartersView
            onBack={() => setView("dashboard")}
            projects={projects}
            quarterInfo={getCurrentQuarterInfo(reportDate, getToday)}
            onQuarterReset={applyQuarterReset}
            onCleanStats={applyCleanStats}
          />
        )}
        {view === "reportes" && <ReportesView projects={projects} engineers={engineers} />}
        {view === "admin-users" && currentUser?.esAdmin && (
          <UsersAdminView engineers={engineers} />
        )}
        {view === "edit" && (
          <EditView
            projects={projects} editingIdx={editingIdx}
            hasUnsavedChanges={hasUnsavedChanges}
            onSelectProject={setEditingIdx}
            onUpdateProject={updateProject}
            onUpdateProjectFull={updateProjectFull}
            onSaveChanges={handleSaveEditedProject}
            onSaveProjectsDirect={persist}
            onReorderProjects={reorderProjects}
            onAddProject={addProject}
            onRemoveProject={removeProject}
            onViewReport={viewProjectReport}
            onExportReport={exportProjectReport}
            engineerCatalog={engineers}
            onCreateEngineer={addEngineer}
            externalContacts={externalContacts}
            onAddExternalContact={addExternalContact}
            onToggleExternalActive={toggleExternalContactActive}
          />
        )}
      </main>

      <footer className="footer">
        <span className="footer__copy">© 2026 Oficina de Tecnología — Corte Suprema de Justicia. Todos los derechos reservados.</span>
        <span className="footer__credit">Desarrollado internamente por la Oficina de Tecnología - Corte Suprema de Justicia</span>
      </footer>

      <CommandPalette
        projects={projects}
        engineers={engineers}
        onGoToProject={handleGoToProject}
        onGoToView={navigateTo}
      />

      {/* Accesos rápidos de planificación desde las tarjetas del dashboard:
          se abren en overlay y al cerrarlos se sigue en el dashboard. */}
      <ProjectPlanningOverlays
        project={planning ? projects[planning.idx] : null}
        view={planning?.view}
        onClose={() => setPlanning(null)}
        onUpdateProject={updated => updateProjectFull(planning.idx, updated)}
        engineerCatalog={engineers}
        externalContacts={externalContacts}
        StatusBoard={TaskStatusSelector}
        initialActivityId={planning?.activityId}
      />

      {saveConflict && (
        <SaveConflictModal
          localProject={saveConflict.localProject}
          serverProject={saveConflict.serverProject}
          onOverwrite={resolveConflictOverwrite}
          onDiscard={resolveConflictDiscard}
          onClose={() => setSaveConflict(null)}
        />
      )}
    </div>
  );
}
