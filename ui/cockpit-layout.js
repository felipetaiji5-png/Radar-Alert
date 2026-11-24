/** Composição visual: move a mesma instância do mapa, preservando seus controles e estado. */
export function createCockpitLayout(documentRef = document) {
  const frame = documentRef.getElementById('mapFrame');
  const home = documentRef.getElementById('journeyMap');
  const originalParent = frame.parentElement;
  const originalNext = frame.nextSibling;
  return screen => {
    if (screen === 'painel') {
      if (frame.parentElement !== home) home.append(frame);
    } else if (frame.parentElement !== originalParent) {
      originalParent.insertBefore(frame, originalNext);
    }
  };
}

/** O número muda imediatamente; anima-se apenas o destaque, nunca o valor medido. */
export function setupTelemetryMotion(documentRef = document, windowRef = window) {
  const reduced = windowRef.matchMedia('(prefers-reduced-motion: reduce)');
  const elements = ['cockpitSpeed', 'distanceValue', 'speedLimit'].map(id => documentRef.getElementById(id));
  const previous = new Map(elements.map(el => [el, el.textContent]));
  const animations = new Map();
  const observer = new MutationObserver(() => {
    for (const el of elements) {
      const value = el.textContent;
      if (value === previous.get(el)) continue;
      previous.set(el, value);
      animations.get(el)?.cancel();
      if (!reduced.matches && !documentRef.hidden && el.getClientRects().length) {
        animations.set(el, el.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }));
      }
    }
  });
  elements.forEach(el => observer.observe(el, { childList: true, subtree: true, characterData: true }));
  const cancel = () => { if (reduced.matches) animations.forEach(animation => animation.cancel()); };
  reduced.addEventListener('change', cancel);
  return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); reduced.removeEventListener('change', cancel); };
}
