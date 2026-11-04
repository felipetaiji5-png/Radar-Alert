import { haversineMeters } from './geo-math.js';

export const GPS_MODES = {
  STOPPED: 'STOPPED', URBAN: 'URBAN', HIGHWAY: 'HIGHWAY', RECOVERING: 'RECOVERING', UNKNOWN: 'UNKNOWN'
};

export class AdaptiveGpsEngine {
  constructor({ maxPlausibleSpeedKmh = 220, maxAcceptableAccuracyM = 65 } = {}) {
    this.maxSpeedKmh = maxPlausibleSpeedKmh;
    this.maxAccuracy = maxAcceptableAccuracyM;
    this.lastFix = null;
    this.lastFixTimestamp = 0;
    this.stoppedTicks = 0;
    this.currentMode = GPS_MODES.UNKNOWN;
    this.outliersCount = 0;
    this.onModeChange = null;
    this.onGpsLost = null;
  }

  processRawFix(coords, timestamp = Date.now()) {
    const lat = Number(coords.latitude), lng = Number(coords.longitude);
    const accuracy = Number(coords.accuracy);
    const speed = coords.speed == null || !Number.isFinite(Number(coords.speed)) ? null : Number(coords.speed) * 3.6;
    const heading = coords.heading == null || !Number.isFinite(Number(coords.heading)) ? null : Number(coords.heading);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { accepted: false, reason: 'INVALID_COORDINATE' };
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > this.maxAccuracy) return { accepted: false, reason: 'LOW_ACCURACY', accuracy, mode: this.currentMode };

    if (this.lastFix) {
      const dt = (timestamp - this.lastFixTimestamp) / 1000;
      if (dt <= 0) return { accepted: false, reason: 'NON_MONOTONIC_TIMESTAMP', mode: this.currentMode };
      const distance = haversineMeters(this.lastFix, { lat, lng });
      const plausibleSpeed = this.maxSpeedKmh / 3.6;
      // Margem de erro proporcional à precisão dos dois fixes reduz rejeições indevidas.
      const toleratedDistance = Math.max(75, accuracy + this.lastFix.accuracy + 25);
      if (dt < 30 && distance > toleratedDistance && (distance - toleratedDistance) / dt > plausibleSpeed) {
        this.outliersCount++;
        return { accepted: false, reason: 'IMPOSSIBLE_JUMP', distance, mode: this.currentMode };
      }
    }

    this.lastFix = { lat, lng, accuracy };
    this.lastFixTimestamp = timestamp;
    let nextMode = this.currentMode;
    if (speed == null) {
      if (nextMode === GPS_MODES.UNKNOWN) nextMode = GPS_MODES.RECOVERING;
    } else if (speed < 3) {
      this.stoppedTicks++;
      if (this.stoppedTicks >= 5) nextMode = GPS_MODES.STOPPED;
      else if (nextMode === GPS_MODES.UNKNOWN) nextMode = GPS_MODES.URBAN;
    } else {
      this.stoppedTicks = 0;
      nextMode = speed > 45 ? GPS_MODES.HIGHWAY : GPS_MODES.URBAN;
    }
    if (nextMode !== this.currentMode) {
      this.currentMode = nextMode;
      this.onModeChange?.(nextMode);
    }
    return { accepted: true, lat, lng, speed, accuracy, heading, mode: this.currentMode, timestamp };
  }

  notifySignalLoss() { this.currentMode = GPS_MODES.RECOVERING; this.onGpsLost?.(); }
  reset() { this.lastFix = null; this.lastFixTimestamp = 0; this.stoppedTicks = 0; this.currentMode = GPS_MODES.UNKNOWN; }
}
