import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualService, MockProvider, validatePng } from '../src/core.ts';
import type { Storage, ImageProvider, Ratio } from '../src/core.ts';
class MemoryStorage implements Storage {
  files = new Map<string,Uint8Array>();
  async read(path:string){const b=this.files.get(path);if(!b)throw new Error('secret storage');return b.slice();}
  async write(path:string,data:Uint8Array){this.files.set(path,data.slice());}
  async exists(path:string){return this.files.has(path);}
}
const input = {task:'Make a useful page PRIVATE_TASK_CONTEXT', assets:[{purpose:'hero',subject:'A forest',placement:'top'}]};
const ref=(p:Awaited<ReturnType<VisualService['plan']>>)=>({planId:p.id,assetId:p.assets[0].id});
test('mock creates actual labeled RGB PNGs for all supported ratios',async()=>{for(const ratio of ['1:1','16:9','4:3'] as Ratio[]){const out=await new MockProvider().generate({prompt:'test',ratio,model:'mock-v1'});assert.equal(out.mock,true);const d=validatePng(out.bytes);const [w,h]=ratio.split(':').map(Number);assert.equal(d.width*h,d.height*w);assert.equal(d.sha256.length,64);const bad=out.bytes.slice();bad[50]^=1;assert.throws(()=>validatePng(bad),/INVALID_PNG/);}});
test('configured model is persisted, passed to provider and cannot silently change',async()=>{
  const storage=new MemoryStorage();
  let received='';
  const provider:ImageProvider={id:'custom-provider',async generate(input){received=input.model;return new MockProvider().generate({...input,model:'mock-v1'});}};
  const service=new VisualService(storage,'owner',{mode:'auto',model:'image-model-a',provider});
  const plan=await service.plan(input);
  assert.equal(plan.assets[0].modelId,'image-model-a');
  await assert.rejects(new VisualService(storage,'owner',{mode:'auto',model:'image-model-b',provider}).generate(ref(plan)),/MODEL_MISMATCH/);
  assert.equal((await new VisualService(storage,'owner').inspect(plan.id)).assets[0].status,'planned');
  await service.generate(ref(plan));
  assert.equal(received,'image-model-a');
  assert.throws(()=>new VisualService(storage,'other',{mode:'auto',model:'image-model-a',provider:new MockProvider()}),/INVALID_MODEL/);
});

test('budget is owner-wide and persists across instances',async()=>{const s=new MemoryStorage(),v=new VisualService(s,'owner',{mode:'auto',maxAssets:2});await v.plan(input);await v.plan(input);await assert.rejects(v.plan(input),/ASSET_LIMIT/);await assert.rejects(new VisualService(s,'owner',{mode:'auto',maxAssets:2}).plan(input),/ASSET_LIMIT/);await new VisualService(s,'other',{mode:'auto',maxAssets:2}).plan(input);});
test('duplicates reuse verified output, finalize only declares usage',async()=>{const s=new MemoryStorage();let calls=0;const mock=new MockProvider();const provider:ImageProvider={id:'test',async generate(i){calls++;return mock.generate(i);}};const v=new VisualService(s,'owner',{mode:'auto',provider});const p=await v.plan(input);const [a,b]=await Promise.all([v.generate(ref(p)),v.generate(ref(p))]);assert.equal(calls,1);assert.deepEqual(a,b);await s.write('page.html',Buffer.from('no image actually embedded'));const final=await v.finalize({...ref(p),target:'page.html'});assert.equal(final.usage?.verification,'existence-and-hash-only');assert.match(final.usage!.declaration,/MOCK TEST/);assert.equal((await new VisualService(s,'owner').inspect(p.id)).assets[0].status,'finalized');await s.write(a.path!,Buffer.from('tampered'));await assert.rejects(v.generate(ref(p)),/INVALID_PNG/);});
test('cancellation before and during provider call never retries',async()=>{const s=new MemoryStorage();const c=new AbortController();let calls=0;const provider:ImageProvider={id:'cancel',async generate(i){calls++;c.abort();return new MockProvider().generate({...i,signal:undefined});}};const v=new VisualService(s,'owner',{mode:'auto',provider});const p=await v.plan(input);assert.equal((await v.generate(ref(p),c.signal)).status,'cancelled');assert.equal(calls,1);await assert.rejects(v.generate(ref(p)),/GENERATION_NOT_RETRYABLE/);const p2=await v.plan(input);assert.equal((await v.generate(ref(p2),c.signal)).status,'cancelled');assert.equal(calls,1);});
test('provider secrets are redacted and uncertainty is not retried',async()=>{const s=new MemoryStorage();let calls=0;const provider:ImageProvider={id:'bad',async generate(){calls++;throw new Error('SECRET API KEY');}};const v=new VisualService(s,'owner',{mode:'auto',provider});const p=await v.plan(input);const a=await v.generate(ref(p));assert.equal(a.status,'uncertain');assert.equal(a.code,'PROVIDER_ERROR');assert.doesNotMatch(JSON.stringify(a),/SECRET/);await assert.rejects(v.generate(ref(p)),/GENERATION_NOT_RETRYABLE/);assert.equal(calls,1);});
test('invalid provider output fails without leaking detail',async()=>{const provider:ImageProvider={id:'bad',async generate(){return {bytes:new Uint8Array([1]),mime:'image/png',mock:false};}};const v=new VisualService(new MemoryStorage(),'owner',{mode:'auto',provider});const p=await v.plan(input);assert.equal((await v.generate(ref(p))).status,'failed');});
test('unsafe ids, empty fields and forbidden modes',async()=>{const s=new MemoryStorage(),v=new VisualService(s,'owner');await assert.rejects(v.inspect('../state'),/INVALID_ID/);await assert.rejects(v.plan({...input,task:' '}),/INVALID_INPUT/);const p=await v.plan(input);await assert.rejects(v.generate(ref(p)),/MODE_SUGGEST/);const off=new VisualService(s,'owner',{mode:'off'});assert.equal((await off.inspect(p.id)).id,p.id);await assert.rejects(off.plan(input),/MODE_OFF/);await assert.rejects(off.generate(ref(p)),/MODE_OFF/);await assert.rejects(off.finalize(ref(p)),/MODE_OFF/);});
test('persisted generating reload becomes uncertain without duplicate request',async()=>{const s=new MemoryStorage();let release!:()=>void;const gate=new Promise<void>(r=>release=r);const provider:ImageProvider={id:'wait',async generate(i){await gate;return new MockProvider().generate(i);}};const v=new VisualService(s,'owner',{mode:'auto',provider});const p=await v.plan(input);const pending=v.generate(ref(p));await new Promise<void>(r=>setImmediate(r));const other=new VisualService(s,'owner',{mode:'auto'});assert.equal((await other.inspect(p.id)).assets[0].status,'uncertain');await assert.rejects(other.generate(ref(p)),/GENERATION_NOT_RETRYABLE/);release();await pending;});


test('default budget is three and no implicit mock is configured', async () => {
  const storage = new MemoryStorage();
  const service = new VisualService(storage, 'owner', { mode: 'auto' });
  const plan = await service.plan(input);
  assert.equal(plan.assets[0].providerId, null);
  await assert.rejects(service.generate(ref(plan)), /PROVIDER_NOT_CONFIGURED/);
  assert.equal((await service.inspect(plan.id)).assets[0].status, 'planned');
  await service.plan(input);
  await service.plan(input);
  await assert.rejects(service.plan(input), /ASSET_LIMIT/);
});

test('persisted prompt is deterministic, scene-specific and minimizes task context', async () => {
  const storage = new MemoryStorage();
  let actual = '';
  const provider: ImageProvider = { id: 'explicit-mock', async generate(i) {
    actual = i.prompt;
    return new MockProvider().generate(i);
  } };
  const service = new VisualService(storage, 'owner', { mode: 'auto', provider });
  const plan = await service.plan(input);
  const asset = plan.assets[0];
  assert.equal(asset.providerId, 'explicit-mock');
  assert.ok(Number.isFinite(Date.parse(asset.createdAt)));
  assert.match(asset.prompt, /Subject: A forest/);
  assert.match(asset.prompt, /Placement: top/);
  assert.match(asset.prompt, /Aspect ratio: 1:1/);
  assert.match(asset.prompt, /No text, lettering, watermarks, or unrelated\/existing brand marks; an original logo symbol is allowed when purpose requests it/);
  assert.doesNotMatch(asset.prompt, /PRIVATE_TASK_CONTEXT/);
  const reloaded = new VisualService(storage, 'owner', { mode: 'auto', provider });
  assert.equal((await reloaded.inspect(plan.id)).assets[0].prompt, asset.prompt);
  const generated = await reloaded.generate(ref(plan));
  assert.equal(actual, asset.prompt);
  await assert.rejects(reloaded.finalize(ref(plan)), /TARGET_REQUIRED/);
  await assert.rejects(reloaded.finalize({ ...ref(plan), target: generated.path }), /INVALID_TARGET/);
});

test('corrupt persisted metadata is rejected before use', async () => {
  const corruptions = [
    (s: any) => { s.plans[0].assets[0].status = 'invented'; },
    (s: any) => { s.plans[0].assets[0].subject = ''; },
    (s: any) => { s.plans[0].assets[0].prompt = 'altered'; },
    (s: any) => { s.plans[0].assets[0].createdAt = 'yesterday'; },
    (s: any) => { s.plans[0].assets[0].providerId = 42; },
    (s: any) => { s.plans[0].assets.push(s.plans[0].assets[0]); },
    (s: any) => { s.plans.push(s.plans[0]); },
    (s: any) => { s.plans[0].assets[0].path = '../outside'; },
    (s: any) => { s.plans[0].assets[0].unexpected = true; },
    (s: any) => { s.plans = Array(1001).fill(s.plans[0]); },
  ];
  for (const corrupt of corruptions) {
    const storage = new MemoryStorage();
    const plan = await new VisualService(storage, 'owner').plan(input);
    const path = [...storage.files.keys()][0];
    const state = JSON.parse(Buffer.from(await storage.read(path)).toString());
    corrupt(state);
    await storage.write(path, Buffer.from(JSON.stringify(state)));
    await assert.rejects(new VisualService(storage, 'owner').inspect(plan.id), /INVALID_STATE/);
  }
});

test('failed writes discard cached mutations rather than leaking unsaved plans', async () => {
  const storage = new MemoryStorage();
  const original = storage.write.bind(storage);
  let reject = true;
  storage.write = async (path, bytes) => {
    if (reject) throw new Error('secret disk detail');
    await original(path, bytes);
  };
  const service = new VisualService(storage, 'owner', { maxAssets: 1 });
  await assert.rejects(service.plan(input), /^VisualError: STORAGE_ERROR$/);
  reject = false;
  const plan = await service.plan(input);
  assert.equal(plan.assets.length, 1);
});
