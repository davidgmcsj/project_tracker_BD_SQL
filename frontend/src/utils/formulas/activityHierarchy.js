// activityHierarchy.js — Índice de actividades y jerarquía de subtareas
// (parent_id plano). Las actividades siguen viviendo en un array PLANO
// (activities_identified); parent_id es la única adición. El árbol se
// reconstruye en memoria, on-demand, solo donde se necesita (HierarchyTable)
// — el resto del sistema (Gantt, Kanban, reportes, sync a SQL) sigue viendo
// el mismo array plano sin cambios.
//
// sequence_order fija el orden entre hermanas del mismo padre. Actividades sin
// el campo (datos existentes anteriores a esta funcionalidad) se ordenan por su
// posición actual en el array la primera vez que se construye el árbol.

// Construye un índice id → { text, position } a partir de activities_identified.
// "position" es el número jerárquico "N" o "N.M.O…" (ver formatHierarchyNumber),
// nunca se guarda, se recalcula en cada llamada — misma fuente que usa el
// Cronograma (HierarchyTable, vía flattenTree).
//
// Antes numeraba por posición en el array plano (1, 2, 3…), ignorando quién
// era padre de quién: el Kanban podía mostrar "2. Anexo Técnico" para la misma
// actividad que el Cronograma mostraba como "1.1" — dos numeraciones distintas
// para el mismo dato. Ahora ambas vistas derivan del mismo árbol, así que el
// número SIEMPRE coincide en toda la app.
export function buildActivityIndex(activities) {
  const map = new Map();
  flattenTree(activities).forEach(({ activity, path }) => {
    if (activity && activity.id != null) {
      map.set(activity.id, { text: activity.text || "", position: formatHierarchyNumber(path) });
    }
  });
  return map;
}

// Resuelve un id a su texto plano. Si no se encuentra (referencia huérfana), devuelve el id tal cual.
export function activityText(index, id) {
  return index.get(id)?.text ?? id ?? "";
}

// Resuelve un id a su label numerado "N. texto" o "N.M. texto" para mostrar en
// Kanban/reportes/listas — mismo número jerárquico que el Cronograma.
export function activityLabel(index, id) {
  const entry = index.get(id);
  return entry ? `${entry.position}. ${entry.text}` : (id || "");
}

// Construye { rootIds, childrenOf } a partir del array plano de actividades.
// childrenOf: Map<parentId|null, Activity[]>, cada lista ya ordenada por
// sequence_order (con fallback a la posición original del array).
// Ignora referencias huérfanas (parent_id apunta a un id que no existe) y
// ciclos (una actividad que, siguiendo parent_id hacia arriba, se referencia
// a sí misma) tratándolas como raíz — nunca cuelga el recorrido.
export function buildActivityTree(activities) {
  const acts = Array.isArray(activities) ? activities : [];
  const byId = new Map(acts.map(a => [a.id, a]));

  const isDescendantCycle = (id, parentId) => {
    let cur = parentId;
    const seen = new Set();
    while (cur != null) {
      if (cur === id) return true;
      if (seen.has(cur)) return true; // ciclo preexistente en los datos, no relacionado con `id`
      seen.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
    return false;
  };

  const childrenOf = new Map();
  const rootIds = [];

  acts.forEach((a, i) => {
    const rawParent = a.parent_id ?? null;
    const validParent = rawParent != null && byId.has(rawParent) && !isDescendantCycle(a.id, rawParent)
      ? rawParent
      : null;
    if (validParent === null) rootIds.push(a.id);
    const key = validParent;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push({ activity: a, originalIndex: i });
  });

  const bySeq = (x, y) => {
    const sx = Number(x.activity.sequence_order);
    const sy = Number(y.activity.sequence_order);
    if (Number.isFinite(sx) && Number.isFinite(sy) && sx !== sy) return sx - sy;
    return x.originalIndex - y.originalIndex;
  };

  for (const list of childrenOf.values()) {
    list.sort(bySeq);
  }
  rootIds.sort((idA, idB) => {
    const a = byId.get(idA), b = byId.get(idB);
    const sa = Number(a?.sequence_order), sb = Number(b?.sequence_order);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    return acts.indexOf(a) - acts.indexOf(b);
  });

  const childrenOfFlat = new Map();
  for (const [key, list] of childrenOf.entries()) {
    childrenOfFlat.set(key, list.map(x => x.activity));
  }

  return { rootIds, childrenOf: childrenOfFlat };
}

// Recorre el árbol en preorden (respetando sequence_order) y devuelve un array
// plano de { activity, level, path }. path = [1,1,13,3,1] — números 1-based por
// nivel; level = path.length - 1. La numeración NUNCA se guarda, se calcula en
// cada llamada (mismo principio que buildActivityIndex de arriba).
//
// collapsedIds: Set<id> de actividades cuyos hijos se omiten del resultado
// (permanece la propia fila, se ocultan sus descendientes) — usado por
// HierarchyTable para colapsar ramas sin perder el resto del árbol.
export function flattenTree(activities, { collapsedIds } = {}) {
  const { rootIds, childrenOf } = buildActivityTree(activities);
  const byId = new Map((Array.isArray(activities) ? activities : []).map(a => [a.id, a]));
  const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set();
  const out = [];

  const visit = (id, path) => {
    const activity = byId.get(id);
    if (!activity) return;
    out.push({ activity, level: path.length - 1, path });
    if (collapsed.has(id)) return;
    const children = childrenOf.get(id) || [];
    children.forEach((child, i) => visit(child.id, [...path, i + 1]));
  };

  rootIds.forEach((id, i) => visit(id, [i + 1]));
  return out;
}

export function formatHierarchyNumber(path) {
  return Array.isArray(path) ? path.join(".") : "";
}

// Recalcula sequence_order para TODO el grupo de hermanas (mismo parent_id)
// tras arrastrar draggedId a la posición de targetId — usado por
// HierarchyTable (drag & drop de filas). El número "1.1, 1.2…" es puramente
// posicional (deriva de sequence_order vía buildActivityTree/flattenTree),
// así que moverlo aquí es lo único que hace falta para "renumerar" la fila
// sin tocar ningún otro campo. Devuelve null si el drop no es válido (no son
// hermanas, o alguno de los dos ids no existe) — el caller no hace nada en
// ese caso, en vez de reordenar entre padres distintos de forma silenciosa.
export function reorderSiblings(activities, draggedId, targetId) {
  const acts = Array.isArray(activities) ? activities : [];
  if (draggedId === targetId) return null;
  const byId = new Map(acts.map(a => [a.id, a]));
  const dragged = byId.get(draggedId);
  const target  = byId.get(targetId);
  if (!dragged || !target) return null;
  const parentId = dragged.parent_id ?? null;
  if ((target.parent_id ?? null) !== parentId) return null;

  const siblings = acts
    .filter(a => (a.parent_id ?? null) === parentId)
    .sort((a, b) => {
      const sa = Number(a.sequence_order), sb = Number(b.sequence_order);
      if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
      return acts.indexOf(a) - acts.indexOf(b);
    });

  const fromIdx = siblings.findIndex(a => a.id === draggedId);
  const toIdx   = siblings.findIndex(a => a.id === targetId);
  const next = [...siblings];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);

  return next.map((a, i) => ({ id: a.id, sequence_order: i }));
}

// Actividades sin hijos — las únicas que cuentan en totales/métricas del
// proyecto. Un padre con subtareas es un contenedor organizativo, no una
// unidad de trabajo medible: contarlo aparte infla el total (un padre con 5
// hijas terminadas aparecería como 6 tareas, no 5).
//
// No usa buildActivityTree (evita reconstruir el árbol completo cuando solo
// hace falta filtrar). Un parent_id huérfano (apunta a un id inexistente en
// el array) no excluye a nadie — esa actividad se trata como hoja.
export function leafActivities(activities) {
  const acts = Array.isArray(activities) ? activities : [];
  const parentIds = new Set(acts.map(a => a.parent_id).filter(id => id != null));
  return acts.filter(a => !parentIds.has(a.id));
}

// Un padre no puede marcarse como completado mientras tenga AL MENOS UNA
// subtarea (directa o indirecta) que no esté completada. Evita que el estado
// visual de un contenedor mienta sobre el trabajo real pendiente debajo.
//
// Recorre TODA la descendencia (no solo hijos directos): un abuelo con un
// nieto pendiente también queda bloqueado, aunque su hijo directo ya esté
// completado. Una hoja (sin descendientes) siempre puede completarse.
export function canMarkCompleted(activityId, activities, taskStatus) {
  const acts = Array.isArray(activities) ? activities : [];
  const completed = new Set((taskStatus && Array.isArray(taskStatus.completed)) ? taskStatus.completed : []);
  const { childrenOf } = buildActivityTree(acts);

  const descendientesPendientes = (id) => {
    const children = childrenOf.get(id) || [];
    return children.some(child => !completed.has(child.id) || descendientesPendientes(child.id));
  };

  return !descendientesPendientes(activityId);
}

// Claves de task_status en las que puede caer una actividad — ver
// transitionActivityStatus (components/edit/shared.js) para la lógica de
// movimiento en sí; esto solo valida si el destino es alcanzable.
const AMBIENTE_KEYS = ["ambiente_pruebas", "ambiente_produccion"];

// Puerta de validación para el flujo de ambientes de despliegue (desarrollo
// → pruebas → producción). Generaliza canMarkCompleted a los 2 estados
// intermedios nuevos, y agrega 2 reglas propias del flujo:
//
//  1. Subtareas normales pendientes bloquean completed/ambiente_pruebas/
//     ambiente_produccion igual que ya bloqueaban completed (canMarkCompleted
//     sin cambios, solo aplicada a 3 destinos en vez de 1).
//  2. No se puede forzar "completed" a mano mientras la actividad YA está en
//     ambiente_pruebas/ambiente_produccion — solo se llega ahí por la cadena
//     automática (ver transitionActivityStatus, paso de automatismos).
//  3. ambiente_pruebas/ambiente_produccion solo son alcanzables si la
//     actividad tiene es_desarrollo === true.
//
// IMPORTANTE: esta función NO se usa (ni debe usarse) para la transición
// automática interna que mueve al padre de ambiente_pruebas a
// ambiente_produccion, ni de ambiente_produccion a completed — esas
// transiciones las dispara el propio sistema al completar la subtarea de
// despliegue correspondiente, y pasar por este guard causaría un deadlock:
// el padre nunca podría avanzar porque su propio estado de ambiente lo
// bloquearía a sí mismo. Ver el comentario en transitionActivityStatus.
export function canTransitionTo(activityId, activities, taskStatus, toKey) {
  const acts = Array.isArray(activities) ? activities : [];
  const ts = taskStatus && typeof taskStatus === "object" ? taskStatus : {};

  if (["completed", "ambiente_pruebas", "ambiente_produccion"].includes(toKey) && !canMarkCompleted(activityId, acts, ts)) {
    return false;
  }

  if (toKey === "completed") {
    const current = ["completed", "in_progress", "not_started", ...AMBIENTE_KEYS]
      .find(k => (ts[k] || []).includes(activityId));
    if (AMBIENTE_KEYS.includes(current)) return false;
  }

  if (AMBIENTE_KEYS.includes(toKey)) {
    const act = acts.find(a => a.id === activityId);
    if (!act || act.es_desarrollo !== true) return false;
  }

  return true;
}

// Progreso agregado de un nodo con hijos: promedio simple de los hijos DIRECTOS,
// recursivo (si un hijo también tiene hijos, su valor ya viene agregado). Nodos
// sin hijos devuelven su propio act.progress manual tal cual. Puramente derivado
// para presentación — nunca se persiste en el dato de la actividad.
export function aggregatedProgress(activity, childrenOf) {
  const children = childrenOf.get(activity.id) || [];
  if (!children.length) return Math.max(0, Math.min(100, Number(activity.progress) || 0));
  const sum = children.reduce((s, child) => s + aggregatedProgress(child, childrenOf), 0);
  return Math.round(sum / children.length);
}

// Protege contra mover una tarea a un descendiente suyo (crearía un ciclo).
// Devuelve true si asignar newParentId como padre de activityId formaría un ciclo
// (incluye el caso trivial newParentId === activityId).
export function wouldCreateCycle(activities, activityId, newParentId) {
  if (newParentId == null) return false;
  if (newParentId === activityId) return true;
  const byId = new Map((Array.isArray(activities) ? activities : []).map(a => [a.id, a]));
  let cur = newParentId;
  const seen = new Set();
  while (cur != null) {
    if (cur === activityId) return true;
    if (seen.has(cur)) return false; // ciclo preexistente ajeno a este movimiento — no lo agrava
    seen.add(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return false;
}
