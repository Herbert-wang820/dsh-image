import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, readProfilePatches, loadProfileDirectory, evaluatePluginCompatibility, getDshRuntimeVersion, pluginCompatibilityWarning } from '@deepseek-ai/dsh-app-boot';
import { parse } from 'yaml';

// The packaging contract an installer and the harness both read: the dsh.bundle
// manifest, the bundle patch beside it, the peer ranges the harness gates on,
// and the exports map that turns the patch row into a running plugin. Everything
// here is the real app-boot code path; only the unrelated host capabilities are
// inert, and the "installed" package is this workspace reached through a
// node_modules symlink, exactly as a profile install would resolve it.
const pluginDir = fileURLToPath(new URL('..', import.meta.url));

test('the dsh bundle manifest installs through the real profile and patch path', async t => {
  const manifest = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh?.bundle, { patch: './cordis.patch.yml' },
    'installability requires dsh.bundle.patch; dsh.client alone is not installable');

  const rows = parse(await readFile(join(pluginDir, 'cordis.patch.yml'), 'utf8'));
  const inserted = rows.find((row: any) => Array.isArray(row.insert))?.insert ?? [];
  assert.deepEqual(inserted.map((row: any) => ({ id: row.id, name: row.name })),
    [{ id: 'auto-visual', name: 'dsh-auto-visual' }], 'the bundle patch must insert the plugin row');
  assert.equal(inserted[0].name, manifest.name, 'the patch row must name this package');

  const runtime = getDshRuntimeVersion();
  const issue = evaluatePluginCompatibility(manifest, {}, runtime);
  assert.equal(issue, undefined, `peer ranges must accept the running harness: ${issue && pluginCompatibilityWarning(issue)}`);

  // `dsh.client.inject` orders the browser module graph, so every entry must be a
  // package that actually declares a client half. A bundled library (react,
  // ui-primitives) belongs to no graph row and must not be listed here.
  for (const dependency of manifest.dsh.client.inject as string[]) {
    const dependencyManifest = JSON.parse(await readFile(join(pluginDir, 'node_modules', dependency, 'package.json'), 'utf8'));
    assert.ok(dependencyManifest.dsh?.client, `${dependency} is listed in dsh.client.inject but declares no dsh.client`);
  }

  const dir = await mkdtemp(fileURLToPath(new URL('.manifest-integration-', import.meta.url)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home);
  await mkdir(join(dir, 'node_modules'));
  await symlink(pluginDir, join(dir, 'node_modules', 'dsh-auto-visual'), 'dir');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: ['dsh-auto-visual'] } } }));
  await writeFile(join(dir, 'cordis.yml'), '[]\n');
  await writeFile(join(dir, 'cordis.patch.yml'), '[]\n');

  const context = {
    name: 'manifest-integration', dir, home, cwd: dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(dir, 'package.json'),
    startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  };

  const profile = loadProfileDirectory('manifest-integration', dir, context.installAnchor);
  assert.deepEqual(profile.skippedBundles, [], 'the bundle must not be skipped by the profile loader');
  assert.equal(profile.layers[0]?.packageName, 'dsh-auto-visual');
  assert.ok(profile.layers[0]!.patchPaths.some(file => file.endsWith('cordis.patch.yml')),
    'the loader must read the bundle patch the manifest names');

  const tools: any[] = [];
  const ctx = await boot('manifest-integration', join(dir, 'cordis.yml'), readProfilePatches('manifest-integration', context), async (ctx: any) => {
    ctx.provide('profileContext', context);
    for (const name of ['fs', 'sandboxPolicy', 'sandbox', 'subprocess']) ctx.provide(name, {});
    ctx.provide('tools', { register(tool: any) { tools.push(tool); } });
    ctx.provide('systemPrompt', { section() {} });
  });
  t.after(() => ctx.fiber.dispose());
  await ctx.loader.await();

  assert.ok(ctx.autoVisualConnection, 'resolving the package must run the plugin apply and register its service');
  assert.equal(tools.length, 3, 'the loaded package must register its three tools');
  // The patch row's own defaults decide this answer, so it proves the bundle
  // patch reached the plugin rather than the schema defaults alone.
  assert.deepEqual(await ctx.autoVisualConnection.checkConnection(), { ok: false, code: 'DISABLED', model: 'mock-v1' });
});
