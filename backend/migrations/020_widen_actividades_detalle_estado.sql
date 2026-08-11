-- ============================================================
-- Migración 020: Ampliar Actividades_Detalle.Estado
--
-- Flujo de ambientes de despliegue (desarrollo → pruebas → producción):
-- agrega 2 estados nuevos, "ambiente_pruebas" (16 caracteres) y
-- "ambiente_produccion" (20 caracteres), que ya no caben con margen en la
-- columna actual NVARCHAR(20) (003_activity_detail.sql). Sin CHECK
-- constraint (igual que hoy), así que el ALTER es seguro y no requiere
-- migrar datos existentes — los valores actuales ("not_started",
-- "in_progress", "completed") ya caben igual de bien en el ancho nuevo.
-- ============================================================

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'Estado' AND max_length < 100
)
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ALTER COLUMN Estado NVARCHAR(50) NOT NULL;
  PRINT 'Actividades_Detalle.Estado ampliada a NVARCHAR(50).';
END
ELSE
  PRINT 'Actividades_Detalle.Estado ya tiene el ancho esperado, se omite.';
