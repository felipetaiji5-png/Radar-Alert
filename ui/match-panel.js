/** Renderização do diagnóstico. O motor de Map Matching não depende desta tela. */
export function renderMatchPanel(summary, getElement, stability = null) {
  const $ = getElement;
  const badge = $('matchBadge');
  badge.className = `match-badge ${summary.state}`;
  badge.textContent = summary.badge;
  $('matchRoad').textContent = summary.road;
  $('matchExplanation').textContent = summary.explanation;
  $('matchOffset').textContent = summary.offset;
  $('matchAngle').textContent = summary.angle;
  $('matchHeading').textContent = summary.heading;
  $('matchCandidates').textContent = summary.candidates;
  $('matchReason').textContent = summary.reason;
  if (stability) {
    $('matchStabilityLabel').textContent = stability.label;
    $('matchStabilityDetail').textContent = stability.detail;
    $('matchStabilityCount').textContent = `${stability.changes} ${stability.changes === 1 ? 'troca' : 'trocas'}`;
    $('matchStabilityCount').dataset.status = stability.status;
  }
  const section = $('candidateSection'), list = $('candidateList');
  list.replaceChildren();
  const alternatives = summary.alternatives || [];
  section.hidden = !alternatives.length;
  for (const item of alternatives) {
    const doc = list.ownerDocument;
    const row = doc.createElement('div'); row.className = `candidate-row${item.isPrimary ? ' primary' : ''}`;
    const content = doc.createElement('div'); content.className = 'candidate-name';
    const name = doc.createElement('b'); name.textContent = item.name;
    const label = doc.createElement('small');
    label.textContent = item.isPrimary ? 'Mais próxima do ponto GPS' : 'Outra rua possível';
    content.append(name, label);
    const offset = doc.createElement('span'); offset.className = 'candidate-offset'; offset.textContent = item.offset;
    row.append(content, offset); list.append(row);
  }
}
