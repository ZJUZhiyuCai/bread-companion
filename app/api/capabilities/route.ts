import { getCapabilities } from '@/server/config';
import { assertLocalRequest, errorResponse, NO_STORE } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try { assertLocalRequest(req); return Response.json(getCapabilities(), { headers: NO_STORE }); }
  catch (e) { return errorResponse(e, crypto.randomUUID(), 'capabilities'); }
}
