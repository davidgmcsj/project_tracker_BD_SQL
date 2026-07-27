-- ============================================================
-- Migración 005: Campo "Solución" en detalle de actividad
-- Agrega la columna Solucion a Actividades_Detalle.
-- Es seguro re-ejecutar: usa IF NOT EXISTS.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'Solucion'
)
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD Solucion NVARCHAR(MAX) NULL;
  PRINT 'Columna Solucion agregada a Actividades_Detalle.';
END
ELSE
  PRINT 'Columna Solucion ya existe, se omite.';
