import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFreshLiveFix } from '../geo/live-fix.js';
import { loadRadarDataset } from '../geo/dataset-loader.js';
import { OverpassRoadLoader } from '../geo/osm-loader.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const [name, timestamp, expected] of [
  ['atual', 1000000, true], ['limite de 90 s', 910000, true],
  ['antigo', 909999, false], ['futuro', 1000001, false],
  ['ausente', undefined, false], ['nulo', null, false], ['zero', 0, false], ['NaN', NaN, false]
]) test(`GPS ao vivo: ${name}`, () => assert.equal(isFreshLiveFix(timestamp, 1000000), expected));

test('cancelar download impede gravação, atualização visual e próxima tentativa', async () => {
  const controller = new AbortController(), started = deferred(), response = deferred();
  let fetches = 0, saves = 0, applications = 0;
  const pending = loadRadarDataset({ signal: controller.signal, key: 'test', urls: ['one', 'two'],
    store: { getDataset: async () => null, saveDataset: async () => { saves++; return true; } },
    fetchText: () => { fetches++; started.resolve(); return response.promise; },
    validate: () => {}, onData: () => applications++ });
  await started.promise;
  controller.abort(); response.resolve('csv');
  assert.equal((await pending).cancelled, true);
  assert.deepEqual([fetches, saves, applications], [1, 0, 0]);
});

test('cancelamento durante gravação aguarda escrita sem reaplicar base', async () => {
  const controller = new AbortController(), started = deferred(), saved = deferred();
  let applied = false;
  const pending = loadRadarDataset({ signal: controller.signal, key: 'test', urls: ['one'],
    store: { getDataset: async () => null, saveDataset: () => { started.resolve(); return saved.promise; } },
    fetchText: async () => 'csv', validate: () => {}, onData: () => { applied = true; } });
  await started.promise; controller.abort(); saved.resolve(true);
  assert.equal((await pending).cancelled, true);
  assert.equal(applied, false);
});

test('cancelamento OSM interrompe a requisição e permite reinício imediato sem fallback', async () => {
  const controller = new AbortController(), started = deferred();
  let fetches = 0, saves = 0;
  const loader = new OverpassRoadLoader({ endpoints: ['https://one.test', 'https://two.test'],
    offlineStore: { saveRoadNetwork: () => saves++ }, isOnline: () => true,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      fetches++; started.resolve();
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }) });
  const pending = loader.loadAround({ lat: -23.55, lng: -46.63 }, { signal: controller.signal });
  await started.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual([fetches, saves, loader.retryAfter, loader.lastRequestAt], [1, 0, 0, 0]);
});

for (const policy of ['LiveFixPolicy', 'GpsRecoveryPolicy']) test(`Android executa ${policy} em Java`, t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = spawnSync('javac', ['-version'], { encoding: 'utf8', timeout: 15000 });
  if (found.error || found.status !== 0) { t.skip('JDK indisponível'); return; }
  const temp = mkdtempSync(path.join(tmpdir(), 'radar-live-fix-'));
  try {
    const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', temp,
      path.join(root, `android-template/app/src/main/java/com/radalert/app/${policy}.java`),
      path.join(root, `tests/native/${policy}Test.java`)], { encoding: 'utf8', timeout: 15000 });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const run = spawnSync('java', ['-cp', temp, `com.radalert.app.${policy}Test`], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
