-- ============================================================
-- Migración 002: Catálogo de colaboradores externos
-- Ejecutar UNA sola vez contra la base de datos Azure SQL.
-- Es seguro re-ejecutar: todas las operaciones usan IF NOT EXISTS.
-- ============================================================

-- 1. Tabla de colaboradores externos
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Colaboradores_Externos'))
BEGIN
  CREATE TABLE dbo.Colaboradores_Externos (
    ColaboradorID  INT           IDENTITY(1,1) PRIMARY KEY,
    Nombre         NVARCHAR(150) NOT NULL,
    Empresa        NVARCHAR(150) NULL,
    Activo         BIT           NOT NULL DEFAULT 1,
    FechaCreacion  DATE          NOT NULL DEFAULT CAST(GETDATE() AS DATE)
  );
  PRINT 'Tabla Colaboradores_Externos creada.';
END
ELSE
  PRINT 'Tabla Colaboradores_Externos ya existe, se omite.';

-- 2. Tabla Estado_Actividades_Reporte: columna para el colaborador externo asignado
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Estado_Actividades_Reporte') AND name = 'AsignadoExternoID'
)
BEGIN
  ALTER TABLE dbo.Estado_Actividades_Reporte
    ADD AsignadoExternoID   INT           NULL,
        AsignadoExternoNombre NVARCHAR(500) NULL;
  PRINT 'Estado_Actividades_Reporte: columnas de externo agregadas.';
END
ELSE
  PRINT 'Estado_Actividades_Reporte: columnas de externo ya existen, se omite.';

-- 3. FK opcional (no bloquea si la tabla existía antes sin la FK)
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EAR_ColaboradorExterno'
)
BEGIN
  ALTER TABLE dbo.Estado_Actividades_Reporte
    ADD CONSTRAINT FK_EAR_ColaboradorExterno
      FOREIGN KEY (AsignadoExternoID)
      REFERENCES dbo.Colaboradores_Externos(ColaboradorID);
  PRINT 'FK FK_EAR_ColaboradorExterno creada.';
END
ELSE
  PRINT 'FK FK_EAR_ColaboradorExterno ya existe, se omite.';

-- ============================================================
-- Consulta útil: actividades con responsable externo en un rango
--
-- SELECT
--   ce.Nombre                      AS Externo,
--   ce.Empresa,
--   ear.DescripcionTexto            AS Actividad,
--   ear.Estado,
--   rs.FechaReporte,
--   rs.WeekLabel
-- FROM Estado_Actividades_Reporte ear
-- JOIN ReportesSemanales rs  ON rs.ReporteID    = ear.ReporteID
-- JOIN Colaboradores_Externos ce ON ce.ColaboradorID = ear.AsignadoExternoID
-- WHERE rs.FechaReporte BETWEEN '2026-01-01' AND '2026-12-31'
-- ORDER BY rs.FechaReporte DESC, ear.DescripcionTexto;
-- ============================================================
