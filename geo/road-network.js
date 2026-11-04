import { haversineMeters, bearingDegrees, projectPointOnSegment, angleDiff } from './geo-math.js';
import { SpatialIndex } from './spatial-index.js';

function normalizeOneway(value, tags = {}) {
  const raw = String(value ?? tags.oneway ?? '').trim().toLowerCase();
  if (['-1', 'reverse'].includes(raw)) return -1;
  if (['yes', 'true', '1'].includes(raw)) return 1;
  if (['no', 'false', '0'].includes(raw)) return 0;
  // Valores dinâmicos/inesperados não são tratados como bidirecionais por suposição.
  if (['reversible', 'alternating'].includes(raw) || (raw && !['-1', 'reverse', 'yes', 'true', '1', 'no', 'false', '0'].includes(raw))) return null;
  // Convenções OSM: motorway, motorway_link e rotatórias são mão única
  // por padrão, salvo quando a via declara explicitamente oneway=no.
  const highway = String(tags.highway || '').toLowerCase();
  if (['motorway', 'motorway_link'].includes(highway) || String(tags.junction || '').toLowerCase() === 'roundabout') return 1;
  return 0;
}

export class RoadSegment {
  constructor({ id, wayId = null, name = null, ref = null, roadKey = null, fromNode = null, toNode = null,
    coords, oneway = null, physicalOneway = false, layer = 0, highway = null, tags = {} }) {
    if (!id || !Array.isArray(coords) || coords.length < 2) throw new TypeError('Segmento precisa de id e ao menos duas coordenadas.');
    this.id = String(id);
    this.wayId = wayId == null ? null : String(wayId);
    this.name = name || null;
    this.ref = ref || null;
    this.roadKey = roadKey || (ref ? `ref:${ref}` : name ? `name:${name}` : `way:${wayId ?? id}`);
    this.fromNode = fromNode == null ? null : String(fromNode);
    this.toNode = toNode == null ? null : String(toNode);
    this.coords = coords.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    if (this.coords.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) throw new TypeError('Coordenada de segmento inválida.');
    this.oneway = normalizeOneway(oneway, tags);
    this.physicalOneway = Boolean(physicalOneway);
    this.layer = Number.isFinite(Number(layer)) ? Number(layer) : 0;
    this.highway = highway || null;
    this.tags = tags;
    this.length = this._calcLength();
    const first = this.coords[0], last = this.coords[this.coords.length - 1];
    this.lat = (first.lat + last.lat) / 2;
    this.lng = (first.lng + last.lng) / 2;
    this.bearing = bearingDegrees(this.coords[0], this.coords.at(-1));
  }

  _calcLength() {
    let sum = 0;
    for (let i = 0; i < this.coords.length - 1; i++) sum += haversineMeters(this.coords[i], this.coords[i + 1]);
    return sum;
  }

  project(point, travelHeading = null) {
    let minPerp = Infinity, bestProj = null, bestDistAlong = 0, bestBearing = this.bearing, accum = 0;
    for (let i = 0; i < this.coords.length - 1; i++) {
      const a = this.coords[i], b = this.coords[i + 1];
      const segmentLength = haversineMeters(a, b);
      const projected = projectPointOnSegment(point, a, b);
      if (projected.distancePerp < minPerp) {
        minPerp = projected.distancePerp;
        bestProj = projected.projPoint;
        bestDistAlong = accum + projected.t * segmentLength;
        bestBearing = bearingDegrees(a, b);
      }
      accum += segmentLength;
    }
    let reverse = this.oneway === -1;
    if (this.oneway === 0 && Number.isFinite(travelHeading)) {
      reverse = angleDiff(travelHeading, (bestBearing + 180) % 360) < angleDiff(travelHeading, bestBearing);
    }
    if (reverse) { bestBearing = (bestBearing + 180) % 360; bestDistAlong = this.length - bestDistAlong; }
    return { segmentId: this.id, distPerp: minPerp, distAlong: bestDistAlong, projPoint: bestProj,
      roadBearing: bestBearing, layer: this.layer, length: this.length, reverse };
  }
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].distance <= item.distance) break; a[i] = a[p]; i = p; }
    a[i] = item;
  }
  pop() {
    const a = this.items; if (!a.length) return null;
    const root = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        let left = i * 2 + 1, right = left + 1;
        if (left >= a.length) break;
        let child = right < a.length && a[right].distance < a[left].distance ? right : left;
        if (a[child].distance >= last.distance) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return root;
  }
  get size() { return this.items.length; }
}

export class RoadNetworkProvider {
  constructor(segments = [], { center = null, radiusMeters = 0, osmTimestamp = null } = {}) {
    this.segments = new Map();
    this.adjacency = new Map();
    this.spatialIndex = new SpatialIndex(0.0025);
    this.center = center;
    this.radiusMeters = radiusMeters;
    this.osmTimestamp = osmTimestamp;
    this.radarAttachments = new Map();
    this.maxSegmentLength = 0;
    for (const segment of segments) this.addSegment(segment);
  }

  addSegment(segment) {
    this.segments.set(segment.id, segment);
    this.maxSegmentLength = Math.max(this.maxSegmentLength, segment.length);
    this.spatialIndex.insertSegment(segment);
    if (segment.fromNode != null && segment.toNode != null) {
      if (!this.adjacency.has(segment.fromNode)) this.adjacency.set(segment.fromNode, []);
      this.adjacency.get(segment.fromNode).push(segment);
    }
  }

  getSegment(id) { return this.segments.get(id); }
  getAllSegments() { return [...this.segments.values()]; }
  covers(point, margin = 0.72) {
    return Boolean(this.center && this.radiusMeters > 0 && haversineMeters(this.center, point) <= this.radiusMeters * margin);
  }

  getCandidates(point, radiusMeters = 100) {
    return this.spatialIndex.queryRadius(point.lat, point.lng, radiusMeters)
      .filter(segment => segment.project(point).distPerp <= radiusMeters);
  }

  shortestDistances(startNode, roadKey, layer, maxDistance = 6000, previousEdge = null) {
    // O estado inclui a aresta de chegada. Isso permite impedir o retorno
    // imediato pela mesma way em vias bidirecionais (U-turn artificial).
    const start = String(startNode);
    const initialPreviousNode = previousEdge?.fromNode == null ? null : String(previousEdge.fromNode);
    const initialPreviousWay = previousEdge?.wayId == null ? null : String(previousEdge.wayId);
    const stateKey = (node, previousNode, previousWay) =>
      `${node}|${previousNode ?? ''}|${previousWay ?? ''}`;
    const initialKey = stateKey(start, initialPreviousNode, initialPreviousWay);
    const bestState = new Map([[initialKey, 0]]);
    const nodeDistances = new Map([[start, 0]]);
    const heap = new MinHeap();
    heap.push({ node: start, previousNode: initialPreviousNode, previousWay: initialPreviousWay, distance: 0 });

    while (heap.size) {
      const current = heap.pop();
      const currentKey = stateKey(current.node, current.previousNode, current.previousWay);
      if (current.distance !== bestState.get(currentKey)) continue;
      if (current.distance > maxDistance) break;

      for (const edge of this.adjacency.get(current.node) || []) {
        if (edge.roadKey !== roadKey || edge.layer !== layer) continue;
        // Não volte pelo mesmo trecho OSM que acabou de percorrer.
        if (current.previousNode != null && edge.wayId === current.previousWay && edge.toNode === current.previousNode) continue;

        const nextDistance = current.distance + edge.length;
        if (nextDistance > maxDistance) continue;
        const nextNode = String(edge.toNode);
        const nextKey = stateKey(nextNode, current.node, edge.wayId);
        if (nextDistance >= (bestState.get(nextKey) ?? Infinity)) continue;

        bestState.set(nextKey, nextDistance);
        nodeDistances.set(nextNode, Math.min(nodeDistances.get(nextNode) ?? Infinity, nextDistance));
        heap.push({ node: nextNode, previousNode: current.node, previousWay: edge.wayId, distance: nextDistance });
      }
    }
    return nodeDistances;
  }

  attachRadars(radars, { maxOffsetMeters = 45 } = {}) {
    this.radarAttachments.clear();
    const stats = {
      considered: radars.length,
      nearby: 0,
      eligible: 0,
      ambiguous: 0,
      missingDirectionNear: 0,
      knownDirectionNear: 0,
      inferredOneway: 0,
      reasons: {}
    };
    for (const radar of radars) {
      const candidates = this.getCandidates(radar, maxOffsetMeters)
        .map(edge => ({ edge, projection: edge.project(radar) }))
        .filter(item => item.projection.distPerp <= maxOffsetMeters);
      if (!candidates.length) continue;
      stats.nearby++;
      if (Number.isFinite(radar.direction)) stats.knownDirectionNear++;
      else stats.missingDirectionNear++;
      candidates.sort((a, b) => a.projection.distPerp - b.projection.distPerp);
      let eligible = [], directionSource = 'unknown';
      if (Number.isFinite(radar.direction)) {
        eligible = candidates.filter(item => angleDiff(item.edge.bearing, radar.direction) <= 50);
        directionSource = 'dataset';
      } else {
        // Para direção ausente, uma via fisicamente de mão única pode fornecer
        // o sentido, MAS somente se for claramente mais próxima que todas as
        // outras ways físicas. Segmentos consecutivos da mesma way não são
        // concorrentes; ruas paralelas, cruzamentos e pistas duplicadas são.
        const closestByWay = new Map();
        for (const item of candidates) {
          const physicalWay = item.edge.wayId ?? item.edge.id;
          const previous = closestByWay.get(physicalWay);
          if (!previous || item.projection.distPerp < previous.projection.distPerp) closestByWay.set(physicalWay, item);
        }
        const physicalWays = [...closestByWay.values()].sort((a, b) => a.projection.distPerp - b.projection.distPerp);
        const first = physicalWays[0], runnerUp = physicalWays[1];
        // Exige pelo menos 15 m de vantagem e 1,8x de separação. Não
        // extrapolamos sentido em ruas bidirecionais ou pistas quase iguais.
        const uniquelyClosest = !runnerUp || (
          runnerUp.projection.distPerp - first.projection.distPerp >= 15 &&
          runnerUp.projection.distPerp >= Math.max(3, first.projection.distPerp) * 1.8
        );
        if (first.edge.physicalOneway && uniquelyClosest) {
          eligible = [first];
          directionSource = 'osm_one_direction_nearby';
        }
      }
      if (!eligible.length) {
        this.radarAttachments.set(radar.id, { radar, eligible: false, reason: 'DIRECAO_OU_VIA_AMBIGUA', offsetMeters: candidates[0].projection.distPerp });
        continue;
      }
      eligible.sort((a, b) => a.projection.distPerp - b.projection.distPerp);
      const best = eligible[0];
      const competing = eligible.slice(1).some(item => item.projection.distPerp - best.projection.distPerp < 4 && item.edge.wayId !== best.edge.wayId);
      if (competing) {
        this.radarAttachments.set(radar.id, { radar, eligible: false, reason: 'VIAS_PARALELAS_AMBIGUAS', offsetMeters: best.projection.distPerp });
        continue;
      }

      let sectionLengthMeters = null;
      if (String(radar.kind || '').toUpperCase() === 'SECTION') {
        if (!Number.isFinite(radar.endLat) || !Number.isFinite(radar.endLng)) {
          this.radarAttachments.set(radar.id, { radar, eligible: false, reason: 'TRECHO_SEM_PONTO_FINAL', offsetMeters: best.projection.distPerp });
          continue;
        }
        const endPoint = { lat: radar.endLat, lng: radar.endLng };
        const endCandidates = this.getCandidates(endPoint, maxOffsetMeters)
          .map(edge => ({ edge, projection: edge.project(endPoint) }))
          .filter(item => item.projection.distPerp <= maxOffsetMeters &&
            item.edge.roadKey === best.edge.roadKey && item.edge.layer === best.edge.layer &&
            angleDiff(item.edge.bearing, best.edge.bearing) <= 50);
        endCandidates.sort((a, b) => a.projection.distPerp - b.projection.distPerp);
        if (!endCandidates.length) {
          this.radarAttachments.set(radar.id, { radar, eligible: false, reason: 'FINAL_DO_TRECHO_NAO_ASSOCIADO', offsetMeters: best.projection.distPerp });
          continue;
        }
        const end = endCandidates[0];
        if (end.edge.id === best.edge.id && end.projection.distAlong >= best.projection.distAlong) {
          sectionLengthMeters = end.projection.distAlong - best.projection.distAlong;
        } else {
          const toEnd = this.shortestDistances(best.edge.toNode, best.edge.roadKey, best.edge.layer, 20000, best.edge);
          const distanceToEndNode = toEnd.get(end.edge.fromNode);
          if (Number.isFinite(distanceToEndNode)) {
            sectionLengthMeters = (best.edge.length - best.projection.distAlong) + distanceToEndNode + end.projection.distAlong;
          }
        }
        if (!Number.isFinite(sectionLengthMeters) || sectionLengthMeters < 10 || sectionLengthMeters > 20000) {
          this.radarAttachments.set(radar.id, { radar, eligible: false, reason: 'EXTENSAO_DO_TRECHO_INDETERMINADA', offsetMeters: best.projection.distPerp });
          continue;
        }
      }

      this.radarAttachments.set(radar.id, {
        radar, eligible: true, reason: null,
        edge: best.edge, distAlongSegment: best.projection.distAlong,
        offsetMeters: best.projection.distPerp, effectiveDirection: best.edge.bearing, directionSource,
        roadKey: best.edge.roadKey, roadName: best.edge.name, layer: best.edge.layer,
        sectionLengthMeters
      });
    }
    for (const attachment of this.radarAttachments.values()) {
      if (attachment.eligible) {
        stats.eligible++;
        if (attachment.directionSource === 'osm_one_direction_nearby') stats.inferredOneway++;
      } else {
        stats.ambiguous++;
        const reason = attachment.reason || 'DESCONHECIDO';
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
      }
    }
    this.lastAttachmentStats = stats;
    return stats.eligible;
  }

  exportForBackground({ maxEdges = 30000, maxAttachments = 12000 } = {}) {
    const segments = this.getAllSegments();
    if (segments.length > maxEdges) {
      throw new RangeError(`A malha possui ${segments.length} segmentos; o limite seguro para sincronização Android é ${maxEdges}.`);
    }
    const attachments = [...this.radarAttachments.values()].filter(item => item.eligible && item.edge);
    if (attachments.length > maxAttachments) {
      throw new RangeError(`A malha possui ${attachments.length} radares associados; o limite seguro é ${maxAttachments}.`);
    }
    return {
      schemaVersion: 1,
      // Deterministic payload: unchanged geometry should not force an Android reload.
      center: this.center,
      radiusMeters: this.radiusMeters,
      osmTimestamp: this.osmTimestamp,
      // Tuplas compactas para reduzir tráfego no bridge Capacitor e tamanho em disco.
      // [id, wayId, roadKey, fromNode, toNode, layer, length, fromLat, fromLng, toLat, toLng, bearing]
      edges: segments.map(edge => [
        edge.id, edge.wayId, edge.roadKey, edge.fromNode, edge.toNode, edge.layer,
        edge.length, edge.coords[0].lat, edge.coords[0].lng,
        edge.coords.at(-1).lat, edge.coords.at(-1).lng, edge.bearing
      ]),
      // [radarId, edgeId, roadKey, layer, distAlong, direction, offset, sectionLength, directionSource]
      attachments: attachments.map(item => [
        String(item.radar.id), item.edge.id, item.roadKey, item.layer,
        item.distAlongSegment, item.effectiveDirection, item.offsetMeters,
        Number.isFinite(item.sectionLengthMeters) ? item.sectionLengthMeters : null,
        item.directionSource
      ])
    };
  }

  getRoutedRadars(match, radars = [], { maxDistance = 5000 } = {}) {
    if (!match?.matched || match.confidence !== 'HIGH' || !match.segment?.toNode || !Number.isFinite(match.vehicleDistAlong)) return [];
    const current = match.segment;
    const remainingOnCurrent = Math.max(0, current.length - match.vehicleDistAlong);
    const distances = this.shortestDistances(current.toNode, current.roadKey, current.layer, maxDistance, current);
    const results = [];
    // Só percorre radares associados à região OSM carregada, não o catálogo estadual inteiro.
    for (const attachment of this.radarAttachments.values()) {
      const radar = attachment.radar;
      if (!attachment.eligible || !attachment.edge || attachment.roadKey !== current.roadKey || attachment.layer !== current.layer) continue;
      let routeDistance = Infinity;
      if (attachment.edge.id === current.id) {
        // No mesmo segmento, só aceita o ponto que ainda está à frente.
        if (attachment.distAlongSegment < match.vehicleDistAlong) continue;
        routeDistance = attachment.distAlongSegment - match.vehicleDistAlong;
      } else {
        const graphDistance = distances.get(attachment.edge.fromNode);
        if (Number.isFinite(graphDistance)) routeDistance = remainingOnCurrent + graphDistance + attachment.distAlongSegment;
      }
      if (routeDistance <= 0 || routeDistance > maxDistance) continue;
      results.push({
        ...radar,
        routeDistanceMeters: routeDistance,
        distance: routeDistance,
        roadSegmentId: attachment.edge.id,
        roadKey: attachment.roadKey,
        roadName: attachment.roadName || current.name,
        effectiveDirection: attachment.effectiveDirection,
        directionSource: attachment.directionSource,
        offsetMeters: attachment.offsetMeters,
        sectionLengthMeters: attachment.sectionLengthMeters,
        routeConfidence: attachment.directionSource === 'dataset' ? 'HIGH' : 'MEDIUM'
      });
    }
    return results.sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);
  }
}

export function buildRoadNetworkFromOverpass(data, metadata = {}) {
  const segments = [];
  const skipped = { unsupported: 0, malformed: 0, inaccessible: 0 };
  for (const way of data?.elements || []) {
    if (way.type !== 'way' || !Array.isArray(way.geometry) || way.geometry.length < 2 || !Array.isArray(way.nodes) || way.nodes.length !== way.geometry.length) { skipped.malformed++; continue; }
    const tags = way.tags || {};
    const highway = String(tags.highway || '').toLowerCase();
    if (!highway) { skipped.unsupported++; continue; }
    const restrictedValues = ['no', 'private'];
    const accessTags = [tags.access, tags.vehicle, tags.motor_vehicle, tags.motorcar].map(value => String(value || '').toLowerCase());
    if (accessTags.some(value => restrictedValues.includes(value))) { skipped.inaccessible++; continue; }
    if (tags['oneway:conditional']) { skipped.unsupported++; continue; }
    if (['construction', 'proposed', 'abandoned', 'razed', 'platform', 'steps', 'footway', 'cycleway', 'path', 'bridleway', 'pedestrian'].includes(highway)) { skipped.unsupported++; continue; }
    const oneway = normalizeOneway(tags.oneway, tags);
    if (oneway == null) { skipped.unsupported++; continue; }
    const layer = Number.parseInt(tags.layer || '0', 10) || 0;
    const name = tags.name || null, ref = tags.ref || null;
    const roadKey = ref ? `ref:${ref}` : name ? `name:${name}` : `way:${way.id}`;
    const points = way.geometry.map(point => ({ lat: Number(point.lat), lng: Number(point.lon) }));
    for (let i = 0; i < points.length - 1; i++) {
      const from = String(way.nodes[i]), to = String(way.nodes[i + 1]);
      if (!Number.isFinite(points[i].lat) || !Number.isFinite(points[i + 1].lat) || from === to) continue;
      const physicalOneway = oneway !== 0;
    const edgeBase = { wayId: way.id, name, ref, roadKey, layer, highway, tags, physicalOneway };
      if (oneway >= 0) segments.push(new RoadSegment({ ...edgeBase, id: `w${way.id}:${i}:f`, fromNode: from, toNode: to, coords: [points[i], points[i + 1]], oneway: 1 }));
      if (oneway <= 0) segments.push(new RoadSegment({ ...edgeBase, id: `w${way.id}:${i}:r`, fromNode: to, toNode: from, coords: [points[i + 1], points[i]], oneway: 1 }));
      if (oneway === -1 && i === 0) { /* reverse-only direction is added by the reverse branch above */ }
    }
  }
  return { provider: new RoadNetworkProvider(segments, metadata), skipped, ways: (data?.elements || []).length };
}
