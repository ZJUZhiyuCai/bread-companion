import { expect, it } from 'vitest';
import { networkDelayMs } from '@/services/network-timing';
import { retryAfterSeconds } from '@/server/providers/response';

it('estimates only the network portion, so slow model/server processing alone is not a slow link', () => {
  expect(networkDelayMs(1100, 'provider;dur=300, total;dur=420.5')).toBe(679.5);
  expect(networkDelayMs(5100, 'provider;dur=5000, total;dur=5050')).toBe(50);
  expect(networkDelayMs(12000, 'total;dur=20')).toBe(5000);
  for (const header of [null, 'provider;dur=500', 'total;dur=-20', 'total;dur=NaN', 'total;dur=2000', 'x'.repeat(1001)]) expect(networkDelayMs(1000, header)).toBeUndefined();
  expect(networkDelayMs(NaN, 'total;dur=1')).toBeUndefined();
});
it('respects relative and dated Retry-After values without turning malformed values into retries', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const delay = (value: string) => retryAfterSeconds(new Response(null, { headers: { 'Retry-After': value } }), now);
  expect(delay('20')).toBe(20); expect(delay('Mon, 02 Nov 2026 12:00:30 GMT')).toBe(30);
  expect(delay('999999')).toBe(86400);
  for (const value of ['', '-2', '1.5', 'oops', 'Mon, 02 Nov 2026 11:59:00 GMT']) expect(delay(value)).toBeUndefined();
});
