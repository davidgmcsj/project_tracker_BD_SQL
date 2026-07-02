-- ============================================================
-- Migración 004: Archivo histórico de trimestres
--
-- Propósito:
--   Guardar un snapshot completo del estado de todos los proyectos
--   al momento de hacer un "Reinicio de Trimestre". Esto permite
--   consultar desde la app cualquier actividad, proyecto o métrica
--   de trimestres anteriores sin necesidad de tocar data.json.
--
-- Estrategia de almacenamiento:
--   El JSON completo del trimestre se guarda en la columna
--   ArchivedDataJSON (NVARCHAR MAX). Esto es intencional: los
--   trimestres son snapshots históricos inmutables que se leen
--   completos, no se consultan por columnas individuales.
--   Para búsquedas específicas, la app parsea el JSON en memoria.
--
-- Es seguro re-ejecutar: usa IF NOT EXISTS en todo.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Trimestres_Archivo'))
BEGIN
  CREATE TABLE dbo.Trimestres_Archivo (
    -- Identificador autoincremental interno
    TrimestreID       INT            IDENTITY(1,1) PRIMARY KEY,

    -- Label legible del trimestre que SE CIERRA (ej: "Q2 2026")
    -- Este es el trimestre que se archiva, no el que empieza
    QuarterLabel      NVARCHAR(50)   NOT NULL,

    -- Fecha del primer día del trimestre archivado (ej: 2026-04-01 para Q2)
    FechaInicio       DATE           NOT NULL,

    -- Fecha en que se ejecutó el reset (día en que se cerró el trimestre)
    FechaReset        DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),

    -- Cantidad de proyectos en el snapshot (para mostrar en la lista sin parsear JSON)
    TotalProyectos    INT            NOT NULL DEFAULT 0,

    -- Cantidad de actividades completadas que se archivaron (no pasan al siguiente trimestre)
    ActividadesArchivadas INT        NOT NULL DEFAULT 0,

    -- Cantidad de actividades que SÍ pasaron al siguiente trimestre (in_progress + not_started)
    ActividadesTransferidas INT      NOT NULL DEFAULT 0,

    -- JSON completo del estado de data.json en el momento del reset.
    -- Incluye: projects (con todas sus actividades, métricas, task_status, etc.),
    -- engineers, externalContacts y weekLabel del último periodo.
    ArchivedDataJSON  NVARCHAR(MAX)  NOT NULL,

    -- Timestamp exacto con zona horaria de cuando se ejecutó el reset
    CreadoEn          DATETIME2      NOT NULL DEFAULT GETDATE()
  );

  PRINT 'Tabla Trimestres_Archivo creada correctamente.';
END
ELSE
  PRINT 'Tabla Trimestres_Archivo ya existe, se omite la creación.';

-- Índice para consultas por label de trimestre (búsqueda desde la app)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Trimestres_Archivo')
  AND   name      = 'IX_Trimestres_QuarterLabel'
)
BEGIN
  CREATE INDEX IX_Trimestres_QuarterLabel
    ON dbo.Trimestres_Archivo (QuarterLabel);
  PRINT 'Índice IX_Trimestres_QuarterLabel creado.';
END
ELSE
  PRINT 'Índice IX_Trimestres_QuarterLabel ya existe, se omite.';

-- Índice para ordenar por fecha de reset (para mostrar lista de más reciente a más antiguo)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Trimestres_Archivo')
  AND   name      = 'IX_Trimestres_FechaReset'
)
BEGIN
  CREATE INDEX IX_Trimestres_FechaReset
    ON dbo.Trimestres_Archivo (FechaReset DESC);
  PRINT 'Índice IX_Trimestres_FechaReset creado.';
END
ELSE
  PRINT 'Índice IX_Trimestres_FechaReset ya existe, se omite.';

-- ============================================================
-- Consultas útiles para verificar y consultar el archivo:
--
-- Ver lista de trimestres archivados:
--   SELECT TrimestreID, QuarterLabel, FechaInicio, FechaReset,
--          TotalProyectos, ActividadesArchivadas, ActividadesTransferidas
--   FROM Trimestres_Archivo
--   ORDER BY FechaReset DESC;
--
-- Ver el JSON completo de un trimestre específico:
--   SELECT ArchivedDataJSON
--   FROM Trimestres_Archivo
--   WHERE TrimestreID = 1;
-- ============================================================
