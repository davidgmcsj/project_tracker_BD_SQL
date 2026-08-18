# Variables de entorno — dónde van y dónde crearlas

## Primero: ¿dónde tienen que existir realmente?

Depende de cómo despliegues:

| Forma de desplegar | ¿Dónde van las variables? |
|---|---|
| **Manual** (clonas el repo en el servidor, `docker compose up`) — ver `GUIA_DESPLIEGUE_DOCKER.md` | En un archivo `.env`, **en el servidor**, junto al `docker-compose.yml`. Ningún sistema de CI/CD necesita saber nada de esto. |
| **Automatizado con GitHub Actions → AKS** (ver `.github/workflows/deploy.yml`) | En **GitHub**: Settings → Secrets and variables → Actions, del repo. Además, las credenciales de la app (`DB_*`, `API_KEY`, etc.) viven **también** en un Secret de Kubernetes creado a mano en el clúster (`backend-secrets`) — el pipeline no las gestiona, solo hace `kubectl apply` de los Deployments. |

> **Nota histórica:** este documento mencionaba antes GitLab CI/CD + variables de grupo — eso describía otro par de repos (`project_tracker_backend`/`project_tracker_front` en GitLab). Este repo (`project_tracker_BD_SQL`) vive en **GitHub**, así que el mecanismo real es GitHub Actions Secrets, documentado abajo.

## Cómo crear un Secret en GitHub Actions

En el repo → **Settings → Secrets and variables → Actions → New repository secret**. Por cada uno:
- **Name**: el nombre exacto (tabla abajo)
- **Secret**: el valor real — cópialo de tu `.env` local (nunca lo pegues en un `.md` ni lo compartas por chat)

A diferencia de GitLab, GitHub Actions no distingue "Protect"/"Mask" por variable: los secrets de repo ya quedan ocultos en los logs automáticamente, y puedes restringir por rama con **Environments** (Settings → Environments → `pruebas` → Deployment branches → solo `develop`) si quieres esa capa extra.

## Secrets del pipeline (`.github/workflows/deploy.yml`)

| Name | Obligatoria | Sacar el valor real de | Para qué |
|---|---|---|---|
| `ACR_LOGIN_SERVER` | Sí | Te lo da el equipo de infraestructura (ej. `misregistro.azurecr.io`) | Login y tag de las imágenes |
| `ACR_USERNAME` | Sí | Te lo da el equipo de infraestructura | Login a ACR |
| `ACR_PASSWORD` | Sí | Te lo da el equipo de infraestructura | Login a ACR |
| `KUBE_CONFIG` | Sí | `cat kubeconfig.yaml \| base64 -w0` (kubeconfig que te dé el equipo de infraestructura) | Autenticación de `kubectl` contra el clúster AKS |
| `API_KEY` | Sí | `backend/.env` (local) — la misma que va en el Secret `backend-secrets` de Kubernetes | Se pasa como build-arg `VITE_API_KEY` al compilar el frontend |
| `AKS_NAMESPACE` | Sí | **Confirmar con el equipo de infraestructura** — nunca copiar el de otro proyecto (ej. `pqrs-development` es el namespace de PQRS, no el nuestro) | Namespace real donde viven los recursos de este proyecto en el clúster |

> Los manifiestos (`backend/k8s/*.yaml`, `frontend/k8s/*.yaml`) usan el placeholder `__NAMESPACE__` en vez de un nombre fijo — el pipeline lo sustituye por `AKS_NAMESPACE` en tiempo de deploy (ver el paso "Sustituir placeholders" de `.github/workflows/deploy.yml`). Si aplicas un manifiesto a mano con `kubectl apply`, sustituye `__NAMESPACE__` tú mismo primero (o usa `-n <namespace>`, que sobrescribe el `metadata.namespace` del archivo).

## Secret de Kubernetes `backend-secrets` (creado a mano en el clúster, no por el pipeline)

Ver plantilla completa en [backend/k8s/secret.example.yaml](backend/k8s/secret.example.yaml).

| Key | Obligatoria | Sacar el valor real de |
|---|---|---|
| `DB_USER` | Sí | `backend/.env` (local) |
| `DB_PASSWORD` | Sí | `backend/.env` (local) |
| `DB_SERVER` | Sí | `backend/.env` (local) |
| `DB_NAME` | Sí | `backend/.env` (local) |
| `API_KEY` | Sí | `backend/.env` (local) — misma que el Secret `API_KEY` de GitHub Actions |
| `FRONTEND_URL` | Sí en producción | La URL real donde quede publicado el frontend (https://…) |
| `GEMINI_API_KEY` | No | `backend/.env` (local) |
| `GROQ_API_KEY` | No | `backend/.env` (local) |
| `OPENROUTER_API_KEY` | No | `backend/.env` (local) |
| `AZURE_STORAGE_CONNECTION_STRING` | Si se usa Blob Storage para adjuntos | `backend/.env` (local) |
| `AZURE_STORAGE_CONTAINER` | Si se usa Blob Storage para adjuntos | `backend/.env` (local) |

## ConfigMap de Kubernetes `backend-config` (aplicado por el pipeline)

Ver [backend/k8s/configmap.yaml](backend/k8s/configmap.yaml). Hoy vacío a propósito — todas las variables actuales del backend son credenciales o dependen del entorno real, así que viven en `backend-secrets`. Si en el futuro se agrega una constante no sensible (un flag, un timeout configurable), va aquí en vez de mezclarla con el Secret — mismo patrón que separa `ConfigMap`/`Secret` en otros proyectos internos (ej. pqrs.api).

## Secret de Kubernetes `frontend-tls-certs` (creado a mano en el clúster)

Ver plantilla completa en [frontend/k8s/secret.example.yaml](frontend/k8s/secret.example.yaml). Certificado HTTPS que monta Nginx — ver `GUIA_DESPLIEGUE_DOCKER.md` §1.3 para generarlo.

## Nota de seguridad

`API_KEY`/`VITE_API_KEY` **no son un secreto real** una vez compilado el frontend — Vite las incrusta en el JavaScript que descarga el navegador, cualquiera puede verlas con las herramientas de desarrollo. Son un filtro contra tráfico automatizado, no control de acceso (eso lo hacen las sesiones con cookie y el rol de administrador). Aun así, protégela como el resto: no la reutilices para nada más y no la publiques en documentación ni código.
