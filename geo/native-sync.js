/** Stable native radar payload: row order from CSV downloads must not invalidate road regions. */
export function buildNativeRadarCatalog(activeRadars) {
  const normalized = activeRadars.map(radar => ({
    id: String(radar.id), lat: Number(radar.lat), lng: Number(radar.lng),
    direction: radar.direction == null ? null : Number(radar.direction),
    limit: radar.limit == null ? null : Number(radar.limit),
    kind: String(radar.kind || 'FIXED'), active: Boolean(radar.active),
    source: String(radar.source || 'Pardal')
  }));
  // Calculate the key once per radar instead of JSON.stringify() at each comparison.
  return normalized.map(value => ({ value, key: JSON.stringify(value) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    .map(({ value }) => value);
}

/** Serialize catalog and regional writes so they cannot race across a dataset refresh. */
export function createNativeWriteQueue() {
  let tail = Promise.resolve();
  return {
    enqueue(task) {
      const job = tail.then(task);
      tail = job.catch(() => undefined); // One failed operation cannot block later repairs.
      return job;
    }
  };
}
