// Resumo EXPLICATIVO do Map Matching: não atribui probabilidades artificiais
// nem transforma uma via candidata em via confirmada.
const meters = value => Number.isFinite(value) ? `${Math.round(value)} m` : '—';
const degrees = value => Number.isFinite(value) ? `${Math.round(value)}°` : '—';

export function summarizeMatch(match, { covered = false, hasPosition = false, accuracy = null, roadStatus = '', fixIssue = null, fixAgeMs = null, speedKmh = null } = {}) {
  const base = {
    state: 'idle', badge: 'AGUARDANDO', road: 'Nenhuma via identificada',
    explanation: 'Inicie o monitoramento para analisar as ruas próximas.',
    offset: '—', angle: '—', heading: '—', candidates: '—',
    reason: 'Sem posição GPS', routeAlertsReady: false, alternatives: []
  };
  if (!hasPosition && !fixIssue) return base;
  // Não mostrar 'via confirmada' quando o fix mais recente foi recusado ou envelheceu.
  if (fixIssue || (Number.isFinite(fixAgeMs) && fixAgeMs > 90000)) {
    const stale = !fixIssue;
    return {
      ...base, state: 'blocked', badge: stale ? 'GPS DESATUALIZADO' : 'GPS INCERTO',
      road: match?.segment ? `Última via válida: ${match.segment.name || match.segment.ref || 'via sem nome'}` : 'Via não confirmada',
      explanation: stale ? 'Última posição recebida há mais de 90 segundos. Aguardando atualização.' :
        'O ponto GPS mais recente foi recusado. Os detalhes da via anterior não confirmam a posição atual.',
      reason: stale ? 'Posição sem atualização recente' : `Fix recusado: ${fixIssue}`
    };
  }
  if (!hasPosition) return base;
  if (!covered) return {
    ...base, state: 'blocked', badge: 'SEM COBERTURA',
    road: 'Malha viária não disponível aqui',
    explanation: 'Aguardando ruas OSM para esta região. Alertas por rota suspensos.',
    reason: roadStatus || 'Fora da malha disponível'
  };
  if (!match) return { ...base, state: 'review', badge: 'ANALISANDO', road: 'Buscando via', explanation: 'Aguardando comparação com a malha viária.', reason: 'Análise pendente' };

  const meta = match.diagnostic || {};
  const roadName = match.segment?.name || match.segment?.ref ||
    (match.segment ? `Via OSM ${match.segment.wayId || match.segment.id}` : null);
  const ok = match.matched === true && match.confidence === 'HIGH';
  const states = {
    LOW_ACCURACY: ['Precisão GPS insuficiente', `Precisão atual: ${meters(accuracy)}. Aguarde uma localização mais precisa.`],
    NO_CANDIDATE: ['Nenhuma via compatível', 'Não encontramos um segmento próximo compatível com esta posição.'],
    AMBIGUOUS_ROADS: ['Vias próximas semelhantes', 'Há mais de uma via possível. Aguarde movimento e melhora da precisão.'],
    NO_HEADING: ['Direção ainda desconhecida', 'O veículo está parado ou o rumo não é confiável. Aguarde deslocamento para confirmar.'],
    WEAK_MATCH: ['Correspondência insuficiente', 'A via candidata ainda não atingiu os critérios de confirmação.'],
    CONFIRMED: ['Via confirmada pelo algoritmo', 'Localização e direção compatíveis com a geometria disponível.']
  };
  const reasonCode = meta.reason || (ok ? 'CONFIRMED' : 'WEAK_MATCH');
  const [reason, explanation] = states[reasonCode] || states.WEAK_MATCH;
  const stationary = !ok && reasonCode === 'NO_HEADING' && Number.isFinite(speedKmh) && speedKmh <= 3;
  return {
    state: ok ? 'confirmed' : stationary ? 'stationary' : 'review',
    badge: ok ? 'VIA CONFIRMADA' : stationary ? 'AGUARDANDO MOVIMENTO' : 'NÃO CONFIRMADA',
    road: roadName ? `${ok ? '' : stationary ? 'Rua próxima: ' : 'Candidata: '}${roadName}` : 'Via não identificada',
    explanation: ok ? 'Correspondência de via e sentido considerada suficiente para avaliar radares associados.' : stationary
      ? 'Localização aproximada com o veículo parado. A rua exibida é apenas uma hipótese; alertas por rota suspensos até confirmar o sentido.'
      : `${explanation} Alertas por rota suspensos.`,
    offset: meters(meta.lateralDistanceMeters ?? match.proj?.distPerp),
    angle: degrees(meta.headingDifferenceDegrees ?? match.headingDiff),
    heading: degrees(match.effectiveHeading),
    candidates: Number.isFinite(meta.candidateCount) ? String(meta.candidateCount) : '—',
    reason,
    routeAlertsReady: ok,
    competingRoad: meta.competingRoad?.name || null,
    alternatives: Array.isArray(meta.alternatives) ? meta.alternatives.map(item => ({
      name: String(item.name || 'Via sem nome'),
      offset: meters(item.offsetMeters),
      heading: degrees(item.headingDifferenceDegrees),
      isPrimary: Boolean(item.isPrimary)
    })).slice(0, 4) : []
  };
}
