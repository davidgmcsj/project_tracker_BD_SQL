# Variables de entorno — dónde van y dónde crearlas

## Primero: ¿dónde tienen que existir realmente?

Depende de cómo despliegues:

| Forma de desplegar | ¿Dónde van las variables? |
|---|---|
| **Manual** (clonas el repo en el servidor, `docker compose up`) — como está documentado en cada `README.md` | En un archivo `.env`, **en el servidor**, junto al `docker-compose.yml` de cada repo. GitLab no necesita saber nada de esto. |
| **Automatizado con GitLab CI/CD** (pipeline que compila/empuja una imagen o hace el deploy por ti) | Además del `.env` del servidor (o en vez de, según cómo armes el pipeline), **en GitLab**: Settings → CI/CD → Variables, de cada proyecto. |

Hoy no hay ningún `.gitlab-ci.yml` — o sea, todavía estás en el primer caso. Esta sección de variables de CI/CD es para cuando decidas automatizar; si vas a seguir desplegando a mano por ahora, con el `.env` en el servidor (ver cada README) es suficiente y puedes saltarte el resto de este documento.

## Cómo crear una variable en GitLab (si automatizas)

En cada proyecto → **Settings → CI/CD → Variables → Add variable**. Por cada una:
- **Key**: el nombre exacto (tabla abajo)
- **Value**: el valor real — cópialo de tu `.env` local (nunca lo pegues en un `.md` ni lo compartas por chat)
- **Type**: `Variable`
- **Protect variable**: ✅ (solo disponible en ramas/tags protegidos)
- **Mask variable**: ✅ en todas las que sean contraseñas/claves (GitLab exige que el valor cumpla un formato mínimo para poder enmascararlo — si no lo deja, revisa que no tenga saltos de línea)

Como son **dos proyectos separados**, hay que repetir esto en cada uno — no se comparten variables entre `project_tracker_backend` y `project_tracker_front` a menos que las definas a nivel de **grupo** (`project_tracker` → Settings → CI/CD → Variables), que si aplica a ambos con el mismo valor (`API_KEY`/`VITE_API_KEY`) puede ahorrarte definirla dos veces.

## project_tracker_backend

| Key | Obligatoria | Sacar el valor real de | Mask |
|---|---|---|---|
| `DB_USER` | Sí | `backend/.env` (local) | ✅ |
| `DB_PASSWORD` | Sí | `backend/.env` (local) | ✅ |
| `DB_SERVER` | Sí | `backend/.env` (local) | No hace falta |
| `DB_NAME` | Sí | `backend/.env` (local) | No hace falta |
| `API_KEY` | Sí | `backend/.env` (local) — misma que `VITE_API_KEY` del frontend | ✅ |
| `FRONTEND_URL` | Sí en producción | La URL real donde quede publicado el frontend (https://…) | No hace falta |
| `GEMINI_API_KEY` | No | `backend/.env` (local) | ✅ |
| `GROQ_API_KEY` | No | `backend/.env` (local) | ✅ |
| `OPENROUTER_API_KEY` | No | `backend/.env` (local) | ✅ |

## project_tracker_front

| Key | Obligatoria | Sacar el valor real de | Mask |
|---|---|---|---|
| `VITE_API_KEY` | Sí | `frontend/.env` (local) — **debe ser idéntica** a `API_KEY` del backend | ✅ |
| `VITE_API_URL` | No (vacío = mismo origen, vía proxy de Nginx) | — | No hace falta |

## Nota de seguridad

`API_KEY`/`VITE_API_KEY` **no son un secreto real** una vez compilado el frontend — Vite las incrusta en el JavaScript que descarga el navegador, cualquiera puede verlas con las herramientas de desarrollo. Son un filtro contra tráfico automatizado, no control de acceso (eso lo hacen las sesiones con cookie y el rol de administrador). Aun así, protégela como el resto: no la reutilices para nada más y no la publiques en documentación ni código.
