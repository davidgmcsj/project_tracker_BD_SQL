-- ============================================================
-- Migración 010: fechas de estado para tareas adicionales del ingeniero
-- Agrega FechaInscrita, FechaInicio y FechaCompletada a
-- Tareas_Sueltas_Ingeniero, para poder consultar en SQL cuándo una
-- tarea suelta pasó por cada estado (inscrita / en proceso / completada).
-- Es seguro re-ejecutar: usa IF NOT EXISTS por columna.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Tareas_Sueltas_Ingeniero') AND name = 'FechaInscrita'
)
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD FechaInscrita DATE NULL;
  PRINT 'Columna FechaInscrita agregada a Tareas_Sueltas_Ingeniero.';
END
ELSE
  PRINT 'Columna FechaInscrita ya existe, se omite.';

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Tareas_Sueltas_Ingeniero') AND name = 'FechaInicio'
)
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD FechaInicio DATE NULL;
  PRINT 'Columna FechaInicio agregada a Tareas_Sueltas_Ingeniero.';
END
ELSE
  PRINT 'Columna FechaInicio ya existe, se omite.';

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Tareas_Sueltas_Ingeniero') AND name = 'FechaCompletada'
)
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD FechaCompletada DATE NULL;
  PRINT 'Columna FechaCompletada agregada a Tareas_Sueltas_Ingeniero.';
END
ELSE
  PRINT 'Columna FechaCompletada ya existe, se omite.';
