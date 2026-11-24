import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = name => readFileSync(path.join(root, name), 'utf8');

test('0.15: seletor nativo escolhe regiões válidas e nunca inventa cobertura', t => {
  const javac = spawnSync('javac', ['-version'], { encoding: 'utf8', timeout: 15000 });
  const java = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 15000 });
  if (javac.error || java.error || javac.status !== 0 || java.status !== 0) {
    t.skip('JDK indisponível neste ambiente; execute com JDK 21 para testar o seletor nativo.');
    return;
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'radar-region-test-'));
  try {
    const source = path.join(root, 'android-template/app/src/main/java/com/radalert/app/RoadRegionSelector.java');
    const spec = path.join(root, 'tests/native/RoadRegionSelectorTest.java');
    const compiled = spawnSync('javac', ['-encoding', 'UTF-8', '-d', temp, source, spec], { encoding: 'utf8', timeout: 15000 });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const result = spawnSync('java', ['-cp', temp, 'com.radalert.app.RoadRegionSelectorTest'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /8 testes Java/);
    const store = path.join(root, 'android-template/app/src/main/java/com/radalert/app/RoadRegionStore.java');
    const storeSpec = path.join(root, 'tests/native/RoadRegionStoreTest.java');
    const atomic = path.join(root, 'tests/native/stubs/android/util/AtomicFile.java');
    const json = path.join(root, 'tests/native/stubs/org/json/JSONObject.java');
    const storeCompiled = spawnSync('javac', ['-encoding', 'UTF-8', '-cp', temp, '-d', temp,
      store, storeSpec, atomic, json], { encoding: 'utf8', timeout: 15000 });
    assert.equal(storeCompiled.status, 0, storeCompiled.stderr || storeCompiled.stdout);
    const storeResult = spawnSync('java', ['-cp', temp, 'com.radalert.app.RoadRegionStoreTest'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(storeResult.status, 0, storeResult.stderr || storeResult.stdout);
    assert.match(storeResult.stdout, /10 testes Java/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('0.15: plugin sincroniza regiões extras sem mudar a malha ativa', () => {
  const plugin = file('android-template/app/src/main/java/com/radalert/app/RadarTrackingPlugin.java');
  const service = file('android-template/app/src/main/java/com/radalert/app/RadarTrackingService.java');
  assert.match(plugin, /void cacheRoadNetwork\(PluginCall call\) \{ persistRoadNetwork\(call, false\); \}/);
  assert.match(plugin, /RoadRegionStore\.cache\(/);
  assert.match(plugin, /if \(activate\) \{/);
  assert.match(service, /chooseCachedRegion\(location\)/);
  assert.match(service, /private final Object roadDataLock/);
  assert.match(service, /synchronized \(roadDataLock\)/);
  assert.match(service, /Map<String, RoadEdge> nextEdges = new HashMap/);
  assert.match(plugin, /RoadRegionStore\.clear\(/);
});

test('0.15: arquivos Java novos entram na integração Capacitor', () => {
  const patch = file('scripts/patch-android.mjs');
  assert.match(patch, /RoadRegionSelector\.java/);
  assert.match(patch, /RoadRegionStore\.java/);
  const app = file('app.js');
  assert.match(app, /syncNativeRoadNetwork\(result\.provider, \{ activate: false \}\)/);
  assert.match(app, /NativeRadarTracking\.cacheRoadNetwork\(/);
  assert.match(app, /cachedRoadRegions/);
});

test('0.15: Leaflet é empacotado com o aplicativo, não carregado de CDN', () => {
  const pkg = JSON.parse(file('package.json'));
  const html = file('index.html');
  const app = file('app.js');
  assert.equal(pkg.dependencies.leaflet, '1.9.4');
  assert.match(app, /import \* as L from 'leaflet'/);
  assert.match(app, /import 'leaflet\/dist\/leaflet\.css'/);
  assert.doesNotMatch(html, /unpkg\.com\/leaflet/);
  assert.match(html, /prepareMapRegionBtn/);
});

test('0.15: uma mudança isolada de rua não é rotulada como oscilação persistente', async () => {
  const { RoadStabilityTracker } = await import('../geo/road-stability.js');
  const history = new RoadStabilityTracker();
  const sample = name => ({ segment: { id: name, name }, matched: false, confidence: 'UNCERTAIN' });
  history.record(sample('Alameda Alegrete'), 100000);
  history.record(sample('Alameda Santiago'), 106000);
  history.record(sample('Alameda Santiago'), 111000);
  const state = history.snapshot(111000);
  assert.equal(state.changes, 1);
  assert.equal(state.status, 'transition');
  assert.match(state.label, /alterada uma vez/i);
  history.record(sample('Alameda Alegrete'), 118000);
  assert.equal(history.snapshot(118000).status, 'changing');
});

test('0.15: centro do mapa respeita ausência do Leaflet e não é confundido com GPS', async () => {
  const { MapView } = await import('../ui/map-view.js');
  const view = new MapView({ getElement: () => null });
  assert.equal(view.getCenter(), null);
  view.map = { getCenter: () => ({ lat: -23.49, lng: -46.79 }) };
  assert.deepEqual(view.getCenter(), { lat: -23.49, lng: -46.79 });
  view.map = { getCenter: () => ({ lat: NaN, lng: 10 }) };
  assert.equal(view.getCenter(), null);
});

test('0.15: dados de outra revisão do catálogo não podem ser associados a radares atuais', () => {
  const plugin = file('android-template/app/src/main/java/com/radalert/app/RadarTrackingPlugin.java');
  const nativeStore = file('android-template/app/src/main/java/com/radalert/app/RoadRegionStore.java');
  assert.match(nativeStore, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(plugin, /putString\("catalogRevision", revision\)/);
  assert.match(nativeStore, /matcher\.group\(1\)\.equals\(revision\)/);
  assert.match(nativeStore, /region_\(\[0-9a-f\]\{12\}\)/);
  assert.match(plugin, /network\.put\("catalogRevision", revision\)/);
  assert.match(file('android-template/app/src/main/java/com/radalert/app/RadarTrackingService.java'), /optString\("catalogRevision", ""\)/);
});

test('0.15: exportação Android determinística impede recarregar a mesma malha em loop', async () => {
  const { RoadNetworkProvider } = await import('../geo/road-network.js');
  const provider = new RoadNetworkProvider([], {
    center: { lat: -23.50, lng: -46.80 }, radiusMeters: 3000,
    osmTimestamp: '2026-11-04T00:00:00Z'
  });
  const first = provider.exportForBackground();
  const second = provider.exportForBackground();
  assert.deepEqual(first, second);
  assert.equal('createdAt' in first, false);
  const plugin = file('android-template/app/src/main/java/com/radalert/app/RadarTrackingPlugin.java');
  assert.match(plugin, /if \(!fileEquals\(target, bytes\)\)/);
});

test('0.15: verificador Android exige novas classes nativas e versão de WebView correta', () => {
  const verify = file('scripts/verify-android.mjs');
  for (const nativeClass of ['RoadRegionSelector.java', 'RoadRegionStore.java', 'RadarTrackingService.java']) {
    assert.match(verify, new RegExp(nativeClass.replace('.', '\\.')));
  }
  assert.match(verify, /assets\/public\/index\.html/);
  assert.equal(JSON.parse(file('package.json')).scripts['android:verify'], 'node scripts/verify-android.mjs');
});
