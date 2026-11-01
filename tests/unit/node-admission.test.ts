import {NextRequest} from 'next/server';
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAdmissionDatabase} from '../../deployment/node/sqlite.mjs';
import {withServerRuntime} from '@/server/runtime';
import {assertAppRequest} from '@/server/http';
import {acquireShared} from '@/server/admission';
const dirs:string[]=[];const databases:ReturnType<typeof openAdmissionDatabase>[]=[];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
function pair(){const dir=mkdtempSync(join(tmpdir(),'bread-admission-'));dirs.push(dir);const file=join(dir,'admission.sqlite');const a=openAdmissionDatabase(file),b=openAdmissionDatabase(file);databases.push(a,b);return {a,b};}
it('enforces duplicate IDs and shared concurrency across independent Node SQLite connections',async()=>{
 const {a,b}=pair();const now=100000000;
 const release=await acquireShared(a,'visitor','call','same',now);
 await expect(acquireShared(b,'visitor','companion','same',now)).rejects.toMatchObject({code:'DUPLICATE_REQUEST'});
 const second=await acquireShared(b,'visitor','call','second',now);
 await expect(acquireShared(a,'visitor','call','third',now)).rejects.toMatchObject({code:'RATE_LIMITED'});
 await release();const third=await acquireShared(b,'visitor','call','third',now);await second();await third();
 expect(await b.prepare('SELECT count(*) AS n FROM bread_requests WHERE active_until > 0').first()).toMatchObject({n:0});
});
it('rolls back a failed batch and cleans expired metadata on the next admission',async()=>{
 const {a,b}=pair();await expect(a.batch([a.prepare('INSERT INTO bread_requests VALUES (?,?,?,?,?,?)').bind('x','v','asr',0,0,1),a.prepare('INVALID SQL')])).rejects.toThrow();
 expect(await b.prepare('SELECT count(*) AS n FROM bread_requests').first()).toMatchObject({n:0});
 await (await acquireShared(a,'v','asr','old',1))();await (await acquireShared(b,'v','asr','new',90000000))();
 expect(await a.prepare('SELECT count(*) AS n FROM bread_requests').first()).toMatchObject({n:1});
});

it('accepts only the configured Node loopback URL while requiring the exact public host and origin',()=>{
 const origin='https://bread.example';const env={BREAD_PUBLIC_ORIGIN:origin};
 const req=new NextRequest('https://127.0.0.1:3220/api/capabilities',{headers:{Host:'bread.example',Origin:origin}});
 expect(()=>withServerRuntime({env},()=>assertAppRequest(req))).toThrow();
 expect(()=>withServerRuntime({env,nodeInternalOrigin:'https://127.0.0.1:3220'},()=>assertAppRequest(req))).not.toThrow();
 for(const bad of [new Request('https://127.0.0.1:3221/api/capabilities',{headers:{Host:'bread.example'}}),new Request(req.url,{headers:{Host:'evil.example'}}),new Request(req.url,{headers:{Host:'bread.example',Origin:'https://evil.example'}})])expect(()=>withServerRuntime({env,nodeInternalOrigin:'https://127.0.0.1:3220'},()=>assertAppRequest(bad))).toThrow();
});
