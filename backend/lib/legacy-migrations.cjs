"use strict";

// legacy-migrations.cjs — Migraciones de datos ANTIGUOS que corren al arrancar.
//
// Ambas son idempotentes: detectan el formato viejo y no hacen nada si los
// datos ya están migrados. Se ejecutan en cada arranque desde lib/bootstrap.cjs.
//
// ESTE ARCHIVO ESTÁ AISLADO PARA PODER BORRARLO. Cuando se confirme que no
// queda ningún data.json en formato pre-migración (ni en producción, ni en
// respaldos que se puedan restaurar), se elimina el archivo entero y sus dos
// llamadas en bootstrap.cjs. No hay nada más que dependa de él.

const { toArray } = require("../utils.cjs");
const { DATA_FILE, readJson, writeJson } = require("./json-store.cjs");


// ── Migración de datos legados (string → array/objeto) ────────────────────────
// Esta función corre UNA SOLA VEZ al inicio si detecta datos en formato antiguo.
// Una vez migrados, los datos tienen el campo en array y no vuelve a correr.
// Se puede eliminar cuando se tenga certeza de que no hay datos pre-migración.

async function migrateArrayFields() {
  const data = await readJson(DATA_FILE, null);
  if (!data?.projects?.length) return;

  let changed = false;
  data.projects = data.projects.map(p => {
    const needsMigration =
      typeof p.activities_identified === "string" ||
      typeof p.weekly_achievements   === "string" ||
      typeof p.next_week_plan        === "string" ||
      typeof p.milestones            === "string" ||
      typeof p.comments              === "string";

    if (!needsMigration) return p;
    changed = true;

    const milestonesArr = typeof p.milestones === "string" && p.milestones.trim()
      ? toArray(p.milestones).map(note => ({ activity: "", date: "", note }))
      : (Array.isArray(p.milestones) ? p.milestones : []);

    const commentsArr = typeof p.comments === "string" && p.comments.trim()
      ? toArray(p.comments).map(text => ({ activity: "", date: "", text }))
      : (Array.isArray(p.comments) ? p.comments : []);

    return {
      ...p,
      activities_identified: toArray(p.activities_identified),
      weekly_achievements:   toArray(p.weekly_achievements),
      next_week_plan:        toArray(p.next_week_plan),
      milestones:            milestonesArr,
      comments:              commentsArr,
      engineers: (p.engineers || []).map(e => ({
        ...e,
        weekly_detail: toArray(e.weekly_detail),
      })),
    };
  });

  if (changed) {
    await writeJson(DATA_FILE, data);
    console.log("Migración string→array/objeto completada");
  }
}

// ── Migración: comments/milestones de proyecto → act.notes/act.key_dates ─────
// Corre UNA SOLA VEZ si detecta que algún proyecto aún tiene p.comments o
// p.milestones en formato antiguo. Mueve cada entrada al array correspondiente
// dentro de la actividad que referencia. Las entradas sin actividad asociada
// se guardan en p.orphan_notes / p.orphan_key_dates para no perder datos.

function genId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function migrateCommentsAndMilestones() {
  const data = await readJson(DATA_FILE, null);
  if (!data?.projects?.length) return;

  let changed = false;

  data.projects = data.projects.map(p => {
    const hasOldComments   = Array.isArray(p.comments)   && p.comments.length   > 0;
    const hasOldMilestones = Array.isArray(p.milestones) && p.milestones.length > 0;
    if (!hasOldComments && !hasOldMilestones) return p;

    changed = true;

    // Construye mapa actId → actividad para asignar notas/fechas
    const actMap = new Map((p.activities_identified || []).map(a => [a.id, a]));

    // Asegura que todas las actividades tengan los campos nuevos
    const newActs = (p.activities_identified || []).map(a => ({
      ...a,
      notes:     Array.isArray(a.notes)     ? a.notes     : [],
      key_dates: Array.isArray(a.key_dates) ? a.key_dates : [],
    }));
    const newActMap = new Map(newActs.map(a => [a.id, a]));

    const orphanNotes    = [...(p.orphan_notes    || [])];
    const orphanKeyDates = [...(p.orphan_key_dates || [])];

    // Migrar p.comments → act.notes
    if (hasOldComments) {
      (p.comments || []).forEach(c => {
        const note = { id: genId("note"), date: c.date || "", text: c.text || "" };
        if (c.activity && newActMap.has(c.activity)) {
          newActMap.get(c.activity).notes.push(note);
        } else {
          orphanNotes.push(note);
        }
      });
    }

    // Migrar p.milestones → act.key_dates
    if (hasOldMilestones) {
      (p.milestones || []).forEach(m => {
        const kd = { id: genId("kd"), date: m.date || "", label: m.note || "" };
        if (m.activity && newActMap.has(m.activity)) {
          newActMap.get(m.activity).key_dates.push(kd);
        } else {
          orphanKeyDates.push(kd);
        }
      });
    }

    const result = {
      ...p,
      activities_identified: newActs,
      comments:   undefined,
      milestones: undefined,
    };
    delete result.comments;
    delete result.milestones;
    if (orphanNotes.length)    result.orphan_notes    = orphanNotes;
    if (orphanKeyDates.length) result.orphan_key_dates = orphanKeyDates;
    return result;
  });

  if (changed) {
    await writeJson(DATA_FILE, data);
    console.log("Migración comments/milestones → act.notes/key_dates completada");
  }
}

module.exports = { migrateArrayFields, migrateCommentsAndMilestones };
