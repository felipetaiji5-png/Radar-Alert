/** Navegação de telas: não altera nem suspende a sessão de GPS. */
export const SCREENS = Object.freeze(['painel', 'mapa', 'via', 'proximos']);

export function normalizeScreen(input) {
  const value = String(input ?? '').replace(/^#/, '').toLowerCase();
  return SCREENS.includes(value) ? value : 'painel';
}

export function createNavigation({ documentRef = document, windowRef = window, onChange = () => {} } = {}) {
  const body = documentRef.body;
  const links = [...documentRef.querySelectorAll('[data-screen-link]')];
  let selected = normalizeScreen(windowRef.location?.hash);
  const activate = (screen, { updateHash = false } = {}) => {
    selected = normalizeScreen(screen);
    body.dataset.activeScreen = selected;
    for (const link of links) {
      const active = link.dataset.screenLink === selected;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (updateHash && windowRef.history?.replaceState) {
      windowRef.history.replaceState(null, '', `#${selected}`);
    }
    onChange(selected);
    return selected;
  };
  for (const link of links) {
    link.addEventListener('click', event => {
      event.preventDefault();
      activate(link.dataset.screenLink, { updateHash: true });
      if (windowRef.matchMedia?.('(max-width: 820px)').matches) windowRef.scrollTo?.({ top: 0, behavior: 'instant' });
    });
  }
  const onHashChange = () => activate(windowRef.location?.hash);
  windowRef.addEventListener?.('hashchange', onHashChange);
  activate(selected);
  return { activate, get current() { return selected; }, destroy() { windowRef.removeEventListener?.('hashchange', onHashChange); } };
}
