-- ============================================================
-- Migración 016: Reportes_Guardados
--
-- Combinaciones de consulta+filtros ya armadas, para no reconfigurar cada
-- vez — el equivalente a "colas guardadas" de QueueMetrics. Config es JSON
-- de usuario que vuelve al motor de consultas (query-builder.cjs) tal cual
-- se guardó; al recargar pasa por la MISMA validación contra el registro
-- que cualquier consulta nueva, así que un Config manipulado directamente
-- en la base no puede inyectar nada — en el peor caso, un campo inválido
-- hace que la consulta falle con 400.
--
-- EsPlantillaSistema queda reservado para cuando las 5 plantillas de
-- arranque rápido (hoy hardcodeadas en ReportesTemplates.jsx) se muevan a
-- esta tabla — no se usa todavía.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Reportes_Guardados')
BEGIN
  CREATE TABLE Reportes_Guardados (
    ReporteID          INT IDENTITY(1,1) PRIMARY KEY,
    Nombre             NVARCHAR(150) NOT NULL,
    Config             NVARCHAR(MAX) NOT NULL,
    Autor              NVARCHAR(150) NULL,
    EsPlantillaSistema BIT           NOT NULL DEFAULT 0,
    CreadoEn           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  PRINT 'Tabla Reportes_Guardados creada.';
END
ELSE
  PRINT 'Tabla Reportes_Guardados ya existe, se omite.';
