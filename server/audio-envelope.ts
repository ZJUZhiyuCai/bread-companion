import { AppError } from './errors';
import { readBytes } from './http';

export async function readAudioEnvelope(req: Request, metadataBytes = 8192): Promise<FormData> {
  if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data;')) throw new AppError('INVALID_INPUT', 415);
  const bytes = await readBytes(req, 44 + 65 * 32000 + metadataBytes);
  const body = new Request(req.url, { method: 'POST', headers: { 'Content-Type': req.headers.get('content-type')! }, body: bytes as BodyInit });
  try { return await body.formData(); } catch { throw new AppError('INVALID_INPUT'); }
}
