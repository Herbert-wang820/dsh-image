#!/usr/bin/env node
/**
 * Install dsh-auto-visual into a DSH profile.
 *
 * DSH installs plugins through the profile's own package manager, so this
 * script builds the local package and then delegates to
 * `dsh plugin --profile <profile> add <path>`, which pnpm-installs the package
 * and reconciles `dsh.profile.bundles` automatically.
 *
 * The profile directory (~/.dsh/profiles/<profile>) must be writable. When the
 * filesystem is mounted read-only the script stops with a clear message instead
 * of leaving a half-written profile behind.
 *
 * Usage:
 *   node scripts/install.mjs [--profile web] [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'web';

if (!profile || profile.startsWith('--')) {
  console.error('install: --profile needs a value (for example: --profile web)');
  process.exit(1);
}

const dshHome = process.env.DSH_HOME ?? resolve(process.env.HOME ?? '/root', '.dsh');
const profileDir = resolve(dshHome, 'profiles', profile);

function step(message) {
  console.log(`\n== ${message}`);
}

step(`Installing ${JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).name} into profile "${profile}"`);

// 1. The package must be built: dist/index.js (host half) and dist/client.js (browser half).
step('Checking build artifacts');
const required = ['dist/index.js', 'dist/client.js', 'cordis.patch.yml', 'package.json'];
for (const file of required) {
  const full = resolve(packageRoot, file);
  if (!existsSync(full)) {
    console.error(`install: missing ${file} — run "npm run build" first`);
    process.exit(1);
  }
  console.log(`  ok  ${file}`);
}

// 2. dsh.bundle is what makes the package installable; dsh.client alone is not.
step('Checking bundle manifest');
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
if (manifest.dsh?.bundle?.patch === undefined) {
  console.error('install: package.json is missing dsh.bundle.patch — "dsh plugin add" cannot install it');
  process.exit(1);
}
console.log(`  bundle   : ${manifest.dsh.bundle.patch}`);

// 3. The browser half declares dsh.client; without it DSH serves no settings page.
step('Checking client-plugin manifest');
const client = manifest.dsh?.client;
if (!client) {
  console.error('install: package.json is missing dsh.client — the settings page would not load');
  process.exit(1);
}
console.log(`  platform : ${client.platform}`);
console.log(`  inject   : ${(client.inject ?? []).join(', ') || '(none)'}`);
if (!manifest.exports?.['./client']) {
  console.error('install: package.json exports no "./client" entry — DSH cannot resolve the browser bundle');
  process.exit(1);
}
console.log(`  exports  : ./client -> ${manifest.exports['./client']}`);

// 3. The profile must be writable; the whole install is a profile-local package write.
step(`Checking profile directory ${profileDir}`);
if (!existsSync(profileDir)) {
  console.error(`install: profile "${profile}" does not exist at ${profileDir}`);
  console.error(`install: create it once with "dsh --profile ${profile}" or pass --profile <name>`);
  process.exit(1);
}
try {
  accessSync(profileDir, constants.W_OK);
  console.log('  writable: yes');
} catch {
  console.error(`install: ${profileDir} is not writable.`);
  console.error('install: remount the filesystem read-write (or run this where the profile lives), then retry.');
  console.error('install: nothing was modified.');
  process.exit(1);
}

if (dryRun) {
  step('Dry run complete — no changes made');
  console.log(`  would run: dsh plugin --profile ${profile} add ${packageRoot}`);
  process.exit(0);
}

// 4. Delegate the actual install so DSH owns dependency and bundle reconciliation.
step(`Running: dsh plugin --profile ${profile} add ${packageRoot}`);
try {
  execFileSync('dsh', ['plugin', '--profile', profile, 'add', packageRoot], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
} catch (error) {
  console.error(`\ninstall: dsh plugin add failed (${error?.message ?? error})`);
  process.exit(1);
}

step('Installed');
console.log('  Next: restart the DSH host serving the Web GUI so the new loader row mounts,');
console.log('  then refresh the page and open Settings — "Image Generation" appears in the nav.');
console.log('  Verify the host half with: dsh plugin --profile ' + profile + ' list');
