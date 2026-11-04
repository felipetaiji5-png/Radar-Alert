import { bearingDegrees, haversineMeters } from './geo-math.js';

// A distância entre dois fixes só comprova movimento quando supera a
// incerteza combinada do GPS. Jitter dentro da precisão não gera rumo.
export function estimateMotion(previous, current, { maxGapSeconds = 10, maxSpeedKmh = 220 } = {}) {
  if (!previous || !current ||
      !Number.isFinite(previous.lat) || !Number.isFinite(previous.lng) ||
      !Number.isFinite(current.lat) || !Number.isFinite(current.lng) ||
      !Number.isFinite(previous.accuracy) || previous.accuracy <= 0 ||
      !Number.isFinite(current.accuracy) || current.accuracy <= 0) return null;
  const elapsed = (current.timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > maxGapSeconds) return null;
  const distance = haversineMeters(previous, current);
  const uncertainty = Math.hypot(previous.accuracy, current.accuracy);
  const threshold = Math.max(12, uncertainty * 1.8);
  if (distance < threshold) return null;
  const inferredSpeedKmh = distance / elapsed * 3.6;
  if (inferredSpeedKmh < 5 || inferredSpeedKmh > maxSpeedKmh) return null;
  return { heading: bearingDegrees(previous, current), distance, inferredSpeedKmh };
}

export function resolveMotionHeading(current, previous) {
  const moving = current.speed == null || (Number.isFinite(current.speed) && current.speed >= 5);
  if (!moving) return { heading: null, source: 'UNCERTAIN' };
  const estimate = estimateMotion(previous, current);
  if (Number.isFinite(current.heading) && current.heading >= 0 && current.heading < 360 &&
      (current.speed != null || estimate)) {
    return { heading: current.heading, source: 'GPS' };
  }
  if (estimate && (current.speed == null || current.speed >= 5)) {
    return { heading: estimate.heading, source: 'DERIVED' };
  }
  return { heading: null, source: 'UNCERTAIN' };
}
