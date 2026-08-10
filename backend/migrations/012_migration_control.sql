-- ============================================================
-- Migración 012: Control de migraciones aplicadas
-- Registra qué migraciones ya corrieron contra esta base, para que
-- run-migration.cjs pueda aplicar "todas las pendientes" sin repetir
-- las que ya se ejecutaron. Complementa (no reemplaza) el patrón
-- IF NOT EXISTS que ya usa cada migración como segunda red de seguridad.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Migraciones_Aplicadas')
BEGIN
  CREATE TABLE Migraciones_Aplicadas (
    Nombre      NVARCHAR(200) PRIMARY KEY,
    AplicadaEn  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Checksum    CHAR(64) NULL
  );
  PRINT 'Tabla Migraciones_Aplicadas creada.';
END
ELSE
  PRINT 'Tabla Migraciones_Aplicadas ya existe, se omite.';
