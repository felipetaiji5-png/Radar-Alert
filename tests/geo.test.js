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
