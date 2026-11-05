import { idSchema } from '@/domain/schemas';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { assertAppRequest, errorResponse, timingHeaders } from '@/server/http';
import { readAudioEnvelope } from '@/server/audio-envelope';
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
    // 65 seconds of supported 16 kHz mono PCM plus a bounded multipart envelope.
    const readStart = performance.now();
    const form = await readAudioEnvelope(req);
    const parsed = idSchema.safeParse(form.get('requestId'));
    if (!parsed.success) throw new AppError('INVALID_INPUT'); requestId = parsed.data;
    const file = form.get('file'); if (!(file instanceof File)) throw new AppError('INVALID_INPUT');
    const bodyMs = performance.now() - readStart;
    const signal = timeoutSignal(req.signal, config().speechTimeout);
    const admissionStart = performance.now();
    release = await admit(req, 'asr', requestId, signal);
    const admissionMs = performance.now() - admissionStart;
    const providerStart = performance.now();
    const text = await withCircuit('asr', () => withAbort(transcribe(file, signal), signal));
    signal.throwIfAborted();
    const headers = timingHeaders(started, requestId, performance.now() - providerStart);
    headers['Server-Timing'] += `, upload;dur=${bodyMs.toFixed(1)}, admission;dur=${admissionMs.toFixed(1)}`;
    return Response.json({ requestId, text, confirmed: false }, { headers });
  } catch (e) { return errorResponse(e, requestId, 'transcribe'); } finally { await release?.(); }
}
