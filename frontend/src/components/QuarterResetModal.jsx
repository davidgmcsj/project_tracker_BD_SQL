import { useState } from "react";

// ── Constante de confirmación ─────────────────────────────────────────────────
// El usuario debe escribir exactamente este texto para habilitar el botón final.
// Está en mayúsculas para que sea difícil hacer click accidental.
const CONFIRM_TEXT = "NUEVO TRIMESTRE";

// ── QuarterResetModal ─────────────────────────────────────────────────────────
//
// Modal de doble confirmación para el reinicio de trimestre.
//
// Flujo:
//   Paso 1 → Muestra resumen de qué pasará (actividades archivadas vs transferidas).
//            Botones: "Cancelar" | "Sí, entiendo — continuar"
//   Paso 2 → Pide escribir "NUEVO TRIMESTRE" para habilitar el botón final.
//            Botones: "Volver" | "Confirmar reset" (deshabilitado hasta texto correcto)
//   Paso 3 → Ejecuta el reset (spinner de carga, UI bloqueada).
//   Paso 4 → Muestra resumen del resultado: cuántas se archivaron, cuántas continúan.
//
// Props:
//   quarterInfo   → { label, startDate, nextLabel } del trimestre actual
//   projects      → array de proyectos (para calcular las estadísticas del preview)
//   onConfirm     → async () => resultado — ejecuta el reset real en App.jsx
//   onClose       → () => void — cierra el modal sin hacer nada

export default function QuarterResetModal({ quarterInfo, projects, onConfirm, onClose }) {
  const [step,        setStep]        = useState(1); // 1: info, 2: confirm, 3: loading, 4: done
  const [inputText,   setInputText]   = useState("");
  const [result,      setResult]      = useState(null);
  const [errorMsg,    setErrorMsg]    = useState("");

  // Calcular preview de cuántas actividades se van a archivar vs transferir
  const stats = projects.reduce((acc, p) => {
    acc.completadas   += (p.task_status?.completed   || []).length;
    acc.enProceso     += (p.task_status?.in_progress || []).length;
    acc.noIniciadas   += (p.task_status?.not_started || []).length;
    return acc;
  }, { completadas: 0, enProceso: 0, noIniciadas: 0 });

  const transferidas = stats.enProceso + stats.noIniciadas;

  const handleConfirm = async () => {
    setStep(3);
    setErrorMsg("");
    try {
      const res = await onConfirm();
      setResult(res);
      setStep(4);
    } catch (e) {
      setErrorMsg(e.message || "Error desconocido ejecutando el reset");
      setStep(2); // vuelve al paso 2 para que pueda reintentar o cancelar
    }
  };

  // Cerrar con Escape solo si no está ejecutando
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && step !== 3) onClose();
  };

  return (
    <div className="qrm-overlay" onClick={handleOverlayClick}>
      <div className="qrm-panel">

        {/* ── Paso 1: Información y primera confirmación ── */}
        {step === 1 && (
          <>
            <div className="qrm-header">
              <div className="qrm-icon">🗂</div>
              <h2 className="qrm-title">Iniciar nuevo trimestre</h2>
              <p className="qrm-subtitle">
                Estás a punto de cerrar el <strong>{quarterInfo.label}</strong> e iniciar el <strong>{quarterInfo.nextLabel}</strong>.
              </p>
            </div>

            <div className="qrm-body">
              <p className="qrm-section-title">¿Qué va a pasar?</p>

              <div className="qrm-stat-row qrm-stat-row--archive">
                <span className="qrm-stat-icon">📦</span>
                <div>
                  <strong>{stats.completadas} actividades completadas</strong> se archivarán.
                  <span className="qrm-stat-sub"> No pasarán al nuevo trimestre — quedan guardadas en el histórico para consulta.</span>
                </div>
              </div>

              <div className="qrm-stat-row qrm-stat-row--keep">
                <span className="qrm-stat-icon">➡</span>
                <div>
                  <strong>{transferidas} actividades continúan</strong> ({stats.enProceso} en proceso, {stats.noIniciadas} no iniciadas).
                  <span className="qrm-stat-sub"> Pasan intactas al nuevo trimestre con su checklist, notas y fechas clave.</span>
                </div>
              </div>

              <div className="qrm-stat-row qrm-stat-row--reset">
                <span className="qrm-stat-icon">🔄</span>
                <div>
                  <strong>Métricas semanales</strong> de todos los ingenieros se resetean a cero.
                  <span className="qrm-stat-sub"> Logros, planes e impedimentos de todos los proyectos se limpian.</span>
                </div>
              </div>

              <div className="qrm-warning">
                ⚠ Esta acción <strong>no se puede deshacer</strong> desde la app. El histórico del {quarterInfo.label} quedará disponible en la sección <em>Trimestres</em>.
              </div>
            </div>

            <div className="qrm-footer">
              <button className="qrm-btn qrm-btn--cancel" onClick={onClose}>Cancelar</button>
              <button className="qrm-btn qrm-btn--next"   onClick={() => setStep(2)}>
                Sí, entiendo — continuar
              </button>
            </div>
          </>
        )}

        {/* ── Paso 2: Segunda confirmación (texto escrito) ── */}
        {step === 2 && (
          <>
            <div className="qrm-header">
              <div className="qrm-icon">⚠</div>
              <h2 className="qrm-title">Confirmación final</h2>
              <p className="qrm-subtitle">
                Para confirmar el cierre del <strong>{quarterInfo.label}</strong>, escribe exactamente:
              </p>
              <div className="qrm-confirm-phrase">{CONFIRM_TEXT}</div>
            </div>

            <div className="qrm-body">
              <input
                className="qrm-confirm-input"
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="Escribe aquí..."
                autoFocus
                // Permitir confirmar con Enter si el texto es correcto
                onKeyDown={e => { if (e.key === "Enter" && inputText === CONFIRM_TEXT) handleConfirm(); }}
              />
              {errorMsg && (
                <div className="qrm-error">{errorMsg}</div>
              )}
            </div>

            <div className="qrm-footer">
              <button className="qrm-btn qrm-btn--cancel" onClick={() => { setStep(1); setInputText(""); setErrorMsg(""); }}>
                ← Volver
              </button>
              <button
                className="qrm-btn qrm-btn--confirm"
                onClick={handleConfirm}
                disabled={inputText !== CONFIRM_TEXT}
              >
                Confirmar reset
              </button>
            </div>
          </>
        )}

        {/* ── Paso 3: Ejecutando (spinner) ── */}
        {step === 3 && (
          <div className="qrm-loading">
            <div className="qrm-spinner" />
            <p className="qrm-loading-text">Archivando {quarterInfo.label}...</p>
            <p className="qrm-loading-sub">Guardando en SQL y preparando el nuevo trimestre. Esto puede tomar unos segundos.</p>
          </div>
        )}

        {/* ── Paso 4: Resultado exitoso ── */}
        {step === 4 && result && (
          <>
            <div className="qrm-header">
              <div className="qrm-icon">✅</div>
              <h2 className="qrm-title">¡{quarterInfo.nextLabel} iniciado!</h2>
              <p className="qrm-subtitle">El {result.quarterLabel} fue archivado correctamente.</p>
            </div>

            <div className="qrm-body">
              <div className="qrm-result-row">
                <span>📦 Actividades archivadas</span>
                <strong>{result.activitiesArchived}</strong>
              </div>
              <div className="qrm-result-row">
                <span>➡ Actividades que continúan</span>
                <strong>{result.activitiesTransferred}</strong>
              </div>
              <div className="qrm-result-row">
                <span>📁 Proyectos procesados</span>
                <strong>{result.totalProyectos}</strong>
              </div>
              <p className="qrm-result-note">
                Puedes consultar el histórico del {result.quarterLabel} en la sección <strong>Trimestres</strong> del menú superior.
              </p>
            </div>

            <div className="qrm-footer">
              <button className="qrm-btn qrm-btn--next" onClick={onClose}>
                Ir al dashboard
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
