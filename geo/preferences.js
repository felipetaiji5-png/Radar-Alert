export const DEFAULT_SETTINGS = Object.freeze({
  voice: true, notifications: false, contrast: false, driveMode: true,
  volume: 100, far: 1000, mid: 500, near: 200
});

// Aceita somente valores que também podem ser escolhidos na interface.
export function normalizeSettings(input) {
  const saved = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = { ...DEFAULT_SETTINGS };
  for (const key of ['voice', 'notifications', 'contrast', 'driveMode']) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key];
  }
  if (Number.isFinite(saved.volume)) result.volume = Math.round(Math.max(0, Math.min(100, saved.volume)));
  for (const [key, options] of Object.entries({ far: [800, 1000, 1200], mid: [400, 500], near: [150, 200] })) {
    if (options.includes(saved[key])) result[key] = saved[key];
  }
  return result;
}

export function persistSettings(storage, key, input) {
  const settings = normalizeSettings(input);
  try {
    storage.setItem(key, JSON.stringify(settings));
    return { settings, persisted: true };
  } catch {
    return { settings, persisted: false };
  }
}
