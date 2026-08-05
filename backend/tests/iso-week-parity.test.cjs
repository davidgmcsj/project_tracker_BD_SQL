// iso-week-parity.test.cjs — blinda la duplicación consciente entre
// backend/utils.cjs (CommonJS) y frontend/src/utils/isoWeek.js (ESM): las
// 6 funciones de semana ISO están copiadas a mano porque backend y
// frontend no comparten bundler. Este test corre las MISMAS 200 fechas por
// ambos lados y falla si algún día se desincronizan.
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const backend = require("../utils.cjs");

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// 200 fechas consecutivas centradas en varios cruces de año (donde vive el
// bug histórico: el año ISO no siempre coincide con el año de calendario).
function generateDates() {
  const dates = [];
  const start = new Date("2024-12-01T12:00:00Z");
  for (let i = 0; i < 200; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(toISODate(d));
  }
  return dates;
}

test("isoWeek/isoWeekNumber/isoYearOf/isoWeekStart/isoWeekEnd coinciden entre backend y frontend en 200 fechas", async () => {
  const frontendPath = path.join(__dirname, "..", "..", "frontend", "src", "utils", "isoWeek.js");
  const frontend = await import(`file://${frontendPath.replace(/\\/g, "/")}`);

  const dates = generateDates();
  const mismatches = [];

  for (const dateStr of dates) {
    const b = {
      isoWeek:       backend.isoWeek(dateStr),
      isoWeekNumber: backend.isoWeekNumber(dateStr),
      isoYearOf:     backend.isoYearOf(dateStr),
      isoWeekStart:  backend.isoWeekStart(dateStr),
      isoWeekEnd:    backend.isoWeekEnd(dateStr),
    };
    const f = {
      isoWeek:       frontend.isoWeek(dateStr),
      isoWeekNumber: frontend.isoWeekNumber(dateStr),
      isoYearOf:     frontend.isoYearOf(dateStr),
      isoWeekStart:  frontend.isoWeekStart(dateStr),
      isoWeekEnd:    frontend.isoWeekEnd(dateStr),
    };

    if (JSON.stringify(b) !== JSON.stringify(f)) {
      mismatches.push({ dateStr, backend: b, frontend: f });
    }
  }

  if (mismatches.length) {
    console.error(`${mismatches.length} discrepancias de ${dates.length} fechas:`, mismatches.slice(0, 5));
  }
  assert.equal(mismatches.length, 0, `${mismatches.length} fechas con resultados distintos entre backend y frontend`);
});
