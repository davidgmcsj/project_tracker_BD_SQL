import { useState, useEffect, useCallback, useRef } from "react";
import Dashboard     from "./components/Dashboard";
import ProjectOverviewTable from "./components/director/ProjectOverviewTable";
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
import DateInput from "./components/common/DateInput";
import { autoAdvanceOverdueActivities } from "./components/edit/shared";
import {
  globalStats, getWeekLabel, getToday, getNextFriday, getWeekRangeLabel,
  isSameWeek, createDefaultProject, generateSingleProjectReportText,
  createEngineer, createExternalContact, sortByName,
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
  const [engineers,         setEngineersRaw]       = useState([]);
  const [externalContacts,  setExternalContactsRaw] = useState([]);
  // Envuelven al setter real para que el catálogo quede SIEMPRE ordenado
  // alfabéticamente por nombre, sin importar por cuál de los ~8 puntos de la
  // app se actualice (alta, edición, activar/desactivar, reset trimestral,
  // restaurar backup) — todas las listas/dropdowns que consumen `engineers`/
  // `externalContacts` heredan el orden sin tener que ordenar cada una.
  // Soportan tanto un valor directo como la forma funcional (prev) => next.
  const setEngineers        = (next) => setEngineersRaw(prev => sortByName(typeof next === "function" ? next(prev) : next));
  const setExternalContacts = (next) => setExternalContactsRaw(prev => sortByName(typeof next === "function" ? next(prev) : next));
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

  // ── Restricción de navegación para usuarios sin rol admin ───────────────────
  // Los no-admin navegan toda la app (Dashboard, Editar, Ingenieros, Reportes)
  // — los datos que ven ya vienen filtrados por proyecto desde el backend
  // (GET /api/projects). Lo único que se bloquea son vistas de operaciones de
  // PORTAFOLIO COMPLETO, no de "su" información: "director" (dashboard
  // ejecutivo agregado), "quarters" (cierre trimestral irreversible) y
  // "admin-users" (gestión de usuarios). Sin esto, alguien podía llegar ahí
  // por un enlace compartido con ?view=algo — el botón oculto en la nav
  // (buildTabs) no alcanza para bloquear eso, solo evita el clic normal.
  // El backend igual exige requireAdmin en esas rutas — esto es la primera
  // capa (UX), no el control de acceso real.
  useEffect(() => {
    if (!currentUser || currentUser.esAdmin) return;
    const vistasSoloAdmin = ["director", "quarters", "admin-users"];
    if (vistasSoloAdmin.includes(view)) setView("dashboard");
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
        // Auto-avance de actividades vencidas: cualquier "No iniciada" cuya
        // start_date ya llegó o pasó se mueve a "En proceso" sola, sin que
        // el equipo tenga que hacerlo a mano — pedido explícito del usuario
        // ("si una actividad arranca hoy el mismo sistema debe cambiarla a
        // en proceso"). Corre UNA vez, al cargar todos los proyectos por
        // primera vez (no en cada render) — mismo motor que usa el Kanban
        // (transitionActivityStatus), así que el resultado se ve idéntico
        // en Kanban/Gantt/Planificación/dashboards sin tocar esas vistas.
        let totalMoved = 0;
        const advanced = saved.map(p => {
          const { project: next, movedCount } = autoAdvanceOverdueActivities(p);
          totalMoved += movedCount;
          return next;
        });
        setProjects(advanced);
        setIncludedInAvg(new Set(advanced.map(p => p.id)));
        const firstDate = advanced[0]?.report_date;
        if (firstDate) setReportDate(firstDate);
        if (totalMoved > 0) {
          // Persiste en segundo plano (fire-and-forget, mismo patrón que el
          // autoguardado periódico) — no bloquea el primer render con los
          // proyectos ya cargados. Sin changedProjectId/expectedVersion: se
          // guarda el array completo, igual que el resto de guardados
          // automáticos que no vienen de "Guardar cambios" del editor.
          saveProjects(advanced, savedWeek || getStoredWeekLabel(), savedEngineers?.length ? savedEngineers : engineers, savedExternals?.length ? savedExternals : externalContacts);
          setSaveToast(`✓ ${totalMoved} actividad${totalMoved !== 1 ? "es" : ""} pasó${totalMoved !== 1 ? "aron" : ""} a En proceso automáticamente`);
          setTimeout(() => setSaveToast(""), 4000);
        }
      }
      if (savedEngineers?.length) setEngineers(savedEngineers);
      if (savedExternals?.length) setExternalContacts(savedExternals);
      const wl = savedWeek || getStoredWeekLabel();
      if (wl) setWeekLabel(wl);
    }
    init();
    // engineers/externalContacts deliberadamente fuera del array de deps:
    // este efecto solo debe correr una vez al confirmar sesión (carga
    // inicial), no cada vez que cualquier otro flujo de la app actualiza
    // esos catálogos — lo que causaría recargar projects del servidor de
    // nuevo. Se leen dentro vía closure del render actual (fallback si
    // savedEngineers/savedExternals vienen vacíos), no como dependencia reactiva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Autoguardado (cada 5 minutos) ──────────────────────────────────────────
  // Cubre el hueco entre ediciones y el clic manual en "Guardar cambios": sin
  // esto, todo lo editado en EditView/los modales de actividad solo vive en
  // memoria de React (+ localStorage como respaldo) hasta que alguien aprieta
  // ese botón — cerrar la pestaña antes pierde el cambio en la base de datos.
  // Reutiliza exactamente handleSaveEditedProject (mismo camino que el botón
  // manual), así que respeta el mismo chequeo de conflicto de versión.
  //
  // Un ref (no un estado) guarda la función más reciente para que el
  // setInterval se cree UNA sola vez al montar — si dependiera de
  // handleSaveEditedProject/hasUnsavedChanges directamente en el array de
  // dependencias, el intervalo se destruiría y recrearía en cada tecla
  // escrita, y nunca llegaría a completar los 5 minutos reales.
  const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
  const autosaveRef = useRef({ hasUnsavedChanges, handleSaveEditedProject, saveConflict });
  useEffect(() => {
    autosaveRef.current = { hasUnsavedChanges, handleSaveEditedProject, saveConflict };
  }, [hasUnsavedChanges, handleSaveEditedProject, saveConflict]);

  useEffect(() => {
    const id = setInterval(async () => {
      const { hasUnsavedChanges: dirty, handleSaveEditedProject: save, saveConflict: conflict } = autosaveRef.current;
      // No autoguarda si ya hay un conflicto de versión pendiente de resolver
      // en pantalla — forzar otro guardado ahí solo confundiría el modal.
      if (!dirty || conflict) return;
      await save();
      setSaveToast("✓ Guardado automáticamente");
      setTimeout(() => setSaveToast(""), 2500);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

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

  // Alterna es_urgente de UNA actividad puntual (dashboard "Mi semana" del
  // ingeniero) y persiste de inmediato — mismo patrón que togglePriority,
  // pero a nivel de actividad en vez de proyecto. changedProjectId=projectId
  // en saveProjects: el guardado no-admin del backend solo autoriza tocar
  // proyectos donde el ingeniero ya tiene una actividad asignada (ver
  // routes/projects.routes.cjs) — este proyecto siempre califica, porque la
  // actividad que se está marcando es justamente una de las suyas.
  const toggleActivityUrgent = (projectId, activityId) => {
    const next = projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        activities_identified: (p.activities_identified || []).map(a =>
          a.id === activityId ? { ...a, es_urgente: !a.es_urgente } : a
        ),
      };
    });
    setProjects(next);
    saveProjects(next, weekLabel, engineers, externalContacts, projectId);
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

  // Orden manual de la cola "Mi semana" (arrastrar y soltar, ver
  // EngineerWeekTable) — field es "orden_ahora" u "orden_proxima". Es
  // preferencia personal de trabajo, no dato de negocio: a diferencia de
  // updateEngineerTasks, no se sincroniza a SQL.
  const updateEngineerQueueOrder = (id, field, orderIds) => {
    persistEngineers(engineers.map(e => e.id === id ? { ...e, [field]: orderIds } : e));
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
                  <DateInput
                    className="header__date-input"
                    value={reportDate}
                    onChange={iso => handleReportDateChange(iso)}
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
        {currentUser?.esAdmin && view !== "edit" && view !== "reportes" && view !== "admin-users" && view !== "director" && (
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
            onToggleUrgent={toggleActivityUrgent}
            onReorderQueue={updateEngineerQueueOrder}
            onOpenActivity={(projectId, activityId) => {
              const idx = projects.findIndex(p => p.id === projectId);
              if (idx === -1) return;
              // Sin "view": abre SOLO la tarjeta de detalle de la actividad,
              // no el overlay grande de Planificación de atrás (antes de
              // ProjectPlanningOverlays.jsx, view era obligatorio para que
              // renderizara algo — incluido el modal — así que este clic
              // terminaba abriendo Planificación completa).
              setPlanning({ idx, activityId });
            }}
            onOpenProjectHierarchy={(projectId) => {
              const idx = projects.findIndex(p => p.id === projectId);
              if (idx === -1) return;
              setPlanning({ idx, view: "hierarchy" });
            }}
          />
        )}
        {view === "director" && currentUser?.esAdmin && (
          <ProjectOverviewTable
            projects={projects}
            engineers={engineers}
            onUpdateProject={updateProjectFull}
            onEdit={idx => { setEditingIdx(idx); setView("edit"); }}
            showEditButton={!!currentUser?.esAdmin}
            StatusBoard={TaskStatusSelector}
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
        {view === "quarters" && currentUser?.esAdmin && (
          <QuartersView
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
