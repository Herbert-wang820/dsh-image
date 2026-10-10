import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';

// A client plugin that consumes a Remote namespace must declare
// `remote.<namespace>` as a dependency. Cordis resolves the traceable
// `remote.demo` property by walking the *consumer fiber* and its ancestors, and
// the namespace Service is provided by a sibling fiber (the api-gateway client
// mounts one fiber per namespace), so an undeclared access cannot resolve.
class FakeRemote extends Service {}
class DemoNamespace extends Service {
  constructor(ctx: Context) { super(ctx, 'remote.demo'); }
  async check() { return 'ok'; }
}

test('a sibling Remote namespace resolves only when declared as a dependency', async t => {
  const ctx = new Context({});
  t.after(() => ctx.fiber.dispose());
  new FakeRemote(ctx, 'remote');
  await ctx.plugin((c: Context) => { new DemoNamespace(c); });
  assert.ok(ctx.reflect.props['remote.demo'], 'namespace Service is registered');

  // Mirror the real client: the consumer is a separate plugin fiber.
  let error: unknown;
  let fallback: unknown;
  await ctx.plugin(async (c: Context) => {
    try { void (c.remote as any).demo.check(); } catch (e) { error = e; }
    // A namespace mounted after the consuming plugin loaded cannot be a static
    // dependency, so the lazy accessor is the documented read-without-inject path.
    fallback = await (c.reflect.get('remote.demo', false) as any).check();
  });
  assert.ok(error instanceof Error, 'undeclared namespace access must not silently resolve');
  assert.match(error.message, /without inject/, `unexpected resolution error: ${error.message}`);
  assert.equal(fallback, 'ok', 'reflect.get resolves a sibling namespace and its methods');

  let result: unknown;
  await ctx.plugin({
    inject: ['remote', 'remote.demo'],
    apply: async (c: Context) => { result = await (c.remote as any).demo.check(); },
  });
  assert.equal(result, 'ok', 'declared namespace resolves and is callable');
});
