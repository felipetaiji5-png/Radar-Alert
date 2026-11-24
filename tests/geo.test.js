import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialIndex } from '../geo/spatial-index.js';
import { RoadSegment, RoadNetworkProvider } from '../geo/road-network.js';
import { MapMatcher } from '../geo/map-matcher.js';
import { AdaptiveGpsEngine, GPS_MODES } from '../geo/adaptive-gps.js';
import { AlertManager } from '../geo/alert-manager.js';

test('índice espacial retorna pontos na célula consultada', () => {
  const index = new SpatialIndex(0.01);
  index.build([{ id: 1, lat: -23.55, lng: -46.63 }, { id: 2, lat: -22.9, lng: -47.0 }]);
  assert.deepEqual(index.queryRadius(-23.55, -46.63, 1000).map(x => x.id), [1]);
});

test('via desconhecida é tratada como bidirecional', () => {
  const segment = new RoadSegment({ id: 'a', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }] });
  assert.equal(segment.oneway, 0);
  assert.ok(segment.length > 1000);
});

test('oneway=-1 inverte o sentido de projeção', () => {
  const segment = new RoadSegment({ id: 'a', oneway: '-1', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }] });
  const projection = segment.project({ lat: -23.55, lng: -46.63 });
  assert.equal(projection.reverse, true);
  assert.ok(projection.roadBearing > 250 && projection.roadBearing < 290);
});

test('map matcher não confirma posição sem geometria viária', () => {
  const matcher = new MapMatcher(new RoadNetworkProvider([]));
  const result = matcher.match({ lat: -23.55, lng: -46.63, speed: 30, accuracy: 8, heading: 90 });
  assert.equal(result.matched, false);
  assert.equal(result.confidence, 'NO_MATCH');
});

test('map matcher encontra segmento fornecido e não inventa geometria', () => {
  const segment = new RoadSegment({ id: 'avenida', name: 'Avenida teste', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }], oneway: false });
  const matcher = new MapMatcher(new RoadNetworkProvider([segment]));
  const result = matcher.match({ lat: -23.55, lng: -46.63, speed: 25, accuracy: 5, heading: 90 });
  assert.equal(result.matched, true);
  assert.equal(result.segment.id, 'avenida');
  assert.ok(result.vehicleDistAlong > 500);
});

test('GPS sem velocidade não classifica automaticamente como parado', () => {
  const engine = new AdaptiveGpsEngine();
  const result = engine.processRawFix({ latitude: -23.55, longitude: -46.63, accuracy: 5, speed: null, heading: null }, 1000);
  assert.equal(result.accepted, true);
  assert.notEqual(result.mode, GPS_MODES.STOPPED);
});

test('alert manager não usa distância geodésica como distância de estrada', () => {
  const manager = new AlertManager();
  const result = manager.processEvaluation({
    matchedSegment: { id: 'road' }, vehicleDistAlong: 100,
    candidateRadars: [{ id: 'r1', active: true, distance: 50, direction: 90, roadSegmentId: 'road' }],
    effectiveHeading: 90, confidence: 'HIGH'
  });
  assert.equal(result.nextRadar, null);
  assert.equal(result.reason, undefined);
});


test('alert manager não dispara quando o map match é apenas médio', () => {
  const segment = new RoadSegment({ id: 'road', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }] });
  const manager = new AlertManager();
  const result = manager.processEvaluation({
    matchedSegment: segment, vehicleDistAlong: 100,
    candidateRadars: [{ id: 'r1', active: true, lat: -23.55, lng: -46.63, direction: 90, roadSegmentId: 'road' }],
    effectiveHeading: 90, confidence: 'MEDIUM'
  });
  assert.equal(result.nextRadar, null);
  assert.equal(result.reason, 'NO_HIGH_CONFIDENCE_ROAD_MATCH');
});

test('alert manager não inventa distância quando a rota não foi calculada', () => {
  const segment = new RoadSegment({ id: 'road', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }], oneway: true });
  const manager = new AlertManager();
  const result = manager.processEvaluation({
    matchedSegment: segment,
    candidateRadars: [{ id: 'r1', active: true, lat: -23.55, lng: -46.63, direction: 90, roadKey: segment.roadKey }],
    effectiveHeading: 90, confidence: 'HIGH'
  });
  assert.equal(result.nextRadar, null);
});

test('alert manager aceita somente distância de rota previamente calculada', () => {
  const segment = new RoadSegment({ id: 'road', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }], oneway: true });
  const manager = new AlertManager();
  const result = manager.processEvaluation({
    matchedSegment: segment,
    candidateRadars: [{ id: 'r1', active: true, direction: 90, effectiveDirection: 90, roadKey: segment.roadKey, routeDistanceMeters: 350 }],
    effectiveHeading: 90, confidence: 'HIGH'
  });
  assert.ok(result.nextRadar);
  assert.equal(result.nextRadar.id, 'r1');
  assert.equal(result.nextRadar.distanceAlongRoad, 350);
  assert.equal(result.nextRadar.routeDistanceMeters, 350);
});


test('map matcher deriva o rumo a partir do deslocamento quando velocidade GPS é nula', () => {
  const segment = new RoadSegment({ id: 'east', coords: [{ lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.62 }], oneway: true });
  const matcher = new MapMatcher(new RoadNetworkProvider([segment]));
  matcher.match({ lat: -23.55, lng: -46.6399, speed: null, accuracy: 5, heading: null, timestamp: 1000 });
  const result = matcher.match({ lat: -23.55, lng: -46.6397, speed: null, accuracy: 5, heading: null, timestamp: 3000 });
  assert.equal(result.headingConfidence, 'DERIVED');
  assert.ok(result.effectiveHeading > 80 && result.effectiveHeading < 100);
});

test('alerta de radar de trecho informa início e extensão mapeada', () => {
  const manager = new AlertManager();
  const segment = new RoadSegment({ id: 'section-road', roadKey: 'ref:SP-1', coords: [
    { lat: -23.55, lng: -46.64 }, { lat: -23.55, lng: -46.63 }
  ], oneway: true });
  const result = manager.processEvaluation({
    matchedSegment: segment,
    candidateRadars: [{ id: 'section-1', kind: 'SECTION', active: true, limit: 60,
      roadKey: segment.roadKey, effectiveDirection: 90, routeDistanceMeters: 300, sectionLengthMeters: 1200 }],
    effectiveHeading: 90, confidence: 'HIGH'
  });
  assert.match(result.alerts[0].text, /Início do trecho de fiscalização/);
  assert.match(result.alerts[0].text, /1200 metros/);
});

function rearmScenario() {
  let clock = 1_000_000;
  const manager = new AlertManager({ now: () => clock });
  const segment = { id: 'via-teste', roadKey: 'ref:SP-TESTE' };
  const evaluate = (routeDistanceMeters, confidence = 'HIGH', heading = 90, speedKmh = null) => manager.processEvaluation({
    matchedSegment: segment, effectiveHeading: heading, confidence, speedKmh,
    candidateRadars: routeDistanceMeters == null ? [] : [{ id: 'radar-ficticio', active: true, limit: 60,
      roadKey: segment.roadKey, effectiveDirection: 90, routeDistanceMeters }]
  }).alerts.map(alert => alert.type);
  const advance = ms => { clock += ms; };
  return { evaluate, advance, manager };
}

test('alerta web volta a avisar numa segunda passagem no mesmo sentido', () => {
  const { evaluate, advance } = rearmScenario();
  assert.deepEqual(evaluate(120), ['ALERT_NEAR']);
  advance(5000); assert.deepEqual(evaluate(null), [], 'radar saiu do trajeto após a passagem');
  advance(20 * 60_000); assert.deepEqual(evaluate(null), []);
  advance(5000); assert.deepEqual(evaluate(900), ['ALERT_FAR']);
  advance(5000); assert.deepEqual(evaluate(120), ['ALERT_NEAR']);
});

test('rearme conta dois minutos desde a primeira ausência confirmada e reinicia ao reencontrar o radar', () => {
  const { evaluate, advance } = rearmScenario();
  const ahead = () => evaluate(120, 'HIGH', 90, 20);
  assert.deepEqual(ahead(), ['ALERT_NEAR']);
  advance(125_000);
  evaluate(null, 'MEDIUM');
  evaluate(null);
  advance(1000);
  assert.deepEqual(ahead(), [], 'a perda anterior de confirmação não conta como saída');
  evaluate(null);
  advance(119_999);
  assert.deepEqual(ahead(), [], 'o retorno antes do prazo encerra esta ausência');
  evaluate(null);
  advance(60_000);
  evaluate(null);
  advance(60_000);
  assert.deepEqual(ahead(), ['ALERT_NEAR'], 'ausências sucessivas preservam o início do prazo');
});

test('perda breve de GPS, cobertura ou confirmação não rearma o alerta', () => {
  const { evaluate, advance } = rearmScenario();
  assert.deepEqual(evaluate(120), ['ALERT_NEAR']);
  advance(5000); assert.deepEqual(evaluate(100, 'MEDIUM'), []);
  advance(5000); assert.deepEqual(evaluate(null), [], 'oscilação confirmada de poucos segundos');
  advance(5000); assert.deepEqual(evaluate(90), []);
  // Sem avaliações confirmadas por minutos (GPS/cobertura ausentes), o radar segue à frente.
  advance(10 * 60_000); assert.deepEqual(evaluate(80), []);
});

test('veículo parado perto do radar não recebe aviso repetido', () => {
  for (const speed of [0, null]) {
    const { evaluate, advance } = rearmScenario();
    assert.deepEqual(evaluate(60, 'HIGH', 90, 20), ['ALERT_NEAR']);
    for (let i = 0; i < 60; i += 1) { advance(5000); assert.deepEqual(evaluate(i % 2 ? null : 4, 'HIGH', 90, speed), []); }
    advance(10 * 60_000); assert.deepEqual(evaluate(3, 'HIGH', 90, speed), [], `oscilação parada depois do radar (velocidade ${speed})`);
  }
});

test('nova passagem que entra na via perto do radar avisa com o veículo em movimento', () => {
  const { evaluate, advance } = rearmScenario();
  assert.deepEqual(evaluate(120, 'HIGH', 90, 40), ['ALERT_NEAR']);
  advance(5000); evaluate(null, 'HIGH', 90, 40);
  advance(20 * 60_000);
  assert.deepEqual(evaluate(150, 'HIGH', 90, 30), ['ALERT_NEAR'], 'entrada por transversal a 150 m');
});

test('estados de radares que saíram do trajeto têm limite de memória', () => {
  let clock = 0;
  const manager = new AlertManager({ now: () => clock, minIntervalMs: 0, maxTrackedRadars: 3 });
  const segment = { id: 'via', roadKey: 'ref:SP-TESTE' };
  for (let i = 0; i < 10; i += 1) {
    clock += 1000;
    manager.processEvaluation({ matchedSegment: segment, effectiveHeading: 90, confidence: 'HIGH',
      candidateRadars: [{ id: `r${i}`, active: true, roadKey: segment.roadKey, effectiveDirection: 90, routeDistanceMeters: 100 }] });
  }
  clock += 1000;
  manager.processEvaluation({ matchedSegment: segment, effectiveHeading: 90, confidence: 'HIGH', candidateRadars: [] });
  assert.equal(manager.radarStates.size, 3);
  assert.deepEqual([...manager.radarStates.keys()], ['r7', 'r8', 'r9']);
});

test('rearme preserva direção e confiança exigidas', () => {
  const { evaluate, advance } = rearmScenario();
  assert.deepEqual(evaluate(120), ['ALERT_NEAR']);
  advance(5000); evaluate(null);
  advance(20 * 60_000);
  assert.deepEqual(evaluate(900, 'HIGH', 270), [], 'sentido oposto');
  assert.deepEqual(evaluate(900, 'MEDIUM'), [], 'via não confirmada');
});
