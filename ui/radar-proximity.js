import { formatDistance } from '../core.js';

export const PROXIMITY_SCALE_METERS = 1000;
const CAR_PERCENT = 14;
const FAR_PERCENT = 89;

/** Projeção visual da distância já calculada; nunca estima movimento ou emite aviso. */
export function deriveRadarProximity(display = {}) {
  const route = display.mode === 'route';
  const distance = route ? display.radar?.routeDistanceMeters : display.radar?.distance;
  if (!['route', 'reference'].includes(display.mode) || !display.radar ||
      !Number.isFinite(distance) || distance < 0) {
    return { active: false, key: '', markerPercent: FAR_PERCENT,
      distanceLabel: '—', modeLabel: 'Sem radar selecionado',
      message: ({ idle: 'Inicie o monitoramento para acompanhar a proximidade.',
        waiting: 'Aguardando uma posição GPS válida.', stale: 'GPS desatualizado ou recusado. Aguardando nova posição.',
        empty: 'Nenhum radar ativo encontrado em até 5 km.' })[display.mode] || 'Aguardando uma distância válida.' };
  }
  const fraction = Math.min(distance / PROXIMITY_SCALE_METERS, 1);
  return { active: true, key: `${display.mode}:${display.radar.id ?? `${display.radar.lat}:${display.radar.lng}`}`,
    markerPercent: CAR_PERCENT + fraction * (FAR_PERCENT - CAR_PERCENT),
    distanceLabel: formatDistance(distance), modeLabel: route ? 'Distância pela via' : 'Linha reta · referência',
    outsideScale: distance > PROXIMITY_SCALE_METERS,
    message: distance > PROXIMITY_SCALE_METERS
      ? `Radar além da escala de 1 km: ${formatDistance(distance)}. ${route ? 'Distância pela via confirmada.' : 'Pode estar em outra rua ou sentido.'}`
      : route ? 'Esquema de distância pela via; não representa curvas ou faixas.'
        : 'Rua ilustrativa. O radar pode estar em outra rua ou sentido.' };
}

export function renderRadarProximity($, display) {
  const card = $('radarProximity');
  if (!card) return;
  const view = deriveRadarProximity(display);
  const marker = $('proximityRadar');
  const range = $('proximityRange');
  // Um novo equipamento não deve parecer o radar anterior atravessando a rua.
  marker.style.transition = card.dataset.radarKey === view.key ? '' : 'none';
  if (range) {
    range.style.transition = marker.style.transition;
    range.style.width = `${view.active ? (view.markerPercent - CAR_PERCENT) / (FAR_PERCENT - CAR_PERCENT) * 100 : 0}%`;
    range.hidden = !view.active;
  }
  marker.style.left = `${view.markerPercent}%`;
  marker.hidden = !view.active;
  card.dataset.radarKey = view.key;
  card.dataset.state = view.active ? display.mode : 'idle';
  $('proximityDistance').textContent = view.distanceLabel;
  $('proximityMode').textContent = view.modeLabel;
  $('proximityCaption').textContent = view.message;
  $('proximityFar').textContent = view.outsideScale ? '1 km +' : '1 km';
  $('proximityScene').setAttribute('aria-label', view.active
    ? `Carro e radar em esquema de proximidade. ${view.modeLabel}: ${view.distanceLabel}. ${view.message}`
    : `Carro em uma rua ilustrativa. ${view.message}`);
}
