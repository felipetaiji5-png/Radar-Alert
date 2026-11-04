// Disponibiliza a cópia local antes de qualquer consulta de rede.
export async function loadRadarDataset({ store, key, urls, fetchText, validate,
  onData, onError = () => {}, isOnline = () => globalThis.navigator?.onLine !== false }) {
  let current = null;
  try {
    const cached = await store.getDataset(key);
    if (cached?.data?.csv) {
      validate(cached.data.csv);
      current = { csv: cached.data.csv, savedAt: cached.savedAt, persisted: true, source: 'cache local' };
      onData(current);
    }
  } catch (error) { onError(error); }
  if (!isOnline()) return { data: current, offline: true, updated: false };

  let lastError = null;
  for (const url of urls) {
    let csv;
    try {
      csv = await fetchText(url);
      validate(csv);
    } catch (error) { lastError = error; onError(error); continue; }
    let persisted = false;
    try { persisted = await store.saveDataset(key, { csv }) === true; }
    catch (error) { onError(error); }
    current = { csv, savedAt: new Date().toISOString(), persisted, source: 'download' };
    onData(current);
    return { data: current, offline: false, updated: true };
  }
  return { data: current, offline: false, updated: false, error: lastError };
}
