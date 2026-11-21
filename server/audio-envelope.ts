import { AppError } from './errors';
import { readBytes } from './http';

export async function readAudioEnvelope(req: Request, maxBodyBytes: number) {
  if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data;')) throw new AppError('INVALID_INPUT', 415);
  const bytes = await readBytes(req, maxBodyBytes);
  const body = new Request(req.url, { method: 'POST', headers: { 'Content-Type': req.headers.get('content-type')! }, body: bytes as BodyInit });
  try { return { form: await body.formData(), byteLength: bytes.byteLength }; } catch { throw new AppError('INVALID_INPUT'); }
}
