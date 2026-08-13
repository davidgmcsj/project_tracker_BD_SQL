# Variables de entorno — Project Tracker (front + back)

Referencia unificada para configurar los `.env` de los dos repos al desplegar
(`project_tracker_front` y `project_tracker_backend`, ambos con su propio
Docker). Cada repo ya trae su `.env.example` — este documento explica **qué
significa cada variable, cómo deben coincidir entre repos, y la diferencia
entre desarrollo local y Docker**, que no es evidente solo mirando los
`.env.example` por separado.

> Ningún `.env` real se sube nunca al repositorio (ambos `.gitignore` ya lo
> excluyen). Este archivo no contiene ningún secreto — solo nombres de
> variable y explicación.

---

## 1. Backend — `project_tracker_backend/.env`

Copiar `.env.example` a `.env` en la raíz del repo del backend y completar:

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DB_SERVER` | Sí | Host de Azure SQL / SQL Server |
| `DB_NAME` | Sí | Nombre de la base de datos |
| `DB_USER` | Sí | Usuario de conexión |
| `DB_PASSWORD` | Sí | Contraseña — si contiene `#`, va entre comillas en el `.env` |
| `API_KEY` | Sí en producción | Clave compartida exigida en el header `X-API-Key` de todo `/api/*`. **Debe ser idéntica** a la del frontend (ver sección 3). Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | Sí en producción | Origen exacto permitido por CORS: `https://<dominio-o-ip>` (sin barra final) |
| `NODE_ENV` | Sí en producción | `production` activa: cookies `secure`, validación de certificado TLS de SQL, exige `API_KEY`/`FRONTEND_URL` (el proceso hace `exit(1)` si faltan) |
| `PORT` | No (default `3002`) | Puerto de escucha |
| `GEMINI_API_KEY` | No | Proveedor de IA #1 |
| `OPENROUTER_API_KEY` | No | Proveedor de IA #2 (fallback si Gemini falla) |
| `GROQ_API_KEY` | No | Proveedor de IA #3 (fallback final) |

Sin las tres claves de IA, la aplicación funciona con normalidad — solo
quedan inactivas las 3 rutas de generación de informes/estado con IA.

**Runtime, no build**: el backend lee estas variables al arrancar el
proceso (`node server.cjs`). Cambiar el `.env` requiere reiniciar el
contenedor/proceso.

---

## 2. Frontend — `project_tracker_front/.env`

Copiar `.env.example` a `.env` en la raíz del repo del frontend.

| Variable | Para qué |
|---|---|
| `VITE_API_URL` | URL base del backend. **Vacío** en producción con Docker (Nginx hace de proxy interno hacia `/api/*` en el mismo origen — ver `nginx.conf`, así el navegador nunca ve una URL de backend distinta y no hay problema de CORS) |
| `VITE_API_KEY` | Debe ser idéntica a `API_KEY` del backend — se envía en el header `X-API-Key` de cada request |

> ⚠️ Vite **incrusta** estas variables en el JavaScript compilado —
> `VITE_API_KEY` queda visible para cualquiera que abra las herramientas de
> desarrollo del navegador. No es un secreto real: es un filtro contra
> tráfico automatizado, no control de acceso — la autorización real la dan
> las sesiones con cookie `httpOnly` y el rol de administrador. No
> reutilizar esa clave para nada más sensible.

**Build time, no runtime**: a diferencia del backend, el frontend lee estas
variables **al compilar** (`npm run build`), no al servir los archivos ya
compilados. Cambiar el `.env` después de un build no tiene efecto — hay que
recompilar (o, en Docker, `docker compose up -d --build` de nuevo).

---

## 3. La clave compartida: `API_KEY` = `VITE_API_KEY`

Ambos repos deben tener el **mismo valor** de clave, aunque la variable se
llame distinto en cada `.env`:

```
project_tracker_backend/.env   →  API_KEY=abc123...
project_tracker_front/.env     →  VITE_API_KEY=abc123...   (mismo valor)
```

Si no coinciden, todas las peticiones del frontend al backend responden
`401` (el middleware `requireApiKey` las rechaza antes de llegar a
cualquier ruta).

Generar un valor nuevo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. ⚠️ Caso especial: variable de entorno del `.env` en Docker (frontend)

Este es el punto que más confunde al desplegar y **no es evidente leyendo
solo el `.env.example`**:

- En **desarrollo local** (`npm run dev`), Vite lee `VITE_API_KEY`
  directamente del `.env` — tal como dice `.env.example`.
- En **Docker** (`docker compose up -d --build`), `docker-compose.yml` del
  frontend hace esto:

  ```yaml
  build:
    args:
      VITE_API_KEY: ${API_KEY}
  ```

  Es decir: Docker Compose lee la variable **`API_KEY`** del `.env` que
  está junto al `docker-compose.yml` (no `VITE_API_KEY`), y la renombra
  internamente al construir la imagen.

**Consecuencia práctica**: si vas a desplegar el frontend con Docker, el
`.env` de `project_tracker_front/` debe contener la variable llamada
`API_KEY` (no `VITE_API_KEY`), con el mismo valor que la del backend:

```bash
# project_tracker_front/.env — para Docker
API_KEY=abc123...          # ← así, no VITE_API_KEY, aunque .env.example diga lo otro
VITE_API_URL=
```

Si copias `.env.example` tal cual sin este ajuste, `${API_KEY}` queda
vacío en el build y el frontend compila sin clave — todas las peticiones al
backend fallarán con `401`.

---

## 5. Checklist de despliegue con Docker

```bash
# Una sola vez en el servidor, antes de levantar cualquiera de los dos repos
docker network create tracker-net
```

**Backend** (`project_tracker_backend/`):
```bash
cp .env.example .env
# completar DB_*, API_KEY, FRONTEND_URL, (IA opcional)
npm run migrate            # si es la primera vez o hay migraciones nuevas
docker compose up -d --build
```

**Frontend** (`project_tracker_front/`):
```bash
cp .env.example .env
# ⚠️ renombrar VITE_API_KEY → API_KEY (ver sección 4), mismo valor que el backend
mkdir -p certs
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=<IP-o-dominio-del-servidor>"
docker compose up -d --build
```

El orden entre backend y frontend no importa — ambos se conectan por la red
externa compartida `tracker-net` una vez que existe.

---

## 6. Resumen rápido (todas las variables)

| Variable | Repo | Secreto real | Notas |
|---|---|---|---|
| `DB_SERVER` | backend | Sí | — |
| `DB_NAME` | backend | No | — |
| `DB_USER` | backend | Sí | — |
| `DB_PASSWORD` | backend | Sí | comillas si contiene `#` |
| `API_KEY` | backend | Parcial | debe coincidir con el del frontend |
| `FRONTEND_URL` | backend | No | origen exacto, sin barra final |
| `NODE_ENV` | backend | No | `production` en despliegue real |
| `PORT` | backend | No | default `3002` |
| `GEMINI_API_KEY` | backend | Sí | opcional |
| `OPENROUTER_API_KEY` | backend | Sí | opcional |
| `GROQ_API_KEY` | backend | Sí | opcional |
| `VITE_API_URL` | frontend | No | vacío en Docker |
| `VITE_API_KEY` (dev) / `API_KEY` (Docker) | frontend | No (incrustado en el bundle) | mismo valor que `API_KEY` del backend |
