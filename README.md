# Seguimiento Semanal de Proyectos — Oficina de Tecnología

Aplicación web para registrar y reportar el avance semanal de proyectos de ingeniería.
Desarrollada internamente por la Oficina de Tecnología de la Corte Suprema de Justicia.

---

## ¿Qué hace la aplicación?

- **Dashboard**: vista de tarjetas con el estado y avance de cada proyecto.
- **Editar**: formulario completo para cargar métricas, actividades, ingenieros, indicadores, impedimentos, fechas clave y comentarios de cada proyecto.
- **Reporte**: vista consolidada o por proyecto. Incluye botón "Copiar reporte" que genera un texto formateado listo para pegar en correo o Teams.
- **Nueva semana**: limpia los campos semanales y guarda un snapshot en el historial antes de borrar.

---

## Estructura del proyecto

```
project_tracker_BD/
│
├── backend/                        ← Servidor Node.js + conexión a BD
│   ├── server.cjs                  ← API REST + sirve el frontend en producción
│   ├── db-operations.cjs           ← Escritura en Azure SQL Server
│   ├── data.json                   ← Estado actual de proyectos (ignorado en git)
│   ├── history.json                ← Historial de snapshots semanales (ignorado en git)
│   ├── .env                        ← Credenciales de BD (ignorado en git)
│   └── package.json                ← Dependencias: express, mssql, cors, dotenv
│
├── frontend/                       ← Aplicación React
│   ├── src/
│   │   ├── App.jsx                 ← Componente raíz: estado global y navegación
│   │   ├── App.css                 ← Todos los estilos de la aplicación
│   │   ├── index.css               ← Reset global y variables CSS
│   │   ├── components/
│   │   │   ├── Dashboard.jsx       ← Vista de tarjetas por proyecto
│   │   │   ├── EditView.jsx        ← Formulario de edición completo
│   │   │   ├── ReportView.jsx      ← Vista de reporte y botón de copia
│   │   │   ├── MetricsTable.jsx    ← Tablas de métricas reutilizables
│   │   │   ├── MiniBar.jsx         ← Barra de progreso pequeña
│   │   │   └── ProgressRing.jsx    ← Anillo de progreso SVG
│   │   └── utils/
│   │       ├── formulas.js         ← Lógica de cálculo y texto del reporte
│   │       └── storage.js          ← Persistencia: localStorage + API
│   ├── public/
│   ├── imagenes/
│   ├── index.html
│   ├── vite.config.js              ← Bundler: proxy /api → :3001 en desarrollo
│   ├── eslint.config.js
│   └── package.json                ← Dependencias: react, vite, eslint
│
├── .gitignore
├── .deployment                     ← Le dice a Azure qué script ejecutar
├── deploy.sh                       ← Script de despliegue para Azure App Service
└── README.md
```

---

## Dónde hacer cada tipo de cambio

| Quiero cambiar… | Archivo |
|---|---|
| La fórmula de avance (cómo se calcula el %) | `frontend/src/utils/formulas.js` → `projectProgress()` |
| El texto del reporte que se copia | `frontend/src/utils/formulas.js` → `projectBlock()` |
| Los campos de un proyecto nuevo | `frontend/src/utils/formulas.js` → `createDefaultProject()` |
| Agregar o quitar un ingeniero de la lista | `frontend/src/components/EditView.jsx` → constante `ENGINEER_LIST` |
| Los estados de proyecto (En curso, Bloqueado…) | `frontend/src/components/EditView.jsx` → constante `STATUS_OPTIONS` |
| Los colores y estilos visuales | `frontend/src/App.css` y `frontend/src/index.css` |
| El logo o nombre en el encabezado | `frontend/src/App.jsx` → sección `<header>` |
| Las rutas de la API | `backend/server.cjs` → secciones `app.get` / `app.post` |
| La conexión a la base de datos | `backend/.env` (credenciales) + `backend/db-operations.cjs` (lógica) |
| El puerto del servidor | `backend/.env` → variable `PORT` |

---

## Correr el proyecto localmente

### Instalación (primera vez)

```bash
# Instalar dependencias del backend
cd backend
npm install

# Instalar dependencias del frontend
cd ../frontend
npm install
```

### Modo desarrollo (dos terminales)

```bash
# Terminal 1 — desde la carpeta backend/
cd backend
npm run server
# → Express arranca en http://localhost:3001

# Terminal 2 — desde la carpeta frontend/
cd frontend
npm run dev
# → Vite arranca en http://localhost:5173
```

Abrir en el navegador: `http://localhost:5173`

Las llamadas a `/api/*` se redirigen automáticamente a `:3001` gracias al proxy de Vite.

### Modo producción (un solo proceso)

```bash
# Desde la carpeta frontend/
cd frontend
npm run build
# → Genera frontend/dist/

# Desde la carpeta backend/
cd backend
npm start
# → Sirve la app completa en http://localhost:3001
```

---

## Conexión a SQL Server / Azure SQL

Los datos se guardan **siempre** en `backend/data.json` y `backend/history.json`.
Azure SQL es un destino adicional en paralelo. Si la BD no responde, la app sigue funcionando.

### Archivo `backend/.env`
```env
DB_SERVER=tu-servidor.database.windows.net
DB_USER=project_tracker
DB_PASSWORD=TuContraseñaFuerte
DB_NAME=DB_SeguimientoProyectos
```

### Diferencia local vs Azure SQL
| Configuración | SQL Server local | Azure SQL |
|---|---|---|
| `DB_SERVER` | `localhost` | `xxx.database.windows.net` |
| `encrypt` en db-operations.cjs | `false` | `true` (ya configurado) |
| Firewall | No aplica | Agregar tu IP en el portal de Azure |

---

## Fórmulas de avance

### Por proyecto
```
Avance = (Completadas + En_Proceso × 0.5) / Total × 100
```
Las tareas en proceso valen 0.5 porque están iniciadas pero no terminadas.
Para cambiar este peso, editar el `0.5` en `frontend/src/utils/formulas.js → projectProgress()`.

### Avance global
```
Avance Global = Promedio de avance de todos los proyectos con tareas definidas
```
Los proyectos sin tareas (Total = 0) se excluyen del promedio.

---

## Flujo semanal de uso

1. **Durante la semana**: actualizar métricas, estado de actividades e impedimentos.
2. **Viernes**: activar "Sección de Cierre" → llenar logros y plan de próxima semana.
3. **Al cerrar**: botón **"💾 Guardar reporte"** → guarda snapshot en historial.
4. **Inicio nueva semana**: botón **"↻ Nueva semana"** → limpia campos semanales y avanza la fecha.
5. **Compartir**: pestaña **Reporte** → **"Copiar reporte ✎"** → pegar en correo o Teams.
