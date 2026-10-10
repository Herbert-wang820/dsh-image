// DSH browser-contract harness for the auto-visual settings section.
import { readFileSync } from 'node:fs';

const writes = [];
let snapshot = { status: 'ready', value: { mode: 'suggest', provider: 'disabled', model: 'mock-v1', baseURL: 'https://api.openai.com/v1', maxAssets: 3 }, base: {}, user: {}, revision: 1, writable: true };
const scopeListeners = new Set();
let expectedLiveRevision;
const fakeForm = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => { scopeListeners.add(listener); return () => scopeListeners.delete(listener); },
  mutate: async (ops, revision) => {
    if (expectedLiveRevision !== undefined && revision !== undefined) throw new Error('plugin passed stale draft revision instead of using ConfigForm live revision');
    revision ??= snapshot.revision;
    if (expectedLiveRevision !== undefined && revision !== expectedLiveRevision) throw new Error('wrong live revision');
    writes.push({ ops, revision });
    const value = { ...snapshot.value };
    for (const op of ops) op.op === 'set' ? value[op.path[0]] = op.value : delete value[op.path[0]];
    snapshot = { ...snapshot, value, user: { ...value }, revision: snapshot.revision + 1 };
    scopeListeners.forEach((listener) => listener());
    return true;
  }
};

function createStore(getSnapshot) {
  const listeners = new Set();
  let current = getSnapshot();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (value) => { current = value; listeners.forEach((listener) => listener()); },
    publish: () => { current = getSnapshot(); listeners.forEach((listener) => listener()); }
  };
}
class FakeSettingsFormModel {
  constructor(scope, specs, secrets = []) {
    this.secrets = new Map(secrets.map(spec => [spec.field, spec]));
    this.scope = scope;
    this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.drafts = new Map();
    this.store = null;
    this.unsubscribe = scope.subscribe(() => this.store?.publish());
  }
  bind(project) { this.store = createStore(project); return this.store; }
  shell() {
    const snap = this.scope.getSnapshot();
    return { available: snap.status === 'ready', writable: !!snap.writable, dirty: [...this.drafts].some(([field, text]) => !this.secrets.has(field) || !!text.trim()), invalid: [...this.drafts].some(([field,text]) => !this.secrets.has(field) && !this.specs.get(field).parse(text)), saving: false, failed: false };
  }
  field(field) {
    if (this.secrets.has(field)) return { text: this.drafts.get(field) ?? '', overridden: false, invalid: false };
    const snap = this.scope.getSnapshot();
    const text = this.drafts.has(field) ? this.drafts.get(field) : this.specs.get(field).format(snap.value?.[field]);
    return { text, overridden: Object.hasOwn(snap.user ?? {}, field), invalid: !this.specs.get(field).parse(text) };
  }
  actions() {
    return {
      edit: (field, text) => { this.drafts.set(field, text); this.store.publish(); },
      resetField: (field) => { this.drafts.set(field, ''); this.store.publish(); },
      discard: () => { this.drafts.clear(); this.store.publish(); },
      save: async () => {
        const secretWrites = [...this.drafts].filter(([field, text]) => this.secrets.has(field) && text.trim()).map(([field, text]) => this.secrets.get(field).write(text));
        const ops = [...this.drafts].filter(([field]) => !this.secrets.has(field)).map(([field, text]) => {
          const parsed = this.specs.get(field).parse(text);
          return parsed.kind === 'set' ? { op: 'set', path: [field], value: parsed.value } : { op: 'unset', path: [field] };
        });
        if (ops.length) await this.scope.mutate(ops, this.scope.getSnapshot().revision);
        await Promise.all(secretWrites);
        this.drafts.clear(); this.store.publish();
      }
    };
  }
  dispose() { this.unsubscribe(); }
}
function settingsNumberField(field) {
  return { field, format: (value) => value == null ? '' : String(value), parse: (text) => /^\d+$/.test(text) ? { kind: 'set', value: Number(text) } : undefined };
}
function SettingsForm() {}
function SettingsValueField() {}
function SettingsSecretField() {}
function Button() {}
const settingsTextField = (field) => ({ field, format: (value) => value == null ? '' : String(value), parse: (text) => text ? { kind: 'set', value: text } : { kind: 'clear' } });
const primitivesStub = { SettingsForm, SettingsValueField, SettingsSecretField, Button, SettingsFormModel: FakeSettingsFormModel, settingsNumberField, settingsTextField };
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: (initial) => {
    const index = hookIndex++;
    if (!(index in hookStates)) hookStates[index] = initial;
    return [hookStates[index], (value) => { hookStates[index] = typeof value === 'function' ? value(hookStates[index]) : value; }];
  },
  useEffect: () => {}
};
let hookIndex = 0;
const hookStates = [];

let loaded;
globalThis.window = { __ModuleLoader__: { load: (descriptor) => { loaded = descriptor; } } };
const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8');
new Function('window', source)(globalThis.window);
if (!loaded) throw new Error('module never registered');
const mod = loaded.factory((name) => {
  if (name === 'react') return reactStub;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
  throw new Error('unexpected require: ' + name);
});
if (loaded.id !== 'dsh-auto-visual') throw new Error('wrong module id');
if (!mod.inject.includes('configForms')) throw new Error('configForms not declared');

const registered = [];
const configForms = { get: (id) => { if (id !== 'auto-visual') throw new Error('wrong entry id'); return fakeForm; } };
const locale = { register: () => () => {}, bind: () => (key) => key };
let checks = 0;
let mounted;
let namespace;
let secretSet = false;
// Real Cordis serves ctx.remote.<namespace> only to a plugin that declared that
// exact name in its dependency set. This plugin mounts its own namespace, so the
// property stays unresolvable on the loading context and only resolves on the
// context that injected the name after mounting.
function makeRemote(allowed) {
  return new Proxy(remoteFacade, {
    get: (target, prop) => {
      if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop);
      if (namespace && allowed.has('remote.' + String(prop))) return namespace;
      throw new Error(`cannot get property "remote.${String(prop)}" without inject`);
    }
  });
}
const remoteFacade = {
  $mount: async (contribution) => {
    if (contribution.package !== 'dsh-auto-visual') throw new Error('wrong Remote package');
    if (contribution.descriptors[0]?.namespace !== 'autoVisualConnection') throw new Error('wrong Remote namespace');
    mounted = contribution;
    namespace = { checkConnection: async () => { checks++; return { ok: true, value: { ok: true, code: 'CONNECTED', model: 'gpt-image-1' } }; } };
    return async () => { namespace = undefined; };
  }
};
const settingsRemote = {
  describe: async () => ({ ok: true, value: [{ ns: 'auto-visual', secrets: [{ path: ['apiKey'], set: secretSet }] }] })
};
const base = {
  remote: makeRemote(new Set()),
  reflect: { get: (name) => name === 'remote.settings' ? settingsRemote : undefined },
  configForms,
  locale,
  effect: (fn) => fn(),
  slots: {
    inject: (name, fn) => { if (name !== 'settings.section') throw new Error('wrong slot'); return fn(); },
    register: (options, component) => { registered.push({ options, component }); return () => {}; }
  }
};
const ctx = Object.assign({}, base, {
  inject: (dependencies, callback) => {
    if (!dependencies.includes('remote.autoVisualConnection')) throw new Error('namespace dependency not declared after mount');
    const scoped = Object.assign({}, base, { remote: makeRemote(new Set(dependencies)) });
    const fiber = Promise.resolve(callback(scoped)).then(() => undefined);
    fiber.dispose = async () => {};
    return fiber;
  }
});
await mod.apply(ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
if (registered.length !== 1) throw new Error('expected one settings section');
if (!mounted) throw new Error('Remote contribution was not mounted');
const entry = registered[0];
const face = entry.options.inject();
if (!face.model || !face.store || !face.t || !face.connection || typeof face.connection.checkConnection !== 'function') throw new Error('native form dependencies missing');
function render() { hookIndex = 0; return entry.component(face); }

let tree = render();
if (tree.type !== SettingsForm) throw new Error('panel does not use native SettingsForm');
if (tree.children.length !== 7 || tree.children.slice(0, 4).some((child) => child.type !== SettingsValueField) || tree.children[4].type !== SettingsSecretField || tree.children[5].type !== SettingsValueField) throw new Error('panel does not use native value and secret controls');
if (tree.children.slice(0, 4).map((child) => child.props.text).concat(tree.children[5].props.text).join(',') !== 'suggest,disabled,mock-v1,https://api.openai.com/v1,3') throw new Error('controls not bound to config values');
if (tree.children[4].props.text !== '') throw new Error('secret was displayed');
if (tree.children[4].props.configured !== false || tree.children[4].props.stateLabel !== 'keyWriteOnly') throw new Error('unsaved secret badge not reported');

// Edits are staged — nothing writes until the native form Save action runs.
tree.children[0].props.onEdit('auto');
if (writes.length) throw new Error('edit wrote before Save');
tree = render();
if (!tree.props.state.dirty || tree.children[0].props.text !== 'auto') throw new Error('draft not reflected');
await tree.props.onSave();
if (writes.length !== 1 || writes[0].ops[0].path[0] !== 'mode' || writes[0].ops[0].value !== 'auto') throw new Error('save did not mutate mode');
tree = render();
if (tree.children[0].props.text !== 'auto' || tree.props.state.dirty) throw new Error('accepted save not reflected');
tree.children[1].props.onEdit('openai');
tree.children[2].props.onEdit('gpt-image-1');
// Simulate Host/config HMR after editing starts. The plugin must not send the
// draft's now-stale revision; ConfigForm resolves the current one when saving.
snapshot = { ...snapshot, revision: snapshot.revision + 1 };
expectedLiveRevision = snapshot.revision;
scopeListeners.forEach((listener) => listener());
await render().props.onSave();
expectedLiveRevision = undefined;
if (writes[1]?.ops[1]?.path[0] !== 'model' || writes[1]?.ops[1]?.value !== 'gpt-image-1') throw new Error('model save did not reach Host');

// Direct key is a write-only native secret, and a subsequent blank writes nothing.
tree = render();
secretSet = true;
tree.children[4].props.onEdit('test-direct-secret');
await render().props.onSave();
if (writes.at(-1).ops[0].path[0] !== 'apiKey' || writes.at(-1).ops[0].value !== 'test-direct-secret') throw new Error('direct secret not saved');
tree = render();
if (tree.children[4].props.text !== '') throw new Error('accepted key was echoed');
if (tree.children[4].props.configured !== true || tree.children[4].props.stateLabel !== 'keySaved') throw new Error('saved secret badge not reported');
const countAfterSecret = writes.length;
render().children[4].props.onEdit('');
await render().props.onSave();
if (writes.length !== countAfterSecret) throw new Error('blank key overwrote saved key');

// The connection check goes through the namespace Service captured after mount;
// a broad ctx.remote.<namespace> lookup cannot resolve it in real Cordis.
tree = render();
await tree.children[6].children[0].props.onClick();
tree = render();
if (checks !== 1) throw new Error('connection check did not reach the namespace service');
const status = tree.children[6].children[2];
if (!status || status.props.role !== 'status') throw new Error('connection result is not announced');
if (!String(status.children.join('')).startsWith('CONNECTED')) throw new Error('connection result not rendered: ' + status.children.join(''));

// A failing RPC surfaces its own machine code instead of a generic restart hint.
const live = face.connection;
live.checkConnection = async () => ({ ok: false, error: { code: 'gateway/invocation-unavailable' } });
await render().children[6].children[0].props.onClick();
tree = render();
if (String(tree.children[6].children[2].children.join('')) !== 'CHECK_FAILED (gateway/invocation-unavailable)') throw new Error('remote failure code not surfaced: ' + tree.children[6].children[2].children.join(''));
delete live.checkConnection;
await render().children[6].children[0].props.onClick();
tree = render();
if (String(tree.children[6].children[2].children.join('')) !== 'CHECK_UNAVAILABLE') throw new Error('missing namespace method not reported: ' + tree.children[6].children[2].children.join(''));
live.checkConnection = async () => { checks++; return { ok: true, value: { ok: true, code: 'CONNECTED', model: 'gpt-image-1' } }; };

snapshot = { ...snapshot, writable: false };
scopeListeners.forEach((listener) => listener());
tree = render();
if (!tree.children.slice(0, 6).every((child) => child.props.disabled)) throw new Error('read-only state not reflected');

console.log('registered id :', loaded.id);
console.log('section id    :', entry.options.id);
console.log('native form   : SettingsForm + 5 SettingsValueField + SettingsSecretField');
console.log('staged save   :', JSON.stringify(writes[0]));
console.log('model save    :', JSON.stringify(writes[1]));
console.log('secret badge  : unsaved -> saved, blank write skipped');
console.log('check result  : CONNECTED, CHECK_FAILED detail, CHECK_UNAVAILABLE');
console.log('read-only UI  : verified');
console.log('\nALL CLIENT CHECKS PASSED');
