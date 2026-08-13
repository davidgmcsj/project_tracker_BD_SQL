// TokenFilterBar.jsx — Barra de filtros acumulativos "estilo GitLab" GENÉRICA:
// un solo input donde primero eliges el TIPO de filtro y luego el VALOR; al
// confirmar se agrega como chip removible dentro de la misma barra, y puedes
// seguir agregando más sin salir del input.
//
// Compartida entre el Gantt (FilterBar → Tarea padre/Mostrar/Niveles/Estado,
// con Estado multi-select) y la tabla de Planificación (HierarchyTable →
// Estado multi-select) — cada consumidor le pasa sus propias `sections`, la
// mecánica del menú/chips/teclado es la misma para ambos.
//
// Contrato de una `section`:
//   {
//     key: "status",                 // identificador estable del tipo
//     label: "Estado",               // texto del tipo en el menú y en los chips
//     icon: "●",                     // ícono del tipo en el menú
//     multi: true,                   // true = varios chips a la vez (OR entre
//                                     //   ellos); false/undefined = un solo
//                                     //   valor, elegir otro reemplaza al chip
//     value: statusFilter,           // valor actual: array si multi, valor
//                                     //   simple (o null/"") si no
//     options: [{ value, label }],   // catálogo de valores — se recalcula en
//                                     //   cada render, así que puede depender
//                                     //   de props externas (ver "Tarea padre"
//                                     //   del Gantt, que usa parentOptions)
//     onSet: (value) => void,        // multi: alterna ese valor dentro del
//                                     //   array (el caller decide cómo
//                                     //   agregar/quitar — ver ejemplos en
//                                     //   FilterBar.jsx/HierarchyTable.jsx)
//                                     //   no-multi: reemplaza el valor
//     isVisible: true,                // (opcional) oculta el tipo del menú sin
//                                     //   sacarlo de `sections` — ver "Mostrar"
//                                     //   del Gantt, que solo aparece con
//                                     //   parentFilter ya elegido
//   }
//
// Reglas de combinación: entre TIPOS distintos, todo se combina con AND.
// Dentro de un mismo tipo `multi`, los valores elegidos se combinan con OR.

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { matchesSearch } from "../../utils/search";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

export default function TokenFilterBar({ sections, onClearAll, placeholder }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("type"); // "type" | "value"
  const [activeKey, setActiveKey] = useState(null);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  useClickOutside(wrapRef, () => { setOpen(false); setStep("type"); setActiveKey(null); setQuery(""); }, open, menuRef);

  const visibleSections = sections.filter(s => s.isVisible !== false);
  const activeSection = visibleSections.find(s => s.key === activeKey) || null;

  // Si la sección activa del submenú deja de estar visible (ej. "Mostrar" del
  // Gantt cuando se quita la tarea padre desde otro camino: chip ✕, "Limpiar
  // todo"), cierra el submenú en vez de dejar montada una opción inalcanzable.
  // Ajuste durante el render (no un efecto) para no dejar ni un frame con el
  // menú inválido visible.
  if (activeKey && !activeSection) {
    setStep("type"); setActiveKey(null); setQuery("");
  }

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const reposition = () => {
      const rect = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
      setMenuPos({
        left: rect.left,
        width: Math.max(rect.width, 260),
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
  }, [open, step]);

  const typeMatches = visibleSections.filter(s => matchesSearch(s.label, query));
  const valueMatches = activeSection ? activeSection.options.filter(v => matchesSearch(v.label, query)) : [];

  const chooseType = (key) => {
    setActiveKey(key);
    setStep("value");
    setQuery("");
  };

  const chooseValue = (value) => {
    activeSection.onSet(value);
    // multi admite varios chips seguidos sin cerrar el menú; el resto es de
    // un solo valor, cierra tras elegir.
    if (activeSection.multi) { setQuery(""); return; }
    setOpen(false); setStep("type"); setActiveKey(null); setQuery("");
  };

  // Backspace sobre el input vacío borra el ÚLTIMO chip activo, mismo atajo
  // que GitLab/la mayoría de token inputs con chips. Recorre las secciones
  // visibles en orden inverso y quita un valor de la primera que tenga algo.
  const handleBackspace = () => {
    if (query !== "") return;
    for (let i = visibleSections.length - 1; i >= 0; i--) {
      const s = visibleSections[i];
      if (s.multi) {
        const arr = Array.isArray(s.value) ? s.value : [];
        if (arr.length) { s.onSet(arr[arr.length - 1]); return; }
      } else if (s.value) {
        s.onSet(s.multi ? null : (typeof s.value === "number" ? "" : null));
        return;
      }
    }
  };

  // ── Chips activos ("Tipo: Valor ✕") ──────────────────────────────────────
  const chips = [];
  visibleSections.forEach(s => {
    if (s.multi) {
      const arr = Array.isArray(s.value) ? s.value : [];
      arr.forEach(v => {
        const opt = s.options.find(o => o.value === v);
        chips.push({ id: `${s.key}:${v}`, label: `${s.label}: ${opt?.label || v}`, onRemove: () => s.onSet(v) });
      });
    } else if (s.value) {
      const opt = s.options.find(o => o.value === s.value);
      chips.push({ id: s.key, label: opt?.label ? `${s.label}: ${opt.label}` : s.label, onRemove: () => s.onSet(null) });
    }
  });

  return (
    <div ref={wrapRef} className="token-filter-bar">
      <span className="token-filter-bar__icon">🔍</span>
      {chips.map(c => (
        <span key={c.id} className="token-filter-bar__chip">
          {c.label}
          <button type="button" className="token-filter-bar__chip-remove" onClick={c.onRemove} title="Quitar filtro">✕</button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        className="token-filter-bar__input"
        placeholder={chips.length ? "Agregar filtro…" : (placeholder || "Filtrar…")}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); setStep("type"); setActiveKey(null); setQuery(""); e.currentTarget.blur(); }
          if (e.key === "Backspace") handleBackspace();
        }}
      />
      {chips.length > 0 && (
        <button
          type="button"
          className="token-filter-bar__clear-all"
          title="Quitar todos los filtros"
          onClick={() => {
            onClearAll();
            setOpen(false); setStep("type"); setActiveKey(null); setQuery("");
          }}
        >
          Limpiar todo
        </button>
      )}

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="token-filter-bar__menu"
          style={{ position: "fixed", left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom }}
        >
          {step === "type" ? (
            typeMatches.length === 0 ? (
              <p className="token-filter-bar__empty">Sin coincidencias.</p>
            ) : typeMatches.map(s => (
              <button key={s.key} type="button" className="token-filter-bar__option" onClick={() => chooseType(s.key)}>
                <span className="token-filter-bar__option-icon">{s.icon}</span> {s.label}
              </button>
            ))
          ) : (
            <>
              <button type="button" className="token-filter-bar__option token-filter-bar__option--back" onClick={() => { setStep("type"); setActiveKey(null); setQuery(""); }}>
                ← {activeSection?.label}
              </button>
              {valueMatches.length === 0 ? (
                <p className="token-filter-bar__empty">Sin coincidencias.</p>
              ) : valueMatches.map(v => {
                const isChecked = activeSection.multi && (Array.isArray(activeSection.value) ? activeSection.value : []).includes(v.value);
                return (
                  <button key={v.value} type="button" className="token-filter-bar__option" onClick={() => chooseValue(v.value)}>
                    {activeSection.multi && <span className="token-filter-bar__option-check">{isChecked ? "☑" : "☐"}</span>}
                    {v.label}
                  </button>
                );
              })}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
