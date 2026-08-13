# Project Tracker — Frontend

SPA en React para el seguimiento semanal de proyectos: Dashboard, Gantt, Planificación jerárquica, Kanban de estados, Mi semana (por ingeniero), reportes e informes con IA.

## Stack

- **React 19** + **Vite** (build tool)
- CSS plano por módulo (`src/styles/*.css`), sin framework de utilidades
- **xlsx** (SheetJS) / **jszip** — importar/exportar Excel
- **html2canvas** — exportar el Gantt como imagen

## Requisitos

- Node 20 LTS
- El backend corriendo (local en `:3002`, o la URL que apunte `VITE_API_URL`)

> ⚠️ `xlsx` no se instala desde npm, sino desde una URL de CDN (`https://cdn.sheetjs.com/...`). Si la máquina que compila no tiene salida a internet, `npm ci` falla — ver `../GUIA_DESPLIEGUE_DOCKER.md` §7 para las alternativas (paquete interno, `.tgz` vendorizado, o compilar en otra máquina y copiar solo `dist/`).

## Variables de entorno

Se leen **en tiempo de compilación** (`npm run build`), no en runtime — hay que definirlas antes de compilar, no después. Crear `.env` en esta carpeta (ver `.env.example` si existe, o crearlo a mano):

| Variable | Para qué |
|---|---|
| `VITE_API_URL` | URL base del backend (ej. `http://localhost:3002`). Vacío = mismo origen (así funciona detrás del proxy de Nginx en producción, ver `../frontend/nginx.conf`) |
| `VITE_API_KEY` | Debe coincidir con `API_KEY` del backend — se envía en el header `X-API-Key` de cada request |

> ⚠️ Vite **incrusta** estas variables en el JavaScript compilado — `VITE_API_KEY` queda visible para cualquiera que abra las herramientas de desarrollo del navegador. No es un secreto real, es solo un filtro contra tráfico automatizado; la autorización real son las sesiones con cookie `httpOnly` y el rol de administrador. No reutilizar esa clave para nada más.

## Desarrollo local

```bash
npm ci
npm run dev     # :5173, con proxy /api → :3002 (ver vite.config.js)
```

## Build de producción

```bash
npm run build   # genera dist/ — archivos estáticos, sin dependencia de Node en el servidor
npm run preview # sirve dist/ localmente para probar el build
```

`dist/` se puede servir con cualquier servidor de estáticos (Nginx, Apache, IIS, Azure Static Web Apps) con *fallback* a `index.html` (es una SPA).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con hot-reload |
| `npm run build` | Build de producción → `dist/` |
| `npm run preview` | Sirve el build localmente |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios (`node --test src/**/*.test.js`) |

## Estructura

```
src/components/   — componentes de UI, organizados por vista/dominio
src/utils/        — lógica pura (fechas, jerarquía de actividades, reportes…), testeada aparte de React
src/styles/       — CSS por módulo, tokens de diseño (claro/oscuro) en base.css
```

## Despliegue con Docker

Este repo trae su propio `Dockerfile` (build en dos etapas: compila con Node, sirve con Nginx) y `docker-compose.yml`. El backend vive en un repo aparte (`project_tracker_backend`) — ambos se conectan por una red externa compartida (`tracker-net`), y Nginx le habla al backend por nombre de contenedor, sin exponerlo a internet.

### HTTPS (obligatorio)

La cookie de sesión del backend exige HTTPS en producción — sin esto el login no se guarda. Generar un certificado (autofirmado sirve para uso interno):

```bash
mkdir -p certs
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=<IP-o-dominio-del-servidor>"
```

### Levantar

```bash
# Una sola vez en el servidor, antes de levantar cualquiera de los dos repos:
docker network create tracker-net    # (se salta si ya se creó desde el repo del backend)

cp .env.example .env    # VITE_API_KEY debe coincidir con API_KEY del backend
docker compose up -d --build
```

El backend (`project_tracker_backend`) debe estar corriendo en la misma red para que `/api/*` funcione — ver su README.
