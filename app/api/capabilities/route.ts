import { getCapabilities } from '@/server/config';
import { assertAppRequest, errorResponse, NO_STORE } from '@/server/http';
import { visitorHeaders } from '@/server/visitor';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try { assertAppRequest(req); return Response.json(getCapabilities(), { headers: { ...NO_STORE, ...visitorHeaders(req) } }); }
  catch (e) { return errorResponse(e, crypto.randomUUID(), 'capabilities'); }
}
