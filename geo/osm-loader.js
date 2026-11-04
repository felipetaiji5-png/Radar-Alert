import { buildRoadNetworkFromOverpass } from './road-network.js';
import { roadCacheSuitability } from './offline-store.js';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// Começa com uma área menor para reduzir o custo da consulta em regiões densas.
// O primeiro usa o raio padrão; os próximos tentam a mesma área reduzida.
export const ROAD_NETWORK_RADIUS_METERS = 3000;
export const ROAD_NETWORK_FALLBACK_RADIUS_METERS = 1800;
const CACHE_MAX_AGE_DAYS = 30;
const OVERPASS_QUERY_TIMEOUT_SECONDS = 15;

export function buildOverpassQuery(lat, lng, radiusMeters = ROAD_NETWORK_RADIUS_METERS) {
  const safeLat = Number(lat), safeLng = Number(lng);
  const radius = Math.max(1000, Math.min(7000, Number(radiusMeters)));
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    throw new TypeError('Coordenadas inválidas para consultar OpenStreetMap.');
  }
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];way(around:${Math.round(radius)},${(Math.round(safeLat * 1000) / 1000).toFixed(3)},${(Math.round(safeLng * 1000) / 1000).toFixed(3)})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$"];out body geom qt;`;
}

export function roadCacheKey(lat, lng) {
  return `osm-roads:${(Math.round(lat * 200) / 200).toFixed(4)}:${(Math.round(lng * 200) / 200).toFixed(4)}`;
}

async function postOverpass(endpoint, query, timeoutMs, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Overpass respondeu HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const json = await response.json();
    if (!Array.isArray(json.elements)) throw new Error('Resposta Overpass sem elementos OSM.');
    if (json.remark) throw new Error(`Resposta Overpass incompleta: ${json.remark}`);
    return json;
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`tempo limite de ${Math.max(1, Math.ceil(timeoutMs / 1000))} s excedido`);
      timeoutError.name = 'TimeoutError';
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function notifyAttempt(callback, details) {
  if (typeof callback !== 'function') return;
  try { callback(details); } catch { /* diagnóstico não deve interromper a carga */ }
}

export class OverpassRoadLoader {
  constructor({
    offlineStore,
    endpoints = OVERPASS_ENDPOINTS,
    radiusMeters = ROAD_NETWORK_RADIUS_METERS,
    fallbackRadiusMeters = ROAD_NETWORK_FALLBACK_RADIUS_METERS,
    timeoutMs = 18000,
    fetchImpl = globalThis.fetch,
    isOnline = () => globalThis.navigator?.onLine !== false,
    onAttempt = null
  } = {}) {
    this.store = offlineStore;
    this.endpoints = endpoints;
    this.radiusMeters = radiusMeters;
    this.fallbackRadiusMeters = fallbackRadiusMeters;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.isOnline = isOnline;
    this.onAttempt = onAttempt;
    this.lastRequestAt = 0;
    this.retryAfter = 0;
  }

  async loadAround(position, { force = false } = {}) {
    const key = roadCacheKey(position.lat, position.lng);
    const exact = await this.store?.getRoadNetwork?.(key);
    // A malha de uma célula vizinha também pode cobrir a posição. Não exigir
    // igualdade da chave é crucial ao cruzar divisões do grid ou ficar offline.
    const nearby = roadCacheSuitability(exact, position) < 100000
      ? await this.store?.findCoveringRoadNetwork?.(position)
      : null;
    const cacheCandidates = [exact, nearby].filter(Boolean).sort((a, b) =>
      roadCacheSuitability(b, position) - roadCacheSuitability(a, position));
    let cached = null, cachedProvider = null;
    for (const record of cacheCandidates) {
      if (roadCacheSuitability(record, position) === -Infinity) continue;
      try {
        const built = buildRoadNetworkFromOverpass(record.data.osm, record.data.metadata);
        if (!built.provider.getAllSegments().length || !built.provider.covers(position, 0.95)) continue;
        cached = record;
        cachedProvider = built;
        break;
      } catch { /* registro danificado: experimentar o próximo cache */ }
    }
    const cachedTime = cached?.savedAt ? new Date(cached.savedAt).getTime() : NaN;
    const cachedAge = Number.isFinite(cachedTime) && cachedTime <= Date.now() ? Date.now() - cachedTime : Infinity;
    const center = cached?.data?.metadata?.center;
    const cacheCovers = Boolean(cachedProvider);
    const cacheKey = cached?.key || key;
    if (!force && cacheCovers && cachedAge < CACHE_MAX_AGE_DAYS * 86400000) {
      cachedProvider.provider.center = center;
      cachedProvider.provider.radiusMeters = cached.data.metadata.radiusMeters;
      return { ...cachedProvider, source: cacheKey === key ? 'cache' : 'cache-regiao-vizinha', savedAt: cached.savedAt, stale: false, key: cacheKey };
    }

    if (!this.isOnline()) {
      if (cacheCovers) {
        cachedProvider.provider.center = center;
        cachedProvider.provider.radiusMeters = cached.data.metadata.radiusMeters;
        return { ...cachedProvider, source: 'cache-offline', savedAt: cached.savedAt, stale: cachedAge >= CACHE_MAX_AGE_DAYS * 86400000, key: cacheKey };
      }
      throw new Error('Sem internet e sem geometria viária em cache para esta região.');
    }
    // Cache antigo ainda representa geometria conhecida. Não bloqueie o GPS
    // por até três timeouts só para renová-lo; botão manual força consulta.
    if (!force && cacheCovers && cachedAge >= CACHE_MAX_AGE_DAYS * 86400000) {
      return { ...cachedProvider,
        source: 'cache-antigo', savedAt: cached.savedAt, stale: true, key: cacheKey,
        warning: 'Ruas OSM armazenadas há mais de 30 dias; atualize manualmente ao ter conexão.' };
    }

    if (Date.now() < this.retryAfter) {
      if (cacheCovers) {
        cachedProvider.provider.center = center;
        cachedProvider.provider.radiusMeters = cached.data.metadata.radiusMeters;
        return { ...cachedProvider, source: 'cache-backoff', savedAt: cached.savedAt, stale: true, key: cacheKey, warning: 'Consulta OSM temporariamente em espera após falhas nos servidores.' };
      }
      const waitSeconds = Math.max(1, Math.ceil((this.retryAfter - Date.now()) / 1000));
      throw new Error(`Servidores OSM temporariamente indisponíveis. Nova tentativa em aproximadamente ${waitSeconds} s.`);
    }
    if (Date.now() - this.lastRequestAt < 45000 && !force) {
      if (cacheCovers) {
        cachedProvider.provider.center = center;
        cachedProvider.provider.radiusMeters = cached.data.metadata.radiusMeters;
        return { ...cachedProvider, source: 'cache-recent', savedAt: cached.savedAt, stale: true, key: cacheKey };
      }
      throw new Error('Consulta OSM recente. Aguarde antes de solicitar outra região.');
    }

    this.lastRequestAt = Date.now();
    const failures = [];
    let osm = null, built = null, metadata = null;

    for (let index = 0; index < this.endpoints.length; index++) {
      const endpoint = this.endpoints[index];
      const attemptRadius = index === 0
        ? this.radiusMeters
        : Math.min(this.radiusMeters, this.fallbackRadiusMeters);
      const query = buildOverpassQuery(position.lat, position.lng, attemptRadius);
      const startedAt = Date.now();

      try {
        const candidate = await postOverpass(endpoint, query, this.timeoutMs, this.fetchImpl);
        const candidateMetadata = {
          center: { lat: position.lat, lng: position.lng }, radiusMeters: attemptRadius,
          osmTimestamp: candidate.osm3s?.timestamp_osm_base || null,
          downloadedAt: new Date().toISOString(), endpoint
        };
        const candidateBuilt = buildRoadNetworkFromOverpass(candidate, candidateMetadata);
        if (!candidateBuilt.provider.getAllSegments().length) {
          throw new Error('A consulta OSM retornou dados, mas nenhum segmento viário utilizável.');
        }
        osm = candidate;
        built = candidateBuilt;
        metadata = candidateMetadata;
        notifyAttempt(this.onAttempt, {
          endpoint, radiusMeters: attemptRadius, durationMs: Date.now() - startedAt,
          ok: true, elementCount: osm.elements.length
        });
        break;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const summary = `${new URL(endpoint).host}: ${error.message}`;
        failures.push(summary);
        notifyAttempt(this.onAttempt, {
          endpoint, radiusMeters: attemptRadius, durationMs,
          ok: false, error: error.message, status: error.status || null
        });
        if (error.status === 429 || error.status === 406) {
          this.retryAfter = Date.now() + 30000;
          break;
        }
      }
    }

    if (!osm) {
      // Evita martelar instâncias públicas quando várias estão degradadas.
      // Aumenta o intervalo entre tentativas após 502, timeout ou falhas de rede.
      this.retryAfter = Date.now() + 120000;
      if (cacheCovers) {
        cachedProvider.provider.center = center;
        cachedProvider.provider.radiusMeters = cached.data.metadata.radiusMeters;
        return { ...cachedProvider, source: 'cache-fallback', savedAt: cached.savedAt, stale: true, key: cacheKey, warning: failures.join('; ') };
      }
      throw new Error(
        `Não foi possível baixar a malha OSM (${failures.join('; ') || 'nenhum endpoint disponível'}). ` +
        'O GPS continua funcionando, mas alertas por estrada ficam suspensos. Tente novamente com conexão estável.'
      );
    }

    let persisted = false;
    try { persisted = await this.store?.saveRoadNetwork?.(key, { osm, metadata }) === true; }
    catch { /* A malha válida continua utilizável nesta sessão. */ }
    this.retryAfter = 0;
    return { ...built, source: 'Overpass', savedAt: metadata.downloadedAt, stale: false, key, persisted,
      warning: persisted ? null : 'Ruas carregadas somente nesta sessão; não foi possível salvar a região para uso offline.' };
  }
}
