// appNav.js — Constantes y helpers puros de navegación/estadísticas del
// header de App.jsx. Sin estado ni hooks: solo construyen datos derivados de
// argumentos (currentUser.esAdmin, view, projects).

// Navegación principal (Fase 4 — de 7 pestañas planas a 4 grupos): "Ingenieros"
// y "Reportes" agrupan varias claves de `view` que antes eran pestañas propias
// y respondían la misma pregunta con datos que podían no coincidir (ver Fase 1).
// Las claves internas de `view` NO cambian — solo se agrupa cómo se navegan —
// así que enlaces existentes con ?view="engineer-report" siguen abriendo lo
// mismo que antes sin necesitar alias.
// "Editar" no tiene botón propio en la nav: no hay forma de elegir QUÉ
// proyecto editar desde ahí (llega en blanco, con "Selecciona un proyecto"),
// mientras que cada tarjeta del Dashboard ya abre EditView directo sobre ESE
// proyecto en un solo clic. El botón redundaba en dos caminos al mismo
// lugar — la vista view==="edit" sigue existiendo, solo se llega a ella
// desde las tarjetas (Dashboard.onEdit / ProjectOverviewTable.onEdit).
export const BASE_TABS = [
  { key: "director",  label: "Dashboard Dirección" },
  { key: "dashboard", label: "Dashboard" },
  {
    label: "Ingenieros",
    options: [
      { key: "engineers",       label: "Equipo y mi semana" },
      { key: "engineer-report", label: "Historial por ingeniero" },
    ],
  },
  {
    label: "Reportes",
    options: [
      { key: "report",   label: "Reporte semanal" },
      { key: "reportes", label: "Consultas" },
      { key: "quarters", label: "Trimestres" },
    ],
  },
];

// Un usuario SIN rol admin (migración 019) navega toda la app — Dashboard,
// Gantt/Jerarquía (vía las tarjetas de Dashboard → Editar), Ingenieros y
// Reportes — pero los datos que ve ya vienen filtrados por el backend
// (GET /api/projects solo devuelve proyectos donde tiene una actividad
// asignada, ver routes/projects.routes.cjs). Lo que SÍ se le oculta son
// operaciones de portafolio completo, no de "su" información:
//   - "Dashboard Dirección": vista ejecutiva agregada de TODA la oficina.
//   - "Trimestres": el cierre trimestral es irreversible y afecta a todos
//     los proyectos, no solo los suyos.
//   - "Administración": gestión de usuarios.
// El botón oculto aquí es la primera capa (evita el clic normal); la guarda
// real está en el useEffect de App.jsx (fuerza `view` aunque alguien navegue
// directo por URL) y en el backend (requireAdmin en las rutas
// correspondientes — quarter-reset, clean-stats, restore-from-db, report).
const NON_ADMIN_TABS = [
  { key: "dashboard", label: "Dashboard" },
  {
    label: "Ingenieros",
    options: [
      { key: "engineers",       label: "Equipo y mi semana" },
      { key: "engineer-report", label: "Historial por ingeniero" },
    ],
  },
  {
    label: "Reportes",
    options: [
      { key: "report",   label: "Reporte semanal" },
      { key: "reportes", label: "Consultas" },
    ],
  },
];

export function buildTabs(esAdmin) {
  if (!esAdmin) return NON_ADMIN_TABS;
  return [...BASE_TABS, { key: "admin-users", label: "Administración" }];
}

// Todas las claves de `view` que agrupa cada botón, para saber cuál grupo
// resaltar como activo aunque `view` apunte a una de sus opciones internas.
export function tabContainsView(tab, view) {
  if (tab.key) return tab.key === view;
  return tab.options.some(o => o.key === view);
}

export const STAT_CARDS = [
  { dot: "done",     label: "Completadas"  },
  { dot: "wip",      label: "En proceso"   },
  { dot: "pending",  label: "No iniciados" },
  { dot: "projects", label: "Proyectos"    },
];

export function getStatValue(dot, stats, projects) {
  switch (dot) {
    case "done":     return stats.completed;
    case "wip":      return stats.inProgress;
    case "pending":  return stats.total - stats.completed - stats.inProgress;
    case "projects": return projects.length;
  }
}

// Cuenta proyectos por estado del semáforo para la fila de KPIs ejecutivos.
export function countByStatus(projects) {
  const c = { onTrack: 0, atRisk: 0, blocked: 0, other: 0 };
  projects.forEach(p => {
    if (p.status === "on-track") c.onTrack++;
    else if (p.status === "at-risk") c.atRisk++;
    else if (p.status === "blocked") c.blocked++;
    else c.other++;
  });
  return c;
}

// Calcula el label y fecha de inicio del trimestre actual basándose en la
// fecha de reporte activa. El trimestre es el que SE CIERRA, no el nuevo.
// Ejemplo: si hoy es julio 2026, el trimestre que se cierra es Q2 2026 (abr-jun).
export function getCurrentQuarterInfo(reportDate, todayFn) {
  const date  = new Date(reportDate || todayFn());
  const month = date.getMonth() + 1; // 1-12
  const year  = date.getFullYear();
  const q     = Math.ceil(month / 3); // 1, 2, 3 o 4
  const starts = [null, `${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
  return {
    label:      `Q${q} ${year}`,
    startDate:  starts[q],
    nextLabel:  `Q${q === 4 ? 1 : q + 1} ${q === 4 ? year + 1 : year}`,
  };
}
