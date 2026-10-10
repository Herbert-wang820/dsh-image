import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, Config} from '../src/index.ts';
import { Context } from '@deepseek-ai/cordis';

function context() {
  const tools: any[] = [], sections: any[] = [];
  const ctx = new Context({});
  ctx.provide('tools');
  ctx.provide('systemPrompt');
  ctx.set('tools', {register:(t:any)=>tools.push(t)});
  ctx.set('systemPrompt', {section:(s:any)=>sections.push(s)});
  return {tools, sections, ctx};
}
test('real DSH defineTool accepts all three tool schemas and canonical output',()=>{
  const {ctx,tools,sections}=context();
  apply(ctx,{mode:'suggest',provider:'disabled',maxAssets:3});
  assert.deepEqual(tools.map(t=>t.name),['visual_plan','visual_generate','visual_finalize']);
  assert.equal(sections.length,1);
  assert.match(sections[0].text,/Auto Visual/);
  for(const tool of tools){assert.equal(typeof tool.execute,'function'); assert.equal(tool.output.render({}, {result:{ok:true}})[0].type,'text');}
});
test('custom model settings remain editable while mock is selected',()=>{
  const {ctx,tools}=context();
  assert.doesNotThrow(()=>apply(ctx,{provider:'mock',model:'gpt-image-1'}));
  assert.equal(tools.length,3);
});
test('off registers nothing and unsafe config fails',()=>{
  const {ctx,tools,sections}=context(); apply(ctx,{mode:'off'});
  assert.equal(tools.length,0); assert.equal(sections.length,0);
  assert.throws(()=>apply(ctx,{maxAssets:0}),/INVALID_CONFIG/);
  assert.ok(Config);
});
test('volatile config changes are read by later tool executions',async()=>{
  let mode: 'off'|'suggest'|'auto' = 'suggest';
  let provider: 'disabled'|'mock' = 'disabled';
  let maxAssets = 3;
  const live = <T>(get:()=>T)=>({get});
  const {ctx,tools}=context();
  apply(ctx,{mode:live(()=>mode),provider:live(()=>provider),maxAssets:live(()=>maxAssets)});
  mode='off';
  await assert.rejects(()=>tools[0].execute({task:'x',assets:[]},{agent:{session:{id:'s'}}}),/MODE_OFF/);
  mode='auto'; provider='mock'; maxAssets=0;
  await assert.rejects(()=>tools[0].execute({task:'x',assets:[]},{agent:{session:{id:'s'}}}),/INVALID_CONFIG/);
});

test('agentless tool execution is refused',async()=>{
  const {ctx,tools}=context();apply(ctx);
  await assert.rejects(()=>tools[0].execute({task:'x',assets:[]},{}),/AGENT_REQUIRED/);
});
