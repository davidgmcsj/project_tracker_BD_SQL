// DiscardConfirmDialog.jsx — Se muestra al intentar cerrar el modal con
// cambios sin guardar (Escape, clic fuera, o botón cerrar).

export default function DiscardConfirmDialog({ onSaveAndClose, onDiscard, onCancel }) {
  return (
    <div className="adm-confirm-overlay">
      <div className="adm-confirm-dialog">
        <p className="adm-confirm-dialog__msg">
          Tienes cambios sin guardar. ¿Qué deseas hacer?
        </p>
        <div className="adm-confirm-dialog__actions">
          <button type="button" className="adm-confirm-btn adm-confirm-btn--cancel"  onClick={onCancel}>
            Seguir editando
          </button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--discard" onClick={onDiscard}>
            Descartar cambios
          </button>
          <button type="button" className="adm-confirm-btn adm-confirm-btn--save"    onClick={onSaveAndClose}>
            Guardar y cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
