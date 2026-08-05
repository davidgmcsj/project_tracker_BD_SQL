-- ============================================================
-- Migración 018: Usuarios y Sesiones (login por base de datos)
--
-- Reemplaza el plan original de EntraID: el usuario no tiene tenant de
-- Azure AD disponible por ahora. Convive con X-API-Key (no lo reemplaza):
-- API_KEY sigue siendo el candado general del backend; el login agrega
-- identidad real ENCIMA, para saber quién hizo cada acción (autor real en
-- Proyecto_Notas, base para auditoría futura). Sin roles todavía — solo
-- login + identidad, cualquier usuario logueado puede hacer lo mismo que
-- ya permite la API_KEY.
--
-- Contraseñas: scrypt (módulo `crypto` nativo de Node, sin dependencia
-- nueva) — PasswordHash (64 bytes → 128 hex) + PasswordSalt (16 bytes →
-- 32 hex) por usuario.
--
-- Sesiones: token aleatorio de 32 bytes como PK directa (no autoincremental
-- expuesto), cookie httpOnly+secure+SameSite=Lax. Expiran a los 7 días;
-- borrar la fila = cerrar sesión de inmediato, sin esperar a que expire.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Usuarios')
BEGIN
  CREATE TABLE Usuarios (
    UsuarioID      INT IDENTITY(1,1) PRIMARY KEY,
    NombreUsuario  NVARCHAR(100) NOT NULL,
    Email          NVARCHAR(200) NULL,
    NombreCompleto NVARCHAR(150) NOT NULL,
    PasswordHash   CHAR(128) NOT NULL,
    PasswordSalt   CHAR(32)  NOT NULL,
    Activo         BIT NOT NULL DEFAULT 1,
    CreadoEn       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Usuarios_NombreUsuario UNIQUE (NombreUsuario)
  );
  PRINT 'Tabla Usuarios creada.';
END
ELSE
  PRINT 'Tabla Usuarios ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Sesiones')
BEGIN
  CREATE TABLE Sesiones (
    Token     CHAR(64) PRIMARY KEY,
    UsuarioID INT NOT NULL,
    CreadaEn  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ExpiraEn  DATETIME2 NOT NULL,
    CONSTRAINT FK_Sesiones_Usuario FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID)
  );
  CREATE INDEX IX_Sesiones_Usuario ON Sesiones (UsuarioID);
  PRINT 'Tabla Sesiones creada.';
END
ELSE
  PRINT 'Tabla Sesiones ya existe, se omite.';
