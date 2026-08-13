# Guía de despliegue en producción con Docker

Guía paso a paso para desplegar Project Tracker en un servidor, con qué
hacer cuando cambies código y qué pasa con los datos que ya existen.

Archivos que la acompañan (ya creados en el repo):

```
backend/Dockerfile
frontend/Dockerfile
frontend/nginx.conf
docker-compose.yml
.env.example
```

---

## 0. Qué necesita el servidor

- **Docker** y **Docker Compose** instalados (nada más — ni Node, ni npm).
- Salida de red **TCP 1433** hacia tu Azure SQL Server.
- La **IP pública/interna del servidor** añadida al firewall de Azure SQL.
- Puertos **80** y **443** libres (los usa Nginx).

---

## 1. Primer despliegue

### 1.1 Llevar el código al servidor

```bash
git clone <tu-repo> project-tracker
cd project-tracker
```

(O copiar la carpeta si no usas git en el servidor.)

### 1.2 Configurar las variables de entorno

```bash
cp .env.example .env
nano .env   # rellenar DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD, API_KEY, FRONTEND_URL
```

- `API_KEY`: generar una nueva, **distinta** de la de desarrollo:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `FRONTEND_URL`: la URL exacta que va a usar el equipo, ej. `https://192.168.1.50`
  (sin barra final). Tiene que coincidir con la IP/dominio del paso 1.3.

### 1.3 Generar el certificado HTTPS

Es **obligatorio**, no opcional: la cookie de sesión se marca `secure` en
producción, y sin HTTPS el navegador la descarta — el login parecería
funcionar pero la sesión no se guardaría.

Para un servidor interno, un certificado autofirmado es suficiente (el
navegador mostrará una advertencia la primera vez; el equipo la acepta y no
vuelve a salir):

```bash
mkdir -p certs
openssl req -x509 -nodes -days 825 \
  -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/CN=192.168.1.50"   # cambiar por la IP o dominio real del servidor
```

Si más adelante tienes un dominio real, reemplaza estos dos archivos por un
certificado de Let's Encrypt (Certbot) sin tocar nada más.

### 1.4 Traer los datos que ya existen (ver sección 3 para el detalle)

Antes de levantar los contenedores por primera vez, copia tus `data.json` e
`history.json` actuales al volumen. La forma más simple es hacerlo **después**
del primer arranque (sección 3.2) — sáltate esto por ahora si es tu primera
vez y ve a 1.5.

### 1.5 Levantar todo

```bash
docker compose up -d --build
```

Esto construye las dos imágenes (backend y frontend) y las deja corriendo.
Verifica con:

```bash
docker compose ps
docker compose logs -f
```

### 1.6 Migraciones y primer usuario

Se ejecutan **una sola vez** (no corren solas al arrancar, a propósito — ver
`INFRAESTRUCTURA_Y_DESPLIEGUE.md` §5):

```bash
docker compose exec backend npm run migrate
docker compose exec backend node scripts/create-user.cjs
```

`create-user.cjs` te pedirá usuario/contraseña para el primer administrador
de forma interactiva.

### 1.7 Probar

Desde un navegador, entra a `https://<IP-del-servidor>`, acepta la advertencia
del certificado autofirmado, e inicia sesión con el usuario que acabas de
crear. Verifica que puedas crear/guardar un proyecto y que, tras
`docker compose restart backend`, los datos sigan ahí.

Ya está: comparte la URL con el equipo (`https://<IP>`) y cada uno entra
desde su navegador. Nadie más instala nada.

---

## 2. Cuando le hagas cambios a la aplicación

Flujo normal para actualizar el servidor tras modificar código:

```bash
git pull                              # o copiar los archivos nuevos
docker compose up -d --build          # reconstruye solo lo que cambió
```

Esto **no borra los datos** — los volúmenes (`tracker-data`, `tracker-archive`)
son independientes de los contenedores y sobreviven a rebuilds y reinicios.

**Si el cambio incluye una migración nueva** (archivo nuevo en
`backend/migrations/`):

```bash
docker compose exec backend npm run migrate
```

El runner lleva su propio control de qué ya se aplicó — es seguro correrlo
siempre que actualices, aunque no haya migraciones nuevas (no hace nada si no
hay pendientes).

**Regla que ya está documentada en el proyecto y conviene recordar:** no
levantes una segunda réplica del backend (`docker compose up --scale
backend=2`) sin antes rediseñar la persistencia — dos procesos escribiendo el
mismo `data.json` a la vez lo corromperían. Una sola instancia, tal como está
este `docker-compose.yml`, es lo correcto para este proyecto.

---

## 3. Qué pasa con la información que ya tienes creada

Tienes datos en dos sitios distintos, y se comportan distinto:

### 3.1 Lo que está en Azure SQL

**No pasa nada, no hay que migrar nada.** La base de datos ya es externa y
sigue siendo la misma — el contenedor solo se conecta a ella con las
credenciales del `.env`. Todos los proyectos, actividades e ingenieros que
ya existen en SQL aparecerán automáticamente en cuanto el equipo entre.

### 3.2 Lo que está en archivos locales (`data.json`, `history.json`, `archive/`)

Esto **sí hay que trasladarlo a mano**, porque hoy vive en tu máquina de
desarrollo, no en SQL. Son:

- `backend/data.json` — estado en caché de proyectos (se reconstruye desde
  SQL si falta, pero **se pierde el catálogo de ingenieros**).
- `backend/history.json` — snapshots semanales acumulados. **No es
  recuperable desde SQL si se pierde.**
- `backend/archive/quarter_*.json` — cierres trimestrales. **Tampoco
  recuperable desde SQL.**

Pasos para llevarlos al servidor **después** del primer `docker compose up -d`
(los volúmenes ya existen en ese punto):

```bash
# Desde tu máquina de desarrollo, copia los archivos al servidor:
scp backend/data.json backend/history.json usuario@servidor:/tmp/
scp -r backend/archive usuario@servidor:/tmp/archive

# En el servidor, cópialos dentro de los volúmenes:
docker cp /tmp/data.json     project-tracker-backend-1:/home/data/data.json
docker cp /tmp/history.json  project-tracker-backend-1:/home/data/history.json
docker cp /tmp/archive/.     project-tracker-backend-1:/app/archive

docker compose restart backend
```

(El nombre exacto del contenedor puede variar — confírmalo con
`docker compose ps`.)

Hazlo **antes** de que el equipo empiece a usar la app en el servidor, para
no tener dos historiales distintos (uno en tu máquina, otro en el servidor).
A partir de ahí, el servidor es la única fuente de verdad — deja de guardar
en tu máquina local.

### 3.3 Backups a partir de ahora

`history.json` y `archive/*.json` no tienen copia de respaldo en SQL. Vale la
pena programar algo simple en el servidor, por ejemplo un cron diario:

```bash
docker cp project-tracker-backend-1:/home/data/history.json ./backups/history-$(date +%F).json
```

O, más simple, hacer un `docker run --rm -v tracker-data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/data-$(date +%F).tar.gz -C /data .` periódico.

---

## 4. Resumen de comandos frecuentes

| Acción | Comando |
|---|---|
| Levantar / actualizar | `docker compose up -d --build` |
| Ver logs | `docker compose logs -f backend` |
| Aplicar migraciones | `docker compose exec backend npm run migrate` |
| Crear un usuario | `docker compose exec backend node scripts/create-user.cjs` |
| Reiniciar solo el backend | `docker compose restart backend` |
| Apagar todo (sin borrar datos) | `docker compose down` |
| Ver dónde están los volúmenes | `docker volume inspect project-tracker_tracker-data` |
