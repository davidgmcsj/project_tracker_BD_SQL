// ReportesTemplates.jsx — 5 tarjetas de arranque rápido (§8.3 del plan).
// Cada una preconfigura consulta + filtros; el usuario sigue afinando desde ahí.

const PLANTILLAS = [
  {
    id: "prioritarios",
    icon: "⭐",
    title: "Prioritarios de la semana",
    desc: "Proyectos con prioridad alta",
    consulta: "proyectos",
    filtros: [{ campo: "prioridad", operador: "=", valor: 1 }],
  },
  {
    id: "ingenieros",
    icon: "🧑‍💻",
    title: "Qué hace cada ingeniero",
    desc: "Asignaciones por reporte semanal",
    consulta: "ingenieros",
    filtros: [],
  },
  {
    id: "portafolio",
    icon: "📊",
    title: "Estado del portafolio",
    desc: "En curso, en riesgo o bloqueados",
    consulta: "proyectos",
    filtros: [{ campo: "estado", operador: "in", valor: ["on-track", "at-risk", "blocked"] }],
  },
  {
    id: "detalle-proyecto",
    icon: "🔍",
    title: "Detalle de un proyecto",
    desc: "Elige el proyecto desde el panel de filtros",
    consulta: "actividades",
    filtros: [],
  },
  {
    id: "vencidas",
    icon: "⏰",
    title: "Actividades vencidas",
    desc: "Fecha de fin pasada, sin completar",
    consulta: "vencidas",
    filtros: [],
  },
];

export function ReportesTemplates({ onSelect }) {
  return (
    <div className="reportes-templates">
      {PLANTILLAS.map(t => (
        <button
          type="button" key={t.id} className="reportes-template-card"
          onClick={() => onSelect({ consulta: t.consulta, filtros: t.filtros })}
        >
          <span className="reportes-template-card__icon">{t.icon}</span>
          <span className="reportes-template-card__title">{t.title}</span>
          <span className="reportes-template-card__desc">{t.desc}</span>
        </button>
      ))}
    </div>
  );
}
