import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRadarProximity, renderRadarProximity } from '../ui/radar-proximity.js';

const reference = distance => ({ mode: 'reference', radar: { id: 'a', distance } });
const route = distance => ({ mode: 'route', radar: { id: 'a', routeDistanceMeters: distance, distance: 40 } });

test('escala visual é linear: zero coincide com carro e 1 km com borda', () => {
  assert.equal(deriveRadarProximity(reference(0)).markerPercent, 14);
  assert.equal(deriveRadarProximity(reference(500)).markerPercent, 51.5);
  assert.equal(deriveRadarProximity(reference(1000)).markerPercent, 89);
});
test('radar se aproxima do carro ao diminuir distância e recua ao aumentar', () => {
  const positions = [900, 500, 200, 50].map(m => deriveRadarProximity(reference(m)).markerPercent);
  assert.ok(positions.every((p, i) => !i || p < positions[i - 1]));
  assert.ok(deriveRadarProximity(reference(600)).markerPercent > positions.at(-1));
});
test('além de 1 km preserva distância real e sinaliza fim da escala', () => {
  const result = deriveRadarProximity(reference(2400));
  assert.equal(result.markerPercent, 89);
  assert.equal(result.distanceLabel, '2,4 km');
  assert.equal(result.outsideScale, true);
  assert.match(result.message, /além da escala/);
});
test('rota confirmada usa distância pela via, sem substituir pela geodésica menor', () => {
  const result = deriveRadarProximity(route(500));
  assert.equal(result.markerPercent, 51.5);
  assert.equal(result.distanceLabel, '500 m');
  assert.equal(result.modeLabel, 'Distância pela via');
});
test('sem confirmação da via deixa explícito que é uma referência ilustrativa', () => {
  const result = deriveRadarProximity(reference(200));
  assert.match(result.modeLabel, /Linha reta/);
  assert.match(result.message, /outra rua ou sentido/);
});
test('não inventa aproximação quando distância permanece igual', () => {
  assert.deepEqual(deriveRadarProximity(reference(320)), deriveRadarProximity(reference(320)));
});
for (const mode of ['idle', 'waiting', 'stale', 'empty']) test(`modo ${mode} oculta radar mesmo que receba valor anterior`, () => {
  assert.equal(deriveRadarProximity({ ...reference(50), mode }).active, false);
});
test('distâncias nulas, negativas, infinitas ou inválidas não posicionam radar', () => {
  for (const distance of [null, undefined, NaN, Infinity, -1, '100']) assert.equal(deriveRadarProximity(reference(distance)).active, false);
});

const fakePanel = () => {
  const elements = new Map();
  return id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, style: {}, hidden: false, textContent: '',
      setAttribute(key, value) { this[key] = value; } });
    return elements.get(id);
  };
};
test('renderização atualiza posição, legenda acessível e distância', () => {
  const $ = fakePanel();
  renderRadarProximity($, reference(500));
  assert.equal($('proximityRadar').style.left, '51.5%');
  assert.equal($('proximityRadar').hidden, false);
  assert.equal($('proximityDistance').textContent, '500 m');
  assert.match($('proximityScene')['aria-label'], /Linha reta.*500 m/);
});
test('novo radar aparece sem atravessar a tela como se fosse o equipamento anterior', () => {
  const $ = fakePanel();
  renderRadarProximity($, reference(500));
  assert.equal($('proximityRadar').style.transition, 'none');
  renderRadarProximity($, reference(200));
  assert.equal($('proximityRadar').style.transition, '');
  renderRadarProximity($, { mode: 'reference', radar: { id: 'b', distance: 900 } });
  assert.equal($('proximityRadar').style.transition, 'none');
  assert.equal($('proximityRadar').style.left, '81.5%');
});
test('parada ou perda do GPS remove radar e o valor antigo da ilustração', () => {
  const $ = fakePanel();
  renderRadarProximity($, reference(80));
  renderRadarProximity($, { mode: 'stale', radar: null });
  assert.equal($('proximityRadar').hidden, true);
  assert.equal($('proximityDistance').textContent, '—');
  assert.equal($('radarProximity').dataset.radarKey, '');
  assert.match($('proximityScene')['aria-label'], /desatualizado/);
});
