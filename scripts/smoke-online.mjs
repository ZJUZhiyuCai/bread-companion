import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
if (!argv.includes('--live')) {
  console.log('Dry run. Use --live --origin https://your-site --audio /absolute/path/to/synthetic.wav --output .local/online-smoke to make one paid ASR → model → TTS chain and non-billable boundary checks. No retries.');
  process.exit(0);
}
const option = name => argv[argv.indexOf(name) + 1];
for (const name of ['--origin', '--audio', '--output']) if (!argv.includes(name) || !option(name)) throw new Error(`Missing ${name}`);
const origin = new URL(option('--origin'));
if (origin.protocol !== 'https:' || origin.origin !== option('--origin')) throw new Error('Expected an exact HTTPS origin');
const destination = resolve(option('--output'));
await mkdir(destination, { recursive: true });
const report = { at: new Date().toISOString(), origin: origin.origin, fixture: 'Operator-selected synthetic WAV; no physical microphone', steps: [] };
let cookie = '';
async function request(path, init = {}, expected = 200) {
  const started = performance.now();
  const response = await fetch(origin.origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(45000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  report.steps.push({ path, status: response.status, expected, ms: Math.round(performance.now() - started), bytes: bytes.length, serverTiming: response.headers.get('server-timing') });
  if (response.status !== expected) throw new Error(`${path}: HTTP ${response.status}; ${new TextDecoder().decode(bytes).slice(0,400)}`);
  return { response, bytes };
}
const json = value => JSON.parse(new TextDecoder().decode(value.bytes));
const post = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin.origin, Cookie: cookie, ...extra }, body: JSON.stringify(body) });
try {
  const capsResult = await request('/api/capabilities');
  cookie = (capsResult.response.headers.get('set-cookie') || '').split(';')[0];
  const caps = json(capsResult);
  if (!cookie.startsWith('__Host-bread-visitor=') || caps.agent.mode !== 'real' || !caps.agent.configured || !caps.asr.available || !caps.tts.available) throw new Error('Expected signed anonymous visit and real configured services');
  report.providers = { agent: caps.agent, asr: caps.asr, tts: caps.tts };
  // Reject before any upstream invocation. Never log the cookie.
  await request('/api/agent/turn', post({}, { Cookie: '' }), 403);
  await request('/api/agent/turn', post({}, { Origin: 'https://other.example' }), 403);
  await request('/api/agent/turn', post({}, { Origin: '' }), 403);
  await request('/api/agent/turn', post({}), 400);
  const wav = await readFile(resolve(option('--audio')));
  report.fixtureSha256 = createHash('sha256').update(wav).digest('hex');
  const form = new FormData();
  form.append('requestId', randomUUID());
  form.append('file', new File([wav], 'synthetic.wav', { type: 'audio/wav' }));
  const transcript = json(await request('/api/speech/transcribe', { method: 'POST', headers: { Origin: origin.origin, Cookie: cookie }, body: form }));
  if (!transcript.text?.trim()) throw new Error('Empty transcript');
  report.transcript = transcript.text;
  const run = { sessionId: randomUUID(), runId: randomUUID(), epoch: 0, contextRevision: 0 };
  const turn = { ...run, requestId: randomUUID(), mode: 'listen', channel: 'call', userMessage: transcript.text, context: { summary: '', recentMessages: [], sources: [], preferences: { advice: 'on_request', questions: 'avoid' } } };
  const reply = json(await request('/api/agent/turn', post(turn)));
  if (reply.serviceMode !== 'real' || !reply.assistantText?.trim()) throw new Error('No real reply');
  report.assistantText = reply.assistantText;
  // Same paid request is rejected across agent lanes, without replay or second generation.
  await request('/api/agent/turn', post({ ...turn, channel: 'text' }), 409);
  const audio = await request('/api/speech/synthesize', post({ ...run, requestId: randomUUID(), text: reply.assistantText }));
  if (!audio.response.headers.get('content-type')?.startsWith('audio/mpeg') || audio.bytes.length < 1000) throw new Error('Invalid synthesized audio');
  await writeFile(resolve(destination, 'reply.mp3'), audio.bytes);
  report.audioSha256 = createHash('sha256').update(audio.bytes).digest('hex');
  report.completed = true;
  report.boundary = 'Real hosted HTTP chain and request guards; browser audio, physical microphones and acoustic echo are separate checks.';
} catch (error) {
  report.completed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
