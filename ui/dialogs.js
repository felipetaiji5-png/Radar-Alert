/** Modais com foco contido, fechamento por Escape e retorno ao botão de origem. */
export function createDialogs(documentRef = document) {
  let active = null;
  let returnFocus = null;
  const focusable = dialog => [...dialog.querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
    .filter(element => !element.disabled && element.getClientRects().length);
  const close = id => {
    const dialog = documentRef.getElementById(id);
    dialog?.classList.add('hidden');
    if (active !== dialog) return;
    active = null;
    documentRef.body.classList.remove('dialog-open');
    returnFocus?.focus();
    returnFocus = null;
  };
  const open = id => {
    const dialog = documentRef.getElementById(id);
    if (!dialog || active === dialog) return;
    if (active) close(active.id);
    returnFocus = documentRef.activeElement;
    active = dialog;
    dialog.classList.remove('hidden');
    documentRef.body.classList.add('dialog-open');
    (focusable(dialog)[0] || dialog).focus();
  };
  const onKey = event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); close(active.id); return; }
    if (event.key !== 'Tab') return;
    const items = focusable(active);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); active.focus(); return; }
    if (event.shiftKey && (documentRef.activeElement === first || !active.contains(documentRef.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (documentRef.activeElement === last || !active.contains(documentRef.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };
  documentRef.addEventListener('keydown', onKey);
  return { open, close, destroy() { if (active) close(active.id); documentRef.removeEventListener('keydown', onKey); } };
}
