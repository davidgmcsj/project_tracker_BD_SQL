-- ============================================================
-- Migración 011: campos ricos para tareas adicionales del ingeniero
-- Amplía Tareas_Sueltas_Ingeniero con los mismos campos que una actividad de
-- proyecto: detalle, objetivos, solución, fechas de plan, progreso y horas.
-- Checklist, notas y fechas clave se guardan como JSON en DatosExtra.
-- Es seguro re-ejecutar: usa IF NOT EXISTS por columna.
-- ============================================================

DECLARE @tbl SYSNAME = 'dbo.Tareas_Sueltas_Ingeniero';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'Detalle')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD Detalle NVARCHAR(MAX) NULL;
  PRINT 'Columna Detalle agregada.';
END ELSE PRINT 'Columna Detalle ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'Objetivos')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD Objetivos NVARCHAR(MAX) NULL;
  PRINT 'Columna Objetivos agregada.';
END ELSE PRINT 'Columna Objetivos ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'Solucion')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD Solucion NVARCHAR(MAX) NULL;
  PRINT 'Columna Solucion agregada.';
END ELSE PRINT 'Columna Solucion ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'FechaInicioPlan')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD FechaInicioPlan DATE NULL;
  PRINT 'Columna FechaInicioPlan agregada.';
END ELSE PRINT 'Columna FechaInicioPlan ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'FechaFinPlan')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD FechaFinPlan DATE NULL;
  PRINT 'Columna FechaFinPlan agregada.';
END ELSE PRINT 'Columna FechaFinPlan ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'Progreso')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD Progreso INT NOT NULL DEFAULT 0;  -- 0-100
  PRINT 'Columna Progreso agregada.';
END ELSE PRINT 'Columna Progreso ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'HorasPlaneadas')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD HorasPlaneadas DECIMAL(8,2) NOT NULL DEFAULT 0;
  PRINT 'Columna HorasPlaneadas agregada.';
END ELSE PRINT 'Columna HorasPlaneadas ya existe, se omite.';

-- Checklist, notas y fechas clave como JSON (evita tablas relacionales extra).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'DatosExtra')
BEGIN
  ALTER TABLE dbo.Tareas_Sueltas_Ingeniero ADD DatosExtra NVARCHAR(MAX) NULL;
  PRINT 'Columna DatosExtra agregada.';
END ELSE PRINT 'Columna DatosExtra ya existe, se omite.';
