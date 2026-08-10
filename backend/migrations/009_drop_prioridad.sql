-- ============================================================
-- Migración 009: Eliminar campo "Prioridad" de actividades
-- La app ya no usa esta métrica. Se elimina la columna de
-- Actividades_Detalle. Es seguro re-ejecutar: usa IF EXISTS.
-- ============================================================

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle') AND name = 'Prioridad'
)
BEGIN
  -- Quitar el DEFAULT constraint asociado antes de dropear la columna
  DECLARE @constraintName NVARCHAR(200);
  SELECT @constraintName = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.Actividades_Detalle') AND c.name = 'Prioridad';

  IF @constraintName IS NOT NULL
    EXEC('ALTER TABLE dbo.Actividades_Detalle DROP CONSTRAINT ' + @constraintName);

  ALTER TABLE dbo.Actividades_Detalle DROP COLUMN Prioridad;
  PRINT 'Columna Prioridad eliminada de Actividades_Detalle.';
END
ELSE
  PRINT 'Columna Prioridad no existe, se omite.';
