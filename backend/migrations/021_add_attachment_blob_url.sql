-- ============================================================
-- Migración 021: Adjuntos en Azure Blob Storage (Fase 10, ver
-- plan-blob-storage.md)
--
-- Agrega BlobUrl a Actividad_Adjuntos y vuelve Contenido NULLABLE.
-- NO borra el dato existente: los adjuntos ya subidos siguen
-- sirviéndose desde SQL (Contenido) hasta que el script de backfill
-- (scripts/backfill-attachments-to-blob.cjs) los mueva a Blob y llene
-- BlobUrl. db/attachments.repo.cjs decide de dónde leer según si
-- BlobUrl está poblado o no — compatibilidad total durante la
-- transición, sin ventana de adjuntos rotos.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividad_Adjuntos') AND name = 'BlobUrl'
)
BEGIN
  ALTER TABLE dbo.Actividad_Adjuntos ADD BlobUrl NVARCHAR(1000) NULL;
  PRINT 'Actividad_Adjuntos.BlobUrl agregada.';
END
ELSE
  PRINT 'Actividad_Adjuntos.BlobUrl ya existe, se omite.';

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividad_Adjuntos') AND name = 'Contenido' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.Actividad_Adjuntos ALTER COLUMN Contenido VARBINARY(MAX) NULL;
  PRINT 'Actividad_Adjuntos.Contenido ahora es NULLABLE.';
END
ELSE
  PRINT 'Actividad_Adjuntos.Contenido ya es NULLABLE (o no existe), se omite.';
