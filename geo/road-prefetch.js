import { haversineMeters } from './geo-math.js';

const EARTH_RADIUS_METERS = 6371000;
const rad = degrees => degrees * Math.PI / 180;
const deg = radians => radians * 180 / Math.PI;

export function destinationPoint(position, heading, distanceMeters) {
  const lat = rad(position.lat), lng = rad(position.lng), bearing = rad(heading);
  const angle = distanceMeters / EARTH_RADIUS_METERS;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
  const nextLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat),
    Math.cos(angle) - Math.sin(lat) * Math.sin(nextLat));
  return { lat: deg(nextLat), lng: ((deg(nextLng) + 540) % 360) - 180 };
}

// Apenas propõe baixar outra região durante deslocamento, ANTES da perda de
// cobertura. Não cria alertas nem pressupõe que exista estrada no destino.
export function planRoadPrefetch(position, provider, heading) {
  const radius = Number(provider?.radiusMeters);
  if (!provider?.center || !Number.isFinite(radius) || radius <= 0 ||
      !Number.isFinite(position?.speed) || position.speed < 15 ||
      !Number.isFinite(position?.accuracy) || position.accuracy > 35 ||
      !Number.isFinite(heading) || heading < 0 || heading >= 360) return null;
  const centerDistance = haversineMeters(position, provider.center);
  if (centerDistance < radius * 0.55 || centerDistance >= radius * 0.72) return null;
  const leadMeters = Math.min(1200, radius * 0.45);
  const destination = destinationPoint(position, heading, leadMeters);
  if (haversineMeters(destination, provider.center) <= radius * 0.95) return null;
  if (haversineMeters(destination, position) > radius * 0.72) return null;
  return destination;
}
