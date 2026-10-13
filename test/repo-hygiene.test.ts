import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// A guard for the repository itself: nothing that ships may carry a credential,
// a private-key block, a local home path, or a link to a host we do not mean to
// publish. Generated artifacts are the realistic leak path — a document can embed
// an endpoint no source file names — so office packages are read through their
// XML parts and checked like any other text.
const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.dsh-auto-visual']);

// Public infrastructure, RFC 2606 reserved names, and this project's own home.
// Anything else in a text part is reported rather than tolerated.
const HOST_ALLOWLIST = [
  'github.com', 'githubusercontent.com', 'npmjs.org', 'npmjs.com', 'nodejs.org',
  'openai.com', 'deepseek.com', 'openxmlformats.org', 'w3.org', 'purl.org',
  'iptc.org', 'ssl.com', 'localhost',
];
const RESERVED_TLD = /\.(test|example|invalid|localhost)$/i;

const RULES: { label: string; pattern: RegExp }[] = [
  { label: 'credential', pattern: /sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { label: 'private key', pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { label: 'local home path', pattern: /\/root\/|\/home\/[a-z0-9_-]+\/|[A-Za-z]:\\Users\\/ },
];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || /-integration-/.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Read one archive's text members, so an embedded document is checked, not skipped. */
function zipTextParts(bytes: Buffer): { where: string; text: string }[] {
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return [];
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const parts: { where: string; text: string }[] = [];
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.(xml|rels|txt|json|ya?ml)$/i.test(name) || localAt === 0) continue;
    const start = localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
    const raw = bytes.subarray(start, start + compressed);
    try {
      parts.push({ where: name, text: (method === 8 ? inflateRawSync(raw) : raw).toString('utf8') });
    } catch {
      parts.push({ where: name, text: '' });
    }
  }
  return parts;
}

/** Every text-bearing part of one file: itself, or an archive's text members. */
async function parts(file: string): Promise<{ where: string; text: string }[]> {
  const bytes = await readFile(file);
  if (bytes.subarray(0, 2).toString('latin1') === 'PK') return zipTextParts(bytes);
  if (bytes.includes(0)) return [];   // binary media carries no text we authored
  return [{ where: '', text: bytes.toString('utf8') }];
}

test('no credential, local path or unintended host ships in tracked content', async () => {
  const files = await walk(root);
  assert.ok(files.length > 10, 'the repository scan must actually see the project files');
  const findings: string[] = [];

  for (const file of files) {
    const name = relative(root, file).split(sep).join('/');
    for (const { where, text } of await parts(file)) {
      const at = where ? `${name} :: ${where}` : name;
      for (const rule of RULES) {
        const match = rule.pattern.exec(text);
        if (match) findings.push(`${at}: ${rule.label} ${JSON.stringify(match[0].slice(0, 40))}`);
      }
      for (const url of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        const host = url[1].toLowerCase();
        if (RESERVED_TLD.test(host)) continue;
        if (HOST_ALLOWLIST.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) continue;
        findings.push(`${at}: unpublished host ${JSON.stringify(host)}`);
      }
    }
  }

  assert.deepEqual(findings, [], `content that must not be published:\n  ${findings.join('\n  ')}`);
});

test('the committed example document records no endpoint host', async () => {
  const doc = join(root, 'docs', 'auto-visual-generation-test.docx');
  try {
    await stat(doc);
  } catch {
    return;   // the example is optional; its absence is not a finding
  }
  const text = (await parts(doc)).map(part => part.text).join('\n');
  assert.equal(/接口主机|endpoint host/i.test(text), false, 'the example document must not record an endpoint host');
});
