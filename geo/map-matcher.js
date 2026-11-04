import { angleDiff } from './geo-math.js';
import { resolveMotionHeading } from './motion-heading.js';

export class MapMatcher {
  constructor(roadNetworkProvider) {
    this.provider = roadNetworkProvider;
    this.lastMatchedId = null;
    this.recentPositions = [];
  }

  resolveEffectiveHeading(rawHeading, speedKmh, lat, lng, timestamp = Date.now(), accuracy = null) {
    return resolveMotionHeading(
      { lat, lng, timestamp, accuracy, speed: speedKmh, heading: rawHeading },
      this.recentPositions.at(-1)
    );
  }

  match(position) {
    const { lat, lng, speed = null, accuracy = 999, heading: rawHeading = null, timestamp = Date.now() } = position;
    // Um fix descartado não pode contaminar a estimativa do próximo rumo.
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 50 ||
        !Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.lastMatchedId = null;
      return { matched: false, segment: null, confidence: 'LOW_ACCURACY', effectiveHeading: null,
        headingConfidence: 'UNCERTAIN', diagnostic: { reason: 'LOW_ACCURACY', candidateCount: 0 } };
    }
    const previous = this.recentPositions.at(-1);
    if (previous && (!Number.isFinite(timestamp) || timestamp <= previous.timestamp)) {
      return { matched: false, segment: null, confidence: 'LOW_ACCURACY', effectiveHeading: null,
        headingConfidence: 'UNCERTAIN', diagnostic: { reason: 'INVALID_TIMESTAMP', candidateCount: 0 } };
    }
    if (previous && timestamp - previous.timestamp > 30000) {
      this.recentPositions = [];
      this.lastMatchedId = null;
    }
    const resolved = this.resolveEffectiveHeading(rawHeading, speed, lat, lng, timestamp, accuracy);
    const heading = resolved.heading, headingConfidence = resolved.source;
    this.recentPositions.push({ lat, lng, accuracy, timestamp });
    if (this.recentPositions.length > 6) this.recentPositions.shift();

    const candidates = this.provider.getCandidates
      ? this.provider.getCandidates({ lat, lng }, Math.max(25, accuracy * 1.5))
      : this.provider.getAllSegments();
    const scored = [];
    for (const segment of candidates) {
      const projection = segment.project({ lat, lng }, heading);
      if (projection.distPerp > Math.max(25, accuracy * 1.5)) continue;
      const headingDiff = heading == null ? null : angleDiff(heading, projection.roadBearing);
      if (segment.oneway === 1 && headingDiff != null && headingDiff > 90) continue;
      if (segment.oneway === -1 && headingDiff != null && headingDiff > 90) continue;
      const sigma = Math.max(accuracy, 8);
      const distanceScore = Math.exp(-(projection.distPerp ** 2) / (2 * sigma ** 2));
      const directionScore = headingDiff == null ? 0.5 : (1 + Math.cos(headingDiff * Math.PI / 180)) / 2;
      const continuityScore = this.lastMatchedId === segment.id ? 1.15 : 1;
      scored.push({ segment, projection, score: distanceScore * directionScore * continuityScore, headingDiff });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return { matched: false, segment: null, confidence: 'NO_MATCH', effectiveHeading: heading, headingConfidence, diagnostic: { reason: 'NO_CANDIDATE', candidateCount: 0 } };
    const margin = scored.length > 1 ? best.score - scored[1].score : best.score;
    // Alternativas são apenas observações da geometria próxima. Não influenciam
    // a decisão de Map Matching nem liberam alertas por rota.
    const seenRoads = new Set();
    const alternatives = [];
    for (const item of scored) {
      const key = `${item.segment.roadKey}|${item.segment.layer}`;
      if (seenRoads.has(key)) continue;
      seenRoads.add(key);
      alternatives.push({
        name: item.segment.name || item.segment.ref || 'Via sem nome',
        offsetMeters: item.projection.distPerp,
        headingDifferenceDegrees: item.headingDiff,
        isPrimary: item.segment.id === best.segment.id,
        roadKey: item.segment.roadKey
      });
      if (alternatives.length === 4) break;
    }
    const second = scored[1]?.segment;
    const sameTopologicalRoad = second && best.segment.roadKey === second.roadKey &&
      best.segment.layer === second.layer &&
      angleDiff(best.projection.roadBearing, scored[1].projection.roadBearing) <= 30 &&
      (best.segment.wayId === second.wayId ||
        best.segment.toNode === second.fromNode || second.toNode === best.segment.fromNode);
    // Duas arestas consecutivas da MESMA via podem empatar na junção; isso
    // não é a mesma ambiguidade de duas pistas/ruas independentes próximas.
    const ambiguous = scored.length > 1 && margin < 0.08 && !sameTopologicalRoad;
    const confidence = heading == null || ambiguous ? 'UNCERTAIN' : best.score >= 0.35 ? 'HIGH' : 'MEDIUM';
    if (confidence !== 'UNCERTAIN') this.lastMatchedId = best.segment.id;
    return {
      matched: confidence !== 'UNCERTAIN', segment: best.segment, proj: best.projection,
      vehicleDistAlong: best.projection.distAlong, headingDiff: best.headingDiff,
      effectiveHeading: heading, headingConfidence, confidence,
      diagnostic: {
        reason: ambiguous ? 'AMBIGUOUS_ROADS' : heading == null ? 'NO_HEADING' :
          confidence === 'MEDIUM' ? 'WEAK_MATCH' : 'CONFIRMED',
        candidateCount: scored.length,
        alternatives,
        lateralDistanceMeters: best.projection.distPerp,
        headingDifferenceDegrees: best.headingDiff,
        scoreGap: scored.length > 1 ? margin : null,
        competingRoad: scored.length > 1 && !sameTopologicalRoad
          ? { name: second.name || second.ref || 'Via sem nome', offsetMeters: scored[1].projection.distPerp }
          : null
      }
    };
  }

  reset() { this.lastMatchedId = null; this.recentPositions = []; }
}
