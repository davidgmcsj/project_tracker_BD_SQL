import { useState } from "react";
import { parseCronogramaWorkbook, buildCronogramaActivities } from "../utils/cronogramaImport";
import { createActivity } from "../utils/formulas";
import { ESTADO_ACTIVIDAD_LABEL } from "../utils/filtroOpciones";

// Modal de importación de Excel "Cronograma por entregable" (formato distinto
// al export nativo de Planner — ver PlannerImportModal.jsx). Mismo patrón de
// 3 etapas (pick → preview → error), pero esta importación es SIEMPRE
// ADITIVA: crea un árbol nuevo de Entregable → Tarea → Subtareas tal como
// viene en el archivo, sin emparejar ni tocar nada de lo que ya existe en el
// proyecto (decisión explícita: el "#" del Excel no es un id estable entre
// archivos, así que no hay forma segura de identificar "la misma" tarea en
// una reimportación).
//
// El modal NO crea ingenieros ni persiste: al confirmar llama onConfirm(payload)
// y el padre (EditView) crea los ingenieros faltantes y guarda.

const STATUS_CLASS = {
  completed: "done", in_progress: "wip", not_started: "pending",
  ambiente_pruebas: "wip", ambiente_produccion: "wip",
};

export default function CronogramaImportModal({
  isOpen, onClose, onConfirm, engineerCatalog,
}) {
  const [stage,       setStage]       = useState("pick");
  const [fileName,    setFileName]    = useState("");
  const [buildRes,    setBuildRes]    = useState(null);
  const [parseErrs,   setParseErrs]   = useState([]);
  const [errorMsg,    setErrorMsg]    = useState("");
  const [busy,        setBusy]        = useState(false);

  if (!isOpen) return null;

  const reset = () => {
    setStage("pick"); setFileName(""); setBuildRes(null);
    setParseErrs([]); setErrorMsg(""); setBusy(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseCronogramaWorkbook(buf);
      if (!parsed.rows.length) {
        setErrorMsg(parsed.errors[0] || "El archivo no contiene tareas reconocibles.");
        setStage("error");
        return;
      }
      // Dry-run: sin resolvedNameToId → solo reporta ingenieros por crear,
      // igual criterio de dos pasadas que PlannerImportModal.
      const res = buildCronogramaActivities(parsed.rows, engineerCatalog, createActivity, undefined);
      setParseErrs(parsed.errors);
      setBuildRes(res);
      setStage("preview");
    } catch (err) {
      setErrorMsg("No se pudo leer el archivo: " + (err?.message || "formato no válido") + ". ¿Es un .xlsx de Cronograma por entregable?");
      setStage("error");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const handleApply = () => {
    if (!buildRes) return;
    onConfirm({
      activities: buildRes.activities,
      statusByActivityId: buildRes.statusByActivityId,
      engineersToCreate: buildRes.newEngineersToCreate,
    });
    handleClose();
  };

  const s = buildRes?.summary;

  return (
    <div className="delete-modal-overlay">
      <div className="delete-modal planner-modal">
        {stage === "pick" && (
          <>
            <div className="delete-modal__icon">📅</div>
            <h3 className="delete-modal__title">Importar Cronograma por entregable</h3>
            <p className="delete-modal__body">
              Selecciona el archivo <strong>.xlsx</strong> con la hoja "Cronograma Detalle"
              (Entregables → Tareas → Subtareas).<br />
              Se crearán actividades <strong>nuevas</strong> respetando esa jerarquía y los
              responsables — nunca se modifica ni se borra lo que ya tienes en el proyecto.
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
              <span className="planner-chip planner-chip--new">{s.entregables} entregables</span>
              <span className="planner-chip planner-chip--new">{s.tareas} tareas/subtareas</span>
              <span className="planner-chip planner-chip--eng">{s.engineersToCreate} ingenieros por crear</span>
            </div>

            {buildRes.newEngineersToCreate.length > 0 && (
              <p className="planner-modal__engineers">
                <strong>Se crearán:</strong> {buildRes.newEngineersToCreate.map(en => en.name).join(", ")}
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
                  <tr><th>Tarea</th><th>Responsable</th><th>Estado</th><th>Inicio</th><th>Fin</th></tr>
                </thead>
                <tbody>
                  {buildRes.activities.map((a) => {
                    const status = buildRes.statusByActivityId.get(a.id);
                    const depth = a.parent_id ? 1 : 0; // sangría visual simple para la vista previa
                    return (
                      <tr key={a.id}>
                        <td className="planner-modal__cell-name" title={a.text} style={{ paddingLeft: depth ? 18 : undefined }}>
                          {a.text}
                        </td>
                        <td title={a.assigned_engineers?.[0]?.name || ""}>{a.assigned_engineers?.[0]?.name || "—"}</td>
                        <td>
                          <span className={`eng-badge eng-badge--${STATUS_CLASS[status] || "pending"}`}>
                            {ESTADO_ACTIVIDAD_LABEL[status] || status}
                          </span>
                        </td>
                        <td>{a.start_date || "—"}</td>
                        <td>{a.due_date || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="delete-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={handleClose}>Cancelar</button>
              <button type="button" className="btn btn--danger-solid" onClick={handleApply}>
                Crear {s.total} actividades
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
