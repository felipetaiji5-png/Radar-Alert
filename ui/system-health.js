/** Sem percentuais artificiais: condições factuais e independentes. */
export function deriveSystemHealth({ tracking = false, native = false, nativeServiceActive = false,
  hasPosition = false, fixAgeMs = null, gpsIssue = null, activeRadars = 0,
  datasetSavedAt = null, datasetPersisted = Boolean(datasetSavedAt), roadCovered = false, roadSegments = 0, routeReady = false, online = true } = {}) {
  const fixFresh = tracking && hasPosition && !gpsIssue && Number.isFinite(fixAgeMs) && fixAgeMs <= 90000;
  const checks = [
    { id: 'gps', title: 'Localização GPS', status: !tracking ? 'idle' : fixFresh ? 'good' : 'warn',
      detail: !tracking ? 'Monitoramento desligado' : gpsIssue ? 'Último ponto recusado' : fixFresh ? 'Posição recente e válida' : 'Aguardando posição válida' },
    { id: 'dataset', title: 'Base de radares', status: activeRadars > 0 ? 'good' : 'warn',
      detail: activeRadars > 0 ? `${activeRadars.toLocaleString('pt-BR')} registros ativos${datasetPersisted ? ' · cópia local disponível' : ' · sem cópia offline confirmada'}` : 'Base ainda indisponível' },
    { id: 'osm', title: 'Cobertura de ruas', status: roadCovered && roadSegments > 0 ? 'good' : 'warn',
      detail: roadCovered && roadSegments > 0 ? `${roadSegments.toLocaleString('pt-BR')} segmentos carregados` : 'Sem malha confirmada nesta posição' },
    { id: 'route', title: 'Alertas por rota', status: routeReady && fixFresh && roadCovered ? 'good' : 'warn',
      detail: routeReady && fixFresh && roadCovered ? 'Via e direção identificadas' : 'Suspensos até confirmação da via' },
    { id: 'service', title: 'Segundo plano', status: native ? (nativeServiceActive ? 'good' : 'idle') : 'info',
      detail: native ? nativeServiceActive ? 'Serviço Android em primeiro plano' : 'Serviço Android desligado' : 'Navegador não garante GPS contínuo' }
  ];
  return { checks, online, ready: checks.every(check => check.status === 'good') };
}

export function renderSystemHealth(target, health) {
  const doc = target.ownerDocument;
  target.replaceChildren();
  for (const check of health.checks) {
    const row = doc.createElement('div'); row.className = `health-row health-${check.status}`;
    const dot = doc.createElement('span'); dot.className = 'health-dot'; dot.setAttribute('aria-hidden', 'true');
    const content = doc.createElement('div');
    const label = doc.createElement('strong'); label.textContent = check.title;
    const detail = doc.createElement('small'); detail.textContent = check.detail;
    content.append(label, detail);
    const status = doc.createElement('span'); status.className = 'health-status';
    status.textContent = { good: 'OK', idle: 'INATIVO', warn: 'ATENÇÃO', info: 'WEB' }[check.status];
    row.append(dot, content, status); target.append(row);
  }
}
