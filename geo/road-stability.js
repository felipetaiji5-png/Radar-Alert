/**
 * Histórico volátil de estabilidade da rua candidata. Não guarda coordenadas
 * nem confirma uma via: serve somente ao diagnóstico do usuário.
 */
export class RoadStabilityTracker {
  constructor({ windowMs = 180000, maxSamples = 100 } = {}) {
    this.windowMs = windowMs;
    this.maxSamples = maxSamples;
    this.reset();
  }

  reset() { this.samples = []; }

  record(match, timestamp) {
    if (!Number.isFinite(timestamp)) return;
    const previous = this.samples.at(-1);
    if (previous && timestamp <= previous.timestamp) return;
    const segment = match?.segment;
    const name = segment ? String(segment.name || segment.ref || `Via sem nome (${segment.wayId || segment.id})`).trim() : null;
    this.samples.push({ timestamp, name, confirmed: Boolean(match?.matched && match?.confidence === 'HIGH') });
    this._prune(timestamp);
  }

  _prune(now) {
    this.samples = this.samples.filter(item => item.timestamp >= now - this.windowMs && item.timestamp <= now);
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }

  snapshot(now = Date.now()) {
    this._prune(now);
    const samples = this.samples;
    if (!samples.length) return { status: 'empty', label: 'Sem histórico', detail: 'Aguardando leituras GPS válidas.', changes: 0, sampleCount: 0, durationMs: 0, currentRoad: null };
    const named = samples.filter(item => item.name);
    if (!named.length) return { status: 'unknown', label: 'Rua ainda não identificada', detail: `${samples.length} leituras, sem uma via candidata.`, changes: 0, sampleCount: samples.length, durationMs: 0, currentRoad: null };
    let changes = 0;
    for (let i = 1; i < named.length; i++) if (named[i].name !== named[i - 1].name) changes++;
    const latest = named.at(-1);
    let firstConsecutive = latest.timestamp;
    for (let i = named.length - 2; i >= 0; i--) {
      if (named[i].name !== latest.name) break;
      firstConsecutive = named[i].timestamp;
    }
    const durationMs = latest.timestamp - firstConsecutive;
    const enough = named.length >= 3 && durationMs >= 15000;
    // Uma troca isolada é comum na convergência inicial do GPS. Somente
    // alternâncias repetidas justificam o rótulo de "oscilando".
    const status = changes >= 2 ? 'changing' : changes === 1 ? 'transition' : enough ? 'stable' : 'collecting';
    const detail = changes >= 2
      ? `${changes} trocas de via candidata nos últimos 3 min. Isso não confirma a pista.`
      : changes === 1 ? 'Uma mudança de candidata no período; aguardando novas leituras para avaliar estabilidade.'
        : enough ? `Mesma rua candidata há ${Math.max(1, Math.floor(durationMs / 1000))} s. Ainda precisa validar o sentido.`
          : `${named.length} ${named.length === 1 ? 'leitura' : 'leituras'} com rua candidata. Aguardando mais pontos.`;
    const label = changes >= 2 ? 'Identificação oscilando' : changes === 1 ? 'Candidata alterada uma vez' : enough ? 'Candidata estável' : 'Coletando histórico';
    return { status, label, detail, changes, sampleCount: samples.length, durationMs, currentRoad: latest.name };
  }
}
