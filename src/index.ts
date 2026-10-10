import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisualService, MockProvider, VisualError } from './core.ts';
import { OpenAIImageProvider } from './provider.ts';
import { createDshStorage } from './storage.ts';
import { guidance } from './guidance.ts';
import { VisualConnectionService } from './connection.ts';

export const name = 'auto-visual';
export const inject = ['tools', 'fs', 'sandboxPolicy', 'sandbox', 'subprocess', 'systemPrompt'];
export const Config = z.object({
  mode: z.union(['off', 'suggest', 'auto']).default('suggest').volatile(),
  provider: z.union(['disabled', 'mock', 'openai']).default('disabled').volatile(),
  model: z.string().min(1).max(100).default('mock-v1').volatile(),
  baseURL: z.string().default('https://api.openai.com/v1').volatile(),
  apiKey: z.string().max(8192).role('secret').default('').volatile(),
  // Retain the old config field for installed profile compatibility only.
  // Credentials are now read exclusively from apiKey.
  apiKeyEnv: z.string().default('OPENAI_API_KEY').volatile(),
  maxAssets: z.number().step(1).min(1).max(100).default(3).volatile(),
});

type Live<T> = T | { get(): T };
type Settings = { mode?: Live<'off'|'suggest'|'auto'>; provider?: Live<'disabled'|'mock'|'openai'>; model?: Live<string>; baseURL?: Live<string>; apiKey?: Live<string>; apiKeyEnv?: Live<string>; maxAssets?: Live<number> };
function read<T>(value: Live<T> | undefined, fallback: T): T {
  return value !== undefined && typeof value === 'object' && value !== null && 'get' in value ? value.get() : (value ?? fallback) as T;
}
export function apply(ctx: any, config: Settings = {}) {
  function settings() {
    const mode = read(config.mode, 'suggest');
    const provider = read(config.provider, 'disabled');
    const model = read(config.model, 'mock-v1');
    const baseURL = read(config.baseURL, 'https://api.openai.com/v1');
    const apiKey = read(config.apiKey, '');
    const maxAssets = read(config.maxAssets, 3);
    if (!['off','suggest','auto'].includes(mode) || !['disabled','mock','openai'].includes(provider) || typeof model !== 'string' || !model.trim() || model.length > 100 || typeof baseURL !== 'string' || baseURL.length > 2048 || typeof apiKey !== 'string' || apiKey.length > 8192 || !Number.isSafeInteger(maxAssets) || maxAssets < 1 || maxAssets > 100) throw new Error('AUTO_VISUAL_INVALID_CONFIG');
    if (provider === 'openai') { try { new URL(baseURL); } catch { throw new Error('AUTO_VISUAL_INVALID_CONFIG'); } }
    return {mode, provider, model, baseURL, apiKey, maxAssets};
  }
  const {mode, provider, model, baseURL, apiKey, maxAssets} = settings();
  new VisualConnectionService(ctx, () => {
    const current = settings();
    return {provider: current.provider, model: current.model, baseURL: current.baseURL, apiKey: current.apiKey};
  });
  // Live settings must be able to enable the tools without remounting the plugin.
  if (mode === 'off' && typeof config.mode !== 'object') return;
  ctx.systemPrompt.section({name:'auto-visual:guidance',order:2550,interpolate:false,text:guidance});
  const output = {
    schema: {type:'object',additionalProperties:false,properties:{result:{type:'json',required:true}}},
    render: (_args: any, value: any) => [{type:'text',text:JSON.stringify(value.result,null,2)}],
  };
  async function run(exec: any, action: (service: VisualService)=>Promise<unknown>) {
    if (!exec.agent?.session?.id) throw new Error('AUTO_VISUAL_AGENT_REQUIRED');
    const {mode, provider, model, baseURL, apiKey, maxAssets} = settings();
    if (mode === 'off') throw new VisualError('MODE_OFF');
    const storage = await createDshStorage(ctx,exec);
    return storage.withLock(async()=>{
      const imageProvider = provider === 'mock' ? new MockProvider() : provider === 'openai' ? new OpenAIImageProvider(baseURL, apiKey) : undefined;
      const service = new VisualService(storage,String(exec.agent.session.id),{mode,model,maxAssets,...(imageProvider?{provider:imageProvider}: {})});
      try { return {result:await action(service)}; }
      catch (error) { if(error instanceof VisualError) throw error; throw new Error('AUTO_VISUAL_OPERATION_FAILED'); }
    });
  }
  ctx.tools.register(defineTool({
    name:'visual_plan',
    description:'Plan useful original images for PPTs, websites or documents, organize prompts, and persist asset IDs. No image generation. Pass planId alone to recover existing plan status. Reuse suitable supplied assets instead of generating unnecessarily.',
    parameters:{
      planId:{type:'string',description:'Existing plan ID to inspect; do not combine with task/assets.'},
      task:{type:'string',description:'Brief task label. Do not include sensitive source documents.'},
      assets:{type:'array',items:{type:'object',additionalProperties:false,properties:{
        purpose:{type:'string',required:true,description:'Image purpose e.g. PPT cover, logo symbol, document illustration.'},
        subject:{type:'string',required:true,description:'Visual subject; do not include credentials or sensitive information.'},
        style:{type:'string',description:'Shared palette and visual style.'},
        placement:{type:'string',required:true,description:'Intended placement and whitespace/composition constraints.'},
        ratio:{type:'string',enum:['1:1','16:9','4:3']},
        required:{type:'boolean',description:'Whether this asset is necessary to complete the task.'},
      }}},
    },output,
    execute: (args: any,exec: any)=>run(exec,service=>{
      if(args.planId!==undefined){if(args.task!==undefined||args.assets!==undefined)throw new VisualError('INVALID_INPUT');return service.inspect(args.planId);}
      return service.plan({task:args.task,assets:args.assets});
    }),
  }));
  ctx.tools.register(defineTool({
    name:'visual_generate',
    description:'Generate one planned asset with the configured provider; reuse an intact existing result. Mock output is visibly labelled TEST and is not real model-generated artwork. Does not insert images into deliverables. Uncertain requests are not automatically retried.',
    parameters:{planId:{type:'string',required:true},assetId:{type:'string',required:true}},output,
    execute:(args: any,exec: any)=>run(exec,service=>service.generate(args,exec.signal)),
  }));
  ctx.tools.register(defineTool({
    name:'visual_finalize',
    description:'After applying an image using task tools, record its workspace-relative target and location. Checks asset integrity and target existence ONLY, not actual embedding or rendered quality. Mock assets remain test assets.',
    parameters:{planId:{type:'string',required:true},assetId:{type:'string',required:true},target:{type:'string',required:true,description:'Existing workspace-relative deliverable path, not the generated image itself.'},location:{type:'string',required:true,description:'Slide number, component, or document section actually using the image.'}},output,
    execute:(args: any,exec: any)=>run(exec,service=>service.finalize(args)),
  }));
}
