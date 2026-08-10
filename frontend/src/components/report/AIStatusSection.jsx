// AIStatusSection.jsx — Genera y muestra el status semanal con IA para un
// proyecto (POST /api/project-status). autoRun dispara la generación
// automáticamente al entrar al reporte individual de ese proyecto.

import { useState, useCallback, useRef, useEffect } from "react";
import { API_BASE, authHeaders } from "../../utils/api";

export default function AIStatusSection({ project, autoRun }) {
  const [status,   setStatus]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const autoRunDone = useRef(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatus(null);
    try {
      const res  = await fetch(`${API_BASE}/api/project-status`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({ project }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setStatus(data.status);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [project]);

  // Genera automáticamente al entrar al reporte individual del proyecto (una vez por proyecto)
  useEffect(() => {
    if (!autoRun || !project?.id) return;
    if (autoRunDone.current === project.id) return;
    autoRunDone.current = project.id;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, project?.id]);

  return (
    <div className="ai-status">
      <div className="ai-status__header">
        <span className="ai-status__title">✨ Status del proyecto con IA</span>
        <button
          className="btn btn--ai-status"
          onClick={generate}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="generating-inline__spinner" />
              Analizando...
            </>
          ) : status ? "↻ Regenerar" : "Generar status"}
        </button>
      </div>

      {error && (
        <div className="ai-status__error">Error: {error}</div>
      )}

      {status && (
        <div className="ai-status__body">
          {status.estado_general && (
            <div className="ai-status__block">
              <div className="ai-status__block-label">Estado general</div>
              <p className="ai-status__text">{status.estado_general}</p>
            </div>
          )}
          <div className="ai-status__cols">
            {status.en_curso?.length > 0 && (
              <div className="ai-status__block ai-status__block--amber">
                <div className="ai-status__block-label">🔄 En curso</div>
                <ul className="ai-status__list">
                  {status.en_curso.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
            {status.pendiente?.length > 0 && (
              <div className="ai-status__block ai-status__block--gray">
                <div className="ai-status__block-label">○ Pendiente</div>
                <ul className="ai-status__list">
                  {status.pendiente.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
          {status.equipo_semana?.length > 0 && (
            <div className="ai-status__block ai-status__block--blue">
              <div className="ai-status__block-label">👷 Equipo esta semana</div>
              <div className="ai-status__team">
                {status.equipo_semana.map((eng, i) => (
                  <div key={i} className="ai-status__eng">
                    <div className="ai-status__eng-name">{eng.nombre}</div>
                    <ul className="ai-status__list">
                      {(eng.tareas || []).map((t, j) => <li key={j}>{t}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          {status.proximos_pasos?.length > 0 && (
            <div className="ai-status__block ai-status__block--blue">
              <div className="ai-status__block-label">→ Próximos pasos</div>
              <ul className="ai-status__list">
                {status.proximos_pasos.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {status.alertas?.length > 0 && (
            <div className="ai-status__block ai-status__block--red">
              <div className="ai-status__block-label">⚠ Alertas</div>
              <ul className="ai-status__list">
                {status.alertas.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
