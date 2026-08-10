// AttachmentsSection.jsx — Sube, descarga y elimina adjuntos de una
// actividad (SQL vía utils/storage.js). Cada operación se refleja de
// inmediato en la lista local mediante onChange.

import { useState, useRef } from "react";
import { uploadAttachment, deleteAttachment, downloadAttachment } from "../../utils/storage";
import { formatBytes, fileIcon } from "./shared";

export default function AttachmentsSection({ items, activityId, projectId, onChange }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const MAX_BYTES = 10 * 1024 * 1024;

  const handleFiles = async (fileList) => {
    setError("");
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" supera el límite de 10 MB.`);
        continue;
      }
      setBusy(true);
      try {
        const meta = await uploadAttachment(file, {
          appActividadID: activityId,
          proyectoAppID:  projectId,
        });
        onChange([...items, meta]);
      } catch (e) {
        setError(`No se pudo subir "${file.name}". ${e.message || ""}`);
      } finally {
        setBusy(false);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = async (att) => {
    setError("");
    try {
      await deleteAttachment(att.id);
    } catch {
      // aunque falle el borrado en SQL, lo quitamos de la lista local
    }
    onChange(items.filter(a => a.id !== att.id));
  };

  const handleDownload = async (att) => {
    setError("");
    try {
      await downloadAttachment(att.id, att.filename);
    } catch {
      setError(`No se pudo descargar "${att.filename}".`);
    }
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Adjuntos</span>
        <button
          type="button"
          className="adm-add-btn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Subiendo…" : "+ Subir archivo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {error && <p className="adm-attach-error">{error}</p>}

      {items.length > 0 ? (
        <ul className="adm-attach-list">
          {items.map(att => (
            <li key={att.id} className="adm-attach-item">
              <span className="adm-attach-item__icon">{fileIcon(att.mime, att.filename)}</span>
              <button
                type="button"
                className="adm-attach-item__name adm-attach-item__name--link"
                onClick={() => handleDownload(att)}
                title="Descargar"
              >
                {att.filename}
              </button>
              <span className="adm-attach-item__size">{formatBytes(att.size)}</span>
              <button
                type="button"
                className="adm-attach-item__remove"
                onClick={() => handleRemove(att)}
                title="Eliminar adjunto"
              >✕</button>
            </li>
          ))}
        </ul>
      ) : (
        !busy && <p className="adm-empty-hint">Sin archivos adjuntos. Máx. 10 MB por archivo.</p>
      )}
    </div>
  );
}
