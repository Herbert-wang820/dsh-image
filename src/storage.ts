import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const LIMIT = 16 * 1024 * 1024;
type Policy = { mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string; sessionId?: any };
/** Structural capability types keep this adapter usable without loading DSH services. */
export interface StorageContext {
  subprocess: { spawn(spec: { argv: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; stdio: { stdin: { data: string }; stdout: { maxBytes: number }; stderr: { maxBytes: number } }; graceMs: number; signal: AbortSignal }): { done: Promise<{ exitCode: number | null }>; terminate(): void } };
  sandboxPolicy: { resolve(input: { session: any }): Policy | Promise<Policy> };
  fs: {
    resolve(path: string, options: { cwd: string; signal?: AbortSignal }): Promise<any>;
    contains(root: any, target: any): boolean;
    processPath(target: any): string;
    processPathFromHostPath(path: string): string | undefined;
    stat(target: any, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other' } | undefined>;
    readBytes(target: any, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
  };
  sandbox?: { confine(argv: readonly string[], policy: Policy & { mode: 'workspace-write' }, signal?: AbortSignal): Promise<{ argv: string[]; enforcement: string }> };
}
export interface DshStorage {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}
function failure(code = 'STORAGE_ERROR'): Error { return new Error(code); }
function validPath(path: string, write = false): void {
  if (typeof path !== 'string' || path.length > 4096 || /[\\:\x00-\x1f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || (write && (!path.startsWith('.dsh-auto-visual/') || path.split('/').slice(1).some(p => p.startsWith('.'))))) throw failure('INVALID_STORAGE_PATH');
}

// No user-controlled JavaScript or command-line fragments. All requests arrive on stdin.
const STATIC_WORKER = String.raw`
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 24*1024*1024) throw Error(); }
  const q = JSON.parse(input);
  if (!/^[0-9a-f-]{36}$/.test(q.token)) throw Error();
  const root = await fs.realpath(process.cwd());
  async function info(p) { try { return await fs.lstat(p); } catch(e) { if(e.code === 'ENOENT') return; throw e; } }
  async function directory(p, create) {
    if (create) { try { await fs.mkdir(p, {mode:0o700}); } catch(e) { if(e.code !== 'EEXIST') throw e; } }
    const s = await info(p); if (!s || s.isSymbolicLink() || !s.isDirectory()) throw Error();
    if (await fs.realpath(p) !== p) throw Error();
  }
  const base = path.join(root, '.dsh-auto-visual'), lock = path.join(base, '.lock'), owner = path.join(lock, 'token');
  await directory(base, q.action === 'lock');
  async function owned() {
    await directory(lock, false); const s = await info(owner);
    if (!s || !s.isFile() || s.isSymbolicLink() || s.size > 100 || await fs.readFile(owner, 'utf8') !== q.token) throw Error();
  }
  if (q.action === 'lock') {
    await fs.mkdir(lock, {mode:0o700});
    try { await fs.writeFile(owner, q.token, {flag:'wx', mode:0o600}); }
    catch(e) { await fs.rmdir(lock).catch(()=>{}); throw e; }
  } else if (q.action === 'unlock') {
    await owned(); await fs.unlink(owner); await fs.rmdir(lock);
  } else if (q.action === 'write') {
    await owned();
    if (typeof q.path !== 'string' || q.path.length > 4096 || /[\\:\x00-\x1f]/.test(q.path)) throw Error();
    const parts = q.path.split('/');
    if (parts.shift() !== '.dsh-auto-visual' || !parts.length || parts.some(p => !p || p.startsWith('.'))) throw Error();
    const leaf = parts.pop(); let dir = base;
    for (const part of parts) { dir = path.join(dir, part); await directory(dir, true); }
    const dest = path.join(dir, leaf), s = await info(dest);
    if (s && (!s.isFile() || s.isSymbolicLink() || /\.png$/i.test(leaf))) throw Error();
    if (typeof q.bytes !== 'string' || q.bytes.length > 22369624) throw Error();
    const bytes = Buffer.from(q.bytes, 'base64'); if(bytes.length > 16*1024*1024) throw Error();
    const temp = path.join(dir, '.tmp-' + crypto.randomUUID());
    try {
      await fs.writeFile(temp, bytes, {flag:'wx', mode:0o600});
      await owned(); await directory(dir, false);
      const current = await info(dest); if(current && (!current.isFile() || current.isSymbolicLink())) throw Error();
      // Hard-link publication is atomic and cannot replace an existing image.
      if (/\.png$/i.test(leaf)) { await fs.link(temp, dest); await fs.unlink(temp); }
      else await fs.rename(temp, dest);
    } finally { await fs.unlink(temp).catch(()=>{}); }
  } else throw Error();
})().catch(() => { process.exitCode = 1; });
`;

export async function createDshStorage(ctx: StorageContext, exec: { agent?: { session: any }; signal?: AbortSignal }): Promise<DshStorage> {
  if (!exec.agent) throw failure('AGENT_REQUIRED');
  const policy = await ctx.sandboxPolicy.resolve({ session: exec.agent.session });
  const root = await ctx.fs.resolve(policy.workspaceRoot, { cwd: policy.workspaceRoot, signal: exec.signal });
  const rootPath = ctx.fs.processPath(root);
  if (ctx.fs.processPathFromHostPath(rootPath) !== rootPath) throw failure('SAME_WORLD_REQUIRED');
  const scope = new AsyncLocalStorage<{ token: string; active: boolean; pending: Set<Promise<void>> }>();
  let locking = false;
  async function target(path: string) {
    validPath(path);
    if (exec.signal?.aborted) throw failure('CANCELLED');
    const resolved = await ctx.fs.resolve(path, { cwd: policy.workspaceRoot, signal: exec.signal });
    if (!ctx.fs.contains(root, resolved)) throw failure('OUTSIDE_WORKSPACE');
    ctx.fs.processPath(resolved);
    return resolved;
  }
  async function worker(action: string, token: string, path?: string, bytes?: Uint8Array, cleanup = false): Promise<void> {
    if (policy.mode === 'read-only') throw failure('READ_ONLY');
    if (!ctx.sandbox) throw failure('CONFINEMENT_REQUIRED');
    const timeout = AbortSignal.timeout(15_000);
    const signal = cleanup || !exec.signal ? timeout : AbortSignal.any([exec.signal, timeout]);
    try {
      signal.throwIfAborted();
      const confined = await ctx.sandbox.confine([process.execPath, '-e', STATIC_WORKER], { ...policy, mode: 'workspace-write' }, signal);
      signal.throwIfAborted();
      if (confined.enforcement !== 'full' || !confined.argv.length) throw failure('CONFINEMENT_REQUIRED');
      // Managed subprocess env overlays a scrubbed parent: explicit tombstones
      // remove ordinary ambient values as well, including NODE_OPTIONS/NODE_PATH.
      const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]));
      Object.assign(env, { PATH: '/usr/bin:/bin', LANG: 'C', NODE_OPTIONS: undefined, NODE_PATH: undefined });
      if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
      const child = ctx.subprocess.spawn({ argv: confined.argv, cwd: rootPath, env, signal, graceMs: 250,
        stdio: { stdin: { data: JSON.stringify({ action, path, bytes: bytes && Buffer.from(bytes).toString('base64'), token }) }, stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
      });
      const abort = () => child.terminate();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try { const outcome = await child.done; if (outcome.exitCode !== 0 || signal.aborted) throw failure(); }
      finally { signal.removeEventListener('abort', abort); }
    } catch { throw failure(signal.aborted ? (exec.signal?.aborted && !cleanup ? 'CANCELLED' : 'STORAGE_TIMEOUT') : 'STORAGE_ERROR'); }
  }
  return {
    async read(path) { try { const t = await target(path); if ((await ctx.fs.stat(t, exec.signal))?.type !== 'file') throw failure(); return await ctx.fs.readBytes(t, exec.signal, LIMIT); } catch { throw failure(exec.signal?.aborted ? 'CANCELLED' : 'STORAGE_READ_ERROR'); } },
    async exists(path) { try { return (await ctx.fs.stat(await target(path), exec.signal))?.type === 'file'; } catch { throw failure(exec.signal?.aborted ? 'CANCELLED' : 'STORAGE_READ_ERROR'); } },
    async write(path, bytes) {
      validPath(path, true);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMIT) throw failure('STORAGE_TOO_LARGE');
      const held = scope.getStore(); if (!held?.active) throw failure('LOCK_REQUIRED');
      const p = (async () => { await target(path); await worker('write', held.token, path, bytes); })();
      held.pending.add(p); try { await p; } finally { held.pending.delete(p); }
    },
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
      if (locking) throw failure('LOCK_CONFLICT');
      locking = true;
      const held = { token: randomUUID(), active: true, pending: new Set<Promise<void>>() };
      let acquired = false;
      try {
        try { await worker('lock', held.token); acquired = true; }
        catch (error) {
          // Acquisition can commit just before cancellation; only our exact token
          // permits cleanup. Missing tokens and other owners remain untouched.
          if (exec.signal?.aborted) await worker('unlock', held.token, undefined, undefined, true).catch(() => {});
          throw error;
        }
        return await scope.run(held, fn);
      }
      finally {
        held.active = false;
        await Promise.allSettled(held.pending);
        try { if (acquired) await worker('unlock', held.token, undefined, undefined, true); }
        finally { locking = false; }
      }
    },
  };
}
