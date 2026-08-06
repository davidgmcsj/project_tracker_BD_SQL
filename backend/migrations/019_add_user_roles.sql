-- ============================================================
-- Migración 019: Roles de usuario + vínculo Usuario↔Ingeniero
--
-- 018 dejó "sin roles todavía" a propósito. Esta migración agrega lo mínimo
-- para que un ingeniero pueda loguearse y ver SOLO su propio dashboard:
--
--   IngenieroID: liga un Usuario con una fila de Ingenieros. NULL = usuario
--   sin ingeniero vinculado (ej. un admin puro, o un usuario de soporte).
--   Sin ON DELETE CASCADE a propósito: borrar un ingeniero del catálogo no
--   debe borrar ni desvincular usuarios en silencio.
--
--   EsAdmin: bit simple, no un enum de roles — hoy solo hace falta
--   distinguir "ve todo" de "ve solo lo suyo". Si aparece un tercer nivel de
--   permiso más adelante, se revisita.
--
-- Ningún backfill: todos los usuarios existentes quedan EsAdmin=0,
-- IngenieroID=NULL hasta que se vinculen a mano desde la pantalla de
-- administración de usuarios (o por UPDATE directo para el primer admin,
-- que necesariamente se crea antes de que esa pantalla sea accesible).
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Usuarios') AND name = 'IngenieroID')
BEGIN
  ALTER TABLE dbo.Usuarios ADD IngenieroID INT NULL;
  PRINT 'Usuarios: columna IngenieroID agregada.';
END
ELSE
  PRINT 'Usuarios: columna IngenieroID ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Usuarios_Ingeniero')
BEGIN
  ALTER TABLE dbo.Usuarios
    ADD CONSTRAINT FK_Usuarios_Ingeniero FOREIGN KEY (IngenieroID) REFERENCES dbo.Ingenieros(IngenieroID);
  PRINT 'Usuarios: FK_Usuarios_Ingeniero agregada.';
END
ELSE
  PRINT 'Usuarios: FK_Usuarios_Ingeniero ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Usuarios') AND name = 'EsAdmin')
BEGIN
  ALTER TABLE dbo.Usuarios ADD EsAdmin BIT NOT NULL DEFAULT 0;
  PRINT 'Usuarios: columna EsAdmin agregada.';
END
ELSE
  PRINT 'Usuarios: columna EsAdmin ya existe, se omite.';
