-- ============================================================
-- Migración 014: Proyecto_Notas
--
-- Notas y comentarios fechados, con autor y tipo, para un proyecto. No
-- reemplaza status_notes (el "pulso" de una línea que ya usa el informe Word
-- y gemini-report.cjs) — es un canal nuevo al lado, para dejar constancia de
-- decisiones, riesgos o compromisos con fecha real, sin pisarse entre sí.
--
-- AppNotaID (note_xxx) es la referencia estable del lado app, igual patrón
-- que act_xxx / chk_xxx / kd_xxx — sin ella no se puede editar/borrar una
-- nota concreta desde el frontend.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Proyecto_Notas')
BEGIN
  CREATE TABLE Proyecto_Notas (
    NotaID           BIGINT IDENTITY(1,1) PRIMARY KEY,
    AppNotaID        NVARCHAR(60)  NOT NULL,
    AppProyectoID    NVARCHAR(60)  NOT NULL,
    Fecha            DATE          NOT NULL,
    Autor            NVARCHAR(150) NULL,
    Tipo             NVARCHAR(20)  NOT NULL DEFAULT 'comentario', -- comentario|decision|riesgo|compromiso
    Texto            NVARCHAR(MAX) NOT NULL,
    IncluirEnReporte BIT           NOT NULL DEFAULT 1,
    CreadoEn         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_ProyectoNotas_AppID UNIQUE (AppNotaID)
  );
  CREATE INDEX IX_ProyectoNotas_Proyecto ON Proyecto_Notas (AppProyectoID, Fecha);
  PRINT 'Tabla Proyecto_Notas creada.';
END
ELSE
  PRINT 'Tabla Proyecto_Notas ya existe, se omite.';
