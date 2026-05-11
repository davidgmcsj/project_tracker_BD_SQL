const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

// En Azure App Service (Linux), /home es el directorio persistente entre reinicios.
// En local, usamos el directorio del proyecto.
function getDataDir() {
  if (process.env.HOME === '/home') {
    // Azure App Service Linux
    return '/home/data';
  }
  return __dirname;
}

const DATA_FILE = path.join(getDataDir(), 'data.json');
const distPath = path.join(__dirname, 'dist');

const app = express();
const PORT = process.env.PORT || 3001;

// En desarrollo necesitamos CORS abierto (Vite corre en :5173).
// En producción (Azure), frontend y backend comparten dominio, no se necesita.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

app.use(express.json({ limit: '50mb' }));

async function initDataFile() {
  try {
    // Crear directorio si no existe (necesario en Azure /home/data)
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.access(DATA_FILE);
    console.log(`Datos cargados: ${DATA_FILE}`);
  } catch {
    console.log(`Creando archivo de datos: ${DATA_FILE}`);
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ projects: [], weekLabel: null, history: [] }, null, 2)
    );
  }
}

app.get('/api/data', async (req, res) => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.status(500).json({ error: 'Error leyendo datos' });
  }
});

app.post('/api/data', async (req, res) => {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ message: 'OK' });
  } catch {
    res.status(500).json({ error: 'Error guardando datos' });
  }
});

// Archivos estáticos del frontend (build de Vite)
app.use(express.static(distPath));

// Fallback SPA: cualquier ruta no-API devuelve index.html
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

// Escuchar en 0.0.0.0 para que Azure pueda enrutar el tráfico
app.listen(PORT, '0.0.0.0', async () => {
  await initDataFile();
  console.log(`Servidor iniciado en puerto ${PORT}`);
  console.log(`Datos en: ${DATA_FILE}`);
});
