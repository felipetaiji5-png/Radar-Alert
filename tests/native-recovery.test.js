import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeRadarCatalog, createNativeWriteQueue } from '../geo/native-sync.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = name => readFileSync(path.join(root, name), 'utf8');

test('0.15.1: serialização de radar nativo é estável mesmo após reordenação do CSV', () => {
  const records = [
    { id: 'B', lat: -23.49, lng: -46.7, direction: null, limit: 50, active: true },
    { id: 'A', lat: -23.5, lng: -46.8, direction: 90, limit: 60, active: true },
    { id: 'A', lat: -23.4, lng: -46.8, direction: 90, limit: 60, active: true }
  ];
  const first = buildNativeRadarCatalog(records);
  const second = buildNativeRadarCatalog([...records].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(records.map(r => r.id), ['B', 'A', 'A']);
  const changed = records.map(r => ({...r}));
  changed[0].limit = 40;
  assert.notDeepEqual(buildNativeRadarCatalog(changed), first);
});

test('0.15.1: operações nativas obedecem ordem e erro anterior não bloqueia reparo', async () => {
  const queue = createNativeWriteQueue();
  const visited = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = queue.enqueue(async () => { visited.push('catalog-start'); await gate; visited.push('catalog-end'); });
  const second = queue.enqueue(async () => { visited.push('network'); });
  await Promise.resolve();
  assert.deepEqual(visited, ['catalog-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(visited, ['catalog-start', 'catalog-end', 'network']);
  await assert.rejects(queue.enqueue(() => { throw new Error('falhou'); }), /falhou/);
  await queue.enqueue(() => visited.push('reparo'));
  assert.equal(visited.at(-1), 'reparo');
});

test('0.15.1: política de revisão recusa snapshot antigo em Java', t => {
  for (const command of ['java', 'javac']) {
    const found = spawnSync(command, ['-version'], { encoding: 'utf8', timeout: 15000 });
    if (found.error || found.status !== 0) { t.skip('JDK 21 indisponível'); return; }
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'radar-native-revision-'));
  try {
    const javaDir = 'android-template/app/src/main/java/com/radalert/app/';
    const compile = spawnSync('javac', ['-encoding', 'UTF-8', '-d', temp,
      path.join(root, javaDir, 'RoadSnapshotRevision.java'),
      path.join(root, 'tests/native/RoadSnapshotRevisionTest.java')], { encoding: 'utf8', timeout: 15000 });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const run = spawnSync('java', ['-cp', temp, 'com.radalert.app.RoadSnapshotRevisionTest'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /7 checks Java/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('0.15.1: serviço continua iniciando sem geometria legada e mantém alertas suspensos', () => {
  const service = file('android-template/app/src/main/java/com/radalert/app/RadarTrackingService.java');
  assert.match(service, /private boolean restoreRoadNetworkOrSuspend\(\)/);
  assert.match(service, /catch \(Exception error\) \{\s*clearRoadNetworkState\(\);/);
  assert.match(service, /"roadNetworkUnavailable", true/);
  assert.match(service, /return false;\s*}\s*}\s*private void clearRoadNetworkState/);
  assert.equal((service.match(/restoreRoadNetworkOrSuspend\(\);/g) || []).length, 2,
    'na inicialização e na atualização');
  assert.match(service, /RoadSnapshotRevision\.compatible/);
  assert.match(file('android-template/app/src/main/java/com/radalert/app/RadarTrackingPlugin.java'), /status\.put\("roadNetworkIssue"/);
  assert.match(service, /private void loadRoadNetwork\(File file\)/);
  assert.match(service, /loadRoadNetwork\(selected\)/);
});

test('0.15.1: integração sincroniza política nativa e número da versão', () => {
  for (const target of ['scripts/patch-android.mjs', 'scripts/verify-android.mjs']) {
    assert.match(file(target), /RoadSnapshotRevision\.java/);
  }
  assert.match(file('app.js'), /nativeWrites\.enqueue\(async \(\) =>/);
  assert.match(file('app.js'), /nativeWrites\.enqueue\(\(\) => writeNativeRoadNetwork/);
  const version = JSON.parse(file('package.json')).version;
  const cacheVersion = 'v' + version.replaceAll('.', '');
  assert.ok(file('scripts/postbuild.mjs').includes(cacheVersion));
  assert.ok(file('sw.js').includes(cacheVersion));
  assert.ok(file('index.html').includes('v' + version));
});
