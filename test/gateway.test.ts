import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway';
import * as autoVisual from '../src/index.ts';

// Use the installed registry and Gateway without a web server or transport mock.
// Only capabilities unrelated to the connection check are inert dependencies.
async function fixture(t: any, settings: Record<string, any>) {
  const ctx = new Context({});
  t.after(() => ctx.fiber.dispose());
  for (const name of ['fs', 'sandboxPolicy', 'sandbox', 'subprocess']) ctx.provide(name, {});
  ctx.provide('tools', { register() {} });
  ctx.provide('systemPrompt', { section() {} });
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(TypertGatewayService);
  await ctx.plugin(autoVisual, settings);
  assert.ok(ctx.typert, 'actual Typert registry must be mounted');
  assert.ok(ctx.typertGateway, 'actual Gateway must be mounted');
  assert.ok(ctx.autoVisualConnection, 'plugin connection service must be mounted');
  assert.equal(ctx.typert.local.get('autoVisualConnection/checkConnection'), undefined,
    'exercise actual SRC Remote-marker discovery, without a fabricated descriptor');
  return {
    ctx,
    invoke: () => ctx.typertGateway.invoke({ namespace: 'autoVisualConnection', method: 'checkConnection', args: {} }),
  };
}

test('actual Typert Gateway invokes mock connection check through the public API', async t => {
  const { invoke } = await fixture(t, { provider: 'mock', model: 'mock-v1' });
  assert.deepEqual(await invoke(), { ok: true, code: 'MOCK_READY', model: 'mock-v1' });
});

test('actual Typert Gateway invokes disabled connection check through the public API', async t => {
  const { invoke } = await fixture(t, { provider: 'disabled', model: 'mock-v1' });
  assert.deepEqual(await invoke(), { ok: false, code: 'DISABLED', model: 'mock-v1' });
});
