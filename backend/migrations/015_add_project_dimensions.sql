-- ============================================================
-- Migración 015: Dimensiones de reportería — Prioridad y Grupo de trabajo
--
-- Prioridad (1=alta, 2=media, 3=baja) en Proyectos: el booleano `priority`
-- del JSON solo distingue prioritario/no prioritario; para ordenar un
-- reporte por prioridad hace falta una escala. Se backfillea desde el
-- último RawDataJSON de cada proyecto (priority:true → 1); el resto queda
-- en 2 (media) hasta que se edite. La UI para editarla queda pendiente —
-- por ahora la columna solo sirve para filtrar/ordenar reportes.
--
-- GrupoTrabajo en Proyectos Y en Ingenieros: cada ingeniero pertenece a un
-- grupo de trabajo, y un proyecto también puede tener uno — ambas quedan
-- disponibles como filtro en el motor de reportes (Fase 2). Sin backfill:
-- no existe ese dato en ningún lado todavía, arranca NULL.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Proyectos') AND name = 'Prioridad')
BEGIN
  ALTER TABLE dbo.Proyectos ADD Prioridad TINYINT NOT NULL DEFAULT 2;
  PRINT 'Proyectos: columna Prioridad agregada.';
END
ELSE
  PRINT 'Proyectos: columna Prioridad ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Proyectos') AND name = 'GrupoTrabajo')
BEGIN
  ALTER TABLE dbo.Proyectos ADD GrupoTrabajo NVARCHAR(100) NULL;
  PRINT 'Proyectos: columna GrupoTrabajo agregada.';
END
ELSE
  PRINT 'Proyectos: columna GrupoTrabajo ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Ingenieros') AND name = 'GrupoTrabajo')
BEGIN
  ALTER TABLE dbo.Ingenieros ADD GrupoTrabajo NVARCHAR(100) NULL;
  PRINT 'Ingenieros: columna GrupoTrabajo agregada.';
END
ELSE
  PRINT 'Ingenieros: columna GrupoTrabajo ya existe, se omite.';

-- Backfill de Prioridad=1 desde el último snapshot semanal de cada proyecto
-- (deterministo y seguro de repetir: siempre da el mismo resultado).
--
-- Va en EXEC(N'...') a propósito: run-migration.cjs ejecuta todo el archivo
-- en un solo batch, sin separadores GO. Sin el EXEC, este UPDATE se compila
-- en el mismo batch que el ALTER TABLE de arriba y SQL Server lo rechaza con
-- "Invalid column name 'Prioridad'" porque la columna todavía no existe al
-- momento de compilar el batch completo — EXEC fuerza que este texto se
-- compile en su propio batch, ya con la columna creada.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Proyectos') AND name = 'Prioridad')
BEGIN
  EXEC(N'
    ;WITH Ultimo AS (
      SELECT rs.ProyectoID, rs.RawDataJSON,
             ROW_NUMBER() OVER (PARTITION BY rs.ProyectoID ORDER BY rs.Anio DESC, rs.NumeroSemana DESC) AS rn
      FROM ReportesSemanales rs
      WHERE rs.RawDataJSON IS NOT NULL
    )
    UPDATE p
    SET Prioridad = 1
    FROM dbo.Proyectos p
    JOIN Ultimo u ON u.ProyectoID = p.ProyectoID AND u.rn = 1
    WHERE ISJSON(u.RawDataJSON) = 1
      AND JSON_VALUE(u.RawDataJSON, ''$.priority'') = ''true'';
  ');
  PRINT 'Prioridad backfillada desde el último snapshot semanal.';
END
