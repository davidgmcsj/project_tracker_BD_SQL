// SaveConflictModal.jsx — Aparece cuando el control de versión optimista
// (Fase 8) detecta que alguien más guardó el mismo proyecto mientras se
// editaba localmente. Sin fusión automática de campos: solo elegir un lado.
//
// Reutiliza los estilos qrm-* de QuarterResetModal.jsx — mismo patrón visual
// de modal de confirmación, sin CSS nuevo.

export default function SaveConflictModal({ localProject, serverProject, onOverwrite, onDiscard, onClose }) {
  const nombre = serverProject?.project_name || localProject?.project_name || "este proyecto";

  return (
    <div className="qrm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qrm-panel">
        <div className="qrm-header">
          <div className="qrm-icon">⚠</div>
          <h2 className="qrm-title">Conflicto de edición</h2>
          <p className="qrm-subtitle">
            Alguien más guardó cambios en <strong>{nombre}</strong> mientras lo editabas. ¿Qué versión conservas?
          </p>
        </div>

        <div className="qrm-body">
          <div className="qrm-stat-row qrm-stat-row--keep">
            <span className="qrm-stat-icon">💾</span>
            <div>
              <strong>Sobrescribir con los míos</strong>
              <span className="qrm-stat-sub"> Guarda tus cambios tal como los tienes en pantalla; descarta el otro guardado.</span>
            </div>
          </div>
          <div className="qrm-stat-row qrm-stat-row--archive">
            <span className="qrm-stat-icon">↩</span>
            <div>
              <strong>Descartar los míos</strong>
              <span className="qrm-stat-sub"> Carga la versión que el otro guardó; pierdes lo que editaste desde tu último guardado.</span>
            </div>
          </div>
        </div>

        <div className="qrm-footer">
          <button className="qrm-btn qrm-btn--cancel" onClick={onDiscard}>Descartar los míos</button>
          <button className="qrm-btn qrm-btn--confirm" onClick={onOverwrite}>Sobrescribir con los míos</button>
        </div>
      </div>
    </div>
  );
}
