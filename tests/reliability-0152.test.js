import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRadarDataset } from '../geo/dataset-loader.js';
import { DEFAULT_SETTINGS, normalizeSettings, persistSettings } from '../geo/preferences.js';
import { OverpassRoadLoader } from '../geo/osm-loader.js';
import { deriveSystemHealth } from '../ui/system-health.js';

const center = { lat: -23.55, lng: -46.64 };
const osm = { elements: [{ type: 'way', id: 1, nodes: [1, 2],
  geometry: [{ lat: center.lat, lon: center.lng }, { lat: center.lat, lon: center.lng + .001 }],
  tags: { highway: 'residential', oneway: 'yes' } }] };
const cached = { key: 'saved', savedAt: new Date().toISOString(), data: { osm, metadata: { center, radiusMeters: 3000 } } };
const urls = ['https://one.test/osm', 'https://two.test/osm'];

for (const [label, first] of [
  ['resposta vazia', { elements: [] }],
  ['resposta parcial', { ...osm, remark: 'runtime error: Query timed out' }],
  ['sem geometria utilizável', { elements: [{ type: 'node', id: 1 }] }]
]) test(`OSM tenta outro servidor após ${label} e só salva dados válidos`, async () => {
  const calls = [], saved = [], attempts = [];
  const loader = new OverpassRoadLoader({ endpoints: urls, isOnline: () => true,
    offlineStore: { saveRoadNetwork: async (key, data) => { saved.push(data); return true; } },
    onAttempt: attempt => attempts.push(attempt),
    fetchImpl: async url => { calls.push(url); return { ok: true, json: async () => calls.length === 1 ? first : osm }; }
  });
  const result = await loader.loadAround(center);
  assert.deepEqual(calls, urls);
  assert.deepEqual(attempts.map(a => a.ok), [false, true]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].metadata.endpoint, urls[1]);
  assert.equal(result.provider.getAllSegments().length, 1);
  assert.equal(result.persisted, true);
});

test('OSM preserva cache válido quando todos os servidores retornam dados incompletos', async () => {
  let saves = 0;
  const loader = new OverpassRoadLoader({ endpoints: urls, isOnline: () => true,
    offlineStore: { getRoadNetwork: async () => cached, saveRoadNetwork: async () => { saves++; } },
    fetchImpl: async () => ({ ok: true, json: async () => ({ elements: [], remark: 'timeout' }) })
  });
  const result = await loader.loadAround(center, { force: true });
  assert.equal(result.source, 'cache-fallback');
  assert.equal(result.provider.getAllSegments().length, 1);
  assert.equal(saves, 0);
});

for (const failure of [false, new Error('quota')]) test(`OSM continua disponível em memória se salvar cache ${failure ? 'lançar erro' : 'retornar falso'}`, async () => {
  const loader = new OverpassRoadLoader({ endpoints: urls, isOnline: () => true,
    offlineStore: { saveRoadNetwork: async () => { if (failure) throw failure; return false; } },
    fetchImpl: async () => ({ ok: true, json: async () => osm })
  });
  const result = await loader.loadAround(center);
  assert.equal(result.persisted, false);
  assert.match(result.warning, /somente nesta sessão/);
  assert.equal(result.provider.getAllSegments().length, 1);
});

function datasetOptions(overrides = {}) {
  return { store: { getDataset: async () => ({ data: { csv: 'cached' }, savedAt: '2026-11-01' }), saveDataset: async () => true },
    key: 'test', urls, validate: value => { if (value === 'bad') throw Error('invalid'); },
    fetchText: async () => 'download', onData: () => {}, isOnline: () => true, ...overrides };
}

test('base offline é aplicada sem realizar consultas de rede', async () => {
  const applied = [];
  const result = await loadRadarDataset(datasetOptions({ isOnline: () => false,
    fetchText: () => assert.fail('offline não consulta rede'), onData: data => applied.push(data) }));
  assert.equal(applied[0].csv, 'cached');
  assert.equal(result.offline, true);
  assert.equal(result.data.persisted, true);
});

test('base em cache fica disponível enquanto uma rede lenta ainda está pendente', async () => {
  const applied = [];
  let release, started;
  const networkStarted = new Promise(resolve => { started = resolve; });
  const network = new Promise(resolve => { release = resolve; });
  const pending = loadRadarDataset(datasetOptions({ onData: data => applied.push(data.csv),
    fetchText: () => { started(); return network; } }));
  await networkStarted;
  assert.deepEqual(applied, ['cached']);
  release('new');
  await pending;
  assert.deepEqual(applied, ['cached', 'new']);
});

test('base inválida não sobrescreve o cache e o próximo endereço é tentado', async () => {
  const saves = [];
  const result = await loadRadarDataset(datasetOptions({
    store: { getDataset: async () => null, saveDataset: async (key, data) => { saves.push(data.csv); return true; } },
    fetchText: async url => url === urls[0] ? 'bad' : 'valid'
  }));
  assert.deepEqual(saves, ['valid']);
  assert.equal(result.data.csv, 'valid');
});

test('erro de armazenamento não descarta a base baixada nem promete uso offline', async () => {
  const result = await loadRadarDataset(datasetOptions({ store: {
    getDataset: async () => { throw Error('blocked'); }, saveDataset: async () => { throw Error('quota'); }
  } }));
  assert.equal(result.updated, true);
  assert.equal(result.data.csv, 'download');
  assert.equal(result.data.persisted, false);
  const health = deriveSystemHealth({ activeRadars: 100, datasetSavedAt: result.data.savedAt, datasetPersisted: false });
  assert.match(health.checks.find(c => c.id === 'dataset').detail, /sem cópia offline confirmada/);
});

test('falha de todos os downloads preserva a base local', async () => {
  const result = await loadRadarDataset(datasetOptions({ fetchText: async () => { throw Error('network'); } }));
  assert.equal(result.updated, false);
  assert.equal(result.data.csv, 'cached');
});

test('sem conexão e sem cache válido informa indisponibilidade', async () => {
  const result = await loadRadarDataset(datasetOptions({ isOnline: () => false,
    store: { getDataset: async () => ({ data: { csv: 'bad' } }) } }));
  assert.equal(result.data, null);
  assert.equal(result.offline, true);
});

test('preferências corrompidas retornam padrões seguros sem copiar campos extras', () => {
  for (const value of [null, [], 'invalid', { voice: 'false', far: -1, mid: 9999, near: 0, volume: NaN, extra: true }]) {
    assert.deepEqual(normalizeSettings(value), DEFAULT_SETTINGS);
  }
});

test('preferências válidas são preservadas e volume fica entre zero e cem', () => {
  const custom = { ...DEFAULT_SETTINGS, voice: false, far: 1200, mid: 400, near: 150, volume: 47 };
  assert.deepEqual(normalizeSettings(custom), custom);
  assert.equal(normalizeSettings({ volume: -20 }).volume, 0);
  assert.equal(normalizeSettings({ volume: 200 }).volume, 100);
  assert.equal(normalizeSettings({ volume: Infinity }).volume, 100);
});

test('armazenamento bloqueado ainda permite aplicar preferências na sessão', () => {
  const result = persistSettings({ setItem: () => { throw Error('blocked'); } }, 'settings', { voice: false });
  assert.equal(result.persisted, false);
  assert.equal(result.settings.voice, false);
});

test('preferências persistidas contêm somente dados normalizados', () => {
  let saved;
  const result = persistSettings({ setItem: (key, value) => { saved = JSON.parse(value); } }, 'settings', { far: -99, voice: false });
  assert.equal(result.persisted, true);
  assert.equal(saved.far, DEFAULT_SETTINGS.far);
  assert.equal(saved.voice, false);
});
