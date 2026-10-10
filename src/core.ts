import { createHash, randomUUID } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export interface Storage { read(path: string): Promise<Uint8Array>; write(path: string, data: Uint8Array): Promise<void>; exists(path: string): Promise<boolean> }
export type Ratio = '1:1' | '16:9' | '4:3';
export interface ImageProvider { id: string; validate?(input: { ratio: Ratio; model: string }): void; generate(input: { prompt: string; ratio: Ratio; model: string; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; mime: 'image/png'; mock: boolean }> }
export interface AssetInput { purpose: string; subject: string; style?: string; placement: string; ratio?: Ratio; required?: boolean }
export interface PlanInput { task: string; assets: AssetInput[] }
export interface VisualOptions { maxAssets?: number; mode?: 'off' | 'suggest' | 'auto'; model?: string; provider?: ImageProvider }
export type AssetStatus = 'planned' | 'generating' | 'generated' | 'finalized' | 'failed' | 'cancelled' | 'uncertain';
export interface VisualAsset extends AssetInput { id: string; prompt: string; promptVersion: 1; providerId: string | null; modelId?: string; createdAt: string; ratio: Ratio; status: AssetStatus; code?: string; path?: string; sha256?: string; mime?: 'image/png'; mock?: boolean; width?: number; height?: number; usage?: { target: string; location: string; verification: 'existence-and-hash-only'; declaration: string } }
export interface VisualPlan { id: string; task: string; assets: VisualAsset[] }
interface State { version: 1; plans: VisualPlan[] }
export class VisualError extends Error { code: string; constructor(code: string) { super(code); this.name = 'VisualError'; this.code = code; } }
function fail(code: string): never { throw new VisualError(code); }
function text(value: unknown, max = 2000): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INVALID_INPUT'); return value; }
function uuid(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('INVALID_ID'); return value; }
function ratio(value: unknown): Ratio { if (value !== '1:1' && value !== '16:9' && value !== '4:3') fail('INVALID_RATIO'); return value; }
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc(b: Uint8Array): number { let c = 0xffffffff; for (const v of b) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer): Buffer { const body = Buffer.concat([Buffer.from(type),data]); const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); body.copy(out,4); out.writeUInt32BE(crc(body),out.length-4); return out; }
/** Validates a deliberately bounded PNG subset: non-interlaced, 8-bit grayscale/RGB/gray-alpha/RGBA. */
export function validatePng(bytes: Uint8Array): { width: number; height: number; sha256: string } {
  try {
    const b = Buffer.from(bytes); if (b.length > 16 * 1024 * 1024 || !b.subarray(0,8).equals(signature)) fail('INVALID_PNG');
    let pos = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataClosed = false; const parts: Buffer[] = [];
    while (pos < b.length) {
      if (pos + 12 > b.length) fail('INVALID_PNG'); const len = b.readUInt32BE(pos); if (len > b.length - pos - 12) fail('INVALID_PNG');
      const type = b.toString('ascii',pos+4,pos+8), data = b.subarray(pos+8,pos+8+len);
      if (!/^[A-Za-z]{4}$/.test(type) || crc(b.subarray(pos+4,pos+8+len)) !== b.readUInt32BE(pos+8+len)) fail('INVALID_PNG');
      if (pos === 8 && type !== 'IHDR') fail('INVALID_PNG');
      if (type === 'IHDR') { if (width || len !== 13) fail('INVALID_PNG'); width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = ({0:1,2:3,4:2,6:4} as Record<number,number>)[data[9]]; if (!width || !height || width > 4096 || height > 4096 || !channels || data[8] !== 8 || data[10] || data[11] || data[12]) fail('INVALID_PNG'); }
      else if (type === 'IDAT') { if (dataClosed) fail('INVALID_PNG'); seenData = true; parts.push(data); }
      else { if (seenData) dataClosed = true; if (type === 'IEND') { if (len || !seenData || pos + 12 !== b.length) fail('INVALID_PNG'); ended = true; } else if (type === 'PLTE') { if (seenData || len === 0 || len > 768 || len % 3) fail('INVALID_PNG'); } else if (type[0] === type[0].toUpperCase()) fail('INVALID_PNG'); }
      pos += len + 12;
    }
    const stride = width * channels + 1, expected = stride * height;
    if (!ended || expected > 32 * 1024 * 1024) fail('INVALID_PNG');
    const inflated = inflateSync(Buffer.concat(parts), { maxOutputLength: expected + 1 });
    if (inflated.length !== expected) fail('INVALID_PNG'); for (let y = 0; y < height; y++) if (inflated[y*stride] > 4) fail('INVALID_PNG');
    return { width, height, sha256: hash(bytes) };
  } catch { return fail('INVALID_PNG'); }
}
export class MockProvider implements ImageProvider {
  readonly id = 'mock';
  async generate(input: { prompt: string; ratio: Ratio; model: string; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; mime: 'image/png'; mock: boolean }> {
    if (input.model !== 'mock-v1') fail('INVALID_MODEL');
    if (input.signal?.aborted) fail('CANCELLED');
    const [w,h] = ({'1:1':[256,256], '16:9':[384,216], '4:3':[320,240]} as const)[ratio(input.ratio)];
    const stride = 1+w*3, raw = Buffer.alloc(stride*h,235); for (let y=0;y<h;y++) raw[y*stride]=0;
    const glyphs: Record<string,string[]> = {M:['10001','11011','10101','10001','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],C:['01111','10000','10000','10000','10000','10000','01111'],K:['10001','10010','10100','11000','10100','10010','10001'],T:['11111','00100','00100','00100','00100','00100','00100'],E:['11111','10000','10000','11110','10000','10000','11111'],S:['01111','10000','10000','01110','00001','00001','11110']};
    const label='MOCK TEST', scale=4, left=Math.floor((w-(label.length*6-1)*scale)/2), top=Math.floor((h-7*scale)/2);
    for (let i=0;i<label.length;i++) { const g=glyphs[label[i]]; if (!g) continue; for(let y=0;y<7;y++) for(let x=0;x<5;x++) if(g[y][x]==='1') for(let dy=0;dy<scale;dy++) for(let dx=0;dx<scale;dx++) { const at=(top+y*scale+dy)*stride+1+(left+(i*6+x)*scale+dx)*3; raw[at]=180;raw[at+1]=20;raw[at+2]=35; } }
    const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
    return { bytes:Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]),mime:'image/png',mock:true };
  }
}
export class VisualService {
  private storage: Storage; private options: { maxAssets: number; mode: 'off' | 'suggest' | 'auto'; model: string; provider?: ImageProvider }; private root: string; private state?: State; private queue: Promise<unknown> = Promise.resolve();
  constructor(storage: Storage, owner: string, options: VisualOptions = {}) {
    text(owner,512); const maxAssets=options.maxAssets ?? 3; if (!Number.isSafeInteger(maxAssets) || maxAssets<1 || maxAssets>1000) fail('INVALID_INPUT'); const mode=options.mode ?? 'suggest'; if (!['off','suggest','auto'].includes(mode)) fail('INVALID_INPUT'); const model=text(options.model ?? 'mock-v1',100);
    this.storage = storage;
    this.options = { maxAssets, mode, model, provider: options.provider };
    if (options.provider) {
      text(options.provider.id, 100);
      if (options.provider instanceof MockProvider && model !== 'mock-v1') fail('INVALID_MODEL');
      if (typeof options.provider.generate !== 'function') fail('INVALID_INPUT');
    }
    this.root = `.dsh-auto-visual/${hash(owner)}/`;
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T> { const p=this.queue.then(async()=>{try{return await fn();}catch(e){this.state = undefined;if(e instanceof VisualError)throw e;throw new VisualError('STORAGE_ERROR');}});this.queue=p.catch(()=>{});return p; }
  private prompt(a: AssetInput): string {
    return [
      'Create a scene-specific image for the following purpose and placement.',
      `Purpose: ${a.purpose}`,
      `Subject: ${a.subject}`,
      `Style: ${a.style ?? 'unspecified'}`,
      `Placement: ${a.placement}`,
      `Aspect ratio: ${a.ratio ?? '1:1'}`,
      'No text, lettering, watermarks, or unrelated/existing brand marks; an original logo symbol is allowed when purpose requests it. An explicitly selected mock provider must instead label its test output MOCK TEST.',
    ].join('\n');
  }
  private target(value: unknown): string {
    const path = text(value, 4096);
    if (path.includes('\\') || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || /^[a-zA-Z]:/.test(path)) fail('INVALID_TARGET');
    return path;
  }
  private async load(): Promise<State> {
    if (this.state) return this.state;
    let state: State = { version: 1, plans: [] };
    if (await this.storage.exists(this.root + 'state.json')) {
      try {
        const bytes = await this.storage.read(this.root + 'state.json');
        if (bytes.length > 16 * 1024 * 1024) fail('INVALID_STATE');
        state = JSON.parse(Buffer.from(bytes).toString());
        const keys = (obj: object, allowed: string[]) => {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k => !allowed.includes(k))) fail('INVALID_STATE');
        };
        keys(state, ['version', 'plans']);
        if (state.version !== 1 || !Array.isArray(state.plans) || state.plans.length > 1000) fail('INVALID_STATE');
        const ids = new Set<string>();
        let count = 0;
        const unique = (id: string) => { uuid(id); const key = id.toLowerCase(); if (ids.has(key)) fail('INVALID_STATE'); ids.add(key); };
        for (const p of state.plans) {
          keys(p, ['id', 'task', 'assets']);
          unique(p.id);
          text(p.task, 8000);
          if (!Array.isArray(p.assets) || !p.assets.length || (count += p.assets.length) > 1000) fail('INVALID_STATE');
          for (const a of p.assets) {
            keys(a, ['id','purpose','subject','style','placement','ratio','required','prompt','promptVersion','providerId','modelId','createdAt','status','code','path','sha256','mime','mock','width','height','usage']);
            unique(a.id);
            text(a.purpose); text(a.subject); text(a.placement); ratio(a.ratio);
            if (a.style !== undefined) text(a.style);
            if (a.required !== undefined && typeof a.required !== 'boolean') fail('INVALID_STATE');
            if (a.promptVersion !== 1 || a.prompt !== this.prompt(a)) fail('INVALID_STATE');
            if (a.providerId !== null) text(a.providerId, 100);
            if (a.modelId !== undefined) text(a.modelId, 100);
            if (typeof a.createdAt !== 'string' || !Number.isFinite(Date.parse(a.createdAt)) || new Date(a.createdAt).toISOString() !== a.createdAt) fail('INVALID_STATE');
            if (!['planned','generating','generated','finalized','failed','cancelled','uncertain'].includes(a.status)) fail('INVALID_STATE');
            if (a.code !== undefined && !['CANCELLED','PROVIDER_ERROR','INVALID_OUTPUT','STORAGE_ERROR','INTERRUPTED'].includes(a.code)) fail('INVALID_STATE');
            const generated = a.status === 'generated' || a.status === 'finalized';
            if (generated) {
              if (a.path !== this.assetPath(p.id, a.id) || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || a.mime !== 'image/png' || typeof a.mock !== 'boolean') fail('INVALID_STATE');
              if (!Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width! < 1 || a.height! < 1 || a.width! > 4096 || a.height! > 4096) fail('INVALID_STATE');
              const [rw, rh] = a.ratio.split(':').map(Number);
              if (a.width! * rh !== a.height! * rw || a.providerId === null || a.code !== undefined) fail('INVALID_STATE');
            } else if (['path','sha256','mime','mock','width','height','usage'].some(k => k in a)) fail('INVALID_STATE');
            if (a.status === 'finalized') {
              keys(a.usage!, ['target','location','verification','declaration']);
              if (this.target(a.usage!.target) === a.path || a.usage!.verification !== 'existence-and-hash-only' || a.usage!.declaration !== this.declaration(a.mock!)) fail('INVALID_STATE');
              text(a.usage!.location);
            } else if (a.usage !== undefined) fail('INVALID_STATE');
            if (['failed','cancelled','uncertain'].includes(a.status) && a.code === undefined) fail('INVALID_STATE');
            if (['planned','generating'].includes(a.status) && a.code !== undefined) fail('INVALID_STATE');
            if (a.status !== 'planned' && a.providerId === null) fail('INVALID_STATE');
            if (a.status === 'generating') { a.status = 'uncertain'; a.code = 'INTERRUPTED'; }
          }
        }
      } catch { fail('INVALID_STATE'); }
    }
    this.state = state;
    return state;
  }
  private declaration(mock: boolean): string {
    return mock ? 'MOCK TEST image; not a real generated visual. Usage declared by caller; embedding not verified.' : 'Usage declared by caller; embedding not verified.';
  }
  private async save(): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(this.state));
    if (bytes.length > 16 * 1024 * 1024) fail('STATE_LIMIT');
    await this.storage.write(this.root + 'state.json', bytes);
  }
  private mutable():void {if(this.options.mode==='off')fail('MODE_OFF');}
  private async lookup(planId:string,assetId?:string):Promise<{plan:VisualPlan;asset?:VisualAsset}>{uuid(planId);if(assetId!==undefined)uuid(assetId);const state=await this.load();const plan=state.plans.find(p=>p.id===planId);if(!plan)fail('NOT_FOUND');const asset=assetId===undefined?undefined:plan.assets.find(a=>a.id===assetId);if(assetId!==undefined&&!asset)fail('NOT_FOUND');return {plan,asset};}
  private output<T>(value:T):T{return JSON.parse(JSON.stringify(value));}
  private assetPath(planId:string,assetId:string):string{return `${this.root}${uuid(planId)}/${uuid(assetId)}.png`;}
  private async verify(plan:VisualPlan,a:VisualAsset):Promise<void>{const path=this.assetPath(plan.id,a.id);if(a.path!==path||!await this.storage.exists(path))fail('ASSET_MISSING');const details=validatePng(await this.storage.read(path));if(details.sha256!==a.sha256)fail('HASH_MISMATCH');}
  plan(input:PlanInput):Promise<VisualPlan>{return this.serial(async()=>{this.mutable();text(input?.task,8000);if(!Array.isArray(input.assets)||!input.assets.length||input.assets.length>this.options.maxAssets)fail('INVALID_INPUT');const assets=input.assets.map(a=>{text(a?.purpose);text(a?.subject);text(a?.placement);if(a.style!==undefined)text(a.style);if(a.required!==undefined&&typeof a.required!=='boolean')fail('INVALID_INPUT');return {id:randomUUID(),prompt:this.prompt(a),promptVersion:1 as const,providerId:this.options.provider?.id ?? null,modelId:this.options.model,createdAt:new Date().toISOString(),purpose:a.purpose,subject:a.subject,placement:a.placement,...(a.style!==undefined?{style:a.style}:{}),...(a.required!==undefined?{required:a.required}:{}),ratio:ratio(a.ratio??'1:1'),status:'planned' as const};});const state=await this.load();if(state.plans.reduce((n,p)=>n+p.assets.length,0)+assets.length>this.options.maxAssets)fail('ASSET_LIMIT');const plan={id:randomUUID(),task:input.task,assets};state.plans.push(plan);await this.save();return this.output(plan);});}
  generate(input:{planId:string;assetId:string},signal?:AbortSignal):Promise<VisualAsset>{return this.serial(async()=>{this.mutable();if(this.options.mode!=='auto')fail('MODE_SUGGEST');const {plan,asset}=await this.lookup(input.planId,input.assetId);const a=asset!;if(a.status==='generated'||a.status==='finalized'){await this.verify(plan,a);return this.output(a);}if(a.status!=='planned')fail('GENERATION_NOT_RETRYABLE');const provider=this.options.provider;if(!provider)fail('PROVIDER_NOT_CONFIGURED');if(a.providerId!==null&&a.providerId!==provider.id)fail('PROVIDER_MISMATCH');if((a.modelId??'mock-v1')!==this.options.model)fail('MODEL_MISMATCH');provider.validate?.({ratio:a.ratio,model:this.options.model});a.providerId=provider.id;if(signal?.aborted){a.status='cancelled';a.code='CANCELLED';await this.save();return this.output(a);}a.status='generating';await this.save();let result:Awaited<ReturnType<ImageProvider['generate']>>;
    try {result=await provider.generate({prompt:a.prompt,ratio:a.ratio,model:this.options.model,signal});}catch{a.status=signal?.aborted?'cancelled':'uncertain';a.code=signal?.aborted?'CANCELLED':'PROVIDER_ERROR';await this.save();return this.output(a);}
    if(signal?.aborted){a.status='cancelled';a.code='CANCELLED';await this.save();return this.output(a);}
    let details:ReturnType<typeof validatePng>;try{if(result.mime!=='image/png'||typeof result.mock!=='boolean'||!(result.bytes instanceof Uint8Array))fail('INVALID_PNG');if(this.options.provider instanceof MockProvider && !result.mock)fail('MOCK_REQUIRED');details=validatePng(result.bytes);const [rw,rh]=a.ratio.split(':').map(Number);if(details.width*rh!==details.height*rw)fail('INVALID_PNG');}catch{a.status='failed';a.code='INVALID_OUTPUT';await this.save();return this.output(a);}
    const path=this.assetPath(plan.id,a.id);try{await this.storage.write(path,result.bytes);Object.assign(a,details,{path,mime:'image/png',mock:result.mock,status:'generated'});await this.save();}catch{a.status='uncertain';a.code='STORAGE_ERROR';throw new VisualError('STORAGE_ERROR');}return this.output(a);
  });}
  finalize(input:{planId:string;assetId:string;target?:string;location?:string}):Promise<VisualAsset>{return this.serial(async()=>{this.mutable();const {plan,asset}=await this.lookup(input.planId,input.assetId);const a=asset!;if(a.status!=='generated'&&a.status!=='finalized')fail('NOT_GENERATED');if(input.target===undefined)fail('TARGET_REQUIRED');const target=this.target(input.target),location=text(input.location??a.placement);if(target===a.path)fail('INVALID_TARGET');await this.verify(plan,a);if(!await this.storage.exists(target))fail('TARGET_MISSING');a.usage={target,location,verification:'existence-and-hash-only',declaration:this.declaration(a.mock!)};a.status='finalized';await this.save();return this.output(a);});}
  inspect(planId:string):Promise<VisualPlan>{return this.serial(async()=>this.output((await this.lookup(planId)).plan));}
}
