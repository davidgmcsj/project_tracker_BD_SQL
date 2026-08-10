-- ============================================================
-- Migración 008: Campo "Objetivos" en detalle de actividad
-- Agrega la columna Objetivos a Actividades_Detalle.
-- Es seguro re-ejecutar: usa IF NOT EXISTS.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'Objetivos'
)
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD Objetivos NVARCHAR(MAX) NULL;
  PRINT 'Columna Objetivos agregada a Actividades_Detalle.';
END
ELSE
  PRINT 'Columna Objetivos ya existe, se omite.';
