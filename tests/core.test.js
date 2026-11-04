import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, normalizePardalRows, haversineMeters, angleDiff, findNearbyRadars } from '../core.js';

const row = (overrides = {}) => ({
  lat: '-23.5500', lng: '-46.6300', kind: 'FIXED', limit_kmh: '60',
  source: 'Pardal', active: '1', direction_deg: '90', ...overrides
});

test('CSV trata BOM, aspas e vírgulas dentro de campos', () => {
  const rows = parseCsv('\uFEFFlat,lng,source\n-23.5,-46.6,"DER-SP, CET"\n');
  assert.equal(rows[0].source, 'DER-SP, CET');
});

test('CSV detecta separador ponto e vírgula', () => {
  const rows = parseCsv('lat;lng;source\n-23.5;-46.6;DER-SP\n');
  assert.equal(rows[0].lat, '-23.5');
  assert.equal(rows[0].source, 'DER-SP');
});

test('direção vazia vira null, mas direção 0 permanece válida', () => {
  const [unknown, north] = normalizePardalRows([row({ direction_deg: '' }), row({ lat: '-23.551', direction_deg: '0' })]);
  assert.equal(unknown.direction, null);
  assert.equal(north.direction, 0);
});

test('limite não padronizado é preservado sem arredondamento', () => {
  const [radar] = normalizePardalRows([row({ limit_kmh: '55' })]);
  assert.equal(radar.limit, 55);
});

test('limite composto não é convertido em um valor arbitrário', () => {
  const [radar] = normalizePardalRows([row({ limit_kmh: '100/80' })]);
  assert.equal(radar.limit, null);
  assert.equal(radar.rawLimit, '100/80');
});

test('preserva coordenadas finais de radares de trecho', () => {
  const [radar] = normalizePardalRows([row({ kind: 'SECTION', end_lat: '-23.56', end_lng: '-46.64' })]);
  assert.equal(radar.kind, 'SECTION');
  assert.equal(radar.endLat, -23.56);
  assert.equal(radar.endLng, -46.64);
});

test('preserva registros inativos para contagem e auditoria', () => {
  const [radar] = normalizePardalRows([row({ active: '0' })]);
  assert.equal(radar.active, false);
});

test('não funde radares próximos quando a direção de ambos é desconhecida', () => {
  const radars = normalizePardalRows([
    row({ direction_deg: '' }),
    row({ lng: '-46.63001', direction_deg: '' })
  ]);
  assert.equal(radars.length, 2);
});

test('funde registros próximos com mesma direção, tipo e limite', () => {
  const radars = normalizePardalRows([
    row(),
    row({ lng: '-46.63001', source: 'DER-SP' })
  ]);
  assert.equal(radars.length, 1);
  assert.equal(radars[0].duplicatesMerged, 1);
  assert.match(radars[0].source, /DER-SP/);
});


test('não funde registros próximos com status ativo/inativo conflitante', () => {
  const radars = normalizePardalRows([
    row({ active: '1' }),
    row({ lng: '-46.63001', active: '0' })
  ]);
  assert.equal(radars.length, 2);
  assert.deepEqual(radars.map(r => r.active).sort(), [false, true]);
});

test('distância geodésica é plausível para um grau de latitude', () => {
  const distance = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(distance > 111000 && distance < 112000);
});

test('diferença angular trata a transição 359/1 graus', () => {
  assert.equal(angleDiff(359, 1), 2);
});

test('filtra radar atrás do veículo quando rumo é conhecido', () => {
  const radars = normalizePardalRows([
    row({ lat: '-23.5400', lng: '-46.6300', direction_deg: '0' }),
    row({ lat: '-23.5600', lng: '-46.6300', direction_deg: '180' })
  ]);
  const found = findNearbyRadars({ lat: -23.55, lng: -46.63, heading: 0, accuracy: 8 }, radars);
  assert.equal(found.length, 1);
  assert.ok(found[0].lat > -23.55);
});

test('direção desconhecida nunca habilita alerta automático', () => {
  const [radar] = normalizePardalRows([row({ direction_deg: '' })]);
  const found = findNearbyRadars({ lat: -23.55, lng: -46.631, heading: 90, accuracy: 5 }, [radar]);
  assert.equal(found.length, 1);
  assert.equal(found[0].alertEligible, false);
});

test('sem heading, mostra candidato mas não considera rumo confirmado', () => {
  const [radar] = normalizePardalRows([row()]);
  const found = findNearbyRadars({ lat: -23.549, lng: -46.63, heading: null, accuracy: 5 }, [radar]);
  assert.equal(found.length, 1);
  assert.equal(found[0].alertEligible, false);
});
