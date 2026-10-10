import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import SettingsForms from '@deepseek-ai/dsh-settings';
import { parse, stringify } from 'yaml';
import * as autoVisual from '../src/index.ts';

// Only unused host capabilities are supplied here. Loader, Include, the actual
// plugin Config/apply, SettingsForms, ConfigEditor, and disk persistence are real.
async function fixture(t: any, apiKey = '') {
  const dir = await mkdtemp(fileURLToPath(new URL('.settings-integration-', import.meta.url)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home);
  const patchPath = join(dir, 'cordis.patch.yml');
  const initial = { mode: 'suggest', provider: 'disabled', model: 'mock-v1', baseURL: 'https://api.openai.com/v1', apiKey, apiKeyEnv: 'OPENAI_API_KEY', maxAssets: 3 };
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }));
  await writeFile(join(dir, 'cordis.yml'), '[]\n');
  await writeFile(patchPath, stringify([{ insert: [{ id: 'auto-visual', name: 'cordis:auto-visual', config: initial }] }]));
  const profile = { name: 'settings-integration', dir, home, cwd: dir, patchPath,
    installAnchor: fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-app-boot/package.json')),
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined };
  const tools: any[] = [];
  const ctx = await boot('settings-integration', join(dir, 'cordis.yml'), readProfilePatches('settings-integration', profile), async ctx => {
    ctx.provide('profileContext', profile);
    for (const name of ['fs', 'sandboxPolicy', 'sandbox', 'subprocess']) ctx.provide(name, {});
    ctx.provide('tools', { register(tool: any) { tools.push(tool); } });
    ctx.provide('systemPrompt', { section() {} });
    ctx.loader.builtins['auto-visual'] = autoVisual;
    await ctx.plugin(ConfigEditor);
    await ctx.plugin(SettingsForms);
  });
  t.after(() => ctx.fiber.dispose());
  await ctx.loader.await();
  const entry = ctx.configEditor.entries().find(entry => entry.options.id === 'auto-visual');
  assert.ok(entry, 'actual Include child must be addressable by ConfigEditor');
  assert.equal(entry.fiber?.state, 2, 'actual plugin must be active');
  assert.equal(entry.fiber?.runtime?.Config, autoVisual.Config);
  assert.equal(tools.length, 3);
  const describe = (options?: { redactSecrets: boolean }) => {
    const descriptor = ctx.settings.describe(options).find(row => row.ns === 'auto-visual');
    assert.ok(descriptor, 'actual settings descriptor must exist');
    return descriptor;
  };
  return { ctx, entry, describe, patchPath, initial, tools };
}

test('real settings mutation persists model/provider/baseURL/apiKeyEnv and updates the mounted plugin without remounting', async t => {
  const { ctx, entry, describe, patchPath, initial, tools } = await fixture(t);
  const before = describe();
  assert.deepEqual(before.value, initial);
  const fiber = entry.fiber;
  const changes = { model: 'gpt-image-1', provider: 'openai', baseURL: 'https://images.example.test/v1', apiKeyEnv: 'AUTO_VISUAL_TEST_KEY' };
  await ctx.settings.mutate('auto-visual', Object.entries(changes).map(([key, value]) => ({ op: 'set' as const, path: [key], value })), before.revision);
  const after = describe();
  assert.deepEqual(after.value, { ...initial, ...changes });
  assert.equal(after.revision, before.revision + 1);
  assert.equal(entry.fiber, fiber, 'volatile saves must retain the mounted plugin fiber');
  assert.equal(tools.length, 3, 'save must not register duplicate tools');
  for (const [key, value] of Object.entries(changes)) assert.equal(entry.fiber!.config[key].get(), value);
  const persisted = parse(await readFile(patchPath, 'utf8'));
  assert.deepEqual(persisted.findLast((row: any) => row.id === 'auto-visual').config, { ...initial, ...changes });
  await assert.rejects(ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['model'], value: 'stale-model' }], before.revision), { code: 'SETTINGS_CONFLICT' });
  assert.deepEqual(describe().value, after.value);
  assert.deepEqual(parse(await readFile(patchPath, 'utf8')), persisted, 'stale save must leave disk unchanged');
});

test('real settings service accepts editing the model while mock is selected', async t => {
  const { ctx, entry, describe, initial } = await fixture(t);
  const fiber = entry.fiber;
  await ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['provider'], value: 'mock' }], describe().revision);
  // This deliberately uses separate saves, as a user selecting a provider and
  // then typing the model does. It exercises Config validation in ConfigEditor.
  await ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['model'], value: 'gpt-image-1' }], describe().revision);
  assert.deepEqual(describe().value, { ...initial, provider: 'mock', model: 'gpt-image-1' });
  assert.equal(entry.fiber, fiber);
  assert.deepEqual(await ctx.autoVisualConnection.checkConnection(), { ok: false, code: 'INVALID_MODEL', model: 'gpt-image-1' });
  await ctx.settings.mutate('auto-visual', [
    { op: 'set', path: ['provider'], value: 'openai' },
    { op: 'set', path: ['baseURL'], value: 'https://images.example.test/v1' },
    { op: 'set', path: ['apiKeyEnv'], value: 'AUTO_VISUAL_TEST_KEY' },
  ], describe().revision);
  assert.equal(entry.fiber!.config.provider.get(), 'openai');
  assert.equal(entry.fiber!.config.model.get(), 'gpt-image-1');
});

test('real settings describe redacts the API key from value, base and user', async t => {
  const { ctx, entry, describe } = await fixture(t, 'inherited-secret');
  const before = describe({ redactSecrets: true });
  assert.equal(Object.hasOwn(before.value, 'apiKey'), false);
  assert.equal(Object.hasOwn(before.base, 'apiKey'), false);
  assert.equal(Object.hasOwn(before.user, 'apiKey'), false);
  assert.deepEqual(before.secrets, [{ path: ['apiKey'], set: true }]);
  assert.equal(JSON.stringify(before).includes('inherited-secret'), false);

  await ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['apiKey'], value: 'saved-secret' }], before.revision);
  const after = describe({ redactSecrets: true });
  for (const value of [after.value, after.base, after.user]) assert.equal(Object.hasOwn(value, 'apiKey'), false);
  assert.deepEqual(after.secrets, [{ path: ['apiKey'], set: true }]);
  assert.equal(JSON.stringify(after).includes('saved-secret'), false);
  assert.equal(JSON.stringify(after).includes('inherited-secret'), false);
  assert.equal(entry.fiber!.config.apiKey.get(), 'saved-secret');
});

test('real non-secret settings mutation retains the saved API key omitted by the redacted form', async t => {
  const { ctx, entry, describe, patchPath, initial } = await fixture(t);
  const fiber = entry.fiber;
  await ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['apiKey'], value: 'saved-secret' }], describe().revision);
  const before = describe({ redactSecrets: true });
  assert.equal(Object.hasOwn(before.value, 'apiKey'), false);
  const changes = { provider: 'openai', model: 'gpt-image-1', baseURL: 'https://images.example.test/v1' };
  await ctx.settings.mutate('auto-visual', Object.entries(changes).map(([key, value]) => ({ op: 'set' as const, path: [key], value })), before.revision);
  assert.equal(entry.fiber, fiber, 'secret and non-secret saves must retain the mounted plugin fiber');
  assert.equal(entry.fiber!.config.apiKey.get(), 'saved-secret');
  const persisted = parse(await readFile(patchPath, 'utf8'));
  assert.deepEqual(persisted.findLast((row: any) => row.id === 'auto-visual').config, { ...initial, ...changes, apiKey: 'saved-secret' });
  const after = describe({ redactSecrets: true });
  const { apiKey, ...visible } = { ...initial, ...changes };
  assert.deepEqual(after.value, visible);
  assert.deepEqual(after.secrets, [{ path: ['apiKey'], set: true }]);
  assert.equal(after.revision, before.revision + 1);
});

test('real Config validation rejects invalid saves before changing the profile or live values', async t => {
  const { ctx, entry, describe, patchPath } = await fixture(t);
  const before = describe();
  const disk = await readFile(patchPath, 'utf8');
  const fiber = entry.fiber;
  for (const [key, value] of [['model', ''], ['provider', 'unsupported']] as const) {
    await assert.rejects(ctx.settings.mutate('auto-visual', [{ op: 'set', path: [key], value }], before.revision));
    assert.deepEqual(describe().value, before.value);
    assert.equal(describe().revision, before.revision);
    assert.equal(await readFile(patchPath, 'utf8'), disk);
    assert.equal(entry.fiber, fiber);
  }
  // A failed validation must not poison a following valid save.
  await ctx.settings.mutate('auto-visual', [{ op: 'set', path: ['model'], value: 'gpt-image-1' }], before.revision);
  assert.equal(entry.fiber!.config.model.get(), 'gpt-image-1');
});
