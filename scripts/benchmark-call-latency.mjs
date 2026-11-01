// Opt-in, sequential synthetic calls. No private conversations, automatic retries or model races.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes('--live')) {
  console.log('node scripts/benchmark-call-latency.mjs --live --origin https://your-host --transport legacy|combined --output .local/call-latency');
  process.exit(0);
}
for (const name of ['--origin', '--transport', '--output']) if (!args.includes(name) || !option(name)) throw Error(`Missing ${name}`);
const origin = new URL(option('--origin')), transport = option('--transport'), destination = resolve(option('--output'));
if (origin.protocol !== 'https:' || origin.origin !== option('--origin') || !['legacy', 'combined'].includes(transport)) throw Error('Expected an exact HTTPS origin and legacy|combined transport');
await mkdir(destination, { recursive: true });
const capsResponse = await fetch(origin.origin + '/api/capabilities', { signal: AbortSignal.timeout(10000), redirect: 'error' });
const cookie = (capsResponse.headers.get('set-cookie') || '').split(';')[0], caps = await capsResponse.json();
if (!cookie.startsWith('__Host-bread-visitor=') || caps.agent.mode !== 'real' || !caps.tts.available || (transport === 'combined' && !caps.tts.turnStream)) throw Error('Expected a signed visit with real configured services');
const cases = [
  '准备了一周的面试，最后还是被拒了。我现在什么建议都不想听。',
  '我今天这个面试又出了点问题。',
  '今天不想复盘，也别问我问题，就想说说话。',
  '不是我没准备，是对方临时换了题，别再说我准备不足。',
];
const report = { at: new Date().toISOString(), origin: origin.origin, transport, synthetic: true, scope: 'Text-to-reply-and-audio HTTP latency; excludes endpoint detection, ASR, audio decoding and physical device playback. Four samples are not a long-term SLA.', cases: [] };
async function post(path, body) {
  const response = await fetch(origin.origin + path, { method: 'POST', redirect: 'error', headers: { Origin: origin.origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`HTTP ${response.status} at ${path}`);
  return response;
}
try {
  for (const [index, text] of cases.entries()) {
    const started = performance.now(), row = { case: index + 1, input: text, status: 'pending' };
    const request = { requestId: randomUUID(), sessionId: randomUUID(), runId: randomUUID(), epoch: 0, contextRevision: 0, mode: 'listen', channel: 'call', userMessage: text, context: { summary: '', recentMessages: [], sources: [], preferences: { advice: 'on_request', questions: 'avoid' } } };
    try {
      let bytes;
      if (transport === 'legacy') {
        const response = await post('/api/agent/turn', request), candidate = await response.json();
        if (candidate.requestId !== request.requestId || !candidate.assistantText) throw Error('Mismatched reply');
        row.replyMs = Math.round(performance.now() - started); row.reply = candidate.assistantText;
        row.agentTiming = response.headers.get('server-timing');
        const audio = await post('/api/speech/synthesize', { requestId: randomUUID(), sessionId: request.sessionId, runId: request.runId, epoch: 0, contextRevision: 0, text: candidate.assistantText });
        bytes = new Uint8Array(await audio.arrayBuffer()); row.speechTiming = audio.headers.get('server-timing');
      } else {
        const response = await post('/api/agent/voice', request), decoder = new TextDecoder(); let buffer = '', done = false;
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true }); let line;
          while ((line = buffer.indexOf('\n')) >= 0) {
            const event = JSON.parse(buffer.slice(0, line)); buffer = buffer.slice(line + 1);
            if (event.type === 'error') throw Error(event.error.code);
            if (event.type === 'candidate') {
              if (event.candidate.requestId !== request.requestId) throw Error('Mismatched reply');
              row.replyMs = Math.round(performance.now() - started); row.reply = event.candidate.assistantText;
            }
            if (event.type === 'audio') bytes = Buffer.from(event.audio, 'base64');
            if (event.type === 'done') { row.timing = event.timing; done = true; }
          }
        }
        if (!done) throw Error('Incomplete stream');
      }
      if (!bytes || bytes.length < 1000) throw Error('No synthesized speech');
      row.audioMs = Math.round(performance.now() - started); row.bytes = bytes.length; row.status = 'ok';
      await writeFile(resolve(destination, `case-${index + 1}.mp3`), bytes);
    } catch (error) { row.status = 'failed'; row.error = String(error); row.totalMs = Math.round(performance.now() - started); process.exitCode = 1; }
    report.cases.push(row);
    await writeFile(resolve(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(row));
  }
} finally {
  const times = report.cases.filter(c => c.status === 'ok').map(c => c.audioMs).sort((a, b) => a - b);
  report.summary = { successful: times.length, planned: cases.length, medianAudioMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null, maxAudioMs: times.at(-1) ?? null };
  await writeFile(resolve(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}
