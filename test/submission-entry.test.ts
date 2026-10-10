import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Constraints the awesome-dsh-plugin list states for a submission entry. They are
// checked here so a local edit cannot silently break the PR: one file per plugin,
// a url that matches the repository exactly, a category from the published set,
// and descriptions that read as one accurate line.
const CATEGORIES = ['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security', 'remote', 'market', 'fun'];
const entryDir = fileURLToPath(new URL('../docs/submission/data/plugins/', import.meta.url));

test('the submission entry satisfies the list contribution rules', async () => {
  const file = join(entryDir, 'Herbert-wang820__dsh-image.yml');
  const entry = parse(await readFile(file, 'utf8'));

  // File name is <owner>__<repo>.yml and the entry names the same repository.
  assert.equal(basename(file), 'Herbert-wang820__dsh-image.yml');
  const match = /^([^_]+)__([^.]+)\.yml$/.exec(basename(file))!;
  assert.equal(entry.name, `${match[1]}/${match[2]}`, 'name must be owner/repo of the entry file');
  assert.equal(entry.url, `https://github.com/${entry.name}`, 'url must match the repository exactly');
  assert.equal(entry.url.endsWith('.git'), false, 'url must be the browse URL, not the clone URL');

  assert.ok(CATEGORIES.includes(entry.category), `category ${entry.category} is outside the published set`);
  assert.equal(entry.category, 'vision', 'this plugin generates images');

  assert.ok(Object.hasOwn(entry.description, 'en'), 'description.en is required');
  assert.equal(entry.description.en.trim().endsWith('.'), true, 'description.en must end with a period');
  if (Object.hasOwn(entry.description, 'zh')) assert.equal(entry.description.zh.trim().endsWith('。'), true, 'description.zh must end with a full stop');
  for (const [locale, text] of Object.entries(entry.description)) {
    assert.equal(typeof text, 'string');
    assert.equal(text.includes('\n'), false, `${locale} description must be one line`);
    assert.equal(/(^|\s):\s/.test(text), false, `${locale} description must not carry an unquoted ": "`);
    assert.equal(/[!！]|best|ultimate|powerful|最强|最好/i.test(text), false, `${locale} description must state function, not marketing`);
  }

  // Fields the list refuses on an entry.
  for (const rejected of ['npm', 'screenshots']) assert.equal(Object.hasOwn(entry, rejected), false, `${rejected} is not an entry field`);
});
