export class SpatialIndex {
  constructor(cellSizeDeg = 0.045) {
    this.cellSize = cellSizeDeg;
    this.grid = new Map();
    this.count = 0;
  }
  _hash(lat, lng) { return `${Math.floor(lat / this.cellSize)}:${Math.floor(lng / this.cellSize)}`; }
  clear() { this.grid.clear(); this.count = 0; }
  _insertCell(item, x, y) {
    const key = `${x}:${y}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(item);
  }
  insert(item) {
    const x = Math.floor(item.lat / this.cellSize), y = Math.floor(item.lng / this.cellSize);
    this._insertCell(item, x, y);
    this.count++;
  }
  insertSegment(item) {
    const points = item.coords;
    if (!Array.isArray(points) || !points.length) { this.insert(item); return; }
    const minLat = Math.min(...points.map(p => p.lat)), maxLat = Math.max(...points.map(p => p.lat));
    const minLng = Math.min(...points.map(p => p.lng)), maxLng = Math.max(...points.map(p => p.lng));
    const minX = Math.floor(minLat / this.cellSize), maxX = Math.floor(maxLat / this.cellSize);
    const minY = Math.floor(minLng / this.cellSize), maxY = Math.floor(maxLng / this.cellSize);
    const visited = new Set();
    const add = (x, y) => {
      const key = `${x}:${y}`;
      if (visited.has(key)) return;
      visited.add(key); this._insertCell(item, x, y);
    };
    if ((maxX - minX + 1) * (maxY - minY + 1) <= 400) {
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) add(x, y);
    } else {
      // Evita explodir a memória com segmentos OSM malformados/enormes.
      // Amostra cada reta com passo menor que meia célula e cobre vizinhos.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lng - a.lng)) / (this.cellSize / 2)));
        for (let j = 0; j <= steps; j++) {
          const x = Math.floor((a.lat + (b.lat - a.lat) * j / steps) / this.cellSize);
          const y = Math.floor((a.lng + (b.lng - a.lng) * j / steps) / this.cellSize);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(x + dx, y + dy);
        }
      }
    }
    this.count++;
  }
  build(items) { this.clear(); for (const item of items) this.insert(item); }
  queryRadius(lat, lng, radiusMeters = 5000) {
    const latDelta = radiusMeters / 110574;
    const cos = Math.max(0.05, Math.cos(lat * Math.PI / 180));
    const lngDelta = radiusMeters / (111320 * cos);
    const minX = Math.floor((lat - latDelta) / this.cellSize);
    const maxX = Math.floor((lat + latDelta) / this.cellSize);
    const minY = Math.floor((lng - lngDelta) / this.cellSize);
    const maxY = Math.floor((lng + lngDelta) / this.cellSize);
    const found = [];
    const seen = new Set();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const cell = this.grid.get(`${x}:${y}`);
      if (!cell) continue;
      for (const item of cell) {
        if (seen.has(item)) continue;
        seen.add(item);
        found.push(item);
      }
    }
    return found;
  }
}
