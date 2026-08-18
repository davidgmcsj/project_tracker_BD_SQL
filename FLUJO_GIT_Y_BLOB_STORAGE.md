# Flujo de ramas + Blob Storage — para hablar con el ingeniero

## 1. Flujo de ramas (ya implementado en los dos repos de GitLab)

```
feature/xxx (local, tu máquina)
     │  desarrollas y pruebas en local
     │  Merge Request →
     ▼
  develop  ───────────────▶  pipeline de GitLab CI/CD  ───────────────▶  AKS, namespace "pruebas"
     │  (automático en cada push/merge a develop)
     │
     │  cuando "pruebas" ya se validó y se decide pasar a producción
     │  Merge Request →
     ▼
   main    (queda quieta — sin pipeline propio todavía, solo el histórico estable)
```

- **`main`**: rama estable. Nadie le hace `push` directo — solo recibe Merge Requests desde `develop` cuando algo ya se validó en pruebas. Hoy no tiene ningún pipeline conectado (a propósito: no hay ambiente de producción todavía).
- **`develop`**: el pipeline de GitLab CI/CD reacciona a esta rama — cada `push`/merge aquí reconstruye la imagen y la despliega sola al namespace `pruebas` del clúster AKS.
- **`feature/*`**: ramas locales de trabajo (ej. `feature/blob-storage-adjuntos`, ya creada). Se prueban en tu máquina, y se integran a `develop` por Merge Request — no hay pipeline en estas ramas, solo en `develop`.

Ya está así en ambos repos (`project_tracker_backend` y `project_tracker_front`): rama `develop` creada, `.gitlab-ci.yml` actualizado para reaccionar a `develop` en vez de `main`. Falta el `push` de las tres ramas (`main`, `develop`, y luego la MR de tu feature) — lo hacemos cuando quieras.

## 2. Blob Storage para adjuntos

Ya existe el diseño completo (`plan-blob-storage.md`, en este mismo repo) desde antes — estaba bloqueado solo por no tener la cuenta de Azure Storage. Ya la tienes.

- ✅ Confirmado: `projectcsjdev` es el nombre del **contenedor** (distinto del nombre de la cuenta, `appscortesupremadev`, que va en la cadena de conexión).
- ✅ Cadena de conexión confirmada — ya está en `backend/.env` local, lista para probar.

Dos preguntas que todavía vale la pena hacerle al ingeniero, no bloqueantes para empezar a probar en local:

1. ¿Ese contenedor está creado como **Private** (sin acceso público)? Es un requisito del diseño — el backend es el único que debe poder leer/escribir ahí.
2. Para producción más adelante: ¿conviene migrar de cadena de conexión a **Managed Identity** de AKS con rol `Storage Blob Data Contributor`? (evita tener la clave de la cuenta guardada en un Secret — más seguro, pero es un cambio aparte, no bloqueante para probar en desarrollo).

## 3. Variables que van a necesitar existir (nombres, no valores)

Igual que las demás (ver `VARIABLES_DESPLIEGUE.md`) — **no pongas el valor real en ningún documento**, solo en tu `.env` local (ya lo dejé listo) o directo en GitLab/Kubernetes cuando toque:

| Variable | Dónde termina en Kubernetes | Notas |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | Secret `backend-secrets`, namespace `pruebas` | Da acceso TOTAL a la cuenta de Storage — tratarla como `DB_PASSWORD`, no como `API_KEY` |
| `AZURE_STORAGE_CONTAINER` | Secret `backend-secrets`, namespace `pruebas` | El nombre a confirmar (punto 2 arriba) |

Ya agregué ambas a: `backend/.env.example`, `backend/k8s/secret.example.yaml` y al `README.md` del repo del backend (comando `kubectl create secret` incluido) — cuando el ingeniero confirme el nombre del contenedor, solo falta correr ese comando en el clúster una vez.

## 4. Orden recomendado a partir de aquí

1. Implementamos el código de `plan-blob-storage.md` (Fase 10) en la rama `feature/blob-storage-adjuntos`, probando contra tu `.env` local. (Puede arrancar ya — las 2 preguntas que quedan pendientes con el ingeniero no bloquean probar en local.)
2. Validado en local, Merge Request a `develop` → se despliega solo a `pruebas`.
3. Confirmas en `pruebas` que subir/descargar/borrar un adjunto funciona igual que hoy (mismo criterio de verificación que ya está en el plan, sección 5.5) — aquí sí importa que el ingeniero haya confirmado que el contenedor es Private.
4. Cuando todo esté validado, Merge Request de `develop` a `main`.
