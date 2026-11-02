/** Same-origin elapsed minus server processing is an estimate, not a bandwidth measurement. */
export function networkDelayMs(elapsedMs: number, serverTiming: string | null): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > 60000 || !serverTiming || serverTiming.length > 1000) return;
  const match = /(?:^|,)\s*total\s*;\s*dur=(\d+(?:\.\d+)?)\s*(?=,|$)/i.exec(serverTiming);
  if (!match) return;
  const serverMs = Number(match[1]);
  if (serverMs > elapsedMs) return;
  return Math.min(5000, elapsedMs - serverMs);
}
