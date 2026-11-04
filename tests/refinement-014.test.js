import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeMatch } from '../geo/match-diagnostics.js';
import { RoadStabilityTracker } from '../geo/road-stability.js';
import { MapView } from '../ui/map-view.js';

const source = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const candidate = (name, id = name, confirmed = false) => ({
  segment: { name, id }, matched: confirmed, confidence: confirmed ? 'HIGH' : 'LOW',
  effectiveHeading: confirmed ? 90 : null,
  diagnostic: { reason: confirmed ? 'CONFIRMED' : 'NO_HEADING', candidateCount: 2, lateralDistanceMeters: 14 }
});

test('0.14: veículo parado mostra rua próxima e nunca libera alertas sem rumo', () => {
  const summary = summarizeMatch(candidate('Alameda Alegrete'), {
    covered: true, hasPosition: true, speedKmh: 0, accuracy: 11
  });
  assert.equal(summary.state, 'stationary');
  assert.equal(summary.badge, 'AGUARDANDO MOVIMENTO');
  assert.equal(summary.road, 'Rua próxima: Alameda Alegrete');
  assert.equal(summary.routeAlertsReady, false);
  assert.match(summary.explanation, /parado.*alertas por rota suspensos/i);
});

test('0.14: GPS sem velocidade não presume que o veículo está parado', () => {
  const summary = summarizeMatch(candidate('Alameda Alegrete'), {
    covered: true, hasPosition: true, speedKmh: null
  });
  assert.equal(summary.state, 'review');
  assert.equal(summary.badge, 'NÃO CONFIRMADA');
  assert.equal(summary.routeAlertsReady, false);
});

test('0.14: rumo desconhecido em movimento não vira estado estacionário', () => {
  const summary = summarizeMatch(candidate('Alameda Alegrete'), {
    covered: true, hasPosition: true, speedKmh: 28
  });
  assert.equal(summary.state, 'review');
  assert.equal(summary.routeAlertsReady, false);
});

test('0.14: GPS recusado ou antigo tem prioridade sobre o estado estacionário', () => {
  const options = { covered: true, hasPosition: true, speedKmh: 0 };
  assert.equal(summarizeMatch(candidate('Alegrete'), { ...options, fixIssue: 'LOW_ACCURACY' }).state, 'blocked');
  assert.equal(summarizeMatch(candidate('Alegrete'), { ...options, fixAgeMs: 110000 }).state, 'blocked');
});

test('0.14: um trecho confirmado continua confirmado independentemente do painel estacionário', () => {
  const summary = summarizeMatch(candidate('Rua fictícia', 'x', true), {
    covered: true, hasPosition: true, speedKmh: 0
  });
  assert.equal(summary.state, 'confirmed');
  assert.equal(summary.routeAlertsReady, true);
});

test('0.14: histórico distingue leituras insuficientes de candidata estável sem inventar confiança', () => {
  const history = new RoadStabilityTracker();
  history.record(candidate('Alameda Alegrete', 'way-1'), 100_000);
  assert.equal(history.snapshot(100_000).status, 'collecting');
  history.record(candidate('Alameda Alegrete', 'way-2'), 109_000);
  history.record(candidate('Alameda Alegrete', 'way-3'), 123_000);
  const result = history.snapshot(123_000);
  assert.equal(result.status, 'stable');
  assert.equal(result.changes, 0);
  assert.equal(result.currentRoad, 'Alameda Alegrete');
  assert.match(result.detail, /Ainda precisa validar o sentido/);
  assert.equal(result.sampleCount, 3);
  assert.equal('probability' in result, false);
});

test('0.14: alternância de ruas conta mudanças e não armazena coordenadas', () => {
  const history = new RoadStabilityTracker();
  history.record(candidate('Alegrete'), 100_000);
  history.record(candidate('Santiago'), 106_000);
  history.record(candidate('Alegrete'), 111_000);
  history.record(candidate('Alegrete'), 118_000);
  const result = history.snapshot(118_000);
  assert.equal(result.status, 'changing');
  assert.equal(result.changes, 2);
  assert.match(result.detail, /2 trocas/);
  assert.equal(JSON.stringify(history.samples).includes('lat'), false);
  assert.equal(JSON.stringify(history.samples).includes('lng'), false);
});

test('0.14: histórico ignora timestamps repetidos e expira amostras antigas', () => {
  const history = new RoadStabilityTracker({ windowMs: 30000 });
  history.record(candidate('A'), 100_000);
  history.record(candidate('B'), 100_000);
  assert.equal(history.snapshot(100_000).sampleCount, 1);
  history.record(candidate('B'), 140_000);
  assert.equal(history.snapshot(140_000).changes, 0);
  history.reset();
  assert.equal(history.snapshot(140_000).status, 'empty');
});

test('0.14: precisão pode ser ocultada sem modificar trilha ou alertas', () => {
  const attributes = {};
  const toggle = { setAttribute: (key, value) => { attributes[key] = value; }, textContent: '' };
  const view = new MapView({ getElement: id => id === 'toggleAccuracyBtn' ? toggle : null });
  assert.equal(view.accuracyVisible, true);
  assert.equal(view.toggleAccuracy(), false);
  assert.equal(attributes['aria-pressed'], 'false');
  assert.match(toggle.textContent, /Mostrar/);
  assert.equal(view.toggleAccuracy(), true);
  assert.equal(attributes['aria-pressed'], 'true');
});

test('0.14: painel contém transparência de precisão e estabilidade; acessibilidade preservada', () => {
  const html = source('index.html');
  const css = source('refined.css');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['mapAccuracyLabel', 'toggleAccuracyBtn', 'matchStabilityLabel', 'matchStabilityDetail', 'matchStabilityCount', 'diagRoadStability']) {
    assert.ok(ids.includes(id), `Elemento ${id} ausente`);
  }
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /não é um limite exato/i);
  assert.match(css, /\.match-badge\.stationary/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /refined\.css/);
  assert.match(source('app.js'), /roadStability\.record\(mapMatch, position\.timestamp\)/);
  assert.match(source('ui/map-view.js'), /this\.accuracyVisible && Number\.isFinite\(position\.accuracy\)/);
});


test('0.14: ponto recusado oculta área antiga e bloqueia centralização com GPS desatualizado', () => {
  const calls = [];
  const state = { textContent: '' };
  const accuracy = { textContent: '' };
  const view = new MapView({ getElement: id => id === 'mapState' ? state : id === 'mapAccuracyLabel' ? accuracy : null,
    onNotice: message => calls.push(message) });
  let cleared = 0;
  view.layers = { user: { clearLayers() { cleared++; } } };
  view.position = { lat: -23.55, lng: -46.63, accuracy: 10 };
  view.map = { setView() { throw new Error('Não deve centralizar ponto antigo'); } };
  view.markAccuracyStale();
  assert.equal(view.positionStale, true);
  assert.equal(cleared, 1);
  assert.match(state.textContent, /não confirmada/i);
  view.center();
  assert.match(calls.at(-1), /novo ponto GPS válido/i);
  assert.match(accuracy.textContent, /não confirmada/i);
});
