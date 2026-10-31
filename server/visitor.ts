import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import { serverEnv } from './runtime';

const COOKIE = '__Host-bread-visitor';
const TTL = 12 * 60 * 60;
export function publicOrigin(): string | undefined {
  const value = serverEnv().BREAD_PUBLIC_ORIGIN;
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) throw new Error();
    return url.origin;
  } catch { throw new AppError('PROVIDER_UNAVAILABLE', 503); }
}
function signature(value: string): string {
  const secret = serverEnv().BREAD_VISITOR_SECRET;
  if (!secret || secret.length < 32) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function verifiedVisitor(req: Request, now: number): string | null {
  const cookies = req.headers.get('cookie') ?? '';
  if (cookies.length > 8192) return null;
  const values = cookies.split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  const match = /^(v1\.([a-f0-9-]{36})\.(\d{10}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const issued = Number(match[3]);
  if (issued > now + 30 || now - issued >= TTL) return null;
  const expected = Buffer.from(signature(match[1]));
  if (!timingSafeEqual(expected, Buffer.from(match[4]))) return null;
  return signature('visitor:' + match[2]);
}
/** Only an opaque keyed identifier is used in the shared budget store. */
export function requestPrincipal(req: Request, now = Math.floor(Date.now() / 1000)): string {
  if (!publicOrigin()) return 'local';
  const principal = verifiedVisitor(req, now);
  if (!principal) throw new AppError('PERMISSION_DENIED', 403);
  return principal;
}
export function visitorHeaders(req: Request, now = Math.floor(Date.now() / 1000)): Record<string, string> {
  if (!publicOrigin() || verifiedVisitor(req, now)) return {};
  const value = `v1.${randomUUID()}.${now}`;
  return { 'Set-Cookie': `${COOKIE}=${value}.${signature(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}` };
}
