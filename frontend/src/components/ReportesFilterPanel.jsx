// ReportesFilterPanel.jsx — Panel de facetas construido a partir del registro
// del backend (GET /api/reports/registry). No tiene campos hardcodeados: lo
// que se puede filtrar por cada consulta viene del backend (§5.3 del plan).
//
// "lista" se controla con un input de texto (valores separados por coma →
// operador "in" si hay más de uno, "=" si hay uno solo) en vez de un combo
// con opciones fijas: los valores válidos de cada campo (estados en español
// vs. en inglés según la consulta, orígenes de evento, etc.) viven en el
// backend y listarlos aquí duplicaría esa lógica con riesgo de desincronía.

import { useState } from "react";

function FiltroControl({ campo, def, onAdd }) {
  const [valor, setValor]   = useState("");
  const [desde, setDesde]   = useState("");
  const [hasta, setHasta]   = useState("");

  const submitLista = () => {
    const valores = valor.split(",").map(v => v.trim()).filter(Boolean);
    if (!valores.length) return;
    onAdd({ campo, operador: valores.length > 1 ? "in" : "=", valor: valores.length > 1 ? valores : valores[0] });
    setValor("");
  };

  const submitRango = () => {
    if (!desde || !hasta) return;
    onAdd({ campo, operador: "between", valor: [desde, hasta] });
    setDesde(""); setHasta("");
  };

  const submitSimple = (operador) => {
    if (valor === "") return;
    onAdd({ campo, operador, valor: def.tipo === "numero" ? Number(valor) : valor });
    setValor("");
  };

  if (def.tipo === "rango_fecha") {
    return (
      <div className="reportes-filter">
        <span className="reportes-filter__label">{campo.replace(/_/g, " ")}</span>
        <input type="date" className="report-filters__select" value={desde} onChange={e => setDesde(e.target.value)} />
        <span className="reportes-filter__sep">–</span>
        <input type="date" className="report-filters__select" value={hasta} onChange={e => setHasta(e.target.value)} />
        <button type="button" className="btn btn--secondary btn--sm" onClick={submitRango} disabled={!desde || !hasta}>Agregar</button>
      </div>
    );
  }

  if (def.tipo === "lista") {
    return (
      <div className="reportes-filter">
        <span className="reportes-filter__label">{campo.replace(/_/g, " ")}</span>
        <input
          type="text" className="report-filters__search" placeholder="valor(es), separados por coma"
          value={valor} onChange={e => setValor(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submitLista()}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={submitLista} disabled={!valor.trim()}>Agregar</button>
      </div>
    );
  }

  // texto / numero
  const primerOperador = def.operador.includes("=") ? "=" : def.operador[0];
  return (
    <div className="reportes-filter">
      <span className="reportes-filter__label">{campo.replace(/_/g, " ")}</span>
      <input
        type={def.tipo === "numero" ? "number" : "text"} className="report-filters__search"
        value={valor} onChange={e => setValor(e.target.value)}
        onKeyDown={e => e.key === "Enter" && submitSimple(primerOperador)}
      />
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => submitSimple(primerOperador)} disabled={valor === ""}>Agregar</button>
    </div>
  );
}

export function ReportesFilterPanel({ registryEntry, onAdd }) {
  if (!registryEntry) return null;
  const campos = Object.entries(registryEntry.filtros || {});
  if (!campos.length) return null;

  return (
    <div className="reportes-filter-panel">
      {campos.map(([campo, def]) => (
        <FiltroControl key={campo} campo={campo} def={def} onAdd={onAdd} />
      ))}
    </div>
  );
}
