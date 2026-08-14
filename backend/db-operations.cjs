"use strict";

// db-operations.cjs — Fachada que re-exporta los repos de db/*.repo.cjs.
//
// La implementación real vive dividida por dominio en db/: pool.cjs (conexión
// compartida con run-migration.cjs), users.repo.cjs, engineers.repo.cjs,
// engineer-tasks.repo.cjs, projects.repo.cjs, weekly-report.repo.cjs,
// activity-detail.repo.cjs, attachments.repo.cjs, recovery.repo.cjs.
//
// Este archivo existe para que server.cjs, reports/index.cjs y
// scripts/backfill-events.cjs sigan haciendo
// `require("./db-operations.cjs")` sin cambiar ni un import — la división
// en repos es un detalle interno de este módulo, no un cambio de contrato
// público.

const { getPool } = require("./db/pool.cjs");
const { listUsers, createUser, updateUser } = require("./db/users.repo.cjs");
const { syncEngineerToSQL, deleteEngineerFromSQL, syncExternalContactToSQL } = require("./db/engineers.repo.cjs");
const { syncEngineerTaskToSQL, deleteEngineerTaskFromSQL } = require("./db/engineer-tasks.repo.cjs");
const { saveWeekReportToDB } = require("./db/weekly-report.repo.cjs");
const { syncActividadesDetalle } = require("./db/activity-detail.repo.cjs");
const { saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB } = require("./db/attachments.repo.cjs");
const { rebuildDataJsonFromSQL, maxSqlSavedAt } = require("./db/recovery.repo.cjs");

module.exports = {
  getPool,
  saveWeekReportToDB, syncEngineerToSQL, deleteEngineerFromSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL,
  syncExternalContactToSQL, syncActividadesDetalle,
  saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB,
  rebuildDataJsonFromSQL, maxSqlSavedAt,
  listUsers, createUser, updateUser,
};
