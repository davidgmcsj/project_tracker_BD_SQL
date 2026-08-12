// TokenFilterBar.jsx — Barra de filtros acumulativos "estilo GitLab": un solo
// input donde primero eliges el TIPO de filtro (Tarea padre, Mostrar,
// Niveles, Estado) y luego el VALOR; al confirmar se agrega como chip
// removible dentro de la misma barra, y puedes seguir agregando más sin
// salir del input. Reemplaza la fila de chips/selects sueltos que tenía
// FilterBar (Estado, Tarea padre, Mostrar, Niveles) — Rango de fechas y
// Buscar por texto quedan en sus propios controles porque son casos
// distintos (un rango continuo y texto libre, no una lista de valores
// discretos).
//
// Reglas de combinación (documentadas también en ganttHelpers.computeDatedRows):
//   - Estado admite VARIOS chips a la vez, combinados con OR entre sí.
//   - Tarea padre, Mostrar y Niveles admiten UN solo chip cada uno — elegir
//     otro valor del mismo tipo reemplaza al chip anterior.
//   - Entre TIPOS distintos, todo se combina con AND (mismo criterio que ya
//     tenía computeDatedRows antes de este cambio).
//   - "Mostrar" solo tiene sentido con una "Tarea padre" elegida (si no, no
//     aparece como tipo disponible) — evita el estado inválido de elegir
//     "Solo subtareas" sin padre.

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { matchesSearch } from "../../utils/search";
import { STATUS_FILTERS, SCOPE_FILTERS_WITH_PARENT, LEVEL_FILTERS } from "./ganttHelpers";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

export default function TokenFilterBar({
  statusFilter, onSetStatusFilter,
  parentOptions, parentFilter, onSetParentFilter,
  scopeFilter, onSetScopeFilter,
  levelFilter, onSetLevelFilter,
  onClearAll,
  counts,
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("type"); // "type" | "value"
  const [activeType, setActiveType] = useState(null);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  useClickOutside(wrapRef, () => { setOpen(false); setStep("type"); setActiveType(null); setQuery(""); }, open, menuRef);

  // "Mostrar" solo existe con un padre elegido — si parentFilter se pone en
  // null por CUALQUIER camino (chip ✕, "Limpiar todo", o elegir otra tarea
  // padre) mientras el submenú de "Mostrar" seguía abierto, se cierra en vez
  // de dejar montado un menú de opciones que ya no deberían ser alcanzables.
  // Ajuste durante el render (no un efecto) para no dejar ni un frame con el
  // menú inválido visible.
  if (!parentFilter && activeType === "scope") {
    setStep("type"); setActiveType(null); setQuery("");
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

  // Catálogo de tipos de filtro disponibles — "Mostrar" solo aparece con un
  // padre ya elegido (ver comentario del archivo). Los valores de "Tarea
  // padre" se recalculan aquí (no son estáticos como los demás).
  const TYPES = [
    { key: "parent",  label: "Tarea padre", icon: "▸" },
    ...(parentFilter ? [{ key: "scope", label: "Mostrar", icon: "▾" }] : []),
    { key: "level", label: "Niveles", icon: "≡" },
    { key: "status", label: "Estado", icon: "●" },
  ];

  const typeMatches = TYPES.filter(t => matchesSearch(t.label, query));

  const valuesFor = (typeKey) => {
    if (typeKey === "status") return STATUS_FILTERS.filter(f => f.value !== "all").map(f => ({ value: f.value, label: `${f.label} (${counts[f.value] ?? 0})` }));
    if (typeKey === "parent") return parentOptions.map(o => ({ value: o.id, label: o.label }));
    if (typeKey === "scope") return SCOPE_FILTERS_WITH_PARENT.map(f => ({ value: f.value, label: f.label }));
    if (typeKey === "level") return LEVEL_FILTERS.filter(f => f.value !== "").map(f => ({ value: f.value, label: f.label }));
    return [];
  };

  const valueMatches = activeType ? valuesFor(activeType).filter(v => matchesSearch(v.label, query)) : [];

  const chooseType = (typeKey) => {
    setActiveType(typeKey);
    setStep("value");
    setQuery("");
  };

  const chooseValue = (value) => {
    if (activeType === "status") onSetStatusFilter(value);
    if (activeType === "parent") onSetParentFilter(value);
    if (activeType === "scope") onSetScopeFilter(value);
    if (activeType === "level") onSetLevelFilter(value);
    // Estado admite varios chips seguidos sin cerrar el menú (multi-select) —
    // los demás tipos son de un solo valor, cierran tras elegir.
    if (activeType === "status") { setQuery(""); return; }
    setOpen(false); setStep("type"); setActiveType(null); setQuery("");
  };

  const handleBackspace = () => {
    // Backspace sobre el input vacío borra el ÚLTIMO chip activo, mismo
    // atajo que GitLab/la mayoría de token inputs con chips. Sigue el mismo
    // orden en que los chips se listan más abajo (Estado → Tarea padre →
    // Mostrar → Niveles), de atrás hacia adelante.
    if (query !== "") return;
    if (levelFilter) { onSetLevelFilter(""); return; }
    if (parentFilter && scopeFilter === "childrenOnly") { onSetScopeFilter("all"); return; }
    if (parentFilter) { onSetParentFilter(null); return; }
    if (statusFilter.length) { onSetStatusFilter(statusFilter[statusFilter.length - 1]); return; }
  };

  // ── Chips activos ("Tipo: Valor ✕") ──────────────────────────────────────
  const chips = [];
  statusFilter.forEach(v => {
    const f = STATUS_FILTERS.find(s => s.value === v);
    chips.push({ id: `status:${v}`, label: `Estado: ${f?.label || v}`, onRemove: () => onSetStatusFilter(v) });
  });
  if (parentFilter) {
    const opt = parentOptions.find(o => o.id === parentFilter);
    chips.push({ id: "parent", label: `Tarea padre: ${opt?.label || parentFilter}`, onRemove: () => onSetParentFilter(null) });
    if (scopeFilter === "childrenOnly") {
      chips.push({ id: "scope", label: "Mostrar: Solo subtareas", onRemove: () => onSetScopeFilter("all") });
    }
  }
  if (levelFilter) {
    const f = LEVEL_FILTERS.find(l => l.value === String(levelFilter));
    chips.push({ id: "level", label: f?.label || `Nivel ${levelFilter}`, onRemove: () => onSetLevelFilter("") });
  }

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
        placeholder={chips.length ? "Agregar filtro…" : "Filtrar por Tarea padre, Niveles, Estado…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); setStep("type"); setActiveType(null); setQuery(""); e.currentTarget.blur(); }
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
            // Si el submenú de "Mostrar" quedó abierto (solo existe con un
            // padre elegido), cerrarlo también — sin esto, seguía montado y
            // permitía elegir "Solo subtareas" ya sin padre.
            setOpen(false); setStep("type"); setActiveType(null); setQuery("");
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
            ) : typeMatches.map(t => (
              <button key={t.key} type="button" className="token-filter-bar__option" onClick={() => chooseType(t.key)}>
                <span className="token-filter-bar__option-icon">{t.icon}</span> {t.label}
              </button>
            ))
          ) : (
            <>
              <button type="button" className="token-filter-bar__option token-filter-bar__option--back" onClick={() => { setStep("type"); setActiveType(null); setQuery(""); }}>
                ← {TYPES.find(t => t.key === activeType)?.label}
              </button>
              {valueMatches.length === 0 ? (
                <p className="token-filter-bar__empty">Sin coincidencias.</p>
              ) : valueMatches.map(v => {
                const isChecked = activeType === "status" && statusFilter.includes(v.value);
                return (
                  <button key={v.value} type="button" className="token-filter-bar__option" onClick={() => chooseValue(v.value)}>
                    {activeType === "status" && <span className="token-filter-bar__option-check">{isChecked ? "☑" : "☐"}</span>}
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
