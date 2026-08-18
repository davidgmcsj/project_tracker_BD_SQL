// requestCache.js — Caché en memoria + deduplicación de peticiones GET
// idempotentes, para no golpear el backend (y su pool de conexión a Azure
// SQL, compartido entre todos los usuarios) con peticiones que se pueden
// ahorrar.
//
// Dos problemas que resuelve, distintos entre sí:
//
// 1. RE-FETCH evitable: un dato que casi no cambia (ej. notas de un
//    proyecto) se vuelve a pedir cada vez que el componente que lo muestra
//    se vuelve a montar, aunque nadie lo haya tocado desde la última vez.
//    withCache() sirve la copia en memoria mientras siga fresca (dentro de
//    su TTL) en vez de pedirla de nuevo.
//
// 2. FAN-OUT simultáneo: varios componentes montados a la vez piden EXACTAMENTE
//    lo mismo en la misma pantalla (ej. "Historial" de un ingeniero con 8
//    proyectos, cada bloque de proyecto monta su propio panel de notas).
//    Sin dedupe, son 8 peticiones HTTP paralelas idénticas. withCache()
//    detecta que ya hay una promesa en vuelo para esa misma key y todos los
//    llamados se enganchan a ELLA, así que solo sale 1 petición real.
//
// Vive en memoria (Map a nivel de módulo) — se pierde al refrescar la
// página, que es exactamente el comportamiento correcto: no es una fuente de
// verdad, es solo evitar peticiones redundantes dentro de la misma sesión de
// pestaña. NUNCA reemplaza el patrón dual-write de storage.js (localStorage
// + backend) — esto es una capa adicional solo para lecturas repetidas.

const store = new Map(); // key -> { value, expiresAt }
const inFlight = new Map(); // key -> Promise (peticiones en curso, para el dedupe del punto 2)

const DEFAULT_TTL_MS = 60 * 1000; // 1 minuto — suficiente para absorber el fan-out de montajes en la misma pantalla, sin servir datos viejos por mucho tiempo si alguien edita en otra pestaña/usuario.

/**
 * Envuelve una función async (normalmente una llamada GET de storage.js) con
 * caché en memoria + deduplicación de vuelos en paralelo.
 *
 * @param {string} key        Identificador único del recurso (ej. `notes:${proyectoAppID}`).
 * @param {() => Promise<T>} fetchFn  Función que trae el dato si no hay caché válida.
 * @param {number} [ttlMs]    Tiempo de vida de la entrada en caché. Default 1 minuto.
 * @returns {Promise<T>}
 */
export async function withCache(key, fetchFn, ttlMs = DEFAULT_TTL_MS) {
  const cached = store.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Dedupe: si ya hay una petición en curso para esta misma key, todos los
  // llamados concurrentes se enganchan a ella en vez de disparar la suya.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetchFn()
    .then(value => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => { inFlight.delete(key); });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Invalida una entrada específica — usar tras cualquier escritura que la
 * vuelva obsoleta (ej. crear/borrar una nota de ESE proyecto). Sin esto, el
 * usuario vería el dato viejo hasta que expire el TTL por su cuenta.
 */
export function invalidateCache(key) {
  store.delete(key);
  inFlight.delete(key);
}

/**
 * Invalida todas las entradas cuya key empiece con el prefijo dado — para
 * cuando una sola escritura afecta a varias keys relacionadas (ej. borrar
 * un proyecto invalidaría todas las keys "notes:<eseProyecto>:*" si las
 * hubiera). No usado hoy por ningún caller, pero es el mismo criterio que
 * ya documentan otros helpers "por si hace falta" en el proyecto.
 */
export function invalidateCachePrefix(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
  for (const key of inFlight.keys()) if (key.startsWith(prefix)) inFlight.delete(key);
}

/** Solo para tests — vacía toda la caché entre casos. */
export function _clearCacheForTests() {
  store.clear();
  inFlight.clear();
}
