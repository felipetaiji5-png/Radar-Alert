import test from 'node:test';
import assert from 'node:assert/strict';
import { MapMatcher } from '../geo/map-matcher.js';
import { RoadNetworkProvider, RoadSegment } from '../geo/road-network.js';
import { summarizeMatch } from '../geo/match-diagnostics.js';
import { AlertManager } from '../geo/alert-manager.js';
import { readFileSync } from 'node:fs';

const street = (id, latitude, name = id) => new RoadSegment({
  id, name, coords: [{ lat: latitude, lng: -46.6400 }, { lat: latitude, lng: -46.6300 }], oneway: 'yes'
});
const FIX = { lat: -23.5500, lng: -46.6350, speed: 30, accuracy: 7, heading: 90, timestamp: 1000 };

test('diagnóstico distingue ausência de GPS de ausência de malha', () => {
  assert.equal(summarizeMatch(null).state, 'idle');
  const noRoad = summarizeMatch(null, { hasPosition: true, covered: false, roadStatus: 'Servidor OSM indisponível' });
  assert.equal(noRoad.state, 'blocked');
  assert.equal(noRoad.routeAlertsReady, false);
  assert.match(noRoad.reason, /Servidor OSM/);
});

test('diagnóstico relata GPS impreciso sem inventar candidato', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat)]));
  const match = matcher.match({ ...FIX, accuracy: 75 });
  const summary = summarizeMatch(match, { covered: true, hasPosition: true, accuracy: 75 });
  assert.equal(match.diagnostic.reason, 'LOW_ACCURACY');
  assert.equal(summary.routeAlertsReady, false);
  assert.match(summary.explanation, /75 m/);
  assert.equal(summary.offset, '—');
});

test('diagnóstico de via de mão única confirmada inclui afastamento, rumo e candidatos', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat, 'Rua Interna')]));
  const match = matcher.match(FIX);
  const summary = summarizeMatch(match, { covered: true, hasPosition: true, accuracy: FIX.accuracy });
  assert.equal(match.confidence, 'HIGH');
  assert.equal(summary.routeAlertsReady, true);
  assert.equal(summary.state, 'confirmed');
  assert.equal(summary.road, 'Rua Interna');
  assert.equal(summary.heading, '90°');
  assert.equal(summary.candidates, '1');
  assert.match(summary.offset, / m$/);
});

test('carro parado sem rumo permanece não confirmado apesar de via próxima', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat)]));
  const match = matcher.match({ ...FIX, speed: 0, heading: null });
  const summary = summarizeMatch(match, { covered: true, hasPosition: true, accuracy: 7 });
  assert.equal(match.diagnostic.reason, 'NO_HEADING');
  assert.equal(summary.state, 'review');
  assert.match(summary.road, /^Candidata:/);
  assert.equal(summary.heading, '—');
  assert.equal(summary.routeAlertsReady, false);
});

test('vias paralelas semelhantes são mostradas como ambíguas e não disparam alerta', () => {
  const roads = new RoadNetworkProvider([
    street('r1', FIX.lat + 0.00002, 'Rua de dentro'),
    street('r2', FIX.lat - 0.00002, 'Avenida de fora')
  ]);
  const matcher = new MapMatcher(roads);
  const match = matcher.match(FIX);
  const summary = summarizeMatch(match, { covered: true, hasPosition: true, accuracy: FIX.accuracy });
  assert.equal(match.diagnostic.reason, 'AMBIGUOUS_ROADS');
  assert.equal(summary.state, 'review');
  assert.equal(summary.routeAlertsReady, false);
  assert.equal(summary.candidates, '2');
  assert.ok(summary.competingRoad);
  const evaluated = new AlertManager().processEvaluation({
    matchedSegment: match.segment,
    candidateRadars: [{ id: 'fake', active: true, routeDistanceMeters: 150 }],
    confidence: match.confidence,
    effectiveHeading: match.effectiveHeading
  });
  assert.equal(evaluated.nextRadar, null);
});

test('sem rua candidata, UI não inventa nome nem distância lateral', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([]));
  const match = matcher.match(FIX);
  const summary = summarizeMatch(match, { covered: true, hasPosition: true, accuracy: 7 });
  assert.equal(match.diagnostic.reason, 'NO_CANDIDATE');
  assert.equal(summary.road, 'Via não identificada');
  assert.equal(summary.offset, '—');
  assert.equal(summary.routeAlertsReady, false);
});

test('interface possui painel de via, diagnóstico avançado e atalhos mobile', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const id of ['matchBadge', 'matchRoad', 'matchOffset', 'matchAngle', 'matchHeading', 'matchCandidates', 'matchReason', 'matchDetailsBtn', 'equipmentToggle', 'equipmentBody']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const target of ['#painel', '#via', '#mapa', '#proximos']) assert.ok(html.includes(`href="${target}"`));
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.mobile-nav/);
  assert.match(css, /\.side-panel:not\(\.expanded\) \.equipment-body/);
});

test('um fix recusado não mantém o selo de via confirmada de um ponto anterior', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat)]));
  const matched = matcher.match(FIX);
  const summary = summarizeMatch(matched, { covered: true, hasPosition: true, fixIssue: 'LOW_ACCURACY' });
  assert.equal(summary.state, 'blocked');
  assert.equal(summary.routeAlertsReady, false);
  assert.match(summary.road, /^Última via válida/);
});

test('uma posição com mais de 90 segundos é sinalizada como desatualizada', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat)]));
  const matched = matcher.match(FIX);
  const summary = summarizeMatch(matched, { covered: true, hasPosition: true, fixAgeMs: 120000 });
  assert.equal(summary.badge, 'GPS DESATUALIZADO');
  assert.equal(summary.routeAlertsReady, false);
});


test('primeiro fix recusado é apresentado como GPS incerto, mesmo sem posição válida prévia', () => {
  const summary = summarizeMatch(null, { hasPosition: false, covered: false, fixIssue: 'LOW_ACCURACY' });
  assert.equal(summary.badge, 'GPS INCERTO');
  assert.equal(summary.routeAlertsReady, false);
});

test('0.11: candidatos visuais agrupam trechos da mesma rua sem inventar direção', () => {
  const roads = new RoadNetworkProvider([
    street('a1', FIX.lat + 0.000015, 'Alameda Alegrete'),
    street('a2', FIX.lat + 0.000019, 'Alameda Alegrete'),
    street('b1', FIX.lat - 0.000022, 'Alameda Santiago')
  ]);
  const match = new MapMatcher(roads).match({ ...FIX, speed: 0, heading: null });
  const summary = summarizeMatch(match, { hasPosition: true, covered: true });
  assert.equal(summary.routeAlertsReady, false);
  assert.equal(summary.state, 'review');
  assert.equal(match.diagnostic.candidateCount, 3);
  assert.equal(summary.alternatives.length, 2);
  assert.deepEqual(summary.alternatives.map(a => a.name), ['Alameda Alegrete', 'Alameda Santiago']);
  assert.ok(summary.alternatives.every(a => /^\d+ m$/.test(a.offset)));
});

test('0.11: dados diagnósticos não incluem coordenadas brutas nem probabilidade inventada', () => {
  const match = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat, 'Rua interna')])).match({ ...FIX, speed: 0, heading: null });
  const summary = summarizeMatch(match, { hasPosition: true, covered: true });
  assert.deepEqual(Object.keys(summary.alternatives[0]).sort(), ['heading', 'isPrimary', 'name', 'offset']);
  assert.ok(!JSON.stringify(summary).includes('-46.635'));
  assert.equal(Object.hasOwn(summary, 'probability'), false);
});

test('0.11: GPS inválido ou desatualizado esconde alternativas anteriores', () => {
  const match = new MapMatcher(new RoadNetworkProvider([street('r1', FIX.lat)])).match({ ...FIX, speed: 0, heading: null });
  assert.equal(summarizeMatch(match, { hasPosition: true, covered: true, fixIssue: 'LOW_ACCURACY' }).alternatives.length, 0);
  assert.equal(summarizeMatch(match, { hasPosition: true, covered: true, fixAgeMs: 120000 }).alternatives.length, 0);
});

test('0.11: interface expõe candidatas e controles acessíveis do mapa', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  for (const id of ['candidateSection', 'candidateList', 'locateMapBtn', 'expandMapBtn', 'mapState', 'refreshRoadBtn', 'diagMatchAlternatives']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Trechos analisados/i);
  assert.match(html, /Atualizar radares/);
  assert.match(html, /Atualizar ruas OSM desta região/);
  assert.match(css, /\.candidate-row/);
  assert.match(css, /\.map-frame\.expanded/);
  assert.match(css, /min-height:44px/);
});

test('0.11: atualização de radares não força consulta Overpass', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const refreshBlock = app.match(/\$\('refreshBtn'\)\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(refreshBlock);
  assert.match(refreshBlock[0], /loadDataset\(true\)/);
  assert.doesNotMatch(refreshBlock[0], /ensureRoadNetwork\(/);
  assert.match(app, /\$\('refreshRoadBtn'\)\.addEventListener/);
});
