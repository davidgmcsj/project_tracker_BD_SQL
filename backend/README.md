# Project Tracker — Backend

API REST en Node.js/Express para el seguimiento semanal de proyectos. Sirve `/api/*`, persiste el estado en `data.json`/`history.json` (con Azure SQL Server como base de datos real) y expone autenticación por sesión + control de acceso por rol.

## Stack

- **Node.js 20 LTS** (mínimo real — el runner de tests usa globs que Node 18 no expande de forma fiable) + **Express 5**
- **mssql** — driver de Azure SQL Server
- **helmet**, **cors**, **express-rate-limit** — cabeceras de seguridad, CORS y límites de tasa
- **exceljs**, **pdfmake** — exportación a Excel/PDF
- **@google/generative-ai**, **groq-sdk** — proveedores de IA opcionales (OpenRouter se llama con `https` nativo, sin SDK)

## Requisitos

- Node 20 LTS (o Docker — ver `../docker-compose.yml` y `../GUIA_DESPLIEGUE_DOCKER.md`)
- Acceso de red saliente TCP 1433 hacia el Azure SQL Server configurado
- La IP del servidor debe estar en la lista blanca del firewall de Azure SQL

## Variables de entorno

Copiar `.env.example` a `.env` y completar. Reinicia el proceso tras cualquier cambio (se leen una sola vez al arrancar).

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DB_USER` | Sí | Usuario de Azure SQL |
| `DB_PASSWORD` | Sí | Contraseña |
| `DB_SERVER` | Sí en producción (default `localhost`) | Host de SQL Server |
| `DB_NAME` | Sí | Nombre de la base de datos |
| `NODE_ENV` | Sí en producción | Con `production`: oculta detalles de error, exige `FRONTEND_URL`/`API_KEY`, cookie `secure`, valida certificado TLS de SQL |
| `API_KEY` | Sí en producción | Clave compartida exigida en el header `X-API-Key` de todo `/api/*`. Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Sin ella en producción, el proceso hace `exit(1)` |
| `FRONTEND_URL` | Sí en producción | Origen exacto permitido por CORS (protocolo + host, sin barra final). Sin ella en producción, el proceso hace `exit(1)` |
| `PORT` | No (default `3002`) | Puerto de escucha |
| `GEMINI_API_KEY` | No | Proveedor de IA #1 (`/api/generate-report`, `/api/project-status`, `/api/generate-global-status`) |
| `OPENROUTER_API_KEY` | No | Proveedor de IA #2 (fallback) |
| `GROQ_API_KEY` | No | Proveedor de IA #3 (fallback) |

Sin las tres claves de IA, la app funciona con normalidad — solo fallan esas 3 rutas.

> `API_KEY` no es un secreto de verdad: el frontend la incrusta en su bundle (`VITE_API_KEY`, visible en las herramientas de desarrollo del navegador). Es un filtro contra tráfico automatizado, no control de acceso — eso lo hacen las sesiones con cookie `httpOnly` y el rol de admin.

## Desarrollo local

```bash
npm ci
cp .env  # (o crear .env a mano con las variables de arriba)
npm run migrate            # aplica las migraciones pendientes
node scripts/create-user.cjs   # crea el primer administrador
npm start                  # arranca en :3002 (o npm run dev si existe hot-reload)
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` / `npm run server` | Arranca el servidor (`node server.cjs`) |
| `npm run migrate` | Aplica migraciones pendientes de `migrations/` |
| `npm test` | Corre los tests de contrato (`node --test tests/**/*.test.cjs`) |
| `npm run kill-port` | Windows: mata el proceso que ocupa el puerto 3002 |
| `npm run fresh` | Windows: `kill-port` + arrancar de nuevo |

## Estructura

```
routes/       — un router por dominio (projects, engineers, quarters, users, auth…)
middleware/   — API key, sesión, rate limiting, logging de seguridad
db/           — acceso a Azure SQL por entidad
lib/          — utilidades compartidas (json-store, bootstrap)
migrations/   — SQL versionado, aplicado por run-migration.cjs
tests/        — tests de contrato HTTP (node:test)
```

## Despliegue con Docker

Este repo trae su propio `Dockerfile` y `docker-compose.yml` — el frontend vive en un repo aparte (`project_tracker_front`) con el suyo. Ambos se conectan por una red externa compartida, así el frontend le habla a este contenedor sin exponer el puerto 3002 a internet.

```bash
# Una sola vez en el servidor, antes de levantar cualquiera de los dos repos:
docker network create tracker-net

# En este repo:
cp .env.example .env    # rellenar con las credenciales reales
docker compose up -d --build

# Primera vez / tras migraciones nuevas:
docker compose exec backend npm run migrate
docker compose exec backend node scripts/create-user.cjs
```

Luego, en el repo `project_tracker_front`, su propio `docker compose up -d --build` (ver su README).
