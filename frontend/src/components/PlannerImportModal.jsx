import { useState } from "react";
import { parsePlannerWorkbook, mergePlannerImport } from "../utils/plannerImport";
import { createActivity } from "../utils/formulas";

// Modal de importación del Excel de Planner. Tres etapas:
//   pick    → elegir archivo, parsear y hacer un merge de simulación (dry-run)
//   preview → mostrar resumen (nuevas/actualizadas/archivadas/ingenieros por crear)
//             y la tabla de tareas parseadas antes de aplicar
//   error   → mensaje claro si el archivo no es un export de Planner válido
//
// El modal NO crea ingenieros ni persiste: al confirmar llama onConfirm(payload)
// y el padre (EditView) crea los ingenieros faltantes y guarda.

import { ESTADO_ACTIVIDAD_LABEL } from "../utils/filtroOpciones";

const STATUS_CLASS = { completed: "done", in_progress: "wip", not_started: "pending" };

export default function PlannerImportModal({
  isOpen, onClose, onConfirm,
  existingActivities, existingTaskStatus, engineerCatalog,
}) {
  const [stage,           setStage]           = useState("pick");
  const [fileName,        setFileName]        = useState("");
  const [rows,            setRows]            = useState([]);
  const [hasParentColumn, setHasParentColumn] = useState(false);
  const [mergeRes,        setMergeRes]        = useState(null);
  const [parseErrs,       setParseErrs]       = useState([]);
  const [errorMsg,        setErrorMsg]        = useState("");
  const [busy,            setBusy]            = useState(false);

  if (!isOpen) return null;

  const reset = () => {
    setStage("pick"); setFileName(""); setRows([]); setHasParentColumn(false);
    setMergeRes(null); setParseErrs([]); setErrorMsg(""); setBusy(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parsePlannerWorkbook(buf);
      if (!parsed.rows.length) {
        setErrorMsg(parsed.errors[0] || "El archivo no contiene tareas de Planner.");
        setStage("error");
        return;
      }
      // Dry-run: sin resolvedNameToId → solo reporta ingenieros por crear.
      // hasParentColumn se pasa desde ahora: la vista previa ya debe mostrar
      // los parent_id resueltos y cualquier error de jerarquía (referencia
      // rota, ciclo) antes de que el usuario confirme.
      const res = mergePlannerImport(
        existingActivities, existingTaskStatus, parsed.rows, engineerCatalog, createActivity,
        undefined, parsed.hasParentColumn
      );
      setRows(parsed.rows);
      setHasParentColumn(parsed.hasParentColumn);
      setParseErrs([...parsed.errors, ...(res.hierarchyErrors || [])]);
      setMergeRes(res);
      setStage("preview");
    } catch (err) {
      setErrorMsg("No se pudo leer el archivo: " + (err?.message || "formato no válido") + ". ¿Es un .xlsx exportado de Planner?");
      setStage("error");
    } finally {
      setBusy(false);
      e.target.value = ""; // permite re-elegir el mismo archivo
    }
  };

  const handleApply = () => {
    if (!mergeRes) return;
    // El padre recibe las filas y el dry-run; se encarga de crear ingenieros y persistir.
    onConfirm({ rows, engineersToCreate: mergeRes.newEngineersToCreate, hasParentColumn });
    handleClose();
  };

  const s = mergeRes?.summary;

  return (
    <div className="delete-modal-overlay">
      <div className="delete-modal planner-modal">
        {stage === "pick" && (
          <>
            <div className="delete-modal__icon">📥</div>
            <h3 className="delete-modal__title">Importar de Planner</h3>
            <p className="delete-modal__body">
              Selecciona el archivo <strong>.xlsx</strong> exportado de Microsoft Planner.<br />
              La app creará y actualizará las actividades automáticamente, sin borrar lo que agregaste a mano.
            </p>
            <label className="planner-modal__file">
              <input type="file" accept=".xlsx" onChange={handleFile} disabled={busy} />
              {busy ? "Leyendo…" : "Elegir archivo…"}
            </label>
            <div className="delete-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={handleClose}>Cancelar</button>
            </div>
          </>
        )}

        {stage === "error" && (
          <>
            <div className="delete-modal__icon">⚠️</div>
            <h3 className="delete-modal__title">No se pudo importar</h3>
            <p className="delete-modal__body">{errorMsg}</p>
            <div className="delete-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setStage("pick")}>Volver</button>
              <button type="button" className="btn btn--danger" onClick={handleClose}>Cerrar</button>
            </div>
          </>
        )}

        {stage === "preview" && s && (
          <>
            <h3 className="delete-modal__title">Revisar importación</h3>
            <p className="planner-modal__filename" title={fileName}>{fileName}</p>

            <div className="planner-modal__summary">
              <span className="planner-chip planner-chip--new">{s.created} nuevas</span>
              <span className="planner-chip planner-chip--upd">{s.updated} actualizadas</span>
              <span className="planner-chip planner-chip--arch">{s.archived} archivadas</span>
              <span className="planner-chip planner-chip--eng">{s.engineersToCreate} ingenieros por crear</span>
            </div>

            {mergeRes.newEngineersToCreate.length > 0 && (
              <p className="planner-modal__engineers">
                <strong>Se crearán:</strong> {mergeRes.newEngineersToCreate.map(en => en.name).join(", ")}
              </p>
            )}

            {parseErrs.length > 0 && (
              <div className="planner-modal__warnings">
                {parseErrs.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div className="planner-modal__table-wrap">
              <table className="planner-modal__table">
                <thead>
                  <tr><th>Nº</th><th>Tarea</th><th>Responsable</th><th>Estado</th><th>Inicio</th><th>Fin</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.planner_task_number || "—"}</td>
                      <td className="planner-modal__cell-name" title={r.text}>{r.text}</td>
                      <td title={r.assigneeNames.join(", ")}>{r.assigneeNames.join(", ") || "—"}</td>
                      <td>
                        <span className={`eng-badge eng-badge--${STATUS_CLASS[r.status]}`}>
                          {ESTADO_ACTIVIDAD_LABEL[r.status]}
                        </span>
                      </td>
                      <td>{r.start_date || "—"}</td>
                      <td>{r.due_date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="delete-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={handleClose}>Cancelar</button>
              <button type="button" className="btn btn--danger-solid" onClick={handleApply}>
                Aplicar importación
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
