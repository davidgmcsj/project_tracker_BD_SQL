-- ============================================================
-- Migración 013: Actividad_Eventos (event log de solo inserción)
--
-- Registra cada cambio relevante de una actividad (estado, progreso,
-- fecha de inicio, fecha de fin, horas planeadas) como una fila nueva —
-- nunca se actualiza ni se borra una fila existente. Es lo que permite
-- responder "¿qué pasó en la semana X?" con un filtro sobre esta tabla,
-- en vez de recorrer fotos completas de history.json.
--
-- Tipo usa 5 valores concretos (estado, progreso, fecha_inicio, fecha_fin,
-- horas) en vez de un genérico "fecha" — así un reporte puede filtrar
-- "solo cambios de fecha de fin" directamente por Tipo.
--
-- HashCambio es un sha256 determinístico de (actividad+tipo+valores+fecha+
-- origen). La restricción UNIQUE sobre esa columna es lo que hace que
-- reinsertar el mismo evento (por ejemplo al reintentar un guardado, o al
-- re-correr el backfill de la Fase 1B) no duplique filas.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Actividad_Eventos')
BEGIN
  CREATE TABLE Actividad_Eventos (
    EventoID          BIGINT IDENTITY(1,1) PRIMARY KEY,
    AppActividadID    NVARCHAR(60)  NOT NULL,
    AppProyectoID     NVARCHAR(60)  NULL,
    AppIngenieroID    NVARCHAR(60)  NULL,
    Tipo              NVARCHAR(30)  NOT NULL,
    ValorAnterior     NVARCHAR(MAX) NULL,
    ValorNuevo        NVARCHAR(MAX) NULL,
    FechaEvento       DATE          NOT NULL,
    FechaRegistro     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    SemanaISO         CHAR(8)       NOT NULL,
    Origen            NVARCHAR(30)  NOT NULL,
    HashCambio        CHAR(64)      NOT NULL,
    CONSTRAINT UQ_Eventos_Hash UNIQUE (HashCambio)
  );
  CREATE INDEX IX_Eventos_Semana    ON Actividad_Eventos (SemanaISO);
  CREATE INDEX IX_Eventos_Ingeniero ON Actividad_Eventos (AppIngenieroID, FechaEvento);
  CREATE INDEX IX_Eventos_Proyecto  ON Actividad_Eventos (AppProyectoID, FechaEvento);
  PRINT 'Tabla Actividad_Eventos creada.';
END
ELSE
  PRINT 'Tabla Actividad_Eventos ya existe, se omite.';
