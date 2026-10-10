import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const file of await readdir(new URL('../src/', import.meta.url))) {
  if (!file.endsWith('.ts')) continue;
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source, { mode: 'strip' })
    .replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2');
  await writeFile(new URL(`../dist/${file.replace(/\.ts$/, '.js')}`, import.meta.url), js);
}
console.log('Built ESM artifacts in dist (syntax stripping; not a TypeScript typecheck).');
