# Infraestructura y Despliegue — Project Tracker

> Fecha: 6 de agosto de 2026. Datos verificados directamente sobre el código.

---

## 1. Resumen para el equipo de infraestructura

**Qué es:** aplicación web de seguimiento de proyectos, con dos piezas independientes:

| Pieza | Tecnología | Qué se despliega |
|---|---|---|
| **Frontend** | React 19 + Vite | **Archivos estáticos** (HTML/CSS/JS). No requiere Node en el servidor. |
| **Backend** | Node.js + Express 5 | **Proceso Node** escuchando en un puerto. Sí requiere Node. |
| **Base de datos** | Azure SQL Server | Externa. Ya existe, no se despliega. |

### Respuesta a "tiene que correr sin tener estas cosas instaladas en el servidor"

Esto se resuelve distinto para cada pieza:

| Pieza | ¿Necesita instalación en el servidor? | Solución |
|---|---|---|
| **Frontend** | **No.** | Se compila en otra máquina (`npm run build`) y se copia la carpeta `dist/`. Son archivos estáticos: los sirve cualquier IIS, Apache, Nginx o Azure Static Web Apps. **Cero dependencias en el servidor.** |
| **Backend** | **Sí, requiere un runtime de Node.** | Tres opciones según lo que permita el servidor — ver §6. La recomendada es **Docker**: el contenedor lleva Node dentro, el servidor solo necesita Docker instalado. |

**Sobre licencias:** todas las dependencias son de licencia permisiva. No hay ninguna GPL de cumplimiento obligatorio ni ningún componente comercial que requiera licencia de pago:

- **MIT:** express, mssql, cors, helmet, express-rate-limit, exceljs, pdfmake, react, react-dom, vite
- **Apache-2.0:** @google/generative-ai, groq-sdk
- **BSD-2-Clause:** dotenv
- **MIT o GPL-3.0 (a elección del usuario):** jszip → se puede usar bajo MIT

El propio Node.js es MIT. **No hay coste de licencias ni obligación de liberar código.**

---

## 2. Arquitectura

```
┌────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Navegador    │  HTTPS  │  Servidor web    │         │                 │
│                │────────▶│  (IIS / Nginx)   │         │                 │
│  React SPA     │         │  sirve dist/     │         │                 │
└────────┬───────┘         └──────────────────┘         │                 │
         │                                              │                 │
         │  /api/*  + header X-API-Key  + cookie sid    │                 │
         │                                              │                 │
         ▼                                              │                 │
┌────────────────────────┐        TLS 1433              │   Azure SQL     │
│  Backend Node/Express  │─────────────────────────────▶│   Server        │
│  puerto 3002           │                              │                 │
│                        │                              └─────────────────┘
│  + data.json           │        HTTPS 443
│  + history.json        │───────▶ Gemini / OpenRouter / Groq  (opcional)
│  + archive/*.json      │
└────────────────────────┘
     ▲
     └── VOLUMEN PERSISTENTE OBLIGATORIO
```

### ⚠️ El backend NO sirve el frontend

Verificado en el código: **no existe `express.static` ni `sendFile` en `server.cjs`**. El comentario de `vite.config.js` que dice *"En producción Express sirve tanto la API como el frontend"* **está desactualizado y es incorrecto**.

**Consecuencia práctica:** el despliegue necesita obligatoriamente **dos cosas**: un servidor web para los estáticos **y** el proceso Node para la API. No se puede desplegar solo el backend y esperar que sirva la aplicación.

(Alternativa: añadir 3 líneas de `express.static` al backend para servir `dist/`. Es un cambio pequeño y simplificaría el despliegue a una sola pieza — pero hoy **no está hecho**.)

---

## 3. Stack tecnológico

### Backend — dependencias de producción (10)

| Paquete | Versión | Uso | Licencia |
|---|---|---|---|
| `express` | ^5.2.1 | Servidor HTTP. **Express 5**, no 4 — sintaxis de rutas distinta. | MIT |
| `mssql` | ^12.5.3 | Driver Azure SQL (tedious) | MIT |
| `cors` | ^2.8.6 | CORS con `credentials: true` | MIT |
| `helmet` | ^8.3.0 | Cabeceras de seguridad | MIT |
| `express-rate-limit` | ^8.6.1 | 4 limitadores de tasa | MIT |
| `dotenv` | ^17.4.2 | Carga de variables de entorno | BSD-2 |
| `exceljs` | ^4.4.0 | Exportación XLSX | MIT |
| `pdfmake` | ^0.3.11 | Exportación PDF | MIT |
| `@google/generative-ai` | ^0.24.1 | Cliente Gemini (opcional) | Apache-2.0 |
| `groq-sdk` | ^1.2.0 | Cliente Groq (opcional) | Apache-2.0 |

Sin `devDependencies`. Sin TypeScript, sin linter, sin framework de test externo (usa `node --test` nativo).

> **Atención con `pdfmake`:** lee las fuentes Roboto desde `node_modules/pdfmake/fonts/Roboto` en tiempo de ejecución (`reports/export-pdf.cjs:14`). **No funciona si se poda `node_modules` o se empaqueta con un bundler.** La exportación a PDF fallaría.

> **OpenRouter no tiene SDK:** se llama con el módulo `https` nativo (`gemini-report.cjs:5`).

### Frontend

| Paquete | Versión | Licencia |
|---|---|---|
| `react` / `react-dom` | ^19.2.4 | MIT |
| `jszip` | ^3.10.1 | MIT o GPL-3.0 (elegimos MIT) |
| `xlsx` (SheetJS) | 0.20.3 | Apache-2.0 |
| `vite` (build) | ^8.0.4 | MIT |

> **🔴 Problema para servidores sin internet:** `xlsx` **no se instala desde npm**, sino desde una URL de CDN:
> ```json
> "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
> ```
> Si la máquina que compila no tiene salida a `cdn.sheetjs.com`, `npm ci` falla. Ver §7 para las soluciones.

### Node.js

`package.json` declara `>=18.0.0`, pero el mínimo **real** es **Node 20**: el script de test usa globs (`tests/**/*.test.cjs`) que Node 18 no expande de forma fiable.

**Recomendación: Node 20 LTS o Node 22 LTS.** (El entorno de desarrollo actual usa Node 24.14.0.)

---

## 4. Variables de entorno

### Backend — 12 variables

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DB_USER` | **Sí** | Usuario Azure SQL |
| `DB_PASSWORD` | **Sí** | Contraseña |
| `DB_SERVER` | **Sí en prod** | Host SQL (por defecto `localhost`) |
| `DB_NAME` | **Sí** | Nombre de la base |
| `NODE_ENV` | **Sí en prod** | Con `production`: oculta detalles de error, exige `FRONTEND_URL` y `API_KEY`, activa `secure` en la cookie, oculta `/api/db-ping`, valida el certificado TLS de SQL |
| `API_KEY` | **Sí en prod** | Clave compartida en header `X-API-Key`. **Sin ella el proceso termina con `exit(1)`** |
| `FRONTEND_URL` | **Sí en prod** | Origen permitido por CORS. **Sin ella el proceso termina con `exit(1)`** |
| `PORT` | No | Puerto de escucha. **Por defecto 3002** |
| `HOME` | No | **No se configura, se detecta.** Si vale exactamente `/home`, los datos van a `/home/data` (heurística de Azure App Service Linux) |
| `GEMINI_API_KEY` | No | Proveedor de IA #1 |
| `OPENROUTER_API_KEY` | No | Proveedor de IA #2 (fallback) |
| `GROQ_API_KEY` | No | Proveedor de IA #3 (fallback) |

Si faltan las tres claves de IA, solo fallan 3 rutas (`/api/generate-report`, `/api/project-status`, `/api/generate-global-status`). El resto funciona con normalidad.

> **⚠️ El `.env` actual del repo define 8 variables pero NO define `NODE_ENV` ni `FRONTEND_URL`.** En producción, sin ellas, **el proceso no arranca**. Hay que añadirlas al entorno del servidor.
>
> **No existe `.env.example`** — conviene crearlo (ver §9).

### Frontend — 2 variables (en tiempo de compilación)

| Variable | Para qué |
|---|---|
| `VITE_API_URL` | URL base del backend. Vacío = mismo origen |
| `VITE_API_KEY` | Clave enviada en `X-API-Key` |

> **🔴 Riesgo de seguridad a tener en cuenta:** Vite **incrusta estas variables en el JavaScript compilado**. `VITE_API_KEY` queda visible para cualquiera que abra las herramientas de desarrollo del navegador. **No es un secreto real.**
>
> Esto no bloquea el despliegue —la protección real son las sesiones con cookie httpOnly y los roles— pero `API_KEY` debe entenderse como *"filtro contra tráfico automatizado"*, no como control de acceso. No reutilizar esa clave para nada más.

---

## 5. Base de datos

**Azure SQL Server**, conexión configurada en `db-operations.cjs:11-21`:

```
puerto:  1433 (hardcodeado, no configurable por variable de entorno)
encrypt: true (siempre)
trustServerCertificate: false en producción, true fuera
timeouts: 60 s conexión / 60 s consulta
pool:    máx. 20 conexiones, mín. 0
```

**Requisito de red:** salida **TCP 1433** hacia el servidor Azure SQL. Si Azure SQL tiene firewall, hay que **añadir la IP pública del servidor de aplicación a la lista de permitidos**.

### Migraciones

19 migraciones en `backend/migrations/` (857 líneas). Se aplican con:

```bash
npm run migrate
```

El runner (`run-migration.cjs`) mantiene una tabla de control, calcula un checksum SHA de cada archivo y aplica solo los pendientes en orden alfabético.

> **⚠️ Se ejecuta manualmente. NO corre en el arranque.** Hay que lanzarlo antes del primer inicio y después de cada despliegue que incluya migraciones nuevas.

---

## 6. Opciones de despliegue

### Opción A — Docker (recomendada)

**El servidor solo necesita Docker.** Node, npm y las dependencias van dentro de la imagen. Resuelve de raíz el problema de versiones y de "no quiero instalar nada".

`backend/Dockerfile` (crear):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "server.cjs"]
```

`docker-compose.yml` (crear en la raíz):

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "3002:3002"
    environment:
      NODE_ENV: production
      DB_SERVER: ${DB_SERVER}
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      API_KEY: ${API_KEY}
      FRONTEND_URL: ${FRONTEND_URL}
    volumes:
      - tracker-data:/app/data          # data.json + history.json
      - tracker-archive:/app/archive    # cierres trimestrales
    restart: unless-stopped

volumes:
  tracker-data:
  tracker-archive:
```

> Los **volúmenes no son opcionales** — ver §8.

El frontend compilado (`dist/`) se copia al servidor web, o se añade un segundo contenedor con Nginx.

### Opción B — Node instalado en el servidor

Requiere **Node 20 LTS** en la máquina.

```bash
cd backend
npm ci --omit=dev
npm run migrate          # solo la primera vez y tras migraciones nuevas
node scripts/create-user.cjs   # crear el primer administrador
NODE_ENV=production node server.cjs
```

Usar un gestor de procesos (**PM2**, `systemd` o **IIS + iisnode** en Windows) para que sobreviva a reinicios.

### Opción C — Azure App Service

El código ya tiene soporte parcial: `server.cjs:82` detecta `HOME=/home` y guarda los datos en `/home/data` (el único directorio persistente de App Service Linux).

> **⚠️ Pero está incompleto:** la carpeta `archive/` (cierres trimestrales) usa `__dirname`, **no** `/home/data`. En App Service ese directorio **no persiste** y los archivos de cierre trimestral se perderían en cada reinicio. Hay que corregirlo antes de usar esta opción.

### Comparación

| | Docker | Node nativo | App Service |
|---|---|---|---|
| Instalar en el servidor | Solo Docker | Node 20 | Nada |
| Control de versión de Node | **Total** | Depende del servidor | De Azure |
| Persistencia de datos | Volúmenes | Disco local | ⚠️ Requiere corrección |
| Recomendado | ✅ | ✔️ | Tras corregir `archive/` |

---

## 7. Compilar sin acceso a internet

Si la máquina que compila no tiene salida a internet, hay dos obstáculos:

**1. `xlsx` viene de un CDN, no de npm.** Soluciones, de mejor a peor:

- Publicar el paquete en un registro npm interno (Nexus, Artifactory, Azure Artifacts) y apuntar `package.json` ahí
- Descargar el `.tgz` una vez, guardarlo en el repo y referenciarlo por ruta: `"xlsx": "file:./vendor/xlsx-0.20.3.tgz"`
- Compilar en una máquina con internet y transferir solo `dist/`

**2. El resto de dependencias.** `npm ci` necesita alcanzar un registro. Con registro interno configurado (`.npmrc`) queda resuelto.

**La vía más simple:** compilar el frontend en una máquina con internet y desplegar **solo la carpeta `dist/`** (archivos estáticos, sin dependencias). Para el backend, construir la imagen Docker en esa misma máquina y transferirla con `docker save` / `docker load`.

---

## 8. ⚠️ El backend guarda estado en disco

**Este es el punto que más condiciona el despliegue.** El backend no es *stateless*: escribe cuatro cosas al sistema de archivos.

| Archivo | Contenido | Cuándo se escribe | Tamaño actual |
|---|---|---|---|
| `data.json` | Estado completo de proyectos | **En cada guardado** (autoguardado del frontend) | 4.119 líneas |
| `history.json` | Snapshots semanales acumulados | En cada cierre de semana | **38.106 líneas** |
| `archive/quarter_*.json` | Cierres trimestrales | En cada cierre de trimestre | 7.341 líneas |
| `DATA_DIR` | Se crea al arrancar | Arranque | — |

### Tres consecuencias que hay que aceptar o corregir

1. **Volumen persistente obligatorio.** En contenedores, sin volumen montado, **cada reinicio borra los datos**. Deben montarse *dos* rutas: `DATA_DIR` **y** `backend/archive` (son directorios distintos).

2. **Una sola instancia. No escala horizontalmente.** Dos procesos escribiendo el mismo `data.json` lo corromperían. **No poner un balanceador con varias réplicas** sin rediseñar antes la persistencia (mover todo a SQL).

3. **Recuperación parcial.** `server.cjs:249-268` reconstruye `data.json` desde SQL si falta o está corrupto — pero **pierde el catálogo de ingenieros** y **no reconstruye** `history.json` ni `archive/`. La copia de seguridad de esos archivos es responsabilidad de infraestructura.

---

## 9. Lista de verificación para el despliegue

### Antes

- [ ] Node 20 LTS disponible (o Docker)
- [ ] Salida de red TCP 1433 hacia Azure SQL
- [ ] IP del servidor añadida al firewall de Azure SQL
- [ ] Salida HTTPS 443 si se usan las funciones de IA (opcional)
- [ ] Volumen persistente para `DATA_DIR` y para `backend/archive`
- [ ] Resuelto el acceso al paquete `xlsx` (§7)

### Configuración

- [ ] Las 7 variables obligatorias definidas: `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_NAME`, `NODE_ENV=production`, `API_KEY`, `FRONTEND_URL`
- [ ] `FRONTEND_URL` apunta a la URL real del frontend (sin barra final)
- [ ] `VITE_API_URL` y `VITE_API_KEY` definidas **antes** de compilar el frontend
- [ ] `API_KEY` generada aleatoria y distinta de la de desarrollo

### Despliegue

- [ ] `npm ci --omit=dev` en backend
- [ ] `npm run migrate` (primera vez y tras migraciones nuevas)
- [ ] `node scripts/create-user.cjs` para crear el primer administrador
- [ ] `npm run build` en frontend → copiar `dist/` al servidor web
- [ ] Servidor web configurado con *fallback* a `index.html` (es una SPA)
- [ ] Gestor de procesos configurado (Docker `restart`, PM2 o systemd)

### Verificación

- [ ] `GET /api/db-ping` responde (solo fuera de producción)
- [ ] El inicio de sesión funciona y la cookie `sid` se guarda
- [ ] Se puede crear y guardar un proyecto
- [ ] Exportar a PDF y a Excel funciona (valida que `pdfmake` encuentre sus fuentes)
- [ ] Tras reiniciar el servicio, **los datos siguen ahí** (valida el volumen)

---

## 10. Puntos pendientes recomendados

Ninguno bloquea el despliegue, pero conviene resolverlos:

| # | Asunto | Impacto |
|---|---|---|
| 1 | **Crear `.env.example`** con las 12 variables documentadas | Alto — hoy no hay referencia de qué configurar |
| 2 | **Corregir la ruta de `archive/`** para que use `DATA_DIR` | Alto si se usa Azure App Service — se pierden los cierres trimestrales |
| 3 | Actualizar el comentario incorrecto de `vite.config.js` | Bajo — pero induce a error en el despliegue |
| 4 | Decidir si el backend sirve `dist/` (3 líneas de `express.static`) | Medio — simplificaría el despliegue a una sola pieza |
| 5 | Corregir el proxy de `vite.config.js` (apunta a 3002, el comentario dice 3001) | Bajo — solo afecta a desarrollo |
| 6 | Documentar la copia de seguridad de `history.json` y `archive/` | Alto — no son recuperables desde SQL |
| 7 | Revisar los `process.exit(1)` en entornos gestionados | Medio — el contenedor reinicia en bucle si falta una variable |

---

## 11. Referencia rápida

```
Backend
  Puerto:        3002 (variable PORT)
  Arranque:      node server.cjs
  Migraciones:   npm run migrate
  Primer admin:  node scripts/create-user.cjs
  Tests:         npm test
  Salida:        TCP 1433 (SQL) · TCP 443 (IA, opcional)

Frontend
  Compilar:      npm run build  →  dist/
  Desarrollo:    npm run dev    →  :5173 (proxy /api → :3002)
  Producción:    archivos estáticos, sin Node

Persistencia
  data.json, history.json  →  DATA_DIR
  archive/*.json           →  backend/archive   ← ruta distinta
```
