-- ============================================================
-- Migración 017: Version optimista en Proyectos (Fase 8 — riesgo 10.1)
--
-- Solo control de versión, no "escritura por entidad": el contrato de
-- POST /api/projects sigue enviando el array completo, ya trae
-- changedProjectId (storage.js) para identificar cuál cambió. Con eso el
-- backend valida la versión SOLO del proyecto que cambió — 95% del
-- beneficio (dos personas editando el MISMO proyecto a la vez ya no se
-- pisan en silencio) con 20% del riesgo de rediseñar el contrato completo.
--
-- Esta columna es un espejo persistente en SQL; el valor que realmente
-- gobierna el chequeo en cada guardado vive en el campo `version` de cada
-- proyecto dentro de data.json (la caché rápida que sirve cada guardado).
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Proyectos') AND name = 'Version')
BEGIN
  ALTER TABLE dbo.Proyectos ADD Version INT NOT NULL DEFAULT 1;
  PRINT 'Proyectos: columna Version agregada.';
END
ELSE
  PRINT 'Proyectos: columna Version ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Proyectos') AND name = 'ActualizadoEn')
BEGIN
  ALTER TABLE dbo.Proyectos ADD ActualizadoEn DATETIME2 NULL;
  PRINT 'Proyectos: columna ActualizadoEn agregada.';
END
ELSE
  PRINT 'Proyectos: columna ActualizadoEn ya existe, se omite.';
