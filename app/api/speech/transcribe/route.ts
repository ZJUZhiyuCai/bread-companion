import { idSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { assertAppRequest, errorResponse, readBytes, timingHeaders } from '@/server/http';
import { timeoutSignal } from '@/server/limits';
import { admit } from '@/server/admission';
import { withCircuit } from '@/server/resilience';
import { transcribe } from '@/server/providers/speech';
import { withAbort } from '@/lib/abort';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const started = performance.now();
  let requestId = crypto.randomUUID() as string; let release: (() => Promise<void>) | undefined;
  try {
    assertAppRequest(req);
    if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data;')) throw new AppError('INVALID_INPUT', 415);
    // 65 seconds of supported 16 kHz mono PCM plus a bounded multipart envelope.
    const bytes = await readBytes(req, 44 + 65 * 32000 + 8192);
    const body = new Request(req.url, { method: 'POST', headers: { 'Content-Type': req.headers.get('content-type')! }, body: bytes as BodyInit });
    let form: FormData;
    try { form = await body.formData(); } catch { throw new AppError('INVALID_INPUT'); }
    const parsed = idSchema.safeParse(form.get('requestId'));
    if (!parsed.success) throw new AppError('INVALID_INPUT'); requestId = parsed.data;
    const file = form.get('file'); if (!(file instanceof File)) throw new AppError('INVALID_INPUT');
    const signal = timeoutSignal(req.signal, config().speechTimeout);
    release = await admit(req, 'asr', requestId, signal);
    const providerStart = performance.now();
    const text = await withCircuit('asr', () => withAbort(transcribe(file, signal), signal));
    signal.throwIfAborted();
    return Response.json({ requestId, text, confirmed: false }, { headers: timingHeaders(started, requestId, performance.now() - providerStart) });
  } catch (e) { return errorResponse(e, requestId, 'transcribe'); } finally { await release?.(); }
}
