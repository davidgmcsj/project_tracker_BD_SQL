-- ============================================================
-- Migración 007: Adjuntos de actividades
-- Guarda archivos (bytes) asociados a cada actividad directamente en SQL.
-- Es seguro re-ejecutar: usa IF NOT EXISTS.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Actividad_Adjuntos'))
BEGIN
  CREATE TABLE dbo.Actividad_Adjuntos (
    AdjuntoID       INT            IDENTITY(1,1) PRIMARY KEY,
    AppAdjuntoID    NVARCHAR(60)   NOT NULL,          -- att_xxx generado en el frontend
    AppActividadID  NVARCHAR(60)   NOT NULL,          -- act_xxx del JSON
    ProyectoAppID   NVARCHAR(60)   NULL,              -- id del proyecto (para consultas/limpieza)
    NombreArchivo   NVARCHAR(400)  NOT NULL,
    TipoMime        NVARCHAR(200)  NULL,
    Tamano          BIGINT         NOT NULL DEFAULT 0, -- bytes
    Contenido       VARBINARY(MAX) NOT NULL,
    FechaSubida     DATETIME2      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_Adjuntos_AppID UNIQUE (AppAdjuntoID)
  );
  PRINT 'Tabla Actividad_Adjuntos creada.';
END
ELSE
  PRINT 'Tabla Actividad_Adjuntos ya existe, se omite.';
