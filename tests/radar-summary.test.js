import test from 'node:test';
import assert from 'node:assert/strict';
import { findRadarReferences, selectRadarDisplay, renderRadarDisplay } from '../ui/radar-summary.js';
import { AlertManager } from '../geo/alert-manager.js';

const now = 1000000;
const position = { lat: -23.55, lng: -46.63, heading: null, speed: 0, accuracy: 8, timestamp: now };
const radar = { id: 'near', lat: -23.549, lng: -46.63, active: true, limit: 50, direction: 180, kind: 'FIXED' };
const options = overrides => ({ tracking: true, position, now,
  references: findRadarReferences(position, [radar]), ...overrides });

const panel = () => {
  const elements = new Map();
  return id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', className: '', dataset: {} });
    return elements.get(id);
  };
};

test('painel escreve 50 km/h e 111 m no caso parado e sem OSM, com rótulo de referência', () => {
  const $ = panel();
  renderRadarDisplay($, selectRadarDisplay(options()));
  assert.equal($('speedLimit').textContent, 50);
  assert.equal($('distanceValue').innerHTML, '111<small>m</small>');
  assert.match($('distanceTypeLabel').textContent, /linha reta/);
  assert.match($('confidenceBadge').textContent, /sem alerta/);
  assert.match($('roadLabel').textContent, /outra rua ou sentido/);
});

test('painel troca entre referência e rota e limpa os valores quando o GPS envelhece', () => {
  const $ = panel();
  renderRadarDisplay($, selectRadarDisplay(options()));
  renderRadarDisplay($, selectRadarDisplay(options({ routeConfirmed: true,
    routeRadar: { ...radar, limit: 60, routeDistanceMeters: 400, directionSource: 'dataset' } })));
  assert.equal($('distanceValue').innerHTML, '400<small>m</small>');
  assert.equal($('speedLimit').textContent, 60);
  assert.equal($('distanceTypeLabel').textContent, 'Distância pela via');
  renderRadarDisplay($, selectRadarDisplay(options({ now: now + 90001 })));
  assert.equal($('distanceValue').innerHTML, '—<small>m</small>');
  assert.equal($('speedLimit').textContent, '—');
});

test('painel não inventa limite quando o radar não tem essa informação', () => {
  const $ = panel();
  const refs = findRadarReferences(position, [{ ...radar, limit: null }]);
  renderRadarDisplay($, selectRadarDisplay(options({ references: refs })));
  assert.equal($('speedLimit').textContent, '—');
  assert.equal($('distanceValue').innerHTML, '111<small>m</small>');
});

test('parado e sem malha OSM mostra limite e distância aproximada do radar mais próximo', () => {
  const display = selectRadarDisplay(options());
  assert.equal(display.mode, 'reference');
  assert.equal(display.radar.limit, 50);
  assert.ok(display.radar.distance > 110 && display.radar.distance < 112);
  assert.equal(display.radar.routeDistanceMeters, null);
});

test('referência geográfica independe do rumo residual e do sentido do radar', () => {
  const behind = { ...radar, id: 'behind', lat: position.lat - .0001 };
  const refs = findRadarReferences({ ...position, heading: 0 }, [radar, behind]);
  assert.equal(refs[0].id, 'behind');
  assert.equal(refs.length, 2);
});

test('referências incluem equipamento a menos de oito metros e distância zero', () => {
  const atPosition = { ...radar, lat: position.lat, lng: position.lng };
  const display = selectRadarDisplay(options({ references: findRadarReferences(position, [atPosition]) }));
  assert.equal(display.mode, 'reference');
  assert.equal(display.radar.distance, 0);
});

test('ordena por distância e exclui inativos, coordenadas inválidas e distância acima de 5 km', () => {
  const closer = { ...radar, id: 'closer', lat: position.lat + .0001 };
  const refs = findRadarReferences(position, [radar, closer,
    { ...radar, id: 'off', active: false }, { ...radar, id: 'invalid', lat: NaN },
    { ...radar, id: 'far', lat: position.lat + .1 }]);
  assert.deepEqual(refs.map(r => r.id), ['closer', 'near']);
  assert.equal(findRadarReferences(position, refs, { maxResults: 1 }).length, 1);
  assert.deepEqual(findRadarReferences({ lat: 999, lng: 0 }, [radar]), []);
});

test('limite ausente na base continua ausente, sem estimativa inventada', () => {
  const refs = findRadarReferences(position, [{ ...radar, limit: null, direction: null }]);
  assert.equal(selectRadarDisplay(options({ references: refs })).radar.limit, null);
});

test('radar confirmado pela via tem prioridade sobre referência geográfica mais próxima', () => {
  const routeRadar = { ...radar, id: 'route', routeDistanceMeters: 400, limit: 60 };
  const display = selectRadarDisplay(options({ routeConfirmed: true, routeRadar }));
  assert.equal(display.mode, 'route');
  assert.equal(display.radar.id, 'route');
  assert.equal(display.radar.routeDistanceMeters, 400);
});

test('perda da confirmação da via volta à referência, sem reutilizar distância de rota', () => {
  const routeRadar = { ...radar, routeDistanceMeters: 400 };
  const display = selectRadarDisplay(options({ routeConfirmed: false, routeRadar }));
  assert.equal(display.mode, 'reference');
  assert.equal(display.radar.routeDistanceMeters, null);
});

test('via confirmada sem radar associado ainda permite referência claramente geográfica', () => {
  assert.equal(selectRadarDisplay(options({ routeConfirmed: true, routeRadar: null })).mode, 'reference');
});

test('sem radar no raio de busca o painel permanece vazio', () => {
  assert.deepEqual(selectRadarDisplay(options({ references: [] })), { mode: 'empty', radar: null });
});

for (const [label, changes, mode] of [
  ['monitoramento parado', { tracking: false }, 'idle'],
  ['sem posição', { position: null }, 'waiting'],
  ['fix recusado', { gpsIssue: 'LOW_ACCURACY' }, 'stale'],
  ['fix antigo', { position: { ...position, timestamp: now - 90001 } }, 'stale'],
  ['timestamp inválido', { position: { ...position, timestamp: NaN } }, 'stale'],
  ['timestamp futuro', { position: { ...position, timestamp: now + 1 } }, 'stale']
]) test(`limpa distância e limite exibidos com ${label}`, () => {
  const display = selectRadarDisplay(options({ routeConfirmed: true,
    routeRadar: { ...radar, routeDistanceMeters: 400 }, ...changes }));
  assert.deepEqual(display, { mode, radar: null });
});

test('referência não produz alertas mesmo se enviada por engano ao avaliador de rota', () => {
  const refs = findRadarReferences(position, [{ ...radar, roadKey: 'street', direction: 0,
    routeDistanceMeters: 111, alertEligible: true }]);
  assert.equal(refs[0].alertEligible, false);
  assert.equal(refs[0].routeDistanceMeters, null);
  const result = new AlertManager().processEvaluation({
    matchedSegment: { roadKey: 'street' }, confidence: 'HIGH', effectiveHeading: 0, candidateRadars: refs
  });
  assert.deepEqual(result.alerts, []);
  assert.equal(result.nextRadar, null);
});
