import { angleDiff } from './geo-math.js';

export class AlertManager {
  constructor({ tierFarMeters = 1000, tierMidMeters = 500, tierNearMeters = 200, minIntervalMs = 4500,
    rearmAfterMs = 120000, movingKmh = 10, maxTrackedRadars = 256, now = () => Date.now() } = {}) {
    this.tierFar = tierFarMeters;
    this.tierMid = tierMidMeters;
    this.tierNear = tierNearMeters;
    this.minIntervalMs = minIntervalMs;
    this.rearmAfterMs = rearmAfterMs;
    this.movingKmh = movingKmh;
    this.maxTrackedRadars = maxTrackedRadars;
    this.now = now;
    this.radarStates = new Map();
    this.lastAnnouncementTime = 0;
  }
  setTiers({ far, mid, near } = {}) {
    if (Number.isFinite(far)) this.tierFar = far;
    if (Number.isFinite(mid)) this.tierMid = mid;
    if (Number.isFinite(near)) this.tierNear = near;
  }
  reset() { this.radarStates.clear(); this.lastAnnouncementTime = 0; }

  tierDistance(tier) { return tier >= 3 ? this.tierNear : tier === 2 ? this.tierMid : this.tierFar; }

  // Um radar já anunciado volta a alertar apenas numa nova passagem: uma avaliação
  // confirmada mostrou que ele saiu do trajeto, ficou ausente por rearmAfterMs e
  // reaparece à frente com o veículo em movimento ou além da faixa já anunciada
  // (velocidade desconhecida). Perdas de GPS, cobertura ou confirmação não chamam o
  // motor com HIGH e, portanto, não contam como saída. Parado, a oscilação do GPS
  // perto do radar não rearma.
  trackPassages(roadRadars, now, speedKmh) {
    const moving = Number.isFinite(speedKmh) && speedKmh >= this.movingKmh;
    const ahead = new Map(roadRadars.map(entry => [entry.radar.id, entry.distanceAlongRoad]));
    for (const [id, state] of this.radarStates) {
      const distance = ahead.get(id);
      if (distance === undefined) {
        state.absentSince ??= now;
        continue;
      }
      if (state.absentSince !== null && now - state.absentSince >= this.rearmAfterMs &&
          (moving || (!Number.isFinite(speedKmh) && distance > this.tierDistance(state.tier)))) {
        this.radarStates.delete(id);
        continue;
      }
      state.absentSince = null;
    }
    // Limita a memória numa sessão longa: descarta primeiro os radares anunciados há mais tempo que já saíram do trajeto.
    for (const [id, state] of this.radarStates) {
      if (this.radarStates.size <= this.maxTrackedRadars) break;
      if (state.absentSince !== null) this.radarStates.delete(id);
    }
  }

  processEvaluation({ matchedSegment, candidateRadars = [], effectiveHeading, confidence, speedKmh = null }) {
    if (!matchedSegment || confidence !== 'HIGH' || !Number.isFinite(effectiveHeading)) {
      return { nextRadar: null, alerts: [], reason: 'NO_HIGH_CONFIDENCE_ROAD_MATCH' };
    }
    const now = this.now();
    const roadRadars = [];
    for (const radar of candidateRadars) {
      if (!radar.active || radar.roadKey !== matchedSegment.roadKey) continue;
      const routeDistance = radar.routeDistanceMeters;
      if (!Number.isFinite(routeDistance) || routeDistance <= 0) continue;
      const radarDirection = radar.effectiveDirection ?? radar.direction;
      if (!Number.isFinite(radarDirection) || angleDiff(radarDirection, effectiveHeading) > 45) continue;
      roadRadars.push({ radar, distanceAlongRoad: routeDistance });
    }
    this.trackPassages(roadRadars, now, speedKmh);
    roadRadars.sort((a, b) => a.distanceAlongRoad - b.distanceAlongRoad);
    const nextEntry = roadRadars[0] || null;
    if (!nextEntry) return { nextRadar: null, alerts: [] };

    const { radar, distanceAlongRoad } = nextEntry;
    const nextRadar = { ...radar, distanceAlongRoad, routeDistanceMeters: distanceAlongRoad };
    const state = this.radarStates.get(radar.id) || { tier: 0, absentSince: null };
    let tier = 0, type = null;
    if (distanceAlongRoad <= this.tierNear && state.tier < 3) { tier = 3; type = 'ALERT_NEAR'; }
    else if (distanceAlongRoad <= this.tierMid && state.tier < 2) { tier = 2; type = 'ALERT_MID'; }
    else if (distanceAlongRoad <= this.tierFar && state.tier < 1) { tier = 1; type = 'ALERT_FAR'; }
    const alerts = [];
    if (tier && now - this.lastAnnouncementTime >= this.minIntervalMs) {
      state.tier = tier;
      this.radarStates.set(radar.id, state);
      this.lastAnnouncementTime = now;
      const limit = radar.limit == null ? 'Limite não informado.' : `Limite cadastrado de ${radar.limit} km/h.`;
      const subject = radar.kind === 'SECTION' ? 'Início do trecho de fiscalização' : 'Radar';
      const section = radar.kind === 'SECTION' && Number.isFinite(radar.sectionLengthMeters)
        ? ` Extensão mapeada aproximada: ${Math.round(radar.sectionLengthMeters)} metros.` : '';
      alerts.push({ type, radar, distance: Math.round(distanceAlongRoad), text: `${subject} à frente a ${Math.round(distanceAlongRoad)} metros.${section} ${limit}` });
    }
    return { nextRadar, alerts };
  }
}
