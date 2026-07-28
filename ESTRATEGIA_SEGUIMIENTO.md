# Estrategia de Seguimiento de Proyectos

**Oficina de Tecnología — Corte Suprema de Justicia**
Portafolio: +15 proyectos · 1 PMO · Modelo no invasivo

---

## Principio rector

> **El dato viaja hacia mí, no yo hacia el dato.**

No pido reportes: **los ingenieros llenan sus actividades en Planner y yo hago seguimiento**. Las reuniones no existen para informar estado (eso ya está en la app), solo para **decidir** o **desbloquear**.

Con +15 proyectos, la regla es: **reunión solo si hay stopper**. Verde = silencio productivo.

---

## Flujo de carga: del Planner al aplicativo sin captura manual

El centro de la agilización. Yo **no capturo tarea por tarea**:

```
Ingeniero llena actividades en Planner    →    Exporto el Excel de Planner    →    Cargo el Excel en la app
   (fechas, responsable, estado)                  (1 clic en Planner)               (la app llena todo solo)
```

- Planner permite **exportar el plan a Excel** (`.xlsx`) con: nombre de tarea, responsable, fecha de inicio, fecha de vencimiento, % completado, esfuerzo y depósito (bucket).
- La app tendrá una función **"Cargar Excel de Planner"** que lee esas columnas y **crea/actualiza las actividades del proyecto automáticamente**: fechas, responsable, estado y % de avance.
- Mi trabajo se reduce a: **exportar → cargar → revisar**. No transcribo nada.
- Al ver las actividades ya cargadas, reviso **para cuándo son** (vencimientos) y detecto lo que se está retrasando.

### Cómo se evita sobrescribir (política de sincronización)

Cada tarea se identifica por su **"Número de tarea" de Planner** (identificador estable), no por su texto ni su posición. Al recargar el Excel:

| ¿En Excel? | ¿En app? | Acción |
|---|---|---|
| Sí | No | **Crea** la actividad nueva |
| Sí | Sí | **Actualiza** solo campos de Planner; **conserva** lo que agregué yo |
| No | Sí | **Archiva** automáticamente (no se borra, recuperable) |

- **El Excel manda** en: nombre, responsable, fechas, % avance, esfuerzo, estado.
- **La app manda** (nunca se toca) en: impedimentos, comentarios, objetivos/solución, checklist, notas internas, indicadores.

> Requisitos que pido al equipo **una sola vez** como estándar (no cada semana):
> 1. Cada tarea con **responsable y fecha de vencimiento**.
> 2. **Editar** la tarea existente, no borrarla y recrearla (eso cambia su número y la app la verá como nueva).

---

## Días de reunión: MIÉRCOLES (regla general)

Todo lo sincrónico se concentra para no fragmentar la semana del equipo.
Jornada 8:00–17:00, almuerzo 13:00. **Ninguna sesión supera 20 minutos.**

| Bloque | Hora | Duración | Quién | Regla |
|---|---|---|---|---|
| **Comité de Stoppers** | 9:00–9:20 | 20 min máx | Solo proyectos 🔴/🟠 | Si no hay stoppers, se cancela |
| **1:1 exprés** (si aplica) | 9:30 en adelante | 20 min máx c/u | Ingeniero con stopper no resuelto en el comité | Solo si el comité no lo resolvió |

**Proyectos que requieren más seguimiento → 2 sesiones/semana** (nunca más):

| Sesión | Día | Hora | Duración |
|---|---|---|---|
| Seguimiento 1 | **Martes** | 9:00–9:20 | 20 min máx |
| Seguimiento 2 | **Jueves** | 9:00–9:20 | 20 min máx |

- Las sesiones de la mañana (9:00–9:20) evitan cruce con el almuerzo y arrancan el día con foco.
- **Ningún proyecto verde ocupa tiempo de reunión.**
- El Comité de Stoppers se apoya en la **Vista de Stoppers** de la app (bloqueos ordenados por días abierto).
- Formato de cada sesión (20 min): por cada stopper → *qué traba · quién lo resuelve · qué necesito de dirección · días abierto*.

---

## Cadencia semanal (mi trabajo, ~3 h/semana)

| Día | Tiempo | Acción | Herramienta |
|---|---|---|---|
| **Lunes** | 30 min | Exporto Excel de Planner y lo **cargo en la app**. Reviso vencimientos y avance. | Planner → App |
| **Lunes** | 20 min | Leo dashboard. Marco rojos/naranjas. Mensaje **asíncrono** al ingeniero en riesgo: *"¿qué necesitas para destrabar X?"* | App + Teams |
| **Martes** | 20 min máx | *(Solo si aplica)* Seguimiento 1 de proyectos críticos. | Reunión |
| **Miércoles** | 20 min máx | Comité de Stoppers (ver arriba). | App + reunión |
| **Jueves** | 20 min máx | *(Solo si aplica)* Seguimiento 2 de proyectos críticos. | Reunión |
| **Viernes** | 30 min | Cierre semanal: recargo Planner, logros + plan próxima semana, snapshot, Status Ejecutivo IA. | App |

---

## Modelo de captura: 3 capas sin re-trabajo

Cada capa se alimenta de la anterior. **Nadie llena lo mismo dos veces.**

| Capa | Pregunta | Frecuencia | Dueño | Fuente |
|---|---|---|---|---|
| **Operativa** | ¿Qué hago hoy y qué me traba? | Diaria, async | Ingeniero | **Planner** |
| **Táctica** | ¿Cómo va cada proyecto? ¿Dónde hay stoppers? | Semanal | **Yo (PMO)** | **Esta app** (cargada desde Excel de Planner) |
| **Ejecutiva** | ¿Cómo estamos en general? | Quincenal | Yo → Dirección | **Status IA de la app** |

> El ingeniero **solo toca Planner**. La app absorbe su avance vía Excel; yo reviso y ajusto el semáforo. El puente es el campo `planner_url` de cada proyecto: cada proyecto enlaza su tablero.

---

## Semáforo objetivo (no opinión)

El color sale de una **regla**, para poder decir a dirección *"esto es rojo porque…"* con datos.

| Semáforo | Criterio |
|---|---|
| 🟢 **En curso** | Avance ≥ al esperado por fecha · sin bloqueantes |
| 🟠 **En riesgo** | Avance 10–25 % bajo lo esperado, **o** riesgo sin mitigar |
| 🔴 **Bloqueado** | ≥1 impedimento "bloqueante" activo, **o** avance >25 % bajo lo esperado |
| 🔵 **Mejora continua** | En operación/mantenimiento |
| 🟢 **Completado** | Entregado y aceptado |

---

## Gestión de stoppers (mi valor real)

No fiscalizo retrasos: **resuelvo trabas**. Cada impedimento tiene ciclo de vida:

```
Detectado → Dueño asignado → En gestión → Escalado (si aplica) → Resuelto
  ↑ fecha       ↑ quién          ↑ acción     ↑ a quién          ↑ días abierto
```

El dato que llevo a dirección no es *"cuántos bloqueos hay"*, sino
**"cuántos días lleva abierto cada uno y a quién le toca resolverlo"**.
Eso cambia la conversación de *"¿por qué van tarde?"* a *"necesito que destrabes esto que lleva 8 días esperando aprobación externa"*.

---

## Cómo respondo "¿cómo estamos?"

Tres audiencias, tres formatos — la app ya tiene la materia prima:

| Audiencia | Formato | Tiempo | Fuente en la app |
|---|---|---|---|
| **Dirección** | 1 párrafo | 30 seg | Status Ejecutivo IA |
| **Par / auditoría** | Tarjetas + tabla global | 2 min | Dashboard |
| **Ingeniero** | Asignaciones por persona | 1 min | Rep. Ingenieros |

---

## Reglas anti-invasivas (mi diferenciador)

1. **Reunión solo si hay bloqueo.** Estado verde = no molesto.
2. **El equipo solo llena Planner; la app absorbe el Excel.** No les pido que "me reporten" ni que usen otra herramienta.
3. **Ninguna sesión pasa de 20 minutos.** Máximo 2 sesiones/semana por proyecto crítico.
4. **Miércoles es el día base.** Martes/jueves solo para proyectos que lo requieran.
5. **Cuando pregunto, llego con la solución del stopper, no con el reclamo del retraso.**

---

*Documento vivo — ajustar cadencia según madurez del equipo.*
