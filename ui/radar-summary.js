import { formatDistance, formatBearing, radarKind } from '../core.js';
import { haversineMeters } from '../geo/geo-math.js';

const validCoordinate = point => Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 &&
  Number.isFinite(point?.lng) && Math.abs(point.lng) <= 180;

/** Referências visuais, sem decisão de direção, pista ou autorização de alerta. */
export function findRadarReferences(position, radars, { radius = 5000, maxResults = 15 } = {}) {
  if (!validCoordinate(position)) return [];
  return radars.filter(radar => radar.active && validCoordinate(radar))
    .map(radar => ({ ...radar, distance: haversineMeters(position, radar),
      distanceType: 'geodesic', routeDistanceMeters: null, alertEligible: false, confidence: 'low' }))
    .filter(radar => radar.distance <= radius)
    .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)))
    .slice(0, maxResults);
}

export function selectRadarDisplay({ tracking = false, position, gpsIssue = null,
  routeRadar = null, routeConfirmed = false, references = [], now = Date.now() } = {}) {
  if (!tracking) return { mode: 'idle', radar: null };
  if (!validCoordinate(position)) return { mode: 'waiting', radar: null };
  const age = now - position.timestamp;
  if (gpsIssue || !Number.isFinite(age) || age < 0 || age > 90000) return { mode: 'stale', radar: null };
  if (routeConfirmed && routeRadar && Number.isFinite(routeRadar.routeDistanceMeters) && routeRadar.routeDistanceMeters > 0) {
    return { mode: 'route', radar: routeRadar };
  }
  const radar = references.find(item => item.active && item.distanceType === 'geodesic' &&
    Number.isFinite(item.distance) && item.distance >= 0 && item.distance <= 5000);
  return radar ? { mode: 'reference', radar } : { mode: 'empty', radar: null };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function renderRadarDisplay($, display, mapMatch = null) {
  const panel = $('drivePanel');
  if (panel) panel.dataset.display = display.mode;
  const next = display.radar;
  if (!next) {
    $('radarHeadline').textContent = ({ idle: 'Seu trajeto começa aqui', waiting: 'Buscando sinal GPS',
      stale: 'Aguardando GPS válido', empty: 'Nenhum radar próximo' })[display.mode];
    $('radarSubhead').textContent = ({ idle: 'Monitoramento desligado', waiting: 'Aguardando localização',
      stale: 'Leitura GPS indisponível', empty: 'Sem radar em até 5 km' })[display.mode];
    $('distanceTypeLabel').textContent = 'Distância ao radar';
    $('distanceValue').innerHTML = '—<small>m</small>';
    $('roadLabel').textContent = display.mode === 'empty' ? 'Não há radar ativo na base dentro do raio de busca de 5 km.' : 'Ative o monitoramento e aguarde uma posição GPS recente para consultar os radares próximos.';
    $('speedLimit').textContent = '—';
    $('radarKind').textContent = '—'; $('radarDirection').textContent = '—'; $('radarSource').textContent = '—';
    $('radarDataConfidence').textContent = '—';
    $('confidenceBadge').className = 'confidence neutral';
    $('confidenceBadge').textContent = display.mode === 'empty' ? 'Sem equipamento próximo' : 'Sem posição válida';
  } else {
    const reference = display.mode === 'reference';
    $('radarHeadline').textContent = reference ? 'Radar por perto' : 'Radar no seu caminho';
    $('radarSubhead').textContent = reference ? `${radarKind(next.kind)} · via não confirmada` :
      next.roadName || mapMatch?.segment?.name || mapMatch?.segment?.ref || 'Via identificada pelo OSM';
    $('distanceTypeLabel').textContent = reference ? 'Distância em linha reta · aproximada' : 'Distância pela via';
    const distance = formatDistance(reference ? next.distance : next.routeDistanceMeters);
    const [number, unit = 'm'] = distance.split(' ');
    $('distanceValue').innerHTML = `${escapeHtml(number)}<small>${escapeHtml(unit)}</small>`;
    const sectionInfo = next.kind === 'SECTION' && Number.isFinite(next.sectionLengthMeters)
      ? ` Extensão do trecho mapeada: ${formatDistance(next.sectionLengthMeters)}.` : '';
    $('roadLabel').textContent = reference
      ? 'Pode estar em outra rua ou sentido. Limite do cadastro deste radar; não confirma o limite da sua via. Sem alerta nesta referência.'
      : `Distância calculada pela rede viária OpenStreetMap. Associação do radar: ${next.directionSource === 'dataset' ? 'sentido informado na base' : 'sentido inferido por via de direção única próxima'}.${sectionInfo} Confira a sinalização física.`;
    $('speedLimit').textContent = next.limit == null ? '—' : next.limit;
    $('radarKind').textContent = radarKind(next.kind);
    $('radarDirection').textContent = formatBearing(reference ? next.direction : next.effectiveDirection ?? next.direction);
    $('radarSource').textContent = next.source;
    $('radarDataConfidence').textContent = reference ? 'Referência geográfica · sem confirmação de via' : `${next.confidence || 'não informada'} · offset ${Math.round(next.offsetMeters || 0)} m`;
    $('confidenceBadge').className = !reference && next.directionSource === 'dataset' ? 'confidence good' : 'confidence warn';
    $('confidenceBadge').textContent = reference ? 'Referência · sem alerta' : next.directionSource === 'dataset' ? 'Sentido informado' : 'Sentido inferido';
  }
}
