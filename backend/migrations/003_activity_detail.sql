-- ============================================================
-- Migración 003: Detalle operacional de actividades
-- Guarda en SQL los campos del modal de actividad:
--   fechas, descripción, checklist, notas, fechas clave.
--   (La columna Prioridad creada aquí fue eliminada en la migración 009).
-- Es seguro re-ejecutar: todas las operaciones usan IF NOT EXISTS.
-- ============================================================

-- 1. Detalle principal de cada actividad (estado operacional vivo)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Actividades_Detalle'))
BEGIN
  CREATE TABLE dbo.Actividades_Detalle (
    DetalleID       INT           IDENTITY(1,1) PRIMARY KEY,
    AppActividadID  NVARCHAR(60)  NOT NULL,          -- act_xxx del JSON
    ProyectoAppID   NVARCHAR(60)  NOT NULL,          -- id del proyecto en el JSON
    TextoActividad  NVARCHAR(MAX) NOT NULL,
    Prioridad       NVARCHAR(10)  NOT NULL DEFAULT 'media',  -- alta / media / baja
    FechaInicio     DATE          NULL,
    FechaFin        DATE          NULL,
    Descripcion     NVARCHAR(MAX) NULL,
    Estado          NVARCHAR(20)  NOT NULL DEFAULT 'not_started',
    FechaInscripcion  DATE        NULL,
    FechaEnProceso    DATE        NULL,
    FechaCompletada   DATE        NULL,
    UltimaActualizacion DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_Actividades_Detalle_AppID UNIQUE (AppActividadID)
  );
  PRINT 'Tabla Actividades_Detalle creada.';
END
ELSE
  PRINT 'Tabla Actividades_Detalle ya existe, se omite.';

-- 2. Checklist de cada actividad
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Actividad_Checklist'))
BEGIN
  CREATE TABLE dbo.Actividad_Checklist (
    ChecklistID     INT           IDENTITY(1,1) PRIMARY KEY,
    AppActividadID  NVARCHAR(60)  NOT NULL,
    AppChecklistID  NVARCHAR(60)  NOT NULL,          -- chk_xxx del JSON
    Texto           NVARCHAR(500) NOT NULL,
    Hecho           BIT           NOT NULL DEFAULT 0,
    Orden           INT           NOT NULL DEFAULT 0,
    CONSTRAINT UQ_Checklist_AppID UNIQUE (AppChecklistID)
  );
  PRINT 'Tabla Actividad_Checklist creada.';
END
ELSE
  PRINT 'Tabla Actividad_Checklist ya existe, se omite.';

-- 3. Notas de cada actividad
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Actividad_Notas'))
BEGIN
  CREATE TABLE dbo.Actividad_Notas (
    NotaID          INT           IDENTITY(1,1) PRIMARY KEY,
    AppActividadID  NVARCHAR(60)  NOT NULL,
    AppNotaID       NVARCHAR(60)  NOT NULL,          -- note_xxx del JSON
    Fecha           DATE          NULL,
    Texto           NVARCHAR(MAX) NOT NULL,
    CONSTRAINT UQ_Notas_AppID UNIQUE (AppNotaID)
  );
  PRINT 'Tabla Actividad_Notas creada.';
END
ELSE
  PRINT 'Tabla Actividad_Notas ya existe, se omite.';

-- 4. Fechas clave de cada actividad
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Actividad_FechasClave'))
BEGIN
  CREATE TABLE dbo.Actividad_FechasClave (
    FechaClaveID    INT           IDENTITY(1,1) PRIMARY KEY,
    AppActividadID  NVARCHAR(60)  NOT NULL,
    AppFechaID      NVARCHAR(60)  NOT NULL,          -- kd_xxx del JSON
    Fecha           DATE          NULL,
    Etiqueta        NVARCHAR(500) NULL,
    CONSTRAINT UQ_FechasClave_AppID UNIQUE (AppFechaID)
  );
  PRINT 'Tabla Actividad_FechasClave creada.';
END
ELSE
  PRINT 'Tabla Actividad_FechasClave ya existe, se omite.';

-- ============================================================
-- Consulta útil: ver detalle completo de una actividad
--
-- SELECT
--   d.AppActividadID, d.TextoActividad, d.Prioridad,
--   d.Estado, d.FechaInicio, d.FechaFin,
--   d.FechaInscripcion, d.FechaEnProceso, d.FechaCompletada,
--   c.Texto AS CheckItem, c.Hecho,
--   n.Fecha AS FechaNota, n.Texto AS Nota,
--   f.Fecha AS FechaClave, f.Etiqueta
-- FROM Actividades_Detalle d
-- LEFT JOIN Actividad_Checklist  c ON c.AppActividadID = d.AppActividadID
-- LEFT JOIN Actividad_Notas      n ON n.AppActividadID = d.AppActividadID
-- LEFT JOIN Actividad_FechasClave f ON f.AppActividadID = d.AppActividadID
-- WHERE d.ProyectoAppID = '<id_proyecto>'
-- ORDER BY d.AppActividadID, c.Orden, n.Fecha, f.Fecha;
-- ============================================================
