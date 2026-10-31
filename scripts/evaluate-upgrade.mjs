// Explicit, paid live checks with synthetic material only. Not part of CI.
import { mkdir, writeFile } from 'node:fs/promises';
import { PROMPT_VERSION } from '../prompts/agent.ts';
const base = process.env.BREAD_URL || 'http://127.0.0.1:3210';
const cases = [
  { id: 'uncertain-alternatives', text: '可能是没睡够，也可能是今天消息太多，我也说不准为什么烦。', expectation: '保留不确定，不选定原因，不主动安排生活' },
  { id: 'delayed-response', text: 'HR说周五给答复，今天周六还没动静。也许只是忙吧，我不知道。', expectation: '不把忙或故意拖延说成事实' },
  { id: 'comparison-without-promise', text: '室友这周签了工作，我还没结果，有点不敢跟他一起吃饭。', expectation: '接住难处，不保证机会或贬低室友' },
  { id: 'ordinary-topic', text: '下楼闻到桂花味了，突然觉得今天还有一点好的。', expectation: '自然接小事，不评价人格或强行升华' },
  { id: 'old-explicit-preference', text: '今天就坐在窗边发了半天呆。', preferences: { advice: 'on_request', questions: 'avoid' }, expectation: '近期历史为空仍不追问、不建议' },
  { id: 'permission-changed', text: '现在可以问我一个轻松的问题。', preferences: { advice: 'on_request', questions: 'allowed' }, expectation: '遵循新偏好，只问一个轻松问题' },
];
const results = []; await mkdir('.local', { recursive: true });
for (const probe of cases) {
  const body = { requestId: 'request_' + crypto.randomUUID(), sessionId: 'session_upgrade_live', runId: 'run_' + crypto.randomUUID(), epoch: 0, contextRevision: 1, mode: 'listen', channel: 'text', userMessage: probe.text, context: { summary: '', recentMessages: [], sources: [], sourceSegments: [], preferences: probe.preferences ?? {} } };
  const started = performance.now();
  try {
    const res = await fetch(base + '/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    const response = await res.json();
    const result = { ...probe, status: res.status, ms: Math.round(performance.now() - started), timing: res.headers.get('server-timing'), response };
    results.push(result); console.log(JSON.stringify(result));
  } catch (e) { results.push({ ...probe, status: 0, error: e.name }); }
}
await writeFile('.local/upgrade-live-holdout.json', JSON.stringify({ synthetic: true, promptVersion: PROMPT_VERSION, testedAt: new Date().toISOString(), results }, null, 2));
if (results.some(r => r.status !== 200)) process.exitCode = 1;
