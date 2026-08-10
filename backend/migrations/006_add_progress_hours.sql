-- ============================================================
-- Migración 006: % de cumplimiento y horas planeadas por actividad
-- Agrega las columnas Progreso y HorasPlaneadas a Actividades_Detalle.
-- Es seguro re-ejecutar: usa IF NOT EXISTS por columna.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'Progreso'
)
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD Progreso INT NOT NULL DEFAULT 0;  -- 0-100
  PRINT 'Columna Progreso agregada a Actividades_Detalle.';
END
ELSE
  PRINT 'Columna Progreso ya existe, se omite.';

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'HorasPlaneadas'
)
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD HorasPlaneadas DECIMAL(8,2) NOT NULL DEFAULT 0;
  PRINT 'Columna HorasPlaneadas agregada a Actividades_Detalle.';
END
ELSE
  PRINT 'Columna HorasPlaneadas ya existe, se omite.';
