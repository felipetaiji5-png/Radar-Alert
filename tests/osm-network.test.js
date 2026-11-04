import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNetworkFromOverpass } from '../geo/road-network.js';
import { MapMatcher } from '../geo/map-matcher.js';
import { buildOverpassQuery, roadCacheKey, OverpassRoadLoader } from '../geo/osm-loader.js';

const baseLat = -23.55;
const baseLng = -46.64;
function osmWay(id, nodes, lons, tags = {}) {
  return {
    type: 'way', id, nodes,
    geometry: lons.map(lon => ({ lat: baseLat, lon })),
    tags: { highway: 'primary', name: 'Avenida de Teste', ...tags }
  };
}

test('Overpass query limita os resultados a vias rodoviárias e raio local', () => {
  const query = buildOverpassQuery(baseLat, baseLng, 4500);
  assert.match(query, /way\(around:4500/);
  assert.match(query, /motorway/);
  assert.match(query, /out body geom/);
});

test('chave de cache OSM é estável para posições próximas', () => {
  assert.equal(roadCacheKey(baseLat, baseLng), roadCacheKey(baseLat + 0.0001, baseLng + 0.0001));
});

test('OSM converte one-way=yes em arestas no sentido da way', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(1, [11, 12, 13], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'yes' })] });
  assert.equal(built.provider.getAllSegments().length, 2);
  assert.equal(built.provider.getAllSegments()[0].fromNode, '11');
  assert.equal(built.provider.getAllSegments()[0].toNode, '12');
});

test('OSM converte oneway=-1 em arestas no sentido inverso', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(2, [21, 22], [baseLng, baseLng + 0.001], { oneway: '-1' })] });
  const edge = built.provider.getAllSegments()[0];
  assert.equal(built.provider.getAllSegments().length, 1);
  assert.equal(edge.fromNode, '22');
  assert.equal(edge.toNode, '21');
});

test('OSM mantém vias bidirecionais como duas arestas direcionadas', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(3, [31, 32], [baseLng, baseLng + 0.001], { oneway: 'no' })] });
  assert.equal(built.provider.getAllSegments().length, 2);
  assert.notEqual(built.provider.getAllSegments()[0].bearing, built.provider.getAllSegments()[1].bearing);
});

test('grafo calcula distância pela estrada em mais de um segmento', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(10, [101, 102, 103], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'yes', ref: 'SP-000' }),
    osmWay(11, [103, 104], [baseLng + 0.002, baseLng + 0.003], { oneway: 'yes', ref: 'SP-000' })
  ] });
  const provider = built.provider;
  const matcher = new MapMatcher(provider);
  const match = matcher.match({ lat: baseLat, lng: baseLng + 0.00045, speed: 30, accuracy: 4, heading: 90, timestamp: 1000 });
  assert.equal(match.confidence, 'HIGH');
  const radar = { id: 'r1', lat: baseLat, lng: baseLng + 0.0025, active: true, limit: 60, direction: 90, source: 'fixture' };
  provider.attachRadars([radar]);
  const routed = provider.getRoutedRadars(match, [radar]);
  assert.equal(routed.length, 1);
  assert.ok(routed[0].routeDistanceMeters > 150);
  assert.ok(routed[0].routeDistanceMeters < 300);
});

test('radar sem direção em via bidirecional não é confirmado automaticamente', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(20, [201, 202], [baseLng, baseLng + 0.001], { oneway: 'no' })] });
  const radar = { id: 'r-bidir', lat: baseLat, lng: baseLng + 0.0005, active: true, direction: null };
  built.provider.attachRadars([radar]);
  assert.equal(built.provider.radarAttachments.get(radar.id).eligible, false);
});

test('radar sem direção em trecho de sentido único pode ser associado por inferência', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(21, [211, 212], [baseLng, baseLng + 0.001], { oneway: 'yes' })] });
  const radar = { id: 'r-oneway', lat: baseLat, lng: baseLng + 0.0005, active: true, direction: null };
  built.provider.attachRadars([radar]);
  const attachment = built.provider.radarAttachments.get(radar.id);
  assert.equal(attachment.eligible, true);
  assert.equal(attachment.directionSource, 'osm_one_direction_nearby');
});

test('segmentos em níveis diferentes não entram na mesma rota', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(30, [301, 302], [baseLng, baseLng + 0.001], { oneway: 'yes', ref: 'A-1', layer: '0' }),
    osmWay(31, [302, 303], [baseLng + 0.001, baseLng + 0.002], { oneway: 'yes', ref: 'A-1', layer: '1' })
  ] });
  const distances = built.provider.shortestDistances('302', 'ref:A-1', 0, 5000);
  assert.equal(distances.has('303'), false);
});

test('ways sem node ids correspondentes são rejeitadas com segurança', () => {
  const malformed = osmWay(40, [401], [baseLng, baseLng + 0.001]);
  const built = buildRoadNetworkFromOverpass({ elements: [malformed] });
  assert.equal(built.provider.getAllSegments().length, 0);
  assert.equal(built.skipped.malformed, 1);
});


test('loader baixa geometria via fetch injetado e grava cache', async () => {
  const fixture = { elements: [osmWay(90, [901, 902], [baseLng, baseLng + 0.001], { oneway: 'yes' })], osm3s: { timestamp_osm_base: '2026-11-03T00:00:00Z' } };
  let saved = null;
  const store = {
    async getRoadNetwork() { return null; },
    async saveRoadNetwork(key, data) { saved = { key, data }; return true; }
  };
  const loader = new OverpassRoadLoader({
    offlineStore: store,
    endpoints: ['https://overpass.test/interpreter'],
    isOnline: () => true,
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /data=/);
      return { ok: true, json: async () => fixture };
    }
  });
  const result = await loader.loadAround({ lat: baseLat, lng: baseLng });
  assert.equal(result.source, 'Overpass');
  assert.equal(result.provider.getAllSegments().length, 1);
  assert.ok(saved?.data?.osm);
  assert.equal(result.provider.center.lat, baseLat);
});

test('loader reutiliza a malha OSM em cache quando fica offline', async () => {
  const fixture = { elements: [osmWay(91, [911, 912], [baseLng, baseLng + 0.001], { oneway: 'yes' })] };
  const center = { lat: baseLat, lng: baseLng };
  const cachedRecord = {
    savedAt: new Date().toISOString(),
    data: { osm: fixture, metadata: { center, radiusMeters: 4500, osmTimestamp: null } }
  };
  let fetchCount = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return cachedRecord; } },
    fetchImpl: async () => { fetchCount++; throw new Error('não deveria consultar a rede'); },
    isOnline: () => false
  });
  const result = await loader.loadAround(center);
  assert.equal(result.source, 'cache');
  assert.equal(result.provider.getAllSegments().length, 1);
  assert.equal(fetchCount, 0);
});

test('consulta Overpass arredonda centro da posição a três casas decimais', () => {
  const query = buildOverpassQuery(-23.55061, -46.63327, 4500);
  assert.match(query, /-23\.551,-46\.633/);
  assert.doesNotMatch(query, /-23\.550610/);
});

test('motorway sem tag oneway explícita segue convenção unidirecional do OSM', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(50, [501, 502], [baseLng, baseLng + 0.001], { highway: 'motorway' })] });
  const edges = built.provider.getAllSegments();
  assert.equal(edges.length, 1);
  assert.equal(edges[0].physicalOneway, true);
  assert.equal(edges[0].fromNode, '501');
});

test('motorway com oneway=no explícito permanece bidirecional', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(51, [511, 512], [baseLng, baseLng + 0.001], { highway: 'motorway', oneway: 'no' })] });
  assert.equal(built.provider.getAllSegments().length, 2);
  assert.equal(built.provider.getAllSegments().every(edge => edge.physicalOneway === false), true);
});

test('oneway ausente em motorway_link segue sentido único padrão', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(52, [521, 522], [baseLng, baseLng + 0.001], { highway: 'motorway_link' })] });
  assert.equal(built.provider.getAllSegments().length, 1);
});

test('radar sem direção não é inferido quando há duas ways unidirecionais paralelas', () => {
  const secondWay = {
    ...osmWay(54, [541, 542], [baseLng, baseLng + 0.001], { highway: 'primary', oneway: 'yes' }),
    geometry: [{ lat: baseLat + 0.0002, lon: baseLng }, { lat: baseLat + 0.0002, lon: baseLng + 0.001 }]
  };
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(53, [531, 532], [baseLng, baseLng + 0.001], { highway: 'primary', oneway: 'yes' }),
    secondWay
  ] });
  const radar = { id: 'r-parallel', lat: baseLat + 0.00005, lng: baseLng + 0.0005, active: true, direction: null };
  built.provider.attachRadars([radar]);
  assert.equal(built.provider.radarAttachments.get(radar.id).eligible, false);
});

test('loader respeita cooldown depois de HTTP 429 sem tentar endpoint alternativo imediatamente', async () => {
  let calls = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return null; } },
    endpoints: ['https://overpass-1.test/interpreter', 'https://overpass-2.test/interpreter'],
    isOnline: () => true,
    fetchImpl: async () => { calls++; return { ok: false, status: 429 }; }
  });
  await assert.rejects(loader.loadAround({ lat: baseLat, lng: baseLng }), /HTTP 429/);
  assert.equal(calls, 1);
  await assert.rejects(loader.loadAround({ lat: baseLat, lng: baseLng }), /temporariamente indisponíveis/);
  assert.equal(calls, 1);
});

test('grafo bidirecional não cria retorno artificial para radar já ultrapassado no mesmo segmento', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(100, [1001, 1002, 1003], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'no', ref: 'SP-TESTE' })
  ] });
  const provider = built.provider;
  const matcher = new MapMatcher(provider);
  const match = matcher.match({ lat: baseLat, lng: baseLng + 0.0008, speed: 35, accuracy: 4, heading: 90, timestamp: 1000 });
  const ahead = { id: 'ahead', lat: baseLat, lng: baseLng + 0.0015, active: true, direction: 90, kind: 'FIXED' };
  const behind = { id: 'behind', lat: baseLat, lng: baseLng + 0.0002, active: true, direction: 90, kind: 'FIXED' };
  provider.attachRadars([ahead, behind]);
  const routed = provider.getRoutedRadars(match, [ahead, behind]);
  assert.deepEqual(routed.map(item => item.id), ['ahead']);
  assert.ok(routed[0].routeDistanceMeters > 50 && routed[0].routeDistanceMeters < 100);
});

test('grafo bidirecional não percorre a via para trás até um radar em segmento anterior', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(101, [1011, 1012, 1013, 1014], [baseLng, baseLng + 0.001, baseLng + 0.002, baseLng + 0.003], { oneway: 'no', ref: 'SP-TESTE-2' })
  ] });
  const provider = built.provider;
  const matcher = new MapMatcher(provider);
  const match = matcher.match({ lat: baseLat, lng: baseLng + 0.0025, speed: 35, accuracy: 4, heading: 90, timestamp: 1000 });
  const behind = { id: 'behind-previous-edge', lat: baseLat, lng: baseLng + 0.0005, active: true, direction: 90, kind: 'FIXED' };
  provider.attachRadars([behind]);
  assert.deepEqual(provider.getRoutedRadars(match, [behind]), []);
});


test('ways com oneway reversível são rejeitadas para não inventar sentido', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(110, [1101, 1102], [baseLng, baseLng + 0.001], { oneway: 'reversible' })] });
  assert.equal(built.provider.getAllSegments().length, 0);
  assert.equal(built.skipped.unsupported, 1);
});

test('ways com oneway condicional não entram no grafo estático', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(111, [1111, 1112], [baseLng, baseLng + 0.001], { oneway: 'yes', 'oneway:conditional': 'no @ (Mo-Fr 07:00-09:00)' })] });
  assert.equal(built.provider.getAllSegments().length, 0);
  assert.equal(built.skipped.unsupported, 1);
});

test('radar de trecho só é associado quando início e fim seguem a mesma via e sentido', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(120, [1201, 1202, 1203], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'yes', ref: 'SP-SECTION' })
  ] });
  const radar = {
    id: 'section-ok', kind: 'SECTION', lat: baseLat, lng: baseLng + 0.0002,
    endLat: baseLat, endLng: baseLng + 0.0018, direction: 90, active: true
  };
  const count = built.provider.attachRadars([radar]);
  const attachment = built.provider.radarAttachments.get(radar.id);
  assert.equal(count, 1);
  assert.equal(attachment.eligible, true);
  assert.ok(attachment.sectionLengthMeters > 150 && attachment.sectionLengthMeters < 210);
});

test('radar de trecho com ponto final na direção contrária não é associado', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [
    osmWay(121, [1211, 1212, 1213], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'yes', ref: 'SP-SECTION-2' })
  ] });
  const radar = {
    id: 'section-reversed', kind: 'SECTION', lat: baseLat, lng: baseLng + 0.0018,
    endLat: baseLat, endLng: baseLng + 0.0002, direction: 90, active: true
  };
  built.provider.attachRadars([radar]);
  const attachment = built.provider.radarAttachments.get(radar.id);
  assert.equal(attachment.eligible, false);
  assert.match(attachment.reason, /FINAL_DO_TRECHO|EXTENSAO/);
});

test('exportação da malha para Android preserva arestas direcionadas e radares associados', () => {
  const built = buildRoadNetworkFromOverpass({
    elements: [osmWay(130, [1301, 1302, 1303], [baseLng, baseLng + 0.001, baseLng + 0.002], { oneway: 'yes', ref: 'SP-BG' })]
  }, { center: { lat: baseLat, lng: baseLng }, radiusMeters: 4500, osmTimestamp: 'fixture' });
  const radar = { id: 'native-r1', kind: 'FIXED', lat: baseLat, lng: baseLng + 0.0015, active: true, direction: 90, limit: 60, source: 'fixture' };
  built.provider.attachRadars([radar]);
  const exported = built.provider.exportForBackground();
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.edges.length, 2);
  assert.equal(exported.attachments.length, 1);
  assert.equal(exported.attachments[0][0], 'native-r1');
  assert.equal(exported.attachments[0][1], 'w130:1:f');
  assert.ok(exported.edges.every(edge => edge.length === 12));
  assert.ok(exported.attachments.every(item => item.length === 9));
});

test('exportação Android falha explicitamente quando a malha excede o limite', () => {
  const built = buildRoadNetworkFromOverpass({ elements: [osmWay(131, [1311, 1312], [baseLng, baseLng + 0.001], { oneway: 'yes' })] });
  assert.throws(() => built.provider.exportForBackground({ maxEdges: 0 }), /limite seguro/);
});


test('consulta OSM padrão usa raio reduzido e timeout coerente com Overpass', () => {
  const query = buildOverpassQuery(baseLat, baseLng);
  assert.match(query, /\[timeout:15\]/);
  assert.match(query, /way\(around:3000/);
});

test('loader identifica timeout e tenta endpoint alternativo com raio menor', async () => {
  const fixture = { elements: [osmWay(140, [1401, 1402], [baseLng, baseLng + 0.001], { oneway: 'yes' })] };
  const attempts = [];
  const saved = [];
  const loader = new OverpassRoadLoader({
    offlineStore: {
      async getRoadNetwork() { return null; },
      async saveRoadNetwork(key, data) { saved.push({ key, data }); }
    },
    endpoints: ['https://overpass-1.test/api', 'https://overpass-2.test/api'],
    timeoutMs: 8,
    isOnline: () => true,
    onAttempt: item => attempts.push(item),
    fetchImpl: async (url, options) => {
      if (url.includes('overpass-1')) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true });
        });
      }
      return { ok: true, json: async () => fixture };
    }
  });

  const result = await loader.loadAround({ lat: baseLat, lng: baseLng });
  assert.equal(result.source, 'Overpass');
  assert.equal(result.provider.radiusMeters, 1800);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].ok, false);
  assert.match(attempts[0].error, /tempo limite de 1 s excedido/);
  assert.equal(attempts[1].ok, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].data.metadata.radiusMeters, 1800);
});

test('loader devolve erro legível quando todos os endpoints excedem timeout', async () => {
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return null; } },
    endpoints: ['https://overpass-1.test/api', 'https://overpass-2.test/api'],
    timeoutMs: 8,
    isOnline: () => true,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })
  });
  await assert.rejects(
    loader.loadAround({ lat: baseLat, lng: baseLng }),
    /Não foi possível baixar a malha OSM.*tempo limite.*GPS continua funcionando/s
  );
});


test('loader tenta uma terceira instância pública após 502 e timeout', async () => {
  const calls = [];
  const fixture = { elements: [osmWay(130, [1301, 1302], [baseLng, baseLng + 0.001], { oneway: 'yes' })] };
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return null; }, async saveRoadNetwork() {} },
    endpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ],
    isOnline: () => true,
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return { ok: false, status: 502 };
      if (calls.length === 2) throw new Error('network timeout');
      return { ok: true, json: async () => fixture };
    }
  });
  const result = await loader.loadAround({ lat: baseLat, lng: baseLng });
  assert.equal(calls.length, 3);
  assert.match(calls[2], /maps\.mail\.ru/);
  assert.equal(result.source, 'Overpass');
});

test('loader aplica cooldown após falha total para não sobrecarregar Overpass', async () => {
  let calls = 0;
  const loader = new OverpassRoadLoader({
    offlineStore: { async getRoadNetwork() { return null; } },
    endpoints: ['https://one.test/interpreter', 'https://two.test/interpreter'],
    isOnline: () => true,
    fetchImpl: async () => { calls++; return { ok: false, status: 502 }; }
  });
  await assert.rejects(loader.loadAround({ lat: baseLat, lng: baseLng }), /Não foi possível baixar a malha OSM/);
  assert.equal(calls, 2);
  await assert.rejects(loader.loadAround({ lat: baseLat, lng: baseLng }), /temporariamente indisponíveis/);
  assert.equal(calls, 2);
});

test('0.9.1: infere o sentido de radar sem direção apenas na mão única claramente mais próxima', () => {
  const nearbySpur = {
    ...osmWay(201, [2011, 2012], [baseLng, baseLng + 0.001], { oneway: 'yes', name: 'Rua Paralela' }),
    geometry: [{ lat: baseLat + 0.0004, lon: baseLng }, { lat: baseLat + 0.0004, lon: baseLng + 0.001 }]
  };
  const provider = buildRoadNetworkFromOverpass({ elements: [
    osmWay(200, [2001, 2002, 2003], [baseLng, baseLng + 0.0005, baseLng + 0.001], { oneway: 'yes' }),
    nearbySpur
  ] }).provider;
  const radar = { id: 'r-oneway-clear', lat: baseLat + 0.00002, lng: baseLng + 0.0005, direction: null, kind: 'FIXED', active: true };
  assert.equal(provider.attachRadars([radar]), 1);
  assert.equal(provider.radarAttachments.get(radar.id).directionSource, 'osm_one_direction_nearby');
  assert.equal(provider.lastAttachmentStats.inferredOneway, 1);
  assert.equal(provider.lastAttachmentStats.missingDirectionNear, 1);
});

test('0.9.1: não infere direção em rua bidirecional mesmo quando é a única via', () => {
  const provider = buildRoadNetworkFromOverpass({ elements: [
    osmWay(210, [2101, 2102], [baseLng, baseLng + 0.001], { oneway: 'no' })
  ] }).provider;
  const radar = { id: 'r-bidirectional', lat: baseLat, lng: baseLng + 0.0004, direction: null, kind: 'FIXED', active: true };
  assert.equal(provider.attachRadars([radar]), 0);
  assert.equal(provider.lastAttachmentStats.nearby, 1);
  assert.equal(provider.lastAttachmentStats.reasons.DIRECAO_OU_VIA_AMBIGUA, 1);
});

test('0.9.1: pista paralela a distância intermediária continua ambígua', () => {
  const parallel = {
    ...osmWay(221, [2211, 2212], [baseLng, baseLng + 0.001], { oneway: 'yes' }),
    geometry: [{ lat: baseLat + 0.00018, lon: baseLng }, { lat: baseLat + 0.00018, lon: baseLng + 0.001 }]
  };
  const provider = buildRoadNetworkFromOverpass({ elements: [
    osmWay(220, [2201, 2202], [baseLng, baseLng + 0.001], { oneway: 'yes' }), parallel
  ] }).provider;
  const radar = { id: 'r-close-parallel', lat: baseLat + 0.00003, lng: baseLng + 0.0005, direction: null, active: true };
  assert.equal(provider.attachRadars([radar]), 0);
  assert.equal(provider.lastAttachmentStats.reasons.DIRECAO_OU_VIA_AMBIGUA, 1);
});

test('0.9.1: contador distingue radar sem direção, direção conhecida e ausência na malha', () => {
  const provider = buildRoadNetworkFromOverpass({ elements: [
    osmWay(230, [2301, 2302], [baseLng, baseLng + 0.001], { oneway: 'yes' })
  ] }).provider;
  const radars = [
    { id: 'known', lat: baseLat, lng: baseLng + 0.0002, direction: 90, active: true },
    { id: 'missing', lat: baseLat, lng: baseLng + 0.0003, direction: null, active: true },
    { id: 'far', lat: baseLat + 0.02, lng: baseLng + 0.02, direction: null, active: true }
  ];
  assert.equal(provider.attachRadars(radars), 2);
  assert.equal(provider.lastAttachmentStats.considered, 3);
  assert.equal(provider.lastAttachmentStats.nearby, 2);
  assert.equal(provider.lastAttachmentStats.knownDirectionNear, 1);
  assert.equal(provider.lastAttachmentStats.missingDirectionNear, 1);
  assert.equal(provider.lastAttachmentStats.ambiguous, 0);
});
