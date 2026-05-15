# Seguimiento Semanal de Proyectos — Oficina de Tecnología

Aplicación web para registrar y reportar el avance semanal de proyectos de ingeniería.
Desarrollada internamente por la Oficina de Tecnología de la Corte Suprema de Justicia.

---

## ¿Qué hace la aplicación?

- **Dashboard**: vista de tarjetas con el estado y avance de cada proyecto.
- **Editar**: formulario completo para cargar métricas, actividades, ingenieros, indicadores, impedimentos, fechas clave y comentarios de cada proyecto.
- **Reporte**: vista consolidada o por proyecto. Incluye botón "Copiar reporte" que genera un texto formateado listo para pegar en correo o Teams.
- **Nueva semana**: limpia los campos semanales (logros, plan, actividades de ingenieros) y guarda un snapshot en el historial antes de borrar.

---

## Estructura del proyecto

```
project_tracker_BD/
│
├── server.cjs              ← Servidor Express: API REST + sirve el frontend en producción
├── db-operations.cjs       ← Escritura en SQL Server (Azure). Fallo silencioso si la BD no responde
├── vite.config.js          ← Bundler: proxy /api → :3001 en desarrollo
├── .env                    ← Credenciales de BD (NO subir a git, está en .gitignore)
│
├── src/
│   ├── App.jsx             ← Componente raíz: estado global, navegación entre vistas, lógica de semana
│   ├── App.css             ← Todos los estilos de la aplicación (una sola hoja)
│   ├── index.css           ← Reset global y variables CSS (colores, fuentes, espaciados)
│   │
│   ├── components/
│   │   ├── Dashboard.jsx   ← Vista de tarjetas por proyecto
│   │   ├── EditView.jsx    ← Formulario de edición completo (el componente más grande)
│   │   ├── ReportView.jsx  ← Vista de reporte visual y botón de copia
│   │   ├── MetricsTable.jsx← Tablas de métricas reutilizables (Global, Compacta, Completa)
│   │   ├── MiniBar.jsx     ← Barra de progreso pequeña usada en tarjetas y reporte
│   │   └── ProgressRing.jsx← Anillo de progreso SVG del encabezado
│   │
│   └── utils/
│       ├── formulas.js     ← Toda la lógica de cálculo y generación del texto del reporte
│       └── storage.js      ← Persistencia: localStorage + llamadas a la API del servidor
│
├── public/
│   └── imagenes/
│       └── logo_institucional.png
│
├── deploy.sh               ← Script de despliegue para Azure App Service
└── .deployment             ← Le dice a Azure qué script ejecutar al hacer push
```

---

## Dónde hacer cada tipo de cambio

| Quiero cambiar… | Archivo |
|---|---|
| La fórmula de avance (cómo se calcula el %) | `src/utils/formulas.js` → `projectProgress()` |
| El texto del reporte que se copia | `src/utils/formulas.js` → `projectBlock()` y `generateReportText()` |
| Los campos de un proyecto nuevo (agregar campo) | `src/utils/formulas.js` → `createDefaultProject()` |
| Agregar o quitar un ingeniero de la lista | `src/components/EditView.jsx` → constante `ENGINEER_LIST` (línea ~17) |
| Los estados de proyecto (En curso, Bloqueado…) | `src/components/EditView.jsx` → constante `STATUS_OPTIONS` (línea ~10) |
| Los colores y estilos visuales | `src/App.css` y `src/index.css` |
| El logo o nombre en el encabezado | `src/App.jsx` → sección `<header>` |
| Las rutas de la API | `server.cjs` → secciones `app.get` / `app.post` |
| La conexión a la base de datos | `.env` (credenciales) + `db-operations.cjs` (lógica) |
| El puerto del servidor | `.env` → variable `PORT`, o `server.cjs` línea `const PORT` |

---

## Correr el proyecto localmente

### Requisitos
- Node.js 18 o superior → https://nodejs.org
- SQL Server local (opcional, la app funciona sin BD usando solo JSON)

### Instalación
```bash
npm install
```

### Modo desarrollo (frontend + backend separados)
```bash
# Terminal 1 — inicia el servidor Express en :3001
npm run server

# Terminal 2 — inicia Vite en :5173 con proxy a :3001
npm run dev
```
Abrir: `http://localhost:5173`

### Modo producción (un solo proceso)
```bash
npm run build        # compila el frontend a /dist
npm start            # sirve todo desde :3001
```
Abrir: `http://localhost:3001`

---

## Conexión a SQL Server / Azure SQL

Los datos se guardan **siempre** en `data.json` y `history.json`.
SQL Server es un destino adicional que recibe los mismos datos en paralelo.
Si la BD no está disponible, la app sigue funcionando con normalidad.

### Variables de entorno (archivo `.env`)
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

## Despliegue en Azure App Service

El archivo `.deployment` le indica a Azure que ejecute `deploy.sh` al recibir un push.
`deploy.sh` instala dependencias y compila el frontend automáticamente.

```bash
# Configurar el remote de Azure (solo una vez)
git remote add azure https://tu-app.scm.azurewebsites.net/tu-app.git

# Desplegar
git push azure main
```

Las variables de entorno (`DB_SERVER`, `DB_USER`, etc.) deben configurarse en:
**Azure Portal → App Service → Configuration → Application Settings**

---

## Fórmulas de avance

### Por proyecto
```
Avance = (Completadas + En_Proceso × 0.5) / Total × 100
```
Las tareas en proceso valen 0.5 porque están iniciadas pero no terminadas.
Para cambiar este peso, editar el `0.5` en `formulas.js → projectProgress()`.

### Avance global
```
Avance Global = Promedio de avance de todos los proyectos con tareas definidas
```
Los proyectos sin tareas (Total = 0) se excluyen del promedio.

---

## Flujo semanal de uso

1. **Lunes**: abrir la app, revisar que los datos de la semana anterior estén correctos.
2. **Durante la semana**: actualizar métricas, estado de actividades e impedimentos.
3. **Viernes**: activar "Sección de Cierre" en cada proyecto → llenar logros y plan de próxima semana.
4. **Al cerrar la semana**: botón **"💾 Guardar reporte"** → guarda snapshot en historial.
5. **Inicio nueva semana**: botón **"↻ Nueva semana"** → limpia campos semanales y avanza la fecha.
6. **Compartir**: pestaña **Reporte** → **"Copiar reporte ✎"** → pegar en correo o Teams.
