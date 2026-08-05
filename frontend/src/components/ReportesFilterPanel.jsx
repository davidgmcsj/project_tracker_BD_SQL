// ReportesFilterPanel.jsx — Panel de facetas construido a partir del registro
// del backend (GET /api/reports/registry). Los campos disponibles por
// consulta vienen del backend (§5.3 del plan); lo único que decide el
// frontend es CÓMO se captura el valor.
//
// "lista" se resuelve como combo con buscador (SearchableMultiSelect) cuando
// hay opciones conocidas en `opciones` — o bien datos ya cargados en memoria
// (proyecto_id/ingeniero_id, ver ReportesView.jsx) o enums fijos que reflejan
// exactamente lo que graba el backend (frontend/src/utils/filtroOpciones.js).
// Si no hay opciones para un campo (p.ej. grupo_trabajo, que aún no se
// escribe desde ninguna UI) cae al input de texto libre original.

import { useState } from "react";
import { SearchableMultiSelect } from "./SearchableMultiSelect";

function FiltroControl({ campo, def, opciones, onAdd }) {
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

  if (def.tipo === "lista" && opciones && opciones.length) {
    return (
      <div className="reportes-filter">
        <span className="reportes-filter__label">{campo.replace(/_/g, " ")}</span>
        <SearchableMultiSelect
          options={opciones}
          placeholder={`Buscar ${campo.replace(/_/g, " ")}…`}
          onAdd={parcial => onAdd({ campo, ...parcial })}
        />
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

export function ReportesFilterPanel({ registryEntry, opcionesPorCampo, onAdd }) {
  if (!registryEntry) return null;
  const campos = Object.entries(registryEntry.filtros || {});
  if (!campos.length) return null;

  return (
    <div className="reportes-filter-panel">
      {campos.map(([campo, def]) => (
        <FiltroControl key={campo} campo={campo} def={def} opciones={opcionesPorCampo?.[campo]} onAdd={onAdd} />
      ))}
    </div>
  );
}
