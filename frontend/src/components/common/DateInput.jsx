// DateInput.jsx — Reemplazo de <input type="date"> con formato SIEMPRE
// dd/mm/aaaa, sin importar el navegador/locale del usuario. El <input
// type="date"> nativo delega el formato de despliegue al navegador (en
// Windows con locale distinto a es-* puede mostrar mm/dd/aaaa), lo que
// generaba confusión mezclado con las fechas ya formateadas a mano en el
// resto de la app (ver formatDateDMY) — el usuario lo reportó explícitamente
// ("estandaricemos... o empieza la confusión").
//
// Trae su PROPIO calendario emergente (portal, mismo patrón que
// ParentSelectDropdown) — el <input type="date"> nativo que reemplaza traía
// uno gratis del navegador; quitarlo sin más rompió el flujo de "hacer clic
// y elegir visualmente" (reportado por el usuario: "al darle no me despliega
// el cronograma para mover fechas" — se refería a este selector, no al
// diagrama de Gantt). Se puede seguir tecleando dd/mm/aaaa a mano igual que
// antes; el calendario es un atajo adicional, no el único camino.
//
// Drop-in: mismo contrato que el <input type="date"> que reemplaza —
// value/onChange siguen siendo string ISO "YYYY-MM-DD" (o "" vacío), para no
// tocar el resto de la lógica de la app (comparaciones de fecha, cálculos de
// días hábiles, etc.).

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { isoToDisplay, displayToIso, maskInput, buildCalendarGrid, monthLabel, WEEKDAY_LABELS } from "../../utils/dateMask.js";

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 320;

function partsOf(iso) {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  return { year: y, monthIndex: m - 1 };
}

export default function DateInput({ value, onChange, className, placeholder = "dd/mm/aaaa", ...rest }) {
  const [text, setText] = useState(() => isoToDisplay(value));
  // Último `value` (ISO) para el que `text` ya está sincronizado — permite
  // detectar durante el RENDER (no en un efecto) que el prop cambió desde
  // fuera (otro campo lo recalculó, se cargó otro proyecto, etc.) y
  // resincronizar sin el round-trip de un useEffect (evita el cascading
  // render que bloquea el lint react-hooks/set-state-in-effect). Mientras el
  // usuario teclea una fecha incompleta/inválida, `value` no cambia (ver
  // handleChange: solo llama a onChange con una fecha ya completa/válida),
  // así que esto nunca pisa lo que el usuario está escribiendo.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(isoToDisplay(value));
  }

  const [open, setOpen] = useState(false);
  // Mes que muestra el calendario — arranca en el mes del value, o el mes
  // actual si no hay fecha. Se reancla cada vez que el picker se abre (ver
  // handleOpen), no en cada render, para no pelear con la navegación ◀/▶
  // del propio usuario mientras el picker sigue abierto.
  const [viewYear, setViewYear] = useState(() => (partsOf(value) || { year: new Date().getFullYear() }).year);
  const [viewMonth, setViewMonth] = useState(() => (partsOf(value) || { monthIndex: new Date().getMonth() }).monthIndex);
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  useClickOutside(wrapRef, () => setOpen(false), open, menuRef);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const reposition = () => {
      const rect = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
      setMenuPos({
        left: rect.left,
        top: openUpward ? undefined : rect.bottom + MENU_GAP,
        bottom: openUpward ? window.innerHeight - rect.top + MENU_GAP : undefined,
      });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const handleOpen = () => {
    const p = partsOf(displayToIso(text) || value);
    setViewYear(p ? p.year : new Date().getFullYear());
    setViewMonth(p ? p.monthIndex : new Date().getMonth());
    setOpen(true);
  };

  const handleChange = (e) => {
    const masked = maskInput(e.target.value);
    setText(masked);
    if (masked === "") { onChange(""); return; }
    const iso = displayToIso(masked);
    if (iso) onChange(iso);
    // Fecha incompleta/inválida mientras se escribe: no se propaga todavía
    // (el campo ISO del caller conserva su último valor válido) — al perder
    // foco (handleBlur) se decide si se descarta.
  };

  // Al salir del campo con una fecha incompleta o inválida (ej. "31/02/2026"
  // o "06/08/20"), se descarta en vez de dejar texto a medias que parece
  // válido pero no lo es.
  const handleBlur = () => {
    const iso = displayToIso(text);
    if (!iso && text !== "") { setText(isoToDisplay(value)); }
  };

  const pickDay = (iso) => {
    setText(isoToDisplay(iso));
    onChange(iso);
    setOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const selectedIso = displayToIso(text) || value || null;
  const grid = open ? buildCalendarGrid(viewYear, viewMonth) : [];

  // El className recibido (adm-input, htable__date, gantt-date-filter__input…)
  // decora el WRAPPER, no el <input> interno — así el borde/fondo/padding que
  // cada caller ya tenía definidos siguen envolviendo TODO el control
  // (texto + botón de calendario) como una sola pieza visual, en vez de que
  // el botón quede "pegado" fuera de la caja con borde. El <input> interno
  // queda sin decoración propia (ver date-input__field en el CSS).
  return (
    <span ref={wrapRef} className={`date-input ${className || ""}`}>
      <input
        type="text"
        inputMode="numeric"
        className="date-input__field"
        placeholder={placeholder}
        value={text}
        onFocus={handleOpen}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
        maxLength={10}
        {...rest}
      />
      <button
        type="button"
        className="date-input__calendar-btn"
        tabIndex={-1}
        title="Abrir calendario"
        onClick={() => (open ? setOpen(false) : handleOpen())}
      >📅</button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="date-input__picker"
          style={{ position: "fixed", left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom }}
        >
          <div className="date-input__picker-head">
            <button type="button" className="date-input__nav-btn" onClick={prevMonth} title="Mes anterior">‹</button>
            <span className="date-input__picker-label">{monthLabel(viewYear, viewMonth)}</span>
            <button type="button" className="date-input__nav-btn" onClick={nextMonth} title="Mes siguiente">›</button>
          </div>
          <div className="date-input__weekdays">
            {WEEKDAY_LABELS.map((w, i) => <span key={i} className="date-input__weekday">{w}</span>)}
          </div>
          <div className="date-input__grid">
            {grid.map(cell => (
              <button
                key={cell.iso}
                type="button"
                className={[
                  "date-input__day",
                  !cell.inMonth && "date-input__day--outside",
                  cell.iso === selectedIso && "date-input__day--selected",
                ].filter(Boolean).join(" ")}
                onClick={() => pickDay(cell.iso)}
              >
                {cell.day}
              </button>
            ))}
          </div>
          {selectedIso && (
            <button type="button" className="date-input__clear" onClick={() => { setText(""); onChange(""); setOpen(false); }}>
              ✕ Borrar fecha
            </button>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
