import test from 'node:test';
import assert from 'node:assert/strict';
import { roadCacheSuitability } from '../geo/offline-store.js';
import { OverpassRoadLoader, roadCacheKey } from '../geo/osm-loader.js';
import { planRoadPrefetch, destinationPoint } from '../geo/road-prefetch.js';
import { MapMatcher } from '../geo/map-matcher.js';
import { buildRoadNetworkFromOverpass } from '../geo/road-network.js';
import { haversineMeters } from '../geo/geo-math.js';

const center = { lat: -23.55, lng: -46.64 };
const osm = { elements: [
  { type: 'way', id: 810, nodes: [1, 2, 3, 4],
    geometry: [-46.641, -46.640, -46.639, -46.638].map(lon => ({ lat: center.lat, lon })),
    tags: { highway: 'primary', name: 'Avenida Contínua', oneway: 'yes' }
  }
] };
const cached = (key = 'old-tile', savedAt = new Date().toISOString(), radiusMeters = 3000) => ({
  key, savedAt,
  data: { osm, metadata: { center, radiusMeters } }
});

test('cache de área vizinha é considerado mesmo com chave de grid diferente', async () => {
  const position = { lat: center.lat + 0.003, lng: center.lng };
  const record = cached();
  assert.notEqual(record.key, roadCacheKey(position.lat, position.lng));
  let networkCalls = 0, nearbyCalls = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: {
      async getRoadNetwork() { return null; },
      async findCoveringRoadNetwork() { nearbyCalls++; return record; }
    },
    isOnline: () => false,
    fetchImpl: async () => { networkCalls++; throw new Error('Nenhuma consulta deveria ser necessária'); }
  });
  const result = await loader.loadAround(position);
  assert.equal(result.source, 'cache-regiao-vizinha');
  assert.equal(result.key, 'old-tile');
  assert.equal(result.provider.getAllSegments().length, 3);
  assert.equal(networkCalls, 0);
  assert.equal(nearbyCalls, 1);
});

test('cache adjacente antigo continua disponível offline e informa data desatualizada', async () => {
  const record = cached('stale', new Date(Date.now() - 41 * 86400000).toISOString());
  const loader = new OverpassRoadLoader({
    offlineStore: {
      async getRoadNetwork() { return null; },
      async findCoveringRoadNetwork() { return record; }
    },
    isOnline: () => false
  });
  const result = await loader.loadAround({ lat: center.lat + 0.002, lng: center.lng });
  assert.equal(result.source, 'cache-offline');
  assert.equal(result.stale, true);
});

test('cache fora da cobertura ou sem dados é rejeitado', () => {
  const record = cached();
  assert.equal(roadCacheSuitability(record, { lat: center.lat + 0.08, lng: center.lng }), -Infinity);
  assert.equal(roadCacheSuitability({ ...record, data: { osm: { elements: [] }, metadata: record.data.metadata } }, center), -Infinity);
  assert.ok(roadCacheSuitability(record, center) > 0);
});

test('cache atual tem prioridade sobre cache velho quando ambos cobrem a região', () => {
  const now = Date.now();
  const fresh = cached('fresh', new Date(now - 86400000).toISOString());
  const old = cached('old', new Date(now - 40 * 86400000).toISOString());
  assert.ok(roadCacheSuitability(fresh, center, 0.95, now) > roadCacheSuitability(old, center, 0.95, now));
});

test('prefetch direcional só ocorre perto da borda e indo para fora da cobertura', () => {
  const provider = { center, radiusMeters: 1800 };
  const position = { lat: center.lat + 0.010, lng: center.lng, speed: 40, accuracy: 8 };
  const destination = planRoadPrefetch(position, provider, 0);
  assert.ok(destination);
  assert.ok(haversineMeters(provider.center, destination) > 1800 * 0.95);
  assert.equal(planRoadPrefetch(position, provider, 180), null);
  assert.equal(planRoadPrefetch({ ...position, speed: 10 }, provider, 0), null);
  assert.equal(planRoadPrefetch({ ...position, accuracy: 50 }, provider, 0), null);
  assert.equal(planRoadPrefetch({ ...position, lat: center.lat + 0.001 }, provider, 0), null);
});

test('projeção geográfica mantém direção e distância aproximada', () => {
  const next = destinationPoint(center, 90, 950);
  assert.ok(Math.abs(haversineMeters(center, next) - 950) < 0.1);
  assert.ok(Math.abs(next.lat - center.lat) < 0.0001);
  assert.ok(next.lng > center.lng);
});

test('Map Matching não descarta junção de segmentos da mesma way', () => {
  const provider = buildRoadNetworkFromOverpass(osm).provider;
  const matcher = new MapMatcher(provider);
  const result = matcher.match({ lat: center.lat, lng: -46.64, speed: 45, heading: 90, accuracy: 5, timestamp: 1000 });
  assert.equal(result.matched, true);
  assert.equal(result.confidence, 'HIGH');
});

test('Map Matching mantém ambiguidade para duas vias diferentes e paralelas', () => {
  const parallelOsm = { elements: [
    { ...osm.elements[0], id: 820, nodes: [21, 22], geometry: [
      { lat: center.lat - 0.00005, lon: -46.6405 }, { lat: center.lat - 0.00005, lon: -46.6395 }
    ] },
    { ...osm.elements[0], id: 821, nodes: [31, 32], geometry: [
      { lat: center.lat + 0.00005, lon: -46.6405 }, { lat: center.lat + 0.00005, lon: -46.6395 }
    ] }
  ] };
  const provider = buildRoadNetworkFromOverpass(parallelOsm).provider;
  const matcher = new MapMatcher(provider);
  const result = matcher.match({ lat: center.lat, lng: -46.64, speed: 45, heading: 90, accuracy: 5, timestamp: 1000 });
  assert.equal(result.matched, false);
  assert.equal(result.confidence, 'UNCERTAIN');
});

test('Map Matching mantém cautela em curva de 90 graus mesmo na mesma way', () => {
  const turn = { elements: [{ type: 'way', id: 850, nodes: [1, 2, 3], geometry: [
    { lat: center.lat - 0.001, lon: center.lng }, { lat: center.lat, lon: center.lng },
    { lat: center.lat, lon: center.lng + 0.001 }
  ], tags: { highway: 'primary', name: 'Curva', oneway: 'yes' } }] };
  const matcher = new MapMatcher(buildRoadNetworkFromOverpass(turn).provider);
  const result = matcher.match({ lat: center.lat, lng: center.lng, speed: 30, accuracy: 6, heading: 45, timestamp: 1000 });
  assert.equal(result.confidence, 'UNCERTAIN');
  assert.equal(result.matched, false);
});
