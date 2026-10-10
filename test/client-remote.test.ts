import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import * as cordis from '@deepseek-ai/cordis';

type BrowserModule = { id: string; factory(require: (name: string) => unknown): any };

async function loadBrowserModule(path: string, dependencies: Record<string, unknown>) {
  let registered: BrowserModule | undefined;
  const window = { __ModuleLoader__: { load(module: BrowserModule) { registered = module; } } };
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  new Function('window', source)(window);
  assert.ok(registered, `${path} did not register with the real module-loader contract`);
  return registered.factory((name: string) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`${path} unexpectedly required ${name}`);
  });
}

const field = (name: string) => ({
  field: name,
  format: (value: unknown) => value == null ? '' : String(value),
  parse: (text: string) => ({ kind: 'set', value: text }),
});
class SettingsFormModel {
  constructor(..._args: unknown[]) {}
  bind(project: () => unknown) { return { subscribe: () => () => {}, getSnapshot: project, set: () => {} }; }
  shell() { return { available: true, writable: true, dirty: false, saving: false }; }
  field() { return { text: '', overridden: false, invalid: false }; }
  actions() { return { edit() {}, resetField() {}, save() {}, discard() {} }; }
  dispose() {}
}
const primitives = {
  SettingsForm() {}, SettingsSecretField() {}, SettingsValueField() {}, Button() {},
  SettingsFormModel,
  settingsNumberField: field,
  settingsTextField: field,
};
const react = {
  createElement() {}, useSyncExternalStore() {}, useState(value: unknown) { return [value, () => {}]; }, useEffect() {},
};

test('real ClientRemoteService mounts plugin contribution and exposes callable namespace', async t => {
  const typertClient = await loadBrowserModule('../node_modules/@deepseek-ai/dsh-typert-registry/lib/client.js', {
    '@deepseek-ai/cordis': cordis,
  });
  const gatewayClient = await loadBrowserModule('../node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js', {
    '@deepseek-ai/cordis': cordis,
  });
  const pluginClient = await loadBrowserModule('../dist/client.js', {
    react,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  });

  const calls: Array<{ route: string; endpoint: string; payload: unknown }> = [];
  const connection = {
    isLoopback: true,
    generation: { getSnapshot: () => ({ host: { home: '/tmp/test-home' } }), subscribe: () => () => {} },
    rpc: {
      open: async function* () {},
      async call(route: string, endpoint: string, payload: unknown) {
        calls.push({ route, endpoint, payload });
        return { ok: true, value: { ok: true, code: 'MOCK_READY', model: 'mock-v1' } };
      },
    },
    registerGenerationSource() { return () => {}; },
    start() { return { stop() {} }; },
  };

  const ctx: any = new Context({});
  t.after(async () => { await ctx.fiber.dispose(); });
  ctx.provide('connection', connection);
  ctx.provide('configForms', { get: () => ({ getSnapshot: () => ({}), subscribe: () => () => {}, mutate: async () => true }) });
  ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} });
  let panel: { inject(): any } | undefined;
  ctx.provide('slots', {
    inject: (_name: string, mount: () => unknown) => mount(),
    register(options: { inject(): any }) { panel = options; return () => {}; },
  });

  await ctx.plugin(typertClient);
  await ctx.plugin(gatewayClient);
  assert.ok(ctx.typert, 'actual browser Typert registry is available');
  assert.ok(ctx.remote, 'actual ClientRemoteService is available');

  // Mount the evaluated plugin contribution through Cordis, rather than calling
  // apply or replacing remote.$mount in the test.
  await ctx.plugin(pluginClient);

  assert.ok(ctx.remote.autoVisualConnection, 'mounted Remote namespace is exposed through ctx.remote');
  assert.equal(typeof ctx.remote.autoVisualConnection.checkConnection, 'function');
  assert.deepEqual(await ctx.remote.autoVisualConnection.checkConnection(), {
    ok: true, value: { ok: true, code: 'MOCK_READY', model: 'mock-v1' },
  }, 'root invocation proves the actual namespace and RPC method are installed');
  calls.length = 0;
  assert.ok(panel, 'actual plugin registers its settings section');
  // The panel face must carry the namespace Service itself: Cordis only serves
  // ctx.remote.<namespace> to a plugin that declared the name, and this plugin
  // mounts its own namespace after loading.
  const panelRemote = panel.inject().connection;
  assert.ok(panelRemote, 'namespace reaches the mounted settings panel, not just the root');
  assert.equal(typeof panelRemote.checkConnection, 'function');
  const result = await panelRemote.checkConnection();
  assert.deepEqual(result, { ok: true, value: { ok: true, code: 'MOCK_READY', model: 'mock-v1' } });
  assert.deepEqual(calls, [{
    route: '/api',
    endpoint: 'autoVisualConnection/checkConnection',
    payload: { args: Object.create(null) },
  }]);
});
