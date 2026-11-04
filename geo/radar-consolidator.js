import { haversineMeters, angleDiff } from './geo-math.js';

export const SP_BOUNDS = { minLat: -25.35, maxLat: -19.75, minLng: -53.15, maxLng: -44.15 };

function valueOf(row, ...names) {
  const keys = new Map(Object.keys(row || {}).map(key => [key.trim().toLowerCase(), key]));
  for (const name of names) {
    const key = keys.get(name.toLowerCase());
    if (key != null) return row[key];
  }
  return null;
}

export function parseNullableNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Formatos compostos (ex.: "100/80") são ambíguos e não viram um único limite.
  if (/\d\s*\/\s*\d/.test(raw)) return null;
  const normalized = raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.+-]/g, '');
  if (!normalized || !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseActive(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { active: true, statusKnown: false };
  const inactive = new Set(['0', 'false', 'nao', 'não', 'inactive', 'inativo', 'desativado', 'disabled', 'off']);
  const active = new Set(['1', 'true', 'sim', 'active', 'ativo', 'yes', 'on']);
  if (inactive.has(raw)) return { active: false, statusKnown: true };
  if (active.has(raw)) return { active: true, statusKnown: true };
  return { active: true, statusKnown: false };
}

function normalizeKind(value) {
  const raw = String(value ?? 'FIXED').trim().toUpperCase();
  if (['SECTION', 'TRECHO', 'RADAR_TRECHO'].includes(raw)) return 'SECTION';
  if (['RED_LIGHT', 'SEMÁFORO', 'SEMAFORO', 'AVANCO_SINAL', 'AVANÇO DE SINAL'].includes(raw)) return 'RED_LIGHT';
  return raw || 'FIXED';
}

function directionValue(value) {
  const parsed = parseNullableNumber(value);
  if (parsed == null || parsed < 0 || parsed > 360) return null;
  return parsed === 360 ? 0 : parsed;
}

function deduplicate(radars) {
  const cellSize = 0.00008; // ~9 m em latitude
  const buckets = new Map();
  const output = [];
  const key = (x, y) => `${x}:${y}`;

  for (const radar of radars) {
    let duplicate = null;
    const gx = Math.floor(radar.lat / cellSize), gy = Math.floor(radar.lng / cellSize);
    for (let dx = -1; dx <= 1 && !duplicate; dx++) {
      for (let dy = -1; dy <= 1 && !duplicate; dy++) {
        for (const candidate of buckets.get(key(gx + dx, gy + dy)) || []) {
          // Sem direção conhecida, não fundir: pode ser equipamento de outra pista/sentido.
          if (radar.direction == null || candidate.direction == null) continue;
          if (radar.kind !== candidate.kind || radar.limit !== candidate.limit || radar.active !== candidate.active) continue;
          if (angleDiff(radar.direction, candidate.direction) > 15) continue;
          if (haversineMeters(radar, candidate) <= 8) { duplicate = candidate; break; }
        }
      }
    }

    if (duplicate) {
      duplicate.duplicatesMerged++;
      const sources = new Set(`${duplicate.source};${radar.source}`.split(';').map(s => s.trim()).filter(Boolean));
      duplicate.source = [...sources].join('; ');
      if (radar.statusKnown) duplicate.statusKnown = duplicate.statusKnown || radar.statusKnown;
      continue;
    }

    const item = { ...radar, duplicatesMerged: 0 };
    output.push(item);
    const bucketKey = key(gx, gy);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push(item);
  }
  return output;
}

export class RadarConsolidator {
  static isValidCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= SP_BOUNDS.minLat && lat <= SP_BOUNDS.maxLat &&
      lng >= SP_BOUNDS.minLng && lng <= SP_BOUNDS.maxLng;
  }

  static normalizeSpeedLimit(value) {
    const limit = parseNullableNumber(value);
    return limit != null && limit > 0 && limit <= 140 ? limit : null;
  }

  static consolidate(rows) {
    const normalized = [];
    rows.forEach((row, index) => {
      const lat = parseNullableNumber(valueOf(row, 'lat', 'latitude'));
      const lng = parseNullableNumber(valueOf(row, 'lng', 'lon', 'long', 'longitude'));
      if (!this.isValidCoordinate(lat, lng)) return;

      const activeInfo = parseActive(valueOf(row, 'active', 'status', 'situacao', 'situação'));
      const rawLimit = valueOf(row, 'limit_kmh', 'limit', 'speed_limit', 'velocidade');
      const limit = this.normalizeSpeedLimit(rawLimit);
      const direction = directionValue(valueOf(row, 'direction_deg', 'direction', 'heading', 'sentido_graus'));
      const endLat = parseNullableNumber(valueOf(row, 'end_lat', 'endLat'));
      const endLng = parseNullableNumber(valueOf(row, 'end_lng', 'endLng'));
      const kind = normalizeKind(valueOf(row, 'kind', 'type', 'tipo'));
      const source = String(valueOf(row, 'source', 'fonte') ?? 'Pardal').trim() || 'Pardal';
      const rawId = valueOf(row, 'id', 'code', 'codigo', 'código');

      normalized.push({
        id: String(rawId || `pardal-sp-${index}-${lat.toFixed(6)}-${lng.toFixed(6)}`),
        lat, lng, kind, limit, rawLimit: rawLimit == null ? null : String(rawLimit),
        direction, active: activeInfo.active, statusKnown: activeInfo.statusKnown,
        source, updatedAt: valueOf(row, 'updated_at', 'updatedAt', 'data_atualizacao') || null,
        roadName: valueOf(row, 'road_name', 'roadName', 'road', 'rodovia', 'via') || null,
        endLat: this.isValidCoordinate(endLat, endLng) ? endLat : null,
        endLng: this.isValidCoordinate(endLat, endLng) ? endLng : null,
        confidence: limit != null && direction != null && activeInfo.statusKnown ? 'MEDIUM' : 'LOW'
      });
    });
    return deduplicate(normalized);
  }
}
