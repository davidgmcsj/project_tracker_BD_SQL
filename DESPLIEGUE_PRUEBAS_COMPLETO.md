# Despliegue completo en Kubernetes (AKS) — guía paso a paso

Checklist de punta a punta: desde "el código ya está listo" hasta "la app responde en pruebas". Sigue el orden — cada sección depende de la anterior.

**Resumen de por qué hace falta todo esto:** el pipeline (`.gitlab-ci.yml`) construye la imagen y le dice al clúster "usa esta imagen nueva" — pero el clúster necesita saber DE ANTEMANO cómo conectarse a la base de datos, qué certificado usar, etc. Eso no va en el código ni en el pipeline (sería un secreto expuesto en git) — va en **Secrets de Kubernetes** (creados una vez, a mano) y en **variables de GitLab CI/CD** (para que el pipeline pueda autenticarse contra ACR y el clúster). Sin esas dos cosas, el pipeline corre pero el pod nunca queda sano.

---

## 0. Antes de empezar — qué necesitas tener a la mano

- [ ] Acceso SSH/red a `lived-flakily5-wielder.cortesuprema.gov.co` (para el `push`)
- [ ] `kubectl` instalado en tu máquina, apuntando al clúster AKS (o el kubeconfig del ingeniero)
- [ ] Los 3 datos que le pediste al ingeniero: `ACR_LOGIN_SERVER`/usuario/contraseña, el kubeconfig del clúster, confirmación de que el GitLab Runner permite modo **privileged**
- [ ] El certificado HTTPS (`fullchain.pem`/`privkey.pem`) — autofirmado sirve para pruebas, ver comando abajo

---

## 1. Prerrequisitos de infraestructura (una sola vez, con el ingeniero)

Esto **no lo resuelve el pipeline** — es configuración previa del clúster:

| Qué | Cómo verificarlo/pedirlo |
|---|---|
| GitLab Runner registrado y disponible | El ingeniero confirma que hay uno activo para `project_tracker` |
| Runner permite modo **privileged** | Necesario para Docker-in-Docker (`services: docker:27-dind`) en la etapa `build`. Sin esto, el pipeline falla en el primer job |
| Namespace `pruebas` existe en el clúster | `kubectl get ns pruebas` — si no existe, se crea en el paso 3 |
| Azure Container Registry (ACR) accesible | El ingeniero te da `ACR_LOGIN_SERVER`, usuario y contraseña (o token) |
| Certificado del contenedor `projectcsjdev` confirmado como Private | Ya lo confirmaste — el contenedor de Blob Storage, no el de Kubernetes |

---

## 2. Generar el certificado HTTPS (una sola vez)

```bash
mkdir -p certs
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=<IP-o-dominio-que-vaya-a-usar-pruebas>"
```

Autofirmado sirve para "pruebas" — el navegador muestra una advertencia la primera vez, se acepta y no vuelve a salir. Para producción más adelante, reemplazar por uno real (Let's Encrypt u otro).

---

## 3. Crear el namespace y los Secrets en el clúster (una sola vez, a mano)

```bash
# 1. Namespace
kubectl create namespace pruebas

# 2. Secret del backend — TODAS las credenciales de la app.
#    Sacar cada valor real de backend/.env (local) o de donde el
#    ingeniero te las dé. NUNCA pegar estos valores en un documento.
kubectl create secret generic backend-secrets --namespace pruebas \
  --from-literal=DB_USER=... \
  --from-literal=DB_PASSWORD=... \
  --from-literal=DB_SERVER=... \
  --from-literal=DB_NAME=... \
  --from-literal=API_KEY=... \
  --from-literal=FRONTEND_URL=https://... \
  --from-literal=GEMINI_API_KEY=... \
  --from-literal=GROQ_API_KEY=... \
  --from-literal=OPENROUTER_API_KEY=... \
  --from-literal=AZURE_STORAGE_CONNECTION_STRING=... \
  --from-literal=AZURE_STORAGE_CONTAINER=projectcsjdev

# 3. Secret del certificado del FRONTEND (Opaque genérico, no "tls" —
#    ver comentario en frontend/k8s/deployment.yaml sobre por qué)
kubectl create secret generic frontend-tls-certs --namespace pruebas \
  --from-file=certs/fullchain.pem --from-file=certs/privkey.pem
```

> `FRONTEND_URL` es un problema de huevo-y-gallina: necesitas la IP del frontend para ponerla aquí, pero el frontend todavía no está desplegado. Solución: pon un valor provisional (`https://pendiente.local`), despliega ambos, consigue la IP real del `Service` del frontend (paso 6), y actualiza el Secret (comando en la sección de "Actualizar después").

---

## 4. Variables de CI/CD en GitLab (una vez por proyecto)

Ruta: **cada proyecto → Settings → CI/CD → Variables → Add variable**. Marca **Protect** y **Mask** en todas las que lo permitan.

### En `project_tracker_backend`

| Key | Value (sacar de) | Protect | Mask |
|---|---|---|---|
| `ACR_LOGIN_SERVER` | Te lo da el ingeniero | ✅ | No hace falta |
| `ACR_USERNAME` | Te lo da el ingeniero | ✅ | ✅ |
| `ACR_PASSWORD` | Te lo da el ingeniero | ✅ | ✅ |
| `KUBE_CONFIG_PRUEBAS` | `cat kubeconfig.yaml \| base64 -w0` (el ingeniero te da el kubeconfig) | ✅ | ✅ |

### En `project_tracker_front`

| Key | Value (sacar de) | Protect | Mask |
|---|---|---|---|
| `ACR_LOGIN_SERVER` | Mismo valor que en el backend | ✅ | No hace falta |
| `ACR_USERNAME` | Mismo valor que en el backend | ✅ | ✅ |
| `ACR_PASSWORD` | Mismo valor que en el backend | ✅ | ✅ |
| `API_KEY` | El mismo `API_KEY` que pusiste en `backend-secrets` (paso 3) — se pasa como build arg `VITE_API_KEY` | ✅ | ✅ |
| `KUBE_CONFIG_PRUEBAS` | Mismo valor que en el backend | ✅ | ✅ |

Si en GitLab la variable "Protect" solo aplica a ramas protegidas, marca `develop` como rama protegida en **Settings → Repository → Protected branches** — si no, las variables protegidas no estarán disponibles para el pipeline que corre ahí.

---

## 5. Hacer el push y abrir los Merge Requests

```bash
# Backend
cd "D:\Users\DavidGM\Desktop\project_tracker_backend"
git push -u origin main
git push -u origin develop
git push -u origin feature/blob-storage-adjuntos

# Frontend
cd "D:\Users\DavidGM\Desktop\project_tracker_front"
git push -u origin main
git push -u origin develop
git push -u origin fix/autocompletar-nombre-usuario
```

En GitLab, abre un **Merge Request** de cada rama de trabajo hacia `develop`:
- `project_tracker_backend`: `feature/blob-storage-adjuntos` → `develop`
- `project_tracker_front`: `fix/autocompletar-nombre-usuario` → `develop`

Al hacer **Merge**, recién ahí se dispara el pipeline (porque quedó configurado para reaccionar a `develop`, ver `.gitlab-ci.yml`).

---

## 6. Verificar que de verdad quedó funcionando

```bash
# ¿Los pods están sanos?
kubectl get pods -n pruebas

# Si algo no está "Running"/"1/1", ver por qué:
kubectl describe pod <nombre-del-pod> -n pruebas
kubectl logs <nombre-del-pod> -n pruebas

# IP pública del frontend (puede tardar 1-2 min en asignarse)
kubectl get svc frontend -n pruebas
```

Con esa IP: entra por navegador a `https://<IP>`, acepta la advertencia del certificado autofirmado, inicia sesión, confirma que puedas ver/crear un proyecto y que el reinicio de un pod no borre datos.

### Actualizar `FRONTEND_URL` después de tener la IP real

```bash
kubectl delete secret backend-secrets -n pruebas
kubectl create secret generic backend-secrets --namespace pruebas \
  --from-literal=... (todos los valores del paso 3, con FRONTEND_URL real esta vez)
kubectl rollout restart deployment/backend -n pruebas
```

---

## 7. Errores comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El pipeline queda en **"pending"** para siempre | No hay Runner disponible, o no acepta este proyecto | Confirmar con el ingeniero que el Runner está activo y habilitado para `project_tracker` |
| Falla el job `build` con error de Docker/socket | Runner no tiene modo **privileged** habilitado | Pedirle al ingeniero que lo habilite, o cambiar a kaniko (build sin Docker-in-Docker) — avísame si toca este camino |
| Pod en **`ImagePullBackOff`** | Credenciales de ACR mal puestas, o el nombre de imagen no coincide | Revisar `ACR_LOGIN_SERVER`/`ACR_USERNAME`/`ACR_PASSWORD`; `kubectl describe pod` da el mensaje exacto |
| Pod en **`CrashLoopBackOff`** (backend) | Falta una variable obligatoria en `backend-secrets` (`API_KEY`/`FRONTEND_URL` faltantes hacen que el proceso se cierre solo) | `kubectl logs <pod> -n pruebas` — el mensaje `[FATAL] ...` dice cuál falta |
| Login funciona pero la sesión no se guarda | HTTPS mal configurado, o `FRONTEND_URL` no coincide exacto con la URL real | Revisar el Secret `frontend-tls-certs` y el valor de `FRONTEND_URL` |
| Error de CORS en la consola del navegador | `FRONTEND_URL` del backend no es idéntico a la URL desde la que entras | Actualizar el Secret (sección 6) y reiniciar el Deployment |

---

## 8. Checklist final (para marcar mientras avanzas)

- [ ] Prerrequisitos de infraestructura confirmados con el ingeniero (sección 1)
- [ ] Certificado HTTPS generado (sección 2)
- [ ] Namespace `pruebas` creado
- [ ] Secret `backend-secrets` creado
- [ ] Secret `frontend-tls-certs` creado
- [ ] Variables de CI/CD del backend configuradas en GitLab
- [ ] Variables de CI/CD del frontend configuradas en GitLab
- [ ] Rama `develop` marcada como protegida (si aplica)
- [ ] Push de las 6 ramas (3 backend + 3 frontend)
- [ ] Merge Request `feature/blob-storage-adjuntos` → `develop` (backend)
- [ ] Merge Request `fix/autocompletar-nombre-usuario` → `develop` (frontend)
- [ ] Pipelines corridos sin error
- [ ] `kubectl get pods -n pruebas` muestra todo `Running`
- [ ] App accesible por navegador, login funciona, datos persisten tras reiniciar un pod
- [ ] `FRONTEND_URL` actualizado con la IP/dominio real
