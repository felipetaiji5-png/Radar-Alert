import { haversineMeters, radarKind, formatDistance, formatBearing } from '../core.js';

const MAX_GPS_TRAIL_POINTS = 50;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Controla exclusivamente a apresentação Leaflet e a trilha volátil da sessão. */
export class MapView {
  constructor({ getElement, onLog = () => {}, onNotice = () => {} }) {
    this.$ = getElement;
    this.onLog = onLog;
    this.onNotice = onNotice;
    this.map = null;
    this.layers = null;
    this.following = true;
    this.trailVisible = false;
    this.accuracyVisible = true;
    this.positionStale = false;
    this.trail = [];
    this.lastRadarPaintPosition = null;
    this.lastRadarPaintAt = 0;
    this.position = null;
  }
  get L() { return window.L; }
  init() {
    const L = this.L;
    if (!L) {
      this.$('map').textContent = 'Mapa indisponível. Verifique a conexão para carregar o Leaflet.';
      this.onLog('Leaflet não foi carregado.');
      return;
    }
    this.map = L.map('map', { zoomControl: true }).setView([-23.55, -46.63], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);
    this.layers = {
      radar: L.layerGroup().addTo(this.map), user: L.layerGroup().addTo(this.map),
      road: L.layerGroup().addTo(this.map), trail: L.layerGroup().addTo(this.map)
    };
    this.map.on('dragstart', () => { this.following = false; this.updateState(); });
  }
  updateState() {
    const el = this.$('mapState');
    if (el) el.textContent = !this.position ? 'Aguardando localização GPS' : this.positionStale ? 'Última posição não confirmada' :
      this.following ? 'Acompanhando GPS · posição aproximada' : 'Mapa livre · toque em centralizar';
    this.$('locateMapBtn')?.classList.toggle('following', Boolean(this.position && !this.positionStale && this.following));
  }
  record(fix) {
    const last = this.trail.at(-1);
    if (last && haversineMeters(last, fix) < 2 && fix.timestamp - last.timestamp < 10000) return;
    this.trail.push({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: fix.timestamp });
    if (this.trail.length > MAX_GPS_TRAIL_POINTS) this.trail.shift();
  }
  resetTrail() { this.trail = []; this.renderTrail(); }
  markAccuracyStale(message = 'GPS sem atualização · última posição não confirmada') {
    const label = this.$('mapAccuracyLabel');
    if (label) label.textContent = message;
    this.positionStale = true;
    this.updateState();
    // Não apresentar a área de precisão antiga como uma leitura atual.
    this.layers?.user?.clearLayers();
  }
  toggleAccuracy() {
    this.accuracyVisible = !this.accuracyVisible;
    const button = this.$('toggleAccuracyBtn');
    if (button) {
      button.setAttribute('aria-pressed', String(this.accuracyVisible));
      button.textContent = this.accuracyVisible ? 'Ocultar área de precisão' : 'Mostrar área de precisão';
    }
    if (this.lastUpdate && !this.positionStale) this.update(this.lastUpdate);
    return this.accuracyVisible;
  }
  toggleTrail() {
    this.trailVisible = !this.trailVisible;
    this.$('toggleTrailBtn').setAttribute('aria-pressed', String(this.trailVisible));
    this.$('toggleTrailBtn').textContent = this.trailVisible ? 'Ocultar trilha GPS' : 'Mostrar trilha GPS';
    this.renderTrail();
  }
  renderTrail() {
    if (!this.layers || !this.L) return;
    this.layers.trail.clearLayers();
    if (!this.trailVisible || this.trail.length < 2) return;
    this.L.polyline(this.trail.map(p => [p.lat, p.lng]), {
      color: '#44dfc3', weight: 3, opacity: 0.8, dashArray: '5 5', interactive: false
    }).addTo(this.layers.trail);
  }
  invalidateSize() { if (this.map) setTimeout(() => this.map.invalidateSize(), 80); }
  center() {
    if (!this.position || !this.map || this.positionStale) {
      this.onNotice('Aguarde um novo ponto GPS válido para centralizar.'); return;
    }
    this.following = true;
    this.map.setView([this.position.lat, this.position.lng], Math.max(this.map.getZoom(), 16), { animate: false });
    this.updateState();
  }
  expand() {
    const expanded = this.$('mapFrame').classList.toggle('expanded');
    this.$('expandMapBtn').setAttribute('aria-expanded', String(expanded));
    this.$('expandMapBtn').setAttribute('aria-label', expanded ? 'Reduzir mapa' : 'Ampliar mapa');
    this.$('expandMapBtn').title = expanded ? 'Reduzir mapa' : 'Ampliar mapa';
    if (this.map) setTimeout(() => this.map.invalidateSize(), 200);
  }
  getCenter() {
    if (!this.map) return null;
    const center = this.map.getCenter();
    return Number.isFinite(center?.lat) && Number.isFinite(center?.lng)
      ? { lat: center.lat, lng: center.lng } : null;
  }
  firstFix(fix) { this.map?.setView([fix.lat, fix.lng], 16); }
  invalidateMarkers() { this.lastRadarPaintPosition = null; }
  update({ position, mapMatch, roadProvider, nearby, spatialIndex }) {
    this.position = position;
    this.positionStale = false;
    this.lastUpdate = { position, mapMatch, roadProvider, nearby, spatialIndex };
    const accuracyNode = this.$('mapAccuracyLabel');
    if (accuracyNode) accuracyNode.textContent = !position ? 'Precisão do GPS: aguardando' :
      Number.isFinite(position.accuracy) && position.accuracy > 0
        ? `Precisão estimada: ±${Math.round(position.accuracy)} m${position.accuracy > 200 ? ' · sinal insuficiente' : this.accuracyVisible ? ' · círculo visível' : ' · círculo oculto'}`
        : 'Precisão do GPS: indisponível';
    if (!this.map || !position || !this.layers) { this.updateState(); return; }
    const L = this.L;
    if (!L) return;
    this.renderTrail();
    const { radar, user, road } = this.layers;
    user.clearLayers();
    road.clearLayers();
    if (roadProvider && mapMatch?.diagnostic?.alternatives?.length > 1) {
      const others = new Set(mapMatch.diagnostic.alternatives.slice(1).map(item => item.roadKey));
      const drawn = new Set();
      for (const segment of roadProvider.getCandidates(position, Math.max(25, (position.accuracy || 15) * 1.5))) {
        if (!others.has(segment.roadKey) || drawn.has(segment.roadKey)) continue;
        drawn.add(segment.roadKey);
        L.polyline(segment.coords.map(point => [point.lat, point.lng]), {
          color: '#c2a8ff', weight: 3, opacity: 0.78, dashArray: '3 8', interactive: false
        }).addTo(road);
        if (drawn.size >= 3) break;
      }
    }
    this.updateState();
    if (this.following && haversineMeters({ lat: this.map.getCenter().lat, lng: this.map.getCenter().lng }, position) > 45) {
      this.map.panTo([position.lat, position.lng], { animate: false });
    }
    if (mapMatch?.segment?.coords) {
      const confirmed = mapMatch.matched && mapMatch.confidence === 'HIGH';
      L.polyline(mapMatch.segment.coords.map(point => [point.lat, point.lng]), {
        color: confirmed ? '#66baff' : '#ffbc69', weight: confirmed ? 6 : 4,
        opacity: confirmed ? 0.92 : 0.82, dashArray: confirmed ? undefined : '7 9', interactive: false
      }).addTo(road);
    }
    if (this.accuracyVisible && Number.isFinite(position.accuracy) && position.accuracy > 0 && position.accuracy <= 200) {
      L.circle([position.lat, position.lng], { radius: position.accuracy, color: '#7396c8',
        weight: 1.5, fillColor: '#729ac5', fillOpacity: 0.14, opacity: 0.78, interactive: false }).addTo(user);
    }
    const userIcon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
    L.marker([position.lat, position.lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(user).bindPopup('Localização GPS deste dispositivo');
    const redrawRadars = !this.lastRadarPaintPosition || Date.now() - this.lastRadarPaintAt > 12000 ||
      haversineMeters(this.lastRadarPaintPosition, position) > 65;
    if (!redrawRadars) return;
    this.lastRadarPaintPosition = { lat: position.lat, lng: position.lng };
    this.lastRadarPaintAt = Date.now();
    radar.clearLayers();
    const visible = spatialIndex.queryRadius(position.lat, position.lng, 12000)
      .filter(item => item.active)
      .map(item => ({ radar: item, distance: haversineMeters(position, item) }))
      .filter(item => item.distance <= 12000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 120);
    for (const entry of visible) {
      const item = entry.radar;
      const selected = nearby[0]?.id === item.id;
      const icon = L.divIcon({
        className: '', html: `<div class="radar-marker ${selected ? 'selected' : 'other'}"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9]
      });
      const limit = item.limit == null ? 'Não informado' : `${item.limit} km/h`;
      const html = `<b>${escapeHtml(radarKind(item.kind))}</b><br>Limite: ${escapeHtml(limit)}<br>Origem: ${escapeHtml(item.source)}<br>Distância aproximada em linha reta: ${escapeHtml(formatDistance(entry.distance))}<br>Sentido: ${escapeHtml(formatBearing(item.direction))}`;
      L.marker([item.lat, item.lng], { icon }).addTo(radar).bindPopup(html);
    }
    this.$('visibleCount').textContent = `${visible.length} equipamentos mostrados · distância em linha reta`;
  }
}
