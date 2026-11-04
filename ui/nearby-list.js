import { radarKind, formatDistance, formatBearing } from '../core.js';

/** DOM somente; nenhuma notificação ou avaliação de radar é executada aqui. */
export function renderNearbyList(container, nearby) {
  container.replaceChildren();
  if (!nearby.length) {
    const empty = container.ownerDocument.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = 'Nenhum equipamento candidato encontrado em até 5 km.';
    container.append(empty);
    return;
  }
  for (const radar of nearby.slice(0, 8)) {
    const doc = container.ownerDocument;
    const item = doc.createElement('div'); item.className = 'nearby-item';
    const info = doc.createElement('div');
    const title = doc.createElement('b');
    title.textContent = `${radarKind(radar.kind)} · ${radar.limit == null ? 'limite desconhecido' : `${radar.limit} km/h`}`;
    const detail = doc.createElement('small');
    detail.textContent = radar.routeDistanceMeters != null
      ? `${radar.source} · via ${radar.roadName || 'OSM'} · ${radar.directionSource === 'dataset' ? 'sentido cadastrado' : 'sentido inferido'}${Number.isFinite(radar.sectionLengthMeters) ? ` · trecho ${formatDistance(radar.sectionLengthMeters)}` : ''}`
      : `${radar.source} · ${radar.direction == null ? 'sentido não cadastrado' : `sentido ${formatBearing(radar.direction)}`} · distância aproximada; sem alerta`;
    info.append(title, detail);
    const distance = doc.createElement('div'); distance.className = 'nearby-distance';
    distance.textContent = formatDistance(radar.routeDistanceMeters ?? radar.distance);
    item.append(info, distance); container.append(item);
  }
}
