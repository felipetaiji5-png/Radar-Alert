export const EARTH_RADIUS_METERS = 6371008.8;
const rad = value => value * Math.PI / 180;
const deg = value => value * 180 / Math.PI;

export function haversineMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function bearingDegrees(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Projeção local equiretangular adequada a segmentos curtos (vias urbanas/rodoviárias).
export function projectPointOnSegment(point, a, b) {
  const meanLat = rad((a.lat + b.lat + point.lat) / 3);
  const sx = 111320 * Math.cos(meanLat), sy = 110574;
  const ax = 0, ay = 0;
  const bx = (b.lng - a.lng) * sx, by = (b.lat - a.lat) * sy;
  const px = (point.lng - a.lng) * sx, py = (point.lat - a.lat) * sy;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const projPoint = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  return { t, projPoint, distancePerp: haversineMeters(point, projPoint) };
}

export function polylineArcLength(coords) {
  let length = 0;
  for (let i = 0; i < coords.length - 1; i++) length += haversineMeters(coords[i], coords[i + 1]);
  return length;
}
