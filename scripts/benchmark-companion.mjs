// Opt-in, sequential, synthetic API evaluation. Never an automated EQ score.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROMPT_VERSION } from '../prompts/agent.ts';

const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`); return args[i + 1]; }
if (args.includes('--help')) {
  console.log('node scripts/benchmark-companion.mjs --dry-run | --live [--app http://127.0.0.1:3210] [--out .local/companion-benchmark.json]');
  process.exit(0);
}
const suite = JSON.parse(await readFile(new URL('../evaluations/companion-scenarios.json', import.meta.url), 'utf8'));
const count = suite.cases.reduce((n, c) => n + c.turns.length, 0);
if (args.includes('--dry-run')) { console.log(JSON.stringify({version:suite.version,cases:suite.cases.length,turns:count,networkRequests:0})); process.exit(0); }
if (!args.includes('--live')) throw new Error('Pass --live to authorize provider calls, or --dry-run to inspect the synthetic suite.');
const base = new URL(option('--app', 'http://127.0.0.1:3210'));
if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname) || base.username || base.password || !['http:','https:'].includes(base.protocol)) throw new Error('Use a local Bread instance without credentials in the URL.');
const out = resolve(option('--out', '.local/companion-benchmark.json'));
const capabilities = await (await fetch(new URL('/api/capabilities',base),{signal:AbortSignal.timeout(10000)})).json();
if (capabilities.agent?.mode !== 'real') throw new Error('This suite measures a configured real provider. Mock results must not be published as model evaluation.');
const results = [];
const report = {
  suite:suite.version, testedAt:new Date().toISOString(), codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  promptVersion:PROMPT_VERSION, serviceLabel:capabilities.agent.label, synthetic:true,
  method:'One sequential sample per turn; actual preceding replies within each case; new session per case; bounded recent history passed directly to the API. Does not measure browser context selection, cross-day storage, voice latency, or competitors. No automatic EQ score.',
  results
};
await mkdir(dirname(out),{recursive:true});
for (const c of suite.cases) {
  const history = [], sessionId = `session_${crypto.randomUUID()}`;
  for (const [index,t] of c.turns.entries()) {
    const started = performance.now();
    const payload = {requestId:`request_${crypto.randomUUID()}`,sessionId,runId:`run_${crypto.randomUUID()}`,epoch:0,contextRevision:index+1,mode:'listen',channel:c.channel,userMessage:t.text,context:{summary:'',recentMessages:[...history,{role:'user',text:t.text}].slice(-16),sources:[]}};
    const row = {caseId:c.id,turn:index+1,channel:c.channel,input:t.text,expectation:t.expectation};
    try {
      const r=await fetch(new URL('/api/agent/turn',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)});
      const data=await r.json(); Object.assign(row,{status:r.status,ms:Math.round(performance.now()-started),reply:typeof data.assistantText==='string'?data.assistantText:null,errorCode:data.error?.code??null});
      history.push({role:'user',text:t.text}); if(row.reply)history.push({role:'assistant',text:row.reply});
    } catch(e) { Object.assign(row,{status:0,ms:Math.round(performance.now()-started),reply:null,errorCode:e.name}); }
    results.push(row);await writeFile(out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({caseId:c.id,turn:index+1,status:row.status,ms:row.ms}));
    // A broken preceding turn is not silently treated as a valid multi-turn chain.
    if(row.status!==200 || !row.reply)break;
  }
}
const durations=results.filter(r=>r.status===200).map(r=>r.ms).sort((a,b)=>a-b);
const n=durations.length;
report.summary={plannedTurns:count,completedTurns:results.length,successfulTurns:n,medianMs:n?(durations[Math.floor((n-1)/2)]+durations[Math.floor(n/2)])/2:null,p90Ms:n?durations[Math.ceil(n*.9)-1]:null,maxMs:n?durations[n-1]:null};
await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
if(n!==count)process.exitCode=1;
