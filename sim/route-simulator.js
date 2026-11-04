import { MapMatcher } from '../geo/map-matcher.js';
import { RoadNetworkProvider, RoadSegment } from '../geo/road-network.js';
import { AlertManager } from '../geo/alert-manager.js';

/**
 * Laboratório inteiramente isolado: geometria e radar FICTÍCIOS.
 * Nunca recebe localizações reais, nem escreve em stores, bridge nativa,
 * gerenciador de alertas em produção ou estado de rastreamento.
 */
export const SIM_SCENARIOS = Object.freeze({
  straight: { label: 'Via única + radar', description: 'Testa confirmação, distância pela rua e faixas de aviso.' },
  parallel: { label: 'Pistas paralelas', description: 'Duas ruas semelhantes: verificar rejeição por ambiguidade.' },
  stopped: { label: 'Veículo parado', description: 'Sem direção confiável: nenhum alerta de rota deve ser liberado.' }
});

const LINE_START = { lat: -23.55, lng: -46.66 };
const LINE_END = { lat: -23.55, lng: -46.63 };
const START_TIME = 1700000000000;
const STEPS = 34;

function buildScenario(scenario) {
  if (!Object.hasOwn(SIM_SCENARIOS, scenario)) throw new RangeError('Cenário de simulação inválido.');
  const primary = new RoadSegment({
    id: 'demo-road-a', wayId: 'demo-way-a', name: 'Via Exemplo', oneway: 'yes', physicalOneway: true,
    fromNode: 'demo-start', toNode: 'demo-end', coords: [LINE_START, LINE_END]
  });
  const roads = [primary];
  if (scenario === 'parallel') {
    roads.push(new RoadSegment({
      id: 'demo-road-b', wayId: 'demo-way-b', name: 'Via Paralela', oneway: 'yes',
      fromNode: 'other-start', toNode: 'other-end',
      coords: [{ lat: LINE_START.lat + 0.000025, lng: LINE_START.lng }, { lat: LINE_END.lat + 0.000025, lng: LINE_END.lng }]
    }));
  }
  const network = new RoadNetworkProvider(roads, { center: LINE_START, radiusMeters: 10000 });
  const radar = {
    id: 'radar-ficticio', lat: -23.55, lng: -46.636, active: true,
    direction: 90, limit: 50, kind: 'FIXED', source: 'Cenário fictício', confidence: 'test'
  };
  network.attachRadars([radar]);
  return { network, radar };
}

export class RouteSimulator {
  constructor(scenario = 'straight') { this.load(scenario); }
  load(scenario) {
    const { network, radar } = buildScenario(scenario);
    this.scenario = scenario;
    this.network = network;
    this.radar = radar;
    this.matcher = new MapMatcher(network);
    this.alertManager = new AlertManager({ minIntervalMs: 0 });
    this.index = 0;
    this.events = [];
    return this;
  }
  get total() { return STEPS; }
  get finished() { return this.index >= STEPS; }
  get progress() { return Math.min(100, Math.round(this.index / STEPS * 100)); }
  step() {
    if (this.finished) return null;
    const idx = this.index++;
    const isStopped = this.scenario === 'stopped';
    const ratio = isStopped ? 0.18 : 0.10 + (idx / (STEPS - 1)) * 0.87;
    const fix = {
      lat: this.scenario === 'parallel' ? LINE_START.lat + 0.0000125 : LINE_START.lat,
      lng: LINE_START.lng + ratio * (LINE_END.lng - LINE_START.lng),
      speed: isStopped ? 0 : 38, accuracy: 5,
      heading: isStopped ? null : 90,
      timestamp: START_TIME + idx * 3000
    };
    const match = this.matcher.match(fix);
    const confirmed = match.matched && match.confidence === 'HIGH';
    const candidates = confirmed ? this.network.getRoutedRadars(match, [this.radar], { maxDistance: 5000 }) : [];
    const evaluation = this.alertManager.processEvaluation({
      matchedSegment: confirmed ? match.segment : null, candidateRadars: candidates,
      effectiveHeading: match.effectiveHeading, confidence: match.confidence
    });
    const result = {
      step: this.index, total: STEPS, progress: this.progress,
      state: confirmed ? 'confirmed' : 'uncertain',
      road: match.segment?.name || 'Sem via',
      reason: match.diagnostic?.reason || match.confidence,
      distanceMeters: evaluation.nextRadar?.routeDistanceMeters ?? null,
      alerts: evaluation.alerts.map(alert => ({ type: alert.type, distance: alert.distance, text: alert.text })),
      ratio, fix: { lat: fix.lat, lng: fix.lng },
      // Para a visualização: informação explícita de que é sintético.
      scenario: this.scenario
    };
    this.events.push(result);
    return result;
  }
  runToEnd() { const results = []; while (!this.finished) results.push(this.step()); return results; }
}
