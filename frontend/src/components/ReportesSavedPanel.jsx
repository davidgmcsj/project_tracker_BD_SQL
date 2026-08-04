// ReportesSavedPanel.jsx — Reportes guardados (Fase 6).
// Guarda la combinación actual (consulta + filtros + columnas) con un
// nombre; cada uno aparece como chip clickeable que recarga esa combinación
// completa. Config es JSON opaco del lado del backend — al recargar vuelve
// a pasar por la validación normal del motor de consultas.

import { useState, useEffect } from "react";
import { loadSavedReports, saveReportCombination, deleteSavedReport } from "../utils/storage";

export function ReportesSavedPanel({ currentConfig, onLoad }) {
  const [saved, setSaved]     = useState([]);
  const [version, setVersion] = useState(0);
  const [nombre, setNombre]   = useState("");
  const [saving, setSaving]   = useState(false);
  const [open, setOpen]       = useState(false);

  // Sin setState síncrono en el cuerpo del efecto (mismo patrón que el
  // resto del módulo de reportes).
  useEffect(() => { loadSavedReports().then(setSaved); }, [version]);

  const handleSave = async () => {
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      await saveReportCombination(nombre.trim(), currentConfig);
      setNombre("");
      setOpen(false);
      setVersion(v => v + 1);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setSaved(prev => prev.filter(s => s.id !== id)); // optimista
    const ok = await deleteSavedReport(id);
    if (!ok) setVersion(v => v + 1); // revertir si falló
  };

  return (
    <div className="reportes-saved">
      <div className="reportes-saved__row">
        <span className="reportes-saved__label">Guardados:</span>
        {saved.length === 0 && !open && <span className="reportes-saved__empty">ninguno todavía</span>}
        {saved.map(s => (
          <span key={s.id} className="reportes-saved-chip">
            <button type="button" className="reportes-saved-chip__load" onClick={() => onLoad(s.config)}>{s.nombre}</button>
            <button type="button" className="reportes-saved-chip__remove" onClick={() => handleDelete(s.id)}>✕</button>
          </span>
        ))}
        {!open && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>💾 Guardar combinación</button>
        )}
      </div>

      {open && (
        <div className="reportes-saved__form">
          <input
            type="text" className="report-filters__search" placeholder="Nombre de la plantilla"
            value={nombre} onChange={e => setNombre(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            autoFocus
          />
          <button type="button" className="btn btn--accent btn--sm" disabled={saving || !nombre.trim()} onClick={handleSave}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setOpen(false); setNombre(""); }}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
