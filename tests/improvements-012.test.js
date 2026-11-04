import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMotion, resolveMotionHeading } from '../geo/motion-heading.js';
import { SpatialIndex } from '../geo/spatial-index.js';
import { RoadSegment, RoadNetworkProvider } from '../geo/road-network.js';
import { MapMatcher } from '../geo/map-matcher.js';
import { OverpassRoadLoader } from '../geo/osm-loader.js';

const lat = -23.55, lng = -46.63;
const fix = (offset, accuracy, timestamp, extra = {}) => ({
  lat, lng: lng + offset, accuracy, timestamp, speed: null, heading: null, ...extra
});
const longStreet = new RoadSegment({ id: 'longa', name: 'Rua Longa',
  coords: [{ lat, lng: lng - 0.02 }, { lat, lng: lng + 0.02 }], oneway: 1 });

test('0.12: ruído entre dois pontos com incerteza GPS ±15 m não produz rumo', () => {
  const previous = fix(0, 15, 1000);
  const current = fix(0.0001, 15, 3000); // ~10 m, abaixo da incerteza combinada
  assert.equal(estimateMotion(previous, current), null);
  assert.equal(resolveMotionHeading(current, previous).heading, null);
});

test('0.12: movimento significativo pode derivar rumo quando sensor não informa velocidade', () => {
  const result = resolveMotionHeading(fix(0.0003, 5, 3000), fix(0, 5, 1000));
  assert.equal(result.source, 'DERIVED');
  assert.ok(result.heading > 80 && result.heading < 100);
});

test('0.12: um salto enorme em 1s não se transforma em direção confiável', () => {
  assert.equal(estimateMotion(fix(0, 5, 1000), fix(0.004, 5, 2000)), null);
});

test('0.12: timestamps repetidos ou lacunas longas não geram rumo', () => {
  assert.equal(estimateMotion(fix(0, 5, 1000), fix(0.0003, 5, 1000)), null);
  assert.equal(estimateMotion(fix(0, 5, 1000), fix(0.0003, 5, 31000)), null);
});

test('0.12: 0 km/h bloqueia rumo mesmo quando bearing residual existe', () => {
  assert.deepEqual(resolveMotionHeading(fix(0, 5, 2000, { speed: 0, heading: 90 }), fix(0, 5, 1000)), {
    heading: null, source: 'UNCERTAIN'
  });
});

test('0.12: fix GPS ruim não polui o próximo rumo do Map Matching', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([longStreet]));
  matcher.match(fix(0, 5, 1000));
  matcher.match(fix(-0.01, 100, 2000));
  const result = matcher.match(fix(0.00008, 5, 3000));
  assert.equal(result.headingConfidence, 'UNCERTAIN');
  assert.equal(result.matched, false);
});

test('0.12: depois de 30s sem fix, continuidade da via é descartada', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([longStreet]));
  matcher.match(fix(0, 5, 1000, { speed: 30, heading: 90 }));
  assert.ok(matcher.lastMatchedId);
  matcher.match(fix(0.0002, 5, 40001, { speed: 0, heading: null }));
  assert.equal(matcher.lastMatchedId, null);
  assert.equal(matcher.recentPositions.length, 1);
});

test('0.12: índice de trecho longo encontra a ponta sem ampliar busca pelo comprimento total', () => {
  const provider = new RoadNetworkProvider([longStreet]);
  const nearEnd = { lat, lng: lng - 0.0198 };
  assert.equal(provider.getCandidates(nearEnd, 25).length, 1);
  assert.equal(provider.getCandidates({ lat: lat + 0.02, lng }, 25).length, 0);
});

test('0.12: índice não devolve a mesma aresta várias vezes quando atravessa células', () => {
  const spatial = new SpatialIndex(0.0025);
  spatial.insertSegment(longStreet);
  assert.deepEqual(spatial.queryRadius(lat, lng, 450).map(item => item.id), ['longa']);
  assert.equal(spatial.count, 1);
});

test('0.12: cache OSM vencido é disponibilizado imediatamente, mesmo online', async () => {
  const osm = { elements: [{ type: 'way', id: 920, nodes: [1, 2],
    geometry: [{ lat, lon: lng }, { lat, lon: lng + 0.001 }],
    tags: { highway: 'residential', name: 'Rua Offline' } }] };
  const stored = { key: 'antigo', savedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    data: { osm, metadata: { center: { lat, lng }, radiusMeters: 3000 } } };
  let fetchCalls = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return stored; } },
    isOnline: () => true, endpoints: ['https://example.org/osm'],
    fetchImpl: async () => { fetchCalls++; throw Error('Consulta desnecessária'); }
  });
  const result = await loader.loadAround({ lat, lng });
  assert.equal(result.source, 'cache-antigo');
  assert.equal(result.stale, true);
  assert.equal(result.provider.getAllSegments().length, 2);
  assert.equal(fetchCalls, 0);
});

test('0.12: atualização manual ainda tenta a rede mesmo com cache vencido', async () => {
  const osm = { elements: [{ type: 'way', id: 930, nodes: [1, 2],
    geometry: [{ lat, lon: lng }, { lat, lon: lng + 0.001 }],
    tags: { highway: 'residential', name: 'Rua Nova' } }] };
  const old = { key: 'antigo', savedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    data: { osm, metadata: { center: { lat, lng }, radiusMeters: 3000 } } };
  let calls = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return old; }, async saveRoadNetwork() {} },
    isOnline: () => true, endpoints: ['https://example.org/osm'],
    fetchImpl: async () => { calls++; return { ok: true, json: async () => osm }; }
  });
  const result = await loader.loadAround({ lat, lng }, { force: true });
  assert.equal(result.source, 'Overpass');
  assert.equal(calls, 1);
});
