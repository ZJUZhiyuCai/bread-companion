import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const base = process.env.BREAD_URL || 'http://127.0.0.1:3210';
const source = { id:'source_smoke',revision:1,origin:'user_recollection',label:'虚构面试回答',confirmed:true,text:'我应聘产品工程实习生。面试官问科研绘图 Agent 的 benchmark。我回答先收集二十个例子，让模型生成图片，再人工检查有没有画错。我没有解释通过标准。' };
const results=[];
await mkdir('.local',{recursive:true});
const capabilities = await fetch(base+'/api/capabilities').then(r=>r.json());
console.log('Capabilities:',JSON.stringify({agent:capabilities.agent,asr:capabilities.asr,tts:capabilities.tts}));
let practiceSetup;
for (const phase of ['listen','organize','review','practice-setup','practice']) {
 const mode=phase==='practice-setup'?'practice':phase;
 const id = crypto.randomUUID();
 const input={requestId:'request_'+id,sessionId:'session_smoke',runId:'run_'+id,epoch:0,contextRevision:1,mode,userMessage:mode==='listen'?'刚收到拒信。我准备了三天，最后只收到一句不合适。':phase==='practice-setup'?'陪我练一题，你来选题。':mode==='practice'?'我会明确正确率的计算方法，每张图检查元素、关系和标注。对于不确定的图让人工复核。':'请按当前模式处理这段我已确认的材料。',context:{summary:'',recentMessages:[],sources:[source],...(phase==='practice'?{selectedQuestion:practiceSetup?.question||'如何为科研绘图 Agent 设计 benchmark？',practiceCriteria:practiceSetup?.criteria||['评价标准','人工复核']}:{})}};
 if(phase==='practice') input.context.sources.push({id:'practice_answer',revision:1,origin:'user_recollection',label:'本次练习回答',confirmed:true,text:input.userMessage});
 const start=performance.now();
 const response=await fetch(base+'/api/agent/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const body=await response.json(); const row={mode,phase,status:response.status,seconds:+((performance.now()-start)/1000).toFixed(2),noStore:response.headers.get('cache-control'),body};results.push(row);
 if(phase==='practice-setup') practiceSetup=body.practiceSetup;
 console.log(JSON.stringify({mode,phase,practiceSetup:body.practiceSetup,status:row.status,seconds:row.seconds,reply:body.assistantText,error:body.error,findings:body.findings?.length,card:!!body.cardDraft}));
}
if(process.argv.includes('--speech')){
 const id=crypto.randomUUID(),start=performance.now();
 const response=await fetch(base+'/api/speech/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'request_'+id,sessionId:'session_smoke',runId:'run_'+id,epoch:0,contextRevision:0,text:'今晚，先说说。想停的时候，随时停。'})});
 if(response.ok){const bytes=new Uint8Array(await response.arrayBuffer());await writeFile('.local/smoke-tts.mp3',bytes);const row={mode:'tts',status:response.status,seconds:+((performance.now()-start)/1000).toFixed(2),bytes:bytes.length,mime:response.headers.get('content-type')};results.push(row);console.log(JSON.stringify(row));}
 else{const row={mode:'tts',status:response.status,body:await response.json()};results.push(row);console.log(JSON.stringify(row));}
}
await writeFile('.local/live-smoke.json',JSON.stringify({testedAt:new Date().toISOString(),results},null,2));
if(results.some(r=>r.status!==200)) process.exitCode=1;
