-- ============================================================
-- Migración 001: Asignación fija de actividades a ingenieros
-- Ejecutar UNA sola vez contra la base de datos Azure SQL.
-- Es seguro re-ejecutar: todas las operaciones usan IF NOT EXISTS.
-- ============================================================

-- 1. Tabla Actividades: columna para el ingeniero asignado y fecha de asignación
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades') AND name = 'AsignadoIngenieroID'
)
BEGIN
  ALTER TABLE dbo.Actividades
    ADD AsignadoIngenieroID INT NULL,
        FechaAsignacion     DATE NULL;
  ALTER TABLE dbo.Actividades
    ADD CONSTRAINT FK_Actividades_Ingeniero
      FOREIGN KEY (AsignadoIngenieroID)
      REFERENCES dbo.Ingenieros(IngenieroID);
  PRINT 'Actividades: columnas AsignadoIngenieroID y FechaAsignacion agregadas.';
END
ELSE
  PRINT 'Actividades: columnas ya existen, se omite.';

-- 2. Tabla Actividades: columna para guardar el nombre del ingeniero que completó
--    (desnormalización intencional para trazabilidad histórica inmutable)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades') AND name = 'CompletadoPorNombre'
)
BEGIN
  ALTER TABLE dbo.Actividades
    ADD CompletadoPorNombre NVARCHAR(150) NULL;
  PRINT 'Actividades: columna CompletadoPorNombre agregada.';
END
ELSE
  PRINT 'Actividades: columna CompletadoPorNombre ya existe, se omite.';

-- 3. Tabla Estado_Actividades_Reporte: columna para el ingeniero asignado en ese reporte
--    Permite consultar: "qué actividades tenía X en la semana Y y en qué estado estaban"
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Estado_Actividades_Reporte') AND name = 'AsignadoIngenieroID'
)
BEGIN
  ALTER TABLE dbo.Estado_Actividades_Reporte
    ADD AsignadoIngenieroID  INT          NULL,
        AsignadoNombre       NVARCHAR(150) NULL;
  PRINT 'Estado_Actividades_Reporte: columnas de asignación agregadas.';
END
ELSE
  PRINT 'Estado_Actividades_Reporte: columnas ya existen, se omite.';

-- ============================================================
-- Consulta de verificación útil para trazabilidad:
--
-- SELECT
--   i.Nombre                      AS Ingeniero,
--   ear.DescripcionTexto           AS Actividad,
--   ear.Estado,
--   rs.FechaReporte,
--   rs.WeekLabel
-- FROM Estado_Actividades_Reporte ear
-- JOIN ReportesSemanales rs  ON rs.ReporteID  = ear.ReporteID
-- JOIN Ingenieros i          ON i.IngenieroID = ear.AsignadoIngenieroID
-- WHERE ear.AsignadoIngenieroID = <IngenieroID>
--   AND rs.FechaReporte BETWEEN '2026-01-01' AND '2026-12-31'
-- ORDER BY rs.FechaReporte DESC, ear.DescripcionTexto;
-- ============================================================
