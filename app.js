import { SP_DATA_URLS, CATALOG_URL, parseCsv, normalizePardalRows, findNearbyRadars, formatDistance, formatBearing, radarKind, haversineMeters } from './core.js';
import { SpatialIndex } from './geo/spatial-index.js';
import { AdaptiveGpsEngine, GPS_MODES } from './geo/adaptive-gps.js';
import { OfflineStore } from './geo/offline-store.js';
import { MapMatcher } from './geo/map-matcher.js';
import { summarizeMatch } from './geo/match-diagnostics.js';
import { AlertManager } from './geo/alert-manager.js';
import { OverpassRoadLoader } from './geo/osm-loader.js';
import { planRoadPrefetch } from './geo/road-prefetch.js';
import { resolveMotionHeading } from './geo/motion-heading.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
window.L = L;
import { renderNearbyList } from './ui/nearby-list.js';
import { renderMatchPanel } from './ui/match-panel.js';
import { createNavigation } from './ui/navigation.js';
import { deriveSystemHealth, renderSystemHealth } from './ui/system-health.js';
import { setupSimulator } from './ui/simulator-panel.js';
import { MapView } from './ui/map-view.js';
import { DriveModeController } from './ui/drive-mode.js';
import { RoadStabilityTracker } from './geo/road-stability.js';
import { buildNativeRadarCatalog, createNativeWriteQueue } from './geo/native-sync.js';

const NativeRadarTracking = registerPlugin('RadarTracking');
const IS_ANDROID_NATIVE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const $ = id => document.getElementById(id);
const DATASET_KEY = 'pardal-sp-csv-v1';
const SETTINGS_KEY = 'radar-alert:settings';
const settings = { voice: true, notifications: false, contrast: false, driveMode: true, volume: 100, far: 1000, mid: 500, near: 200 };
let radars = [], activeRadars = [], nearby = [], position = null;
let spatialIndex = new SpatialIndex();
const mapView = new MapView({ getElement: $, onLog: log, onNotice: setNotice });
const driveMode = new DriveModeController();
const roadStability = new RoadStabilityTracker();
let roadProvider = null, mapMatcher = null, mapMatch = null, roadLoadPromise = null;
let roadNetworkStatus = 'Não carregada';
let roadLoadRetryAfter = 0;
let lastRoadLoadSucceededAt = 0;
const roadLoader = new OverpassRoadLoader({
  offlineStore: OfflineStore,
  onAttempt: attempt => {
    const host = new URL(attempt.endpoint).host;
    const seconds = (attempt.durationMs / 1000).toFixed(1).replace('.', ',');
    if (attempt.ok) {
      log(`OSM respondeu por ${host}: ${attempt.elementCount} elementos em ${seconds}s; raio ${attempt.radiusMeters} m.`);
    } else {
      log(`Consulta OSM falhou em ${host} após ${seconds}s (raio ${attempt.radiusMeters} m): ${attempt.error}.`);
    }
  }
});
const alertManager = new AlertManager();
let watchId = null, wakeLock = null, installPrompt = null;
let trackingStarting = false, trackingActive = false, nativeServiceActive = false;
let nativeBridgeReady = Promise.resolve();
let nativeHeartbeatTimer = null;
let firstFixLogged = false, firstGpsCallbackLogged = false;
let datasetSavedAt = null, catalogBuiltAt = null;
let lastAnnouncementAt = 0;
const alertTiers = new Map();
const diagnostics = [];
const gpsEngine = new AdaptiveGpsEngine();
let lastMatchDiagnosticSignature = null;
let lastMatchDiagnosticAt = 0;
let lastFixIssue = null;
let cachedRoadRegions = 0;
const nativeWrites = createNativeWriteQueue();

function log(message) {
  // Reduz mensagens nativas repetidas sem esconder mudanças de estado.
  if (message === log.lastMessage && Date.now() - (log.lastAt || 0) < 3500) return;
  log.lastMessage = message;
  log.lastAt = Date.now();
  diagnostics.unshift(`${new Date().toLocaleTimeString('pt-BR')} · ${message}`);
  diagnostics.splice(40);
  const box = $('diagLogBox');
  if (box) box.textContent = diagnostics.join('\n');
}
function setNotice(message) {
  const node = $('mainNotice')?.lastElementChild;
  if (node) node.textContent = message;
}
function setGpsStatus(on) {
  const node = $('gpsStatus');
  node.classList.toggle('on', on);
  node.innerHTML = `<i></i> ${on ? 'GPS ativo' : 'GPS desligado'}`;
}
function resetDriveMode() {
  driveMode.reset();
  document.body.classList.remove('driving-mode');
  $('driveModeLabel').textContent = 'Painel de direção';
}
function updateDriveMode(speedKmh) {
  if (!settings.driveMode) { resetDriveMode(); return; }
  const driving = driveMode.update(speedKmh);
  document.body.classList.toggle('driving-mode', driving);
  $('driveModeLabel').textContent = driving ? 'Modo direção ativo' : 'Painel de direção';
}
function showError(message) { $('gpsError').textContent = message; $('gpsError').classList.remove('hidden'); }
function clearError() { $('gpsError').textContent = ''; $('gpsError').classList.add('hidden'); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'data não informada' : date.toLocaleDateString('pt-BR');
}

function updateDatasetStats() {
  const active = radars.filter(radar => radar.active);
  const inactive = radars.length - active.length;
  const withLimit = radars.filter(radar => radar.limit != null).length;
  activeRadars = active;
  spatialIndex.build(activeRadars);
  mapView.invalidateMarkers();
  if (roadProvider) roadProvider.attachRadars(activeRadars);
  if (nativeServiceActive) void syncNativeConfiguration().catch(error => log(`Falha ao atualizar a base do serviço Android: ${error.message}`));
  $('activeCount').textContent = active.length.toLocaleString('pt-BR');
  $('inactiveCount').textContent = inactive.toLocaleString('pt-BR');
  $('withLimitCount').textContent = withLimit.toLocaleString('pt-BR');
  $('radarCount').textContent = active.length.toLocaleString('pt-BR');
}

async function fetchText(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

async function loadCatalog() {
  try {
    const catalog = JSON.parse(await fetchText(CATALOG_URL, 9000));
    const sp = catalog?.ufs?.SP;
    if (sp?.built_at) {
      catalogBuiltAt = sp.built_at;
      $('datasetMeta').textContent = `Pardal · base gerada em ${formatDate(catalogBuiltAt)}`;
      return sp;
    }
  } catch (error) { log(`Catálogo não disponível: ${error.message}`); }
  $('datasetMeta').textContent = 'Pardal · data do catálogo não confirmada';
  return null;
}

function applyDataset(csv, savedAt, sourceLabel) {
  const rows = parseCsv(csv);
  const normalized = normalizePardalRows(rows);
  if (normalized.length < 100) throw new Error(`A base retornou apenas ${normalized.length} coordenadas válidas; importação recusada.`);
  radars = normalized;
  datasetSavedAt = savedAt || null;
  updateDatasetStats();
  $('datasetStatus').textContent = `${activeRadars.length.toLocaleString('pt-BR')} radares ativos`;
  $('networkDot').classList.toggle('online', navigator.onLine);
  $('networkDot').classList.toggle('offline', !navigator.onLine);
  $('staleDataBanner').classList.toggle('hidden', !OfflineStore.isDatasetStale(datasetSavedAt));
  $('datasetMeta').textContent = catalogBuiltAt
    ? `Pardal · base gerada em ${formatDate(catalogBuiltAt)} · ${sourceLabel}`
    : `Pardal · ${sourceLabel} · cache ${datasetSavedAt ? formatDate(datasetSavedAt) : 'sem data'}`;
  setNotice(`Base carregada: ${activeRadars.length.toLocaleString('pt-BR')} ativos e ${radars.length - activeRadars.length} inativos/sem operação confirmada.`);
  $('diagDatabase').textContent = `${radars.length.toLocaleString('pt-BR')} registros (${activeRadars.length} ativos)`;
  $('diagDatasetAge').textContent = datasetSavedAt ? formatDate(datasetSavedAt) : 'Não informada';
  log(`Base carregada via ${sourceLabel}: ${radars.length} registros; ${activeRadars.length} ativos.`);
  if (position && trackingActive) updateNearby();
}

async function loadDataset(force = false) {
  $('datasetStatus').textContent = 'Carregando base…';
  setNotice('Consultando a base de dados Pardal para São Paulo.');
  if (!force) {
    const cached = await OfflineStore.getDataset(DATASET_KEY);
    if (cached?.data?.csv) {
      try { applyDataset(cached.data.csv, cached.savedAt, 'cache local'); }
      catch (error) { log(`Cache local inválido: ${error.message}`); }
    }
  }

  let lastError = null;
  for (const url of SP_DATA_URLS) {
    try {
      const csv = await fetchText(url);
      const preview = normalizePardalRows(parseCsv(csv));
      if (preview.length < 100) throw new Error('Quantidade insuficiente de coordenadas válidas.');
      await OfflineStore.saveDataset(DATASET_KEY, { csv });
      applyDataset(csv, new Date().toISOString(), 'download');
      return;
    } catch (error) { lastError = error; log(`Falha ao obter base: ${error.message}`); }
  }

  if (radars.length) {
    setNotice('Não foi possível atualizar. Usando a última cópia salva; confirme a idade dos dados antes de dirigir.');
    return;
  }
  $('datasetStatus').textContent = 'Base indisponível';
  $('networkDot').classList.add('offline');
  setNotice(`Não foi possível carregar os radares. ${lastError?.message || 'Verifique sua conexão e tente novamente.'}`);
}

function deriveHeading(current, previous) {
  return resolveMotionHeading({ ...current, heading: current.heading }, previous).heading;
}

async function ensureRoadNetwork(force = false, targetCenter = null) {
  if (!position || roadLoadPromise) return roadLoadPromise;
  const requestedCenter = targetCenter || position;
  if (!force && roadProvider?.covers(requestedCenter)) return roadProvider;
  if (!force && Date.now() < roadLoadRetryAfter) return null;
  const currentNetworkStillCovers = Boolean(roadProvider?.covers(position));
  roadNetworkStatus = currentNetworkStillCovers ? 'Atualizando região OSM sem interromper a malha atual…' : 'Carregando geometria OSM…';
  $('diagMapMatch').textContent = roadNetworkStatus;
  if (!currentNetworkStillCovers) setNotice('Carregando ruas e rodovias próximas do OpenStreetMap. Alertas por via aguardam validação.');
  roadLoadPromise = roadLoader.loadAround(requestedCenter, { force })
    .then(result => {
      roadLoadRetryAfter = 0;
      if (result.provider.covers(requestedCenter, 0.95)) lastRoadLoadSucceededAt = Date.now();
      // O veículo pode ter saído da região durante um download lento.
      // Não substitua uma malha ainda válida por outra que já não o cobre.
      if (!result.provider.covers(position) && roadProvider?.covers(position)) {
        // Prefetch must not replace the live graph, but it must be available
        // to the native foreground service after the screen is locked.
        result.provider.attachRadars(activeRadars);
        if (IS_ANDROID_NATIVE) {
          void syncNativeRoadNetwork(result.provider, { activate: false })
            .catch(error => log(`Região pré-carregada não foi salva no Android: ${error.message}`));
        }
        log('Região OSM adiante preparada no cache; malha atual preservada para o GPS.');
        return roadProvider;
      }
      roadProvider = result.provider;
      mapMatcher = new MapMatcher(roadProvider);
      const attached = roadProvider.attachRadars(activeRadars);
      const attachStats = roadProvider.lastAttachmentStats || { nearby: attached, ambiguous: 0 };
      roadNetworkStatus = `${roadProvider.getAllSegments().length.toLocaleString('pt-BR')} segmentos OSM · ${attached.toLocaleString('pt-BR')} radares elegíveis`;
      $('diagMapMatch').textContent = roadNetworkStatus;
      log(`Malha OSM carregada: ${roadProvider.getAllSegments().length} segmentos; ${attached} radares elegíveis, ${attachStats.ambiguous} ambiguidades; origem ${result.source}.`);
      log(`Associação: ${attachStats.nearby} radares a até 45 m das vias (${attachStats.knownDirectionNear} com sentido cadastrado; ${attachStats.missingDirectionNear} sem sentido); ${attachStats.inferredOneway} sentidos inferidos em mão única.`);
      if (attachStats.ambiguous) {
        log(`Associações recusadas: ${Object.entries(attachStats.reasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}.`);
      }
      if (!attached && attachStats.nearby) {
        log('Malha viária disponível, mas nenhum radar próximo tem via e sentido confirmados. Alertas de rota suspensos; pontos permanecem visíveis no mapa.');
      } else if (!attached) {
        log('Nenhum radar localizado a até 45 m dos segmentos OSM carregados. Isso não significa falha no GPS.');
      }
      if (result.stale) {
        log('Geometria OSM em cache está desatualizada; atualize quando houver conexão.');
        setNotice('Ruas OSM carregadas de cache antigo. O monitoramento usa estes dados locais, mas recomenda-se atualizar a malha no mapa quando possível.');
      }
      if (IS_ANDROID_NATIVE) {
        void syncNativeRoadNetwork().catch(error => log(`Malha OSM não sincronizada com o serviço Android: ${error.message}`));
      }
      if (trackingActive) updateNearby();
      return roadProvider;
    })
    .catch(error => {
      roadLoadRetryAfter = Date.now() + 45000;
      if (roadProvider?.covers(position)) {
        roadNetworkStatus = 'Região OSM anterior ativa; atualização pendente';
        log(`Pré-carregamento falhou, mas a malha atual continua ativa: ${error.message}`);
        return roadProvider;
      }
      roadNetworkStatus = `Indisponível: ${error.message}`;
      $('diagMapMatch').textContent = roadNetworkStatus;
      setNotice(`Malha viária indisponível. Nenhum alerta por estrada será emitido. ${error.message}`);
      log(`Falha ao carregar malha OSM: ${error.message}`);
      return null;
    })
    .finally(() => { roadLoadPromise = null; });
  return roadLoadPromise;
}

function updateRouteAlert(evaluation) {
  if (!trackingActive) return;
  if (IS_ANDROID_NATIVE && document.visibilityState !== 'visible') return;
  for (const alert of evaluation.alerts || []) {
    const message = `${alert.text} Confira a sinalização da via.`;
    setNotice(message);
    speak(message);
    log(`Alerta por malha OSM emitido: ${alert.radar.id}, ${alert.type}, ${alert.distance} m.`);
    if (settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Radar Alert', { body: message, icon: '/icon.svg', tag: `radar-${alert.radar.id}` }); }
      catch (error) { log(`Notificação não exibida: ${error.message}`); }
    }
  }
}

function updateNearby() {
  if (!trackingActive || !position || !activeRadars.length) return;
  let next = null;
  let routed = [];
  mapMatch = null;
  let evaluation = { nextRadar: null, alerts: [] };

  if (roadProvider?.covers(position) && mapMatcher) {
    mapMatch = mapMatcher.match({
      lat: position.lat, lng: position.lng, speed: position.speed,
      accuracy: position.accuracy, heading: position.heading, timestamp: position.timestamp
    });
    if (mapMatch.matched && mapMatch.confidence === 'HIGH') {
      routed = roadProvider.getRoutedRadars(mapMatch, activeRadars, { maxDistance: 5000 });
      evaluation = alertManager.processEvaluation({
        matchedSegment: mapMatch.segment,
        candidateRadars: routed,
        effectiveHeading: mapMatch.effectiveHeading,
        confidence: mapMatch.confidence
      });
      next = evaluation.nextRadar;
      nearby = routed;
      $('matchedRoadLabel').textContent = mapMatch.segment.ref || mapMatch.segment.name || 'Via identificada';
      $('navEngineMode').textContent = 'Rede OSM · grafo direcional';
      $('diagMapMatch').textContent = `Alta confiança · ${mapMatch.segment.name || mapMatch.segment.ref || mapMatch.segment.wayId}`;
      $('distanceTypeLabel').textContent = 'Distância pela via';
    } else {
      nearby = findNearbyRadars(position, spatialIndex.queryRadius(position.lat, position.lng, 5000), { radius: 5000, maxResults: 15 });
      $('matchedRoadLabel').textContent = 'Via ainda não confirmada';
      $('navEngineMode').textContent = 'Map matching inconclusivo';
      $('diagMapMatch').textContent = `Sem confiança suficiente · ${mapMatch.confidence}`;
      $('distanceTypeLabel').textContent = 'Distância aproximada';
    }
  } else {
    nearby = findNearbyRadars(position, spatialIndex.queryRadius(position.lat, position.lng, 5000), { radius: 5000, maxResults: 15 });
    $('matchedRoadLabel').textContent = 'Carregando ruas';
    $('navEngineMode').textContent = 'Geometria não carregada';
    $('diagMapMatch').textContent = roadNetworkStatus;
    $('distanceTypeLabel').textContent = 'Distância aproximada';
    if (!roadLoadPromise) void ensureRoadNetwork(false);
  }

  $('currentSpeed').textContent = position.speed == null ? '—' : `${Math.round(position.speed)} km/h`;
  $('cockpitSpeed').textContent = position.speed == null ? '—' : String(Math.round(position.speed));
  $('gpsAccuracy').textContent = `± ${Math.round(position.accuracy)} m`;
  $('gpsMode').textContent = String(position.mode || 'UNKNOWN').replace('HIGHWAY', 'RODOVIA').replace('URBAN', 'URBANO').replace('STOPPED', 'PARADO').replace('RECOVERING', 'RECUPERANDO').replace('UNKNOWN', 'INDEFINIDO');
  $('lastFixTime').textContent = new Date(position.timestamp).toLocaleTimeString('pt-BR');

  if (!next) {
    $('radarHeadline').textContent = mapMatch?.matched && mapMatch.confidence === 'HIGH' ? 'Nenhum radar confirmado à frente' : (position.speed != null && position.speed <= 3 ? 'Aguardando movimento' : 'Identificando a rua');
    $('radarSubhead').textContent = mapMatch?.matched ? 'Nenhum radar associado à mesma via e sentido' : 'A rua ainda não foi confirmada';
    $('distanceValue').innerHTML = '—<small>m</small>';
    $('roadLabel').textContent = mapMatch?.matched ? 'A geometria OSM foi associada, mas não há radar confirmado adiante nesta via.' : 'Os pontos próximos são apenas referências geográficas. Alertas suspensos sem correspondência confiável.';
    $('speedLimit').textContent = '—';
    $('radarKind').textContent = '—'; $('radarDirection').textContent = '—'; $('radarSource').textContent = '—';
    $('radarDataConfidence').textContent = '—';
    $('confidenceBadge').className = `confidence ${mapMatch?.confidence === 'HIGH' ? 'good' : 'warn'}`;
    $('confidenceBadge').textContent = mapMatch?.confidence === 'HIGH' ? 'Via confirmada' : 'Via não confirmada';
  } else {
    $('radarHeadline').textContent = radarKind(next.kind);
    $('radarSubhead').textContent = next.roadName || mapMatch.segment.name || mapMatch.segment.ref || 'Via identificada pelo OSM';
    const distance = formatDistance(next.routeDistanceMeters ?? next.distance);
    const [number, unit = 'm'] = distance.split(' ');
    $('distanceValue').innerHTML = `${escapeHtml(number)}<small>${escapeHtml(unit)}</small>`;
    const sectionInfo = next.kind === 'SECTION' && Number.isFinite(next.sectionLengthMeters)
      ? ` Extensão do trecho mapeada: ${formatDistance(next.sectionLengthMeters)}.` : '';
    $('roadLabel').textContent = `Distância calculada pela rede viária OpenStreetMap. Associação do radar: ${next.directionSource === 'dataset' ? 'sentido informado na base' : 'sentido inferido por via de direção única próxima'}.${sectionInfo} Confira a sinalização física.`;
    $('speedLimit').textContent = next.limit == null ? '—' : next.limit;
    $('radarKind').textContent = radarKind(next.kind);
    $('radarDirection').textContent = formatBearing(next.effectiveDirection ?? next.direction);
    $('radarSource').textContent = next.source;
    $('radarDataConfidence').textContent = `${next.confidence || 'não informada'} · offset ${Math.round(next.offsetMeters || 0)} m`;
    $('confidenceBadge').className = next.directionSource === 'dataset' ? 'confidence good' : 'confidence warn';
    $('confidenceBadge').textContent = next.directionSource === 'dataset' ? 'Sentido informado' : 'Sentido inferido';
  }
  roadStability.record(mapMatch, position.timestamp);
  renderNearby();
  renderMatchInsight();
  mapView.update({ position, mapMatch, roadProvider, nearby, spatialIndex });
  updateRouteAlert(evaluation);
  updateDiagnostics();
  if (roadProvider && !roadLoadPromise && Date.now() >= roadLoadRetryAfter && navigator.onLine &&
      document.visibilityState === 'visible' && roadProvider.covers(position)) {
    const ahead = planRoadPrefetch(position, roadProvider, mapMatch?.effectiveHeading ?? position.heading);
    if (ahead) void ensureRoadNetwork(false, ahead);
  }
}

function renderNearby() { renderNearbyList($('nearbyList'), nearby); }

function speak(message) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'pt-BR'; utterance.rate = 1; utterance.volume = Math.max(0, Math.min(1, settings.volume / 100));
  window.speechSynthesis.speak(utterance);
}

function onPositionSuccess(coords, timestamp) {
  if (!trackingActive) return;
  const previous = position;
  const processed = gpsEngine.processRawFix(coords, timestamp);
  if (!processed.accepted) {
    if (!firstGpsCallbackLogged) {
      firstGpsCallbackLogged = true;
      log(`Primeiro retorno de localização rejeitado: ${processed.reason || 'motivo desconhecido'}${Number.isFinite(processed.accuracy) ? `; precisão ±${Math.round(processed.accuracy)} m` : ''}.`);
    }
    $('gpsAccuracy').textContent = Number.isFinite(processed.accuracy) ? `± ${Math.round(processed.accuracy)} m` : '—';
    if (processed.reason === 'LOW_ACCURACY') setNotice(`Precisão GPS insuficiente (${Math.round(processed.accuracy)} m). Alertas suspensos até melhorar.`);
    if (processed.reason === 'IMPOSSIBLE_JUMP') log('Ponto GPS rejeitado por salto incompatível.');
    lastFixIssue = processed.reason || 'qualidade insuficiente';
    mapView.markAccuracyStale('GPS incerto · última posição não confirmada');
    renderMatchInsight();
    updateDiagnostics();
    return;
  }
  lastFixIssue = null;
  const current = { ...processed };
  current.heading = deriveHeading(current, previous);
  position = current;
  updateDriveMode(current.speed);
  mapView.record(current);
  if (!firstFixLogged) {
    firstFixLogged = true;
    log(`Primeira posição GPS recebida: precisão ±${Math.round(current.accuracy)} m${current.speed == null ? '; velocidade indisponível' : `; ${current.speed.toFixed(1)} km/h`}.`);
  }
  $('mapSubtitle').textContent = `GPS · precisão aproximada ±${Math.round(current.accuracy)} m · rede viária OSM quando disponível`;
  if (!window.__radarMapCentered) {
    mapView.firstFix(current);
    window.__radarMapCentered = true;
  }
  updateNearby();
}

function onPositionError(error) {
  if (!trackingActive) return;
  const messages = {
    1: 'Permissão de localização negada. Habilite o GPS para este site nas configurações do navegador.',
    2: 'O dispositivo não conseguiu determinar sua localização. Tente em local aberto.',
    3: 'A localização demorou demais. O navegador tentará novamente.'
  };
  showError(messages[error.code] || 'Não foi possível obter a localização.');
  gpsEngine.notifySignalLoss();
  resetDriveMode();
  lastFixIssue = `GPS: ${error.code || 'erro'}`;
  mapView.markAccuracyStale('GPS indisponível · última posição não confirmada');
  renderMatchInsight();
  log(`Erro do GPS: código ${error.code} — ${messages[error.code] || 'erro desconhecido'}`);
  if (error.code === 1) void stopTracking('permissão de localização negada pelo navegador (erro 1)');
  updateDiagnostics();
}

async function requestWakeLock() {
  if (IS_ANDROID_NATIVE || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || !trackingActive || watchId == null) return;
  try {
    const requestedLock = await navigator.wakeLock.request('screen');
    // A solicitação pode resolver depois que o usuário já interrompeu o GPS.
    if (watchId == null || document.visibilityState !== 'visible') {
      await requestedLock.release();
      return;
    }
    wakeLock = requestedLock;
    log('Wake Lock de tela solicitado enquanto o monitoramento está ativo e a página visível.');
  } catch { wakeLock = null; }
}
async function setupNativeBridge() {
  if (!IS_ANDROID_NATIVE) return;
  await NativeRadarTracking.addListener('locationUpdate', event => {
    const coords = {
      latitude: Number(event.latitude), longitude: Number(event.longitude),
      accuracy: Number(event.accuracy),
      speed: event.speedMps == null || !Number.isFinite(Number(event.speedMps)) ? null : Number(event.speedMps),
      heading: event.bearingDegrees == null || !Number.isFinite(Number(event.bearingDegrees)) || Number(event.bearingDegrees) < 0
        ? null : Number(event.bearingDegrees)
    };
    onPositionSuccess(coords, Number(event.timestampMs) || Date.now());
  });
  await NativeRadarTracking.addListener('serviceEvent', event => {
    if (event.mode === 'stopped' || event.running === false) {
      nativeServiceActive = false;
      trackingActive = false;
      setGpsStatus(false);
      $('startBtn').classList.remove('hidden'); $('stopBtn').classList.add('hidden');
    } else if (event.running) {
      nativeServiceActive = true;
      trackingActive = true;
      setGpsStatus(true);
      $('startBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden');
    }
    if (event.mode === 'error') showError(event.message || 'Falha no serviço nativo de localização.');
    log(`Serviço Android [${event.mode || 'evento'}]: ${event.message || 'estado atualizado'}`);
    updateDiagnostics();
  });
  const status = await NativeRadarTracking.getStatus();
  nativeServiceActive = Boolean(status.running);
  cachedRoadRegions = Number(status.cachedRoadRegions) || 0;
  if (status.roadNetworkIssue) log(`Cobertura nativa pendente de nova sincronização: ${status.roadNetworkIssue}`);
  trackingActive = nativeServiceActive;
  if (nativeServiceActive) {
    setGpsStatus(true);
    $('startBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden');
    log('Serviço Android de localização já estava ativo ao abrir o Radar Alert.');
    if (status.roadNetworkReady) log(`Serviço Android restaurou a malha OSM: ${status.roadEdgeCount} arestas e ${status.roadRadarCount} radares associados.`);
    else if (status.roadEdgeCount > 0 && status.roadRadarCount === 0) log('Serviço Android restaurou a malha OSM, mas não há radar associado com sentido confirmado nesta região. Alertas por rota suspensos.');
    else log('Serviço Android ativo sem malha OSM sincronizada; alertas de rota em segundo plano permanecem suspensos.');
  }
  await NativeRadarTracking.setAppVisible({ visible: document.visibilityState === 'visible' });
  if (!nativeHeartbeatTimer) {
    nativeHeartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void NativeRadarTracking.setAppVisible({ visible: true }).catch(() => undefined);
    }, 7000);
  }
  updateDiagnostics();
}

async function writeNativeRoadNetwork(provider, { activate = true } = {}) {
  if (!IS_ANDROID_NATIVE || !provider) return null;
  const network = provider.exportForBackground();
  const result = activate
    ? await NativeRadarTracking.setRoadNetwork({ network })
    : await NativeRadarTracking.cacheRoadNetwork({ network });
  cachedRoadRegions = Number(result.cachedRegions) || cachedRoadRegions;
  if (activate) {
    log(`Rede viária sincronizada com Android: ${result.edges} arestas, ${result.attachments} radares associados; ${cachedRoadRegions} regiões salvas (${result.bytes} bytes).`);
  } else {
    log(`Região adicional preparada para segundo plano: ${result.edges} arestas; ${cachedRoadRegions} regiões salvas.`);
  }
  updateDiagnostics();
  return result;
}

function syncNativeRoadNetwork(provider = roadProvider, options = {}) {
  if (!IS_ANDROID_NATIVE || !provider) return Promise.resolve(null);
  return nativeWrites.enqueue(() => writeNativeRoadNetwork(provider, options));
}

function syncNativeConfiguration() {
  if (!IS_ANDROID_NATIVE) return Promise.resolve();
  // A fila preserva a revisão do catálogo durante a gravação de cada malha.
  // Sem isso, uma atualização em paralelo podia invalidar o arquivo recém-salvo.
  return nativeWrites.enqueue(async () => {
    const nativeRadars = buildNativeRadarCatalog(activeRadars);
    const datasetResult = await NativeRadarTracking.setRadars({ radars: nativeRadars });
    if (datasetResult.changed) cachedRoadRegions = 0;
    await NativeRadarTracking.setPreferences({
      far: settings.far, mid: settings.mid, near: settings.near,
      voice: settings.voice, notifications: settings.notifications, volume: settings.volume
    });
    if (roadProvider) await writeNativeRoadNetwork(roadProvider);
  });
}

async function startTracking() {
  clearError();
  if (trackingActive || watchId != null || trackingStarting) {
    log('Solicitação de início ignorada: monitoramento já está ativo ou iniciando.');
    return;
  }
  if (!IS_ANDROID_NATIVE && !navigator.geolocation) { showError('Este navegador não oferece geolocalização.'); return; }
  if (!window.isSecureContext) { showError('GPS exige HTTPS ou localhost. Abra pelo endereço local/HTTPS.'); return; }
  if (!activeRadars.length) { showError('A base de radares ainda não foi carregada.'); return; }

  trackingStarting = true;
  try {
    alertTiers.clear(); lastAnnouncementAt = 0; alertManager.reset(); position = null;
    mapView.resetTrail(); roadStability.reset(); resetDriveMode();
    firstFixLogged = false; firstGpsCallbackLogged = false; window.__radarMapCentered = false; gpsEngine.reset();
    mapMatcher?.reset(); mapMatch = null; lastMatchDiagnosticSignature = null;

    if (IS_ANDROID_NATIVE) {
      await nativeBridgeReady;
      const permissions = await NativeRadarTracking.requestPermissions();
      if (!permissions.fineLocationGranted) throw new Error('Permita localização precisa para iniciar o monitoramento.');
      let notificationsGranted = permissions.notificationsGranted;
      if (settings.notifications && !notificationsGranted) {
        const notificationResult = await NativeRadarTracking.requestNotificationPermission();
        notificationsGranted = notificationResult.notificationsGranted;
      }
      await syncNativeConfiguration();
      await NativeRadarTracking.setAppVisible({ visible: true });
      const started = await NativeRadarTracking.start();
      if (!started.running) throw new Error('O serviço Android não confirmou o início.');
      nativeServiceActive = true;
      trackingActive = true;
      setGpsStatus(true);
      $('startBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden');
      setNotice('Monitoramento Android ativo. O serviço nativo mantém o GPS em segundo plano com notificação persistente.');
      log('Monitoramento iniciado pelo serviço Android em primeiro plano. Aguardando primeiro fix nativo.');
      if (settings.notifications && !notificationsGranted) log('Permissão de notificações recusada; alertas por voz continuam disponíveis.');
      updateDiagnostics();
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      event => onPositionSuccess(event.coords, event.timestamp || Date.now()),
      onPositionError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
    trackingActive = true;
    setGpsStatus(true);
    $('startBtn').classList.add('hidden'); $('stopBtn').classList.remove('hidden');
    setNotice('Monitoramento iniciado nesta página. A versão web não garante GPS contínuo com a tela bloqueada ou o navegador suspenso.');
    log(`Monitoramento GPS iniciado (web em primeiro plano; watchId ${watchId}). Aguardando primeira posição.`);
    updateDiagnostics();
    void requestWakeLock();
    if (settings.notifications && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* permissão opcional */ });
    }
  } catch (error) {
    if (IS_ANDROID_NATIVE && nativeServiceActive) {
      try { await NativeRadarTracking.stop(); } catch { /* preserva o erro original */ }
    }
    nativeServiceActive = false; trackingActive = false; watchId = null;
    setGpsStatus(false);
    $('startBtn').classList.remove('hidden'); $('stopBtn').classList.add('hidden');
    showError(`Não foi possível iniciar o monitoramento: ${error.message}`);
    log(`Falha ao iniciar monitoramento: ${error.message}`);
  } finally {
    trackingStarting = false;
  }
}
async function stopTracking(reason = 'solicitado pelo usuário') {
  const wasActive = trackingActive || watchId != null || nativeServiceActive;
  if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (IS_ANDROID_NATIVE && nativeServiceActive) {
    try { await NativeRadarTracking.stop(); }
    catch (error) { log(`Falha ao parar o serviço Android: ${error.message}`); }
  }
  nativeServiceActive = false;
  trackingActive = false;
  mapView.resetTrail(); mapView.markAccuracyStale('Monitoramento parado · área de precisão oculta'); roadStability.reset(); resetDriveMode();
  mapMatcher?.reset(); mapMatch = null;
  setGpsStatus(false);
  $('startBtn').classList.remove('hidden'); $('stopBtn').classList.add('hidden');
  renderMatchInsight();
  updateDiagnostics();
  if (wakeLock) { try { await wakeLock.release(); } catch { /* pode já ter sido liberado */ } wakeLock = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  setNotice('Monitoramento pausado.');
  if (wasActive) log(`Monitoramento GPS pausado: ${reason}.`);
  updateDiagnostics();
}
function getMatchSummary() {
  return summarizeMatch(mapMatch, {
    covered: Boolean(position && roadProvider?.covers(position)),
    hasPosition: Boolean(position && trackingActive),
    accuracy: position?.accuracy,
    roadStatus: roadNetworkStatus,
    fixIssue: trackingActive ? lastFixIssue : null,
    fixAgeMs: position ? Date.now() - position.timestamp : null,
    speedKmh: position?.speed ?? null
  });
}

function renderMatchInsight() {
  const summary = getMatchSummary();
  renderMatchPanel(summary, $, roadStability.snapshot());
  const signature = `${summary.state}|${summary.reason}|${mapMatch?.segment?.name || mapMatch?.segment?.ref || 'nenhuma'}`;
  // Só registra mudanças de decisão; registrar cada fix poluiria os logs.
  if (trackingActive && signature !== lastMatchDiagnosticSignature &&
      (Date.now() - lastMatchDiagnosticAt >= 15000 || summary.state === 'confirmed' || summary.state === 'blocked')) {
    lastMatchDiagnosticSignature = signature;
    lastMatchDiagnosticAt = Date.now();
    log(`Map Matching: ${summary.badge} · ${summary.road} · ${summary.reason}; afastamento ${summary.offset}, diferença de rumo ${summary.angle}, ${summary.candidates} candidatos.`);
  }
  return summary;
}

function updateDiagnostics() {
  const summary = getMatchSummary();
  $('diagGpsStatus').textContent = !trackingActive ? 'Desligado' : (nativeServiceActive ? 'Android FGS ativo' : 'Ativo na página');
  $('diagGpsMode').textContent = position?.mode || gpsEngine.currentMode;
  $('diagAccuracy').textContent = position ? `±${Math.round(position.accuracy)} m` : '—';
  $('diagSpeed').textContent = position?.speed == null ? '—' : `${position.speed.toFixed(1)} km/h`;
  $('diagServiceStatus').textContent = IS_ANDROID_NATIVE ? (nativeServiceActive ? 'Serviço Android em primeiro plano' : 'Serviço Android inativo') : 'Web foreground; sem GPS garantido em segundo plano';
  $('diagWakeLock').textContent = nativeServiceActive ? 'Dispensável: serviço nativo ativo' : (wakeLock ? 'Solicitado (tela visível)' : 'Inativo');
  $('diagCachedRegions').textContent = IS_ANDROID_NATIVE ? `${cachedRoadRegions} de 12 regiões sincronizadas` : 'Disponível somente no aplicativo Android';
  $('diagNetwork').textContent = navigator.onLine ? 'Online' : 'Offline';
  $('diagDatabase').textContent = `${radars.length} registros (${activeRadars.length} ativos)`;
  $('diagDatasetAge').textContent = datasetSavedAt ? formatDate(datasetSavedAt) : 'Não informada';
  $('diagMapMatch').textContent = `${summary.badge} · ${roadNetworkStatus}`;
  $('diagMatchRoad').textContent = summary.road;
  $('diagMatchReason').textContent = summary.competingRoad ? `${summary.reason} · alternativa: ${summary.competingRoad}` : summary.reason;
  $('diagMatchOffset').textContent = summary.offset;
  $('diagMatchAngle').textContent = summary.angle;
  $('diagMatchHeading').textContent = summary.heading;
  $('diagMatchCandidates').textContent = summary.candidates;
  $('diagMatchAlternatives').textContent = (summary.alternatives || []).map(item =>
    `${item.name} (${item.offset})`).join(' · ') || '—';
  $('diagOutliersCount').textContent = String(gpsEngine.outliersCount);
  const stability = roadStability.snapshot();
  $('diagRoadStability').textContent = `${stability.label} · ${stability.detail}`;
  if (position && Date.now() - position.timestamp > 90000) resetDriveMode();
  const health = deriveSystemHealth({
    tracking: trackingActive, native: IS_ANDROID_NATIVE, nativeServiceActive,
    hasPosition: Boolean(position), fixAgeMs: position ? Date.now() - position.timestamp : null,
    gpsIssue: lastFixIssue, activeRadars: activeRadars.length, datasetSavedAt,
    roadCovered: Boolean(position && roadProvider?.covers(position)),
    roadSegments: roadProvider?.getAllSegments().length || 0,
    routeReady: summary.routeAlertsReady, online: navigator.onLine
  });
  renderSystemHealth($('healthList'), health);
  const okCount = health.checks.filter(item => item.status === 'good').length;
  $('healthSummary').textContent = `${okCount} de ${health.checks.length} verificações ativas`;
  $('cockpitRoadState').textContent = ({ idle:'Aguardando GPS', confirmed:'Confirmada', review:'Em análise', stationary:'Aguardando movimento', blocked:'Indisponível' })[summary.state] || summary.badge;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(settings, saved);
  } catch { /* configurações padrão */ }
  $('prefVoiceToggle').checked = Boolean(settings.voice);
  $('prefNotificationsToggle').checked = Boolean(settings.notifications);
  $('prefContrastToggle').checked = Boolean(settings.contrast);
  document.body.classList.toggle('contrast-high', Boolean(settings.contrast));
  $('prefDriveModeToggle').checked = Boolean(settings.driveMode);
  $('voiceVolSlider').value = String(settings.volume);
  $('volLabel').textContent = `${settings.volume}%`;
  $('prefTierFar').value = String(settings.far);
  $('prefTierMid').value = String(settings.mid);
  $('prefTierNear').value = String(settings.near);
  alertManager.setTiers({ far: settings.far, mid: settings.mid, near: settings.near });
}
async function saveSettings() {
  settings.voice = $('prefVoiceToggle').checked;
  settings.notifications = $('prefNotificationsToggle').checked;
  settings.contrast = $('prefContrastToggle').checked;
  settings.driveMode = $('prefDriveModeToggle').checked;
  if (!settings.driveMode) resetDriveMode();
  document.body.classList.toggle('contrast-high', Boolean(settings.contrast));
  settings.volume = Number($('voiceVolSlider').value);
  settings.far = Number($('prefTierFar').value);
  settings.mid = Number($('prefTierMid').value);
  settings.near = Number($('prefTierNear').value);
  alertManager.setTiers({ far: settings.far, mid: settings.mid, near: settings.near });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (nativeServiceActive) {
    if (settings.notifications) {
      try {
        const permission = await NativeRadarTracking.requestNotificationPermission();
        if (!permission.notificationsGranted) log('Notificações não autorizadas pelo Android; alertas por voz continuam disponíveis.');
      } catch (error) { log(`Não foi possível solicitar notificações: ${error.message}`); }
    }
    void NativeRadarTracking.setPreferences({ far: settings.far, mid: settings.mid, near: settings.near, voice: settings.voice, notifications: settings.notifications, volume: settings.volume }).catch(error => log(`Falha ao atualizar preferências nativas: ${error.message}`));
  }
  closeModal('settingsModal'); setNotice('Preferências salvas neste dispositivo.');
}
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

const navigation = createNavigation({ onChange: () => mapView.invalidateSize() });
const simulatorUI = setupSimulator({ getElement: $, onLog: log });
$('startBtn').addEventListener('click', startTracking);
$('stopBtn').addEventListener('click', () => { void stopTracking('botão Parar monitoramento acionado'); });
$('refreshBtn').addEventListener('click', async () => {
  const button = $('refreshBtn');
  if (button.disabled) return;
  button.disabled = true;
  try { await loadDataset(true); }
  finally { button.disabled = false; }
});
$('refreshRoadBtn').addEventListener('click', async () => {
  if (!position) { setNotice('Ative a localização antes de atualizar a malha viária.'); return; }
  const button = $('refreshRoadBtn');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Consultando ruas OSM…';
  try { await ensureRoadNetwork(true); }
  finally { button.disabled = false; button.textContent = 'Atualizar ruas OSM desta região'; }
});
$('prepareMapRegionBtn').addEventListener('click', async () => {
  const center = mapView.getCenter();
  if (!center || !position || !trackingActive) {
    setNotice('Ative o monitoramento e aguarde o GPS para preparar uma região do mapa.');
    return;
  }
  if (Date.now() - position.timestamp > 90000 || lastFixIssue) {
    setNotice('A localização atual está desatualizada ou foi recusada. Aguarde um novo fix antes de preparar a região.');
    return;
  }
  const button = $('prepareMapRegionBtn');
  if (button.disabled) return;
  if (roadLoadPromise) { setNotice('Já existe uma consulta OSM em andamento. Aguarde o resultado antes de preparar outra região.'); return; }
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Preparando área…';
  try {
    if (roadProvider?.covers(center)) {
      setNotice('Esta área já está coberta pela malha ativa e foi sincronizada com o Android.');
    } else {
      const previousSuccess = lastRoadLoadSucceededAt;
      await ensureRoadNetwork(false, center);
      setNotice(lastRoadLoadSucceededAt > previousSuccess
        ? 'Geometria da área preparada no cache local. No Android, verifique o número de regiões sincronizadas no Diagnóstico.'
        : 'Não foi possível confirmar o preparo desta área. Consulte o diagnóstico e tente novamente com conexão estável.');
    }
  } finally { button.disabled = false; button.textContent = label; }
});
$('toggleTrailBtn').addEventListener('click', () => mapView.toggleTrail());
$('toggleAccuracyBtn').addEventListener('click', () => mapView.toggleAccuracy());
$('locateMapBtn').addEventListener('click', () => mapView.center());
$('expandMapBtn').addEventListener('click', () => mapView.expand());
$('diagBtn').addEventListener('click', () => { updateDiagnostics(); openModal('diagModal'); });
$('diagOpenInlineBtn').addEventListener('click', () => { updateDiagnostics(); openModal('diagModal'); });
$('matchDetailsBtn').addEventListener('click', () => { updateDiagnostics(); openModal('diagModal'); });
$('equipmentToggle').addEventListener('click', () => {
  const expanded = $('equipmentPanel').classList.toggle('expanded');
  $('equipmentToggle').setAttribute('aria-expanded', String(expanded));
  $('equipmentToggle').firstChild.textContent = expanded ? 'Ocultar ' : 'Exibir ';
});
$('settingsBtn').addEventListener('click', () => openModal('settingsModal'));
$('closeDiagBtn').addEventListener('click', () => closeModal('diagModal'));
$('closeDiagBtn2').addEventListener('click', () => closeModal('diagModal'));
$('closeSettingsBtn').addEventListener('click', () => closeModal('settingsModal'));
$('closePrivacyBtn').addEventListener('click', () => closeModal('privacyModal'));
$('closePrivacyBtn2').addEventListener('click', () => closeModal('privacyModal'));
$('openPrivacyModalLink').addEventListener('click', event => { event.preventDefault(); openModal('privacyModal'); });
$('saveSettingsBtn').addEventListener('click', saveSettings);
$('voiceVolSlider').addEventListener('input', event => { $('volLabel').textContent = `${event.target.value}%`; });
$('testVoiceBtn').addEventListener('click', () => speak('Teste de áudio do Radar Alert. Este é um aviso informativo.'));
$('clearDataBtn').addEventListener('click', async () => {
  if (!confirm('Apagar a base de radares em cache e as preferências locais do Radar Alert?')) return;
  await stopTracking('limpeza dos dados locais solicitada');
  const ok = await OfflineStore.clearAllLocalData();
  let nativeDataCleared = true;
  if (IS_ANDROID_NATIVE) {
    try { await NativeRadarTracking.clearLocalData(); }
    catch (error) { nativeDataCleared = false; log(`Falha ao apagar a cópia nativa da base: ${error.message}`); }
  }
  localStorage.removeItem(SETTINGS_KEY);
  radars = []; activeRadars = []; nearby = []; spatialIndex.clear(); datasetSavedAt = null; alertTiers.clear(); roadProvider = null; mapMatcher = null; mapMatch = null; roadNetworkStatus = 'Cache apagado';
  lastMatchDiagnosticSignature = null; lastFixIssue = null; roadStability.reset(); mapView.resetTrail(); resetDriveMode(); renderMatchInsight();
  updateDatasetStats(); $('datasetStatus').textContent = 'Cache apagado'; $('datasetMeta').textContent = 'Pardal · ainda não carregado'; catalogBuiltAt = null;
  closeModal('settingsModal');
  setNotice(ok && nativeDataCleared ? 'Dados locais do Radar Alert apagados.' : 'Parte dos dados locais não pôde ser apagada. Consulte o diagnóstico.');
  await loadDataset(true);
});
$('copyDiagBtn').addEventListener('click', async () => {
  updateDiagnostics();
  const match = getMatchSummary();
  const snapshot = [
    'Radar Alert — diagnóstico resumido',
    `Estado: ${match.badge}; via: ${match.road}; motivo: ${match.reason}`,
    `Afastamento GPS/via: ${match.offset}; desvio de rumo: ${match.angle}; rumo: ${match.heading}; candidatos: ${match.candidates}`,
    `Precisão GPS: ${position && trackingActive ? `±${Math.round(position.accuracy)} m` : '—'}; base: ${activeRadars.length} radares ativos`,
    `Vias consideradas: ${(match.alternatives || []).map(item => `${item.name} (${item.offset})`).join(' · ') || '—'}`,
    `Estabilidade: ${roadStability.snapshot().label}; ${roadStability.snapshot().detail}`,
    `Regiões offline sincronizadas com Android: ${IS_ANDROID_NATIVE ? cachedRoadRegions : 'não aplicável'}`,
    'Histórico recente:'
  ].join('\n');
  const text = `${snapshot}\n${diagnostics.join('\n')}`;
  try { await navigator.clipboard.writeText(text); setNotice('Eventos de diagnóstico copiados. Coordenadas não são incluídas.'); }
  catch { setNotice('Não foi possível copiar o diagnóstico neste navegador.'); }
});
for (const id of ['diagModal', 'settingsModal', 'privacyModal']) {
  $(id).addEventListener('click', event => { if (event.target === $(id)) closeModal(id); });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const id of ['diagModal', 'settingsModal', 'privacyModal']) closeModal(id);
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installBtn').classList.remove('hidden'); });
$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null; $('installBtn').classList.add('hidden');
});
document.addEventListener('visibilitychange', () => {
  const visible = document.visibilityState === 'visible';
  if (IS_ANDROID_NATIVE && nativeServiceActive) {
    void NativeRadarTracking.setAppVisible({ visible }).catch(error => log(`Não foi possível atualizar estado de visibilidade nativo: ${error.message}`));
    if (!visible) log('Segundo plano: serviço nativo usa a malha sincronizada e suspende alertas sem via confirmada.');
  } else {
    if (visible && trackingActive && watchId != null && !wakeLock) requestWakeLock();
    if (!visible && wakeLock) { wakeLock.release().catch(() => undefined); wakeLock = null; }
    if (!visible && watchId != null) log('Página oculta: o navegador pode suspender GPS/tarefas.');
  }
  renderMatchInsight();
  updateDiagnostics();
});
// Atualiza o selo se o último fix envelhecer sem novos eventos de localização.
setInterval(() => {
  if (trackingActive && document.visibilityState === 'visible' && position &&
      $('matchBadge').textContent !== getMatchSummary().badge) {
    renderMatchInsight();
    updateDiagnostics();
    if (Date.now() - position.timestamp > 90000) mapView.markAccuracyStale('GPS desatualizado · área de precisão oculta');
  }
}, 15000);
window.addEventListener('online', () => { $('networkDot').classList.add('online'); $('networkDot').classList.remove('offline'); updateDiagnostics(); });
window.addEventListener('offline', () => { $('networkDot').classList.add('offline'); $('networkDot').classList.remove('online'); updateDiagnostics(); });
window.addEventListener('pagehide', () => { if (!IS_ANDROID_NATIVE && watchId != null) { navigator.geolocation?.clearWatch(watchId); watchId = null; trackingActive = false; } });

gpsEngine.onModeChange = mode => { log(IS_ANDROID_NATIVE ? `Perfil GPS observado: ${mode}; o serviço nativo ajusta a frequência real.` : `Perfil GPS alterado: ${mode}. A frequência real é controlada pelo navegador.`); };
gpsEngine.onGpsLost = () => { setNotice('Sinal GPS perdido. Aguardando uma nova posição válida.'); };

mapView.init();
renderMatchInsight();
loadSettings();
updateDiagnostics();
if (IS_ANDROID_NATIVE) nativeBridgeReady = setupNativeBridge().catch(error => { log(`Plugin Android indisponível: ${error.message}`); throw error; });
if (!IS_ANDROID_NATIVE && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(error => log(`Service Worker indisponível: ${error.message}`));
await loadCatalog();
await loadDataset(false);
updateDiagnostics();
