import { angleDiff } from './geo-math.js';

export class AlertManager {
  constructor({ tierFarMeters = 1000, tierMidMeters = 500, tierNearMeters = 200, minIntervalMs = 4500 } = {}) {
    this.tierFar = tierFarMeters;
    this.tierMid = tierMidMeters;
    this.tierNear = tierNearMeters;
    this.minIntervalMs = minIntervalMs;
    this.radarStates = new Map();
    this.lastAnnouncementTime = 0;
  }
  setTiers({ far, mid, near } = {}) {
    if (Number.isFinite(far)) this.tierFar = far;
    if (Number.isFinite(mid)) this.tierMid = mid;
    if (Number.isFinite(near)) this.tierNear = near;
  }
  reset() { this.radarStates.clear(); this.lastAnnouncementTime = 0; }

  processEvaluation({ matchedSegment, candidateRadars = [], effectiveHeading, confidence }) {
    if (!matchedSegment || confidence !== 'HIGH' || !Number.isFinite(effectiveHeading)) {
      return { nextRadar: null, alerts: [], reason: 'NO_HIGH_CONFIDENCE_ROAD_MATCH' };
    }
    const roadRadars = [];
    for (const radar of candidateRadars) {
      if (!radar.active || radar.roadKey !== matchedSegment.roadKey) continue;
      const routeDistance = radar.routeDistanceMeters;
      if (!Number.isFinite(routeDistance) || routeDistance <= 0) continue;
      const radarDirection = radar.effectiveDirection ?? radar.direction;
      if (!Number.isFinite(radarDirection) || angleDiff(radarDirection, effectiveHeading) > 45) continue;
      roadRadars.push({ radar, distanceAlongRoad: routeDistance });
    }
    roadRadars.sort((a, b) => a.distanceAlongRoad - b.distanceAlongRoad);
    const nextEntry = roadRadars[0] || null;
    if (!nextEntry) return { nextRadar: null, alerts: [] };

    const { radar, distanceAlongRoad } = nextEntry;
    const nextRadar = { ...radar, distanceAlongRoad, routeDistanceMeters: distanceAlongRoad };
    const state = this.radarStates.get(radar.id) || { tier: 0, passed: false };
    const now = Date.now();
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
