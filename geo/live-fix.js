// Somente para GPS ao vivo; simuladores podem usar relógios virtuais.
export function isFreshLiveFix(timestamp, now = Date.now()) {
  return Number.isFinite(timestamp) && timestamp > 0 &&
    timestamp <= now && now - timestamp <= 90000;
}
