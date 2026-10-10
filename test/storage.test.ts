import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDshStorage, type StorageContext } from '../src/storage.ts';
import { apply } from '../src/index.ts';
import { validatePng } from '../src/core.ts';

async function fixture(t: any, mode: 'workspace-write' | 'read-only' | 'danger-full-access' = 'workspace-write') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls: any[] = [];
  async function canonical(p: string): Promise<string> { try { return await fs.realpath(p); } catch (e: any) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(p); if (parent === p) throw e; return path.join(await canonical(parent), path.basename(p)); } }
  const ctx: StorageContext = {
    subprocess: { spawn(spec) {
      const env = { ...process.env, ...spec.env };
      assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.NODE_PATH, undefined);
      assert.equal(spec.stdio.stderr.maxBytes, 1024);
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env, stdio: ['pipe', 'ignore', 'ignore'] });
      let failed = false;
      const terminate = () => { child.kill('SIGKILL'); };
      const done = new Promise<{ exitCode: number | null }>((resolve, reject) => {
        child.on('error', () => { failed = true; });
        child.stdin.on('error', () => { failed = true; });
        child.on('close', exitCode => { spec.signal.removeEventListener('abort', terminate); failed ? reject(Error('spawn failed')) : resolve({ exitCode }); });
      });
      spec.signal.addEventListener('abort', terminate, { once: true });
      if (spec.signal.aborted) terminate();
      child.stdin.end(spec.stdio.stdin.data);
      return { done, terminate };
    } },
    sandboxPolicy: { resolve({ session }) { assert.equal(session, 'session'); return { mode, workspaceRoot: root, sessionId: 'session' }; } },
    fs: {
      async resolve(p, opts) { return canonical(path.resolve(opts.cwd, p)); },
      contains(r, p) { const rel = path.relative(r, p); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); },
      processPath(p) { return p; }, processPathFromHostPath(p) { return p; },
      async stat(p) { try { const s = await fs.stat(p); return { type: s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other' }; } catch (e: any) { if (e.code === 'ENOENT') return; throw e; } },
      async readBytes(p, signal, limit) { signal?.throwIfAborted(); assert.equal(limit, 16 * 1024 * 1024); const s = await fs.stat(p); if (s.size > limit) throw Error('large'); return fs.readFile(p); },
    },
    // TEST ONLY: passthrough is NOT actual confinement. Production must supply DSH's provider.
    sandbox: { async confine(argv, policy) { calls.push(policy); assert.equal(argv[0], process.execPath); return { argv: [...argv], enforcement: 'full' }; } },
  };
  const exec = { agent: { session: 'session' } };
  return { root, ctx, exec, calls, storage: await createDshStorage(ctx, exec) };
}
const state = '.dsh-auto-visual/owner/state.json';
test('bounded reads, atomic state replacement, immutable images and scoped lock', async t => {
  const { storage, root, calls } = await fixture(t);
  await assert.rejects(storage.write(state, Buffer.from('x')), /LOCK_REQUIRED/);
  assert.equal(await storage.exists(state), false);
  await storage.withLock(async () => {
    await storage.write(state, Buffer.from('one'));
    await storage.write(state, Buffer.from('two'));
    await storage.write('.dsh-auto-visual/owner/image.png', Buffer.from('image'));
    await assert.rejects(storage.write('.dsh-auto-visual/owner/image.png', Buffer.from('replacement')));
  });
  assert.equal(Buffer.from(await storage.read(state)).toString(), 'two');
  assert.equal(await storage.exists(state), true);
  assert.equal(await storage.exists('.dsh-auto-visual/owner'), false);
  await assert.rejects(fs.stat(path.join(root, '.dsh-auto-visual/.lock')));
  assert.ok(calls.every(p => p.mode === 'workspace-write'));
  await storage.withLock(async () => assert.rejects(storage.write(state, new Uint8Array(16 * 1024 * 1024 + 1)), /TOO_LARGE/));
});
test('policy, absent agent, same-world and confinement fail closed', async t => {
  const f = await fixture(t, 'read-only');
  await assert.rejects(f.storage.withLock(async () => {}), /READ_ONLY/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(createDshStorage(f.ctx, {}), /AGENT_REQUIRED/);
  f.ctx.fs.processPathFromHostPath = () => undefined;
  await assert.rejects(createDshStorage(f.ctx, f.exec), /SAME_WORLD/);
  for (const enforcement of ['partial', 'none']) {
    const g = await fixture(t);
    g.ctx.sandbox!.confine = async argv => ({ argv: [...argv], enforcement });
    await assert.rejects(g.storage.withLock(async () => assert.fail('must not execute')));
    assert.equal(await g.storage.exists(state), false);
    await assert.rejects(fs.stat(path.join(g.root, '.dsh-auto-visual')));
  }
  const g = await fixture(t, 'danger-full-access');
  g.ctx.sandbox = undefined;
  await assert.rejects(g.storage.withLock(async () => {}), /CONFINEMENT_REQUIRED/);
});
test('workspace lock conflicts, callback errors release, unrelated writes denied', async t => {
  const f = await fixture(t), second = await createDshStorage(f.ctx, f.exec);
  await f.storage.withLock(async () => {
    await assert.rejects(second.withLock(async () => {}));
    await assert.rejects(f.storage.withLock(async () => {}), /LOCK_CONFLICT/);
    await assert.rejects(second.write(state, Buffer.from('x')), /LOCK_REQUIRED/);
  });
  await assert.rejects(f.storage.withLock(async () => { throw Error('callback'); }), /callback/);
  await second.withLock(async () => second.write(state, Buffer.from('ok')));
});
test('traversal, absolute paths, reserved lock and symlink components rejected', async t => {
  const f = await fixture(t);
  await f.storage.withLock(async () => {
    for (const p of ['../escape', '/tmp/escape', 'file', '.dsh-auto-visual/../escape', '.dsh-auto-visual//x', '.dsh-auto-visual/./x', '.dsh-auto-visual/.lock/token', '.dsh-auto-visual/a\\b', 'C:/escape']) await assert.rejects(f.storage.write(p, Buffer.from('x')));
    await fs.mkdir(path.join(f.root, 'inside'));
    await fs.symlink(path.join(f.root, 'inside'), path.join(f.root, '.dsh-auto-visual/link'));
    await assert.rejects(f.storage.write('.dsh-auto-visual/link/file', Buffer.from('x')));
    await fs.symlink(os.tmpdir(), path.join(f.root, 'outside'));
    await assert.rejects(f.storage.exists('outside'));
    await assert.rejects(f.storage.read('../outside'));
  });
});
test('token mismatch never releases another owner lock; stale locks not stolen', async t => {
  const f = await fixture(t);
  await assert.rejects(f.storage.withLock(async () => { await fs.writeFile(path.join(f.root, '.dsh-auto-visual/.lock/token'), 'another-owner'); }));
  assert.equal(await fs.readFile(path.join(f.root, '.dsh-auto-visual/.lock/token'), 'utf8'), 'another-owner');
  await assert.rejects(f.storage.withLock(async () => {}));
});
test('cancelled callback still releases owned lock with separate cleanup signal', async t => {
  const f = await fixture(t), abort = new AbortController();
  const storage = await createDshStorage(f.ctx, { ...f.exec, signal: abort.signal });
  await storage.withLock(async () => {
    abort.abort();
    await assert.rejects(storage.write(state, Buffer.from('x')), /CANCELLED/);
  });
  await f.storage.withLock(async () => {});
  await assert.rejects(storage.withLock(async () => {}), /CANCELLED/);
});
test('abort kills a running confined worker and waits for close', async t => {
  const f = await fixture(t), abort = new AbortController();
  let first = true;
  f.ctx.sandbox!.confine = async argv => { const hang = first; first = false; return { argv: hang ? [process.execPath, '-e', 'setInterval(()=>{},1000)'] : [...argv], enforcement: 'full' }; };
  const storage = await createDshStorage(f.ctx, { ...f.exec, signal: abort.signal });
  const timer = setTimeout(() => abort.abort(), 100);
  try { await assert.rejects(storage.withLock(async () => assert.fail('must not acquire')), /CANCELLED/); }
  finally { clearTimeout(timer); }
});
test('worker stderr and provider failures are never exposed', async t => {
  const f = await fixture(t);
  f.ctx.sandbox!.confine = async () => ({ argv: [process.execPath, '-e', 'console.error("sensitive-secret");process.exit(1)'], enforcement: 'full' });
  await assert.rejects(f.storage.withLock(async () => {}), e => e instanceof Error && e.message === 'STORAGE_ERROR');
  f.ctx.sandbox!.confine = async () => { throw Error('sensitive-secret'); };
  await assert.rejects(f.storage.withLock(async () => {}), e => e instanceof Error && e.message === 'STORAGE_ERROR');
});
