import { haversineMeters, bearingDegrees, angleDiff } from './geo/geo-math.js';
import { RadarConsolidator } from './geo/radar-consolidator.js';

export const SP_DATA_URLS = [
  'https://raw.githubusercontent.com/Murkiriel/pardal/main/estados/SP/radares.csv',
  'https://cdn.jsdelivr.net/gh/Murkiriel/pardal@main/estados/SP/radares.csv'
];
export const CATALOG_URL = 'https://raw.githubusercontent.com/Murkiriel/pardal/main/catalogo.json';
export { haversineMeters, bearingDegrees, angleDiff };

export function parseCsv(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
  let delimiter = ',';
  let commas = 0, semicolons = 0, quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas++;
    else if (!quoted && char === ';') semicolons++;
  }
  if (semicolons > commas) delimiter = ';';

  const rows = [];
  let row = [], field = '', quotedField = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quotedField) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quotedField = false;
      else field += char;
    } else if (char === '"') quotedField = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some(value => value.trim() !== '')) rows.push(row);
  if (quotedField) throw new Error('CSV inválido: campo entre aspas não foi fechado.');
  if (rows.length < 2) throw new Error('O CSV não contém registros.');

  const headers = rows.shift().map(header => header.trim().replace(/^\uFEFF/, '').toLowerCase());
  if (!headers.includes('lat') && !headers.includes('latitude')) throw new Error('CSV sem coluna de latitude.');
  if (!headers.includes('lng') && !headers.includes('longitude') && !headers.includes('lon')) throw new Error('CSV sem coluna de longitude.');
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? '').trim()])));
}

export function normalizePardalRows(rows) { return RadarConsolidator.consolidate(rows); }

export function findNearbyRadars(position, radars, { radius = 5000, maxResults = 30 } = {}) {
  const headingKnown = Number.isFinite(position.heading);
  return radars.filter(radar => radar.active).map(radar => {
    const distance = haversineMeters(position, radar);
    const bearing = bearingDegrees(position, radar);
    const aheadDiff = headingKnown ? angleDiff(position.heading, bearing) : null;
    const directionKnown = Number.isFinite(radar.direction);
    const directionDiff = headingKnown && directionKnown ? angleDiff(position.heading, radar.direction) : null;
    const ahead = !headingKnown || aheadDiff <= 85;
    const directionCompatible = !directionKnown || !headingKnown || directionDiff <= 65;
    const alertEligible = headingKnown && directionKnown && aheadDiff <= 65 && directionDiff <= 45 &&
      Number.isFinite(position.accuracy) && position.accuracy <= 35;
    const confidence = alertEligible ? 'high' : headingKnown && directionKnown && ahead && directionCompatible ? 'medium' : 'low';
    return { ...radar, distance, distanceType: 'geodesic', bearing, aheadDiff, directionDiff,
      headingKnown, directionKnown, candidate: ahead && directionCompatible, alertEligible, confidence };
  }).filter(radar => radar.distance > 8 && radar.distance <= radius && radar.candidate)
    .sort((a, b) => a.distance - b.distance).slice(0, maxResults);
}

export function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`;
}
export function formatBearing(degrees) {
  if (degrees == null || !Number.isFinite(degrees)) return 'Não informado';
  const names = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return `${names[Math.round(degrees / 45) % 8]} (${Math.round(degrees)}°)`;
}
export function radarKind(kind) {
  return ({ FIXED: 'Radar fixo', SECTION: 'Radar de trecho', RED_LIGHT: 'Avanço de sinal' })[kind] || kind || 'Equipamento';
}
