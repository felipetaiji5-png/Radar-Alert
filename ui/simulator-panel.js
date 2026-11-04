import { RouteSimulator, SIM_SCENARIOS } from '../sim/route-simulator.js';

/** Interação de laboratório isolada da execução Android e do GPS real. */
export function setupSimulator({ getElement, onLog = () => {} }) {
  const $ = getElement;
  const simulator = new RouteSimulator();
  let interval = null;
  let last = null;
  const stop = () => {
    if (interval != null) clearInterval(interval);
    interval = null;
    $('simRunBtn').disabled = false;
    $('simRunBtn').textContent = simulator.finished ? 'Executar novamente' : 'Executar trajetória';
  };
  const update = () => {
    $('simProgress').style.width = `${simulator.progress}%`;
    $('simProgressText').textContent = `${simulator.index} / ${simulator.total} pontos`;
    $('simSceneDescription').textContent = SIM_SCENARIOS[simulator.scenario].description;
    $('simStatus').textContent = last ? (last.state === 'confirmed' ? 'VIA CONFIRMADA' : 'NÃO CONFIRMADA') : 'PRONTO';
    $('simStatus').dataset.status = last?.state || 'idle';
    $('simRoad').textContent = last?.road || 'Via Exemplo (fictícia)';
    $('simReason').textContent = last?.reason || 'Nenhuma localização simulada processada';
    $('simDistance').textContent = last?.distanceMeters != null ? `${Math.round(last.distanceMeters)} m` : '—';
    $('simCar').style.left = `${last ? 9 + last.ratio * 83 : 17}%`;
    const alerts = simulator.events.flatMap(item => item.alerts);
    const pane = $('simEventList'); pane.replaceChildren();
    if (!alerts.length) {
      const item = pane.ownerDocument.createElement('p');
      item.textContent = 'Nenhum aviso simulado até este ponto.';
      pane.append(item);
    } else {
      for (const item of alerts.slice(-4).reverse()) {
        const entry = pane.ownerDocument.createElement('p');
        entry.textContent = `${item.type.replace('ALERT_', '')}: ${item.distance} m do radar fictício`;
        pane.append(entry);
      }
    }
  };
  const advance = () => {
    const result = simulator.step();
    if (!result) { stop(); return; }
    last = result;
    update();
    if (simulator.finished) { stop(); onLog(`Laboratório: cenário ${simulator.scenario} concluído (${simulator.events.flatMap(event => event.alerts).length} avisos simulados).`); }
  };
  $('simScenario').addEventListener('change', event => {
    stop(); simulator.load(event.target.value); last = null; update();
  });
  $('simStepBtn').addEventListener('click', () => {
    stop();
    if (simulator.finished) { simulator.load(simulator.scenario); last = null; }
    advance();
  });
  $('simRunBtn').addEventListener('click', () => {
    stop();
    if (simulator.finished) { simulator.load(simulator.scenario); last = null; }
    $('simRunBtn').disabled = true;
    $('simRunBtn').textContent = 'Simulando…';
    advance();
    if (!simulator.finished) interval = setInterval(advance, 160);
  });
  $('simResetBtn').addEventListener('click', () => {
    stop(); simulator.load(simulator.scenario); last = null; update();
  });
  update();
  return { stop, simulator };
}
