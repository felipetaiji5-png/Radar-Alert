import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RouteSimulator, SIM_SCENARIOS } from '../sim/route-simulator.js';
import { deriveSystemHealth } from '../ui/system-health.js';
import { normalizeScreen, SCREENS } from '../ui/navigation.js';
import { MapView } from '../ui/map-view.js';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('0.13: laboratório usa dados sintéticos e gera alertas somente na via única', () => {
  const simulator = new RouteSimulator('straight');
  const results = simulator.runToEnd();
  assert.equal(results.length, simulator.total);
  assert.ok(results.every(result => result.state === 'confirmed'));
  const types = results.flatMap(result => result.alerts.map(alert => alert.type));
  assert.deepEqual(types, ['ALERT_FAR', 'ALERT_MID', 'ALERT_NEAR']);
  assert.ok(results[0].distanceMeters > 1000);
  assert.equal(simulator.finished, true);
  assert.equal(simulator.step(), null);
});

test('0.13: duas pistas paralelas próximas não podem confirmar via nem emitir aviso', () => {
  const results = new RouteSimulator('parallel').runToEnd();
  assert.ok(results.every(result => result.state === 'uncertain'));
  assert.ok(results.every(result => result.reason === 'AMBIGUOUS_ROADS'));
  assert.equal(results.flatMap(result => result.alerts).length, 0);
});

test('0.13: cenário parado não inventa rumo nem emite aviso', () => {
  const results = new RouteSimulator('stopped').runToEnd();
  assert.ok(results.every(result => result.reason === 'NO_HEADING'));
  assert.ok(results.every(result => result.distanceMeters === null));
  assert.equal(results.flatMap(result => result.alerts).length, 0);
});

test('0.13: alternar cenário reinicia progresso, histórico e alertas simulados', () => {
  const simulator = new RouteSimulator('straight');
  simulator.runToEnd();
  assert.equal(simulator.events.length, simulator.total);
  simulator.load('stopped');
  assert.equal(simulator.index, 0);
  assert.equal(simulator.progress, 0);
  assert.deepEqual(simulator.events, []);
  assert.equal(simulator.alertManager.radarStates.size, 0);
  assert.equal(simulator.step().reason, 'NO_HEADING');
  simulator.load('straight');
  assert.equal(simulator.step().state, 'confirmed');
});

test('0.13: cenários inválidos são recusados e não ativam simulação', () => {
  assert.deepEqual(Object.keys(SIM_SCENARIOS), ['straight', 'parallel', 'stopped']);
  assert.throws(() => new RouteSimulator('live'), /inválido/);
});

test('0.13: indicador GPS não fica verde com ponto antigo', () => {
  const current = deriveSystemHealth({ tracking: true, hasPosition: true, fixAgeMs: 120000, activeRadars: 5155 });
  assert.equal(current.checks.find(row => row.id === 'gps').status, 'warn');
  assert.equal(current.checks.find(row => row.id === 'route').status, 'warn');
});

test('0.13: via não confirmada mantém avaliação de rota suspensa', () => {
  const current = deriveSystemHealth({ tracking: true, hasPosition: true, fixAgeMs: 1000,
    activeRadars: 5155, roadCovered: true, roadSegments: 8557, routeReady: false, native: true, nativeServiceActive: true });
  assert.equal(current.checks.find(row => row.id === 'gps').status, 'good');
  assert.equal(current.checks.find(row => row.id === 'osm').status, 'good');
  assert.equal(current.checks.find(row => row.id === 'route').status, 'warn');
  assert.equal(current.checks.find(row => row.id === 'service').status, 'good');
});

test('0.13: estado do serviço informa quando navegador não garante segundo plano', () => {
  const web = deriveSystemHealth({ native: false });
  assert.equal(web.checks.find(row => row.id === 'service').status, 'info');
  const nativeOff = deriveSystemHealth({ native: true, nativeServiceActive: false });
  assert.equal(nativeOff.checks.find(row => row.id === 'service').status, 'idle');
});

test('0.13: navegação padroniza nomes e não aceita telas inexistentes', () => {
  assert.deepEqual(SCREENS, ['painel', 'mapa', 'via', 'proximos']);
  assert.equal(normalizeScreen('#via'), 'via');
  assert.equal(normalizeScreen('MAPA'), 'mapa');
  assert.equal(normalizeScreen('#outra'), 'painel');
  assert.equal(normalizeScreen(null), 'painel');
});

test('0.13: interfaces possuem alvos de navegação e controles reais de simulação', () => {
  const html = source('index.html');
  const css = source('styles.css');
  const ids = [...html.matchAll(/\bid="([^\"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'identificadores HTML repetidos');
  for (const page of SCREENS) {
    assert.match(html, new RegExp(`data-screen="${page}"`));
    assert.match(html, new RegExp(`data-screen-link="${page}"`));
  }
  for (const id of ['healthList','healthSummary','simScenario','simRunBtn','simStepBtn','simResetBtn','simEventList','simStatus','simDistance','prefContrastToggle']) {
    assert.ok(ids.includes(id), `faltou ${id}`);
  }
  assert.match(html, /dados inteiramente fictícios/);
  assert.match(css, /body\[data-active-screen="via"\]/);
});

test('0.13: arquitetura mantém os motores separados da interface e da simulação', () => {
  const app = source('app.js');
  const sim = source('sim/route-simulator.js');
  const view = source('ui/simulator-panel.js');
  assert.match(app, /ui\/map-view\.js/);
  assert.match(app, /ui\/nearby-list\.js/);
  assert.match(app, /ui\/match-panel\.js/);
  assert.match(app, /ui\/navigation\.js/);
  assert.match(app, /ui\/system-health\.js/);
  assert.match(app, /ui\/simulator-panel\.js/);
  assert.doesNotMatch(sim, /NativeRadarTracking|registerPlugin|navigator\.geolocation|navigator\.clipboard|Notification\(/);
  assert.doesNotMatch(view, /NativeRadarTracking|navigator\.geolocation|speechSynthesis|new Notification/);
  assert.match(app, /getRoutedRadars/);
  assert.match(app, /NativeRadarTracking\.start/);
});

test('0.13: classe MapView pode ser construída sem GPS, DOM global ou Leaflet', () => {
  const view = new MapView({ getElement: () => null });
  assert.equal(view.map, null);
  assert.equal(view.trail.length, 0);
  assert.equal(view.trailVisible, false);
});

test('0.13: modo direção entra e sai com histerese; leituras isoladas não oscilam o layout', async () => {
  const { DriveModeController } = await import('../ui/drive-mode.js');
  const mode = new DriveModeController();
  assert.equal(mode.update(30), false);
  assert.equal(mode.update(30), false);
  assert.equal(mode.update(30), true);
  assert.equal(mode.update(null), true);
  for (let i = 0; i < 4; i++) assert.equal(mode.update(0), true);
  assert.equal(mode.update(0), false);
});

test('0.13: velocidade inválida ou baixa não ativa o modo direção', async () => {
  const { DriveModeController } = await import('../ui/drive-mode.js');
  const mode = new DriveModeController();
  for (const speed of [null, undefined, NaN, 7, 10, -1]) assert.equal(mode.update(speed), false);
  assert.equal(mode.update(13), false);
  assert.equal(mode.update(0), false);
});


test('0.13: sessão parada não reavalia e não emite alertas ao atualizar dados', () => {
  const app = source('app.js');
  assert.match(app, /function updateNearby\(\) \{\s*if \(!trackingActive/);
  assert.match(app, /function updateRouteAlert\(evaluation\) \{\s*if \(!trackingActive\) return;/);
  assert.match(app, /function onPositionSuccess\(coords, timestamp\) \{\s*if \(!trackingActive\) return;/);
});
