# 📊 Project Tracker — Seguimiento Semanal de Proyectos

## ¿Qué necesitas instalado?

1. **Node.js** (versión 18 o superior) → https://nodejs.org
2. **VS Code** → https://code.visualstudio.com
3. **Git** (opcional) → https://git-scm.com

## Paso a paso para correrlo

### 1. Abre la terminal en VS Code (Ctrl + `)

### 2. Crea el proyecto React con Vite
```bash
npm create vite@latest project-tracker -- --template react
cd project-tracker
```

### 3. Instala dependencias
```bash
npm install
```

### 4. Reemplaza los archivos
Copia los archivos que te entrego en este paquete:

- `src/App.jsx` → reemplaza el que ya existe
- `src/App.css` → reemplaza el que ya existe
- `src/components/ProgressRing.jsx` → crea la carpeta components y pon este archivo
- `src/components/MiniBar.jsx` → mismo lugar
- `src/components/Dashboard.jsx` → mismo lugar
- `src/components/EditView.jsx` → mismo lugar
- `src/components/ReportView.jsx` → mismo lugar
- `src/utils/formulas.js` → crea la carpeta utils y pon este archivo
- `src/utils/storage.js` → mismo lugar
- `src/index.css` → reemplaza el que ya existe

### 5. Corre el proyecto con guardado local
Para que la información se guarde en un archivo real (`data.json`) en tu carpeta:

1.  **Abre dos terminales** o usa este comando:
    ```bash
    npm run server
    ```
    (Esto inicia el backend en el puerto 3001)
2.  **En otra terminal**, inicia la interfaz:
    ```bash
    npm run dev
    ```

### 6. Para uso en servidor (On-Premise)
Si lo vas a dejar fijo en un servidor para que otros lo vean:
1.  Genera el build: `npm run build`
2.  Ejecuta: `npm start`
    Esto servirá la aplicación y guardará todo en `data.json` automáticamente.

---

## 📐 Fórmulas de cumplimiento

### Por proyecto:
```
% Avance = (Actividades Completadas / Total Actividades) × 100
```

### Avance global (ponderado por peso del proyecto):
```
% Global = Σ(Completadas_i) / Σ(Total_i) × 100
```
Donde i = cada proyecto. Esto significa que un proyecto con 100 actividades
pesa más que uno con 10, lo cual refleja mejor el esfuerzo real.

### Velocidad semanal:
```
Velocidad = Actividades completadas esta semana / Total en proceso
```

### Índice de salud:
```
Salud = (Completadas / (Completadas + En Proceso + Pendientes)) × 100
Pendientes = Total - Completadas - En Proceso
```

---

## 🗂 Estructura del proyecto

```
project-tracker/
├── src/
│   ├── components/
│   │   ├── ProgressRing.jsx
│   │   ├── MiniBar.jsx
│   │   ├── Dashboard.jsx
│   │   ├── EditView.jsx
│   │   └── ReportView.jsx
│   ├── utils/
│   │   ├── formulas.js      ← Todas las fórmulas aquí
│   │   └── storage.js       ← Persistencia en localStorage
│   ├── App.jsx               ← Componente principal
│   ├── App.css               ← Estilos de la app
│   └── index.css             ← Reset y fuentes
├── package.json
└── README.md
```

---

## 🔄 ¿Cómo llenar los datos semana a semana?

1. Abre la app → pestaña **"Editar"**
2. Selecciona un proyecto (o crea uno nuevo con "+ Nuevo")
3. Llena los campos:
   - **Total actividades**: cuántas actividades tiene el proyecto en total
   - **Completadas**: cuántas ya terminaste
   - **En proceso**: cuántas estás trabajando actualmente
   - **Logros de la semana**: qué avanzaste (texto libre)
   - **Planeado próxima semana**: qué esperas terminar
   - **Pendientes/Bloqueantes**: qué está frenando el avance
   - **Fechas clave**: hitos, entregas, deadlines
4. Los datos se guardan automáticamente en tu navegador
5. Al final de la semana: pestaña **"Reporte"** → **"Copiar reporte"**
6. Para empezar nueva semana: botón **"↻ Nueva semana"**
   (limpia los campos semanales pero conserva actividades acumuladas)
