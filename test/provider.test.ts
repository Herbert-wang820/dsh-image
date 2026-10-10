import test from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from '../src/core.ts';
import { OpenAIImageProvider } from '../src/provider.ts';

const png = await new MockProvider().generate({ prompt: 'fixture', ratio: '1:1', model: 'mock-v1' });

test('OpenAI-compatible provider sends configured model without exposing key', async () => {
  let url = '', init: RequestInit | undefined;
  const request = async (input: string | URL | Request, options?: RequestInit) => {
    url = String(input); init = options;
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(png.bytes).toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const provider = new OpenAIImageProvider('https://images.example.test/v1/', 'top-secret', request as typeof fetch);
  const result = await provider.generate({ prompt: 'draw this', ratio: '1:1', model: 'gpt-image-1' });
  const body = JSON.parse(String(init?.body));
  assert.equal(url, 'https://images.example.test/v1/images/generations');
  assert.equal(body.model, 'gpt-image-1');
  assert.equal(body.prompt, 'draw this');
  assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer top-secret');
  assert.equal(result.mock, false);
  assert.deepEqual(Buffer.from(result.bytes), Buffer.from(png.bytes));
});

test('OpenAI-compatible provider rejects unsafe endpoint, missing key and unsupported ratio', async () => {
  assert.throws(() => new OpenAIImageProvider('file:///tmp/api', 'top-secret'), /INVALID_ENDPOINT/);
  const provider = new OpenAIImageProvider('https://images.example.test/v1', '', (async () => { throw new Error('must not request'); }) as typeof fetch);
  await assert.rejects(provider.generate({ prompt: 'x', ratio: '1:1', model: 'm' }), /CREDENTIAL_NOT_CONFIGURED/);
  const configured = new OpenAIImageProvider('https://images.example.test/v1', 'x', (async () => { throw new Error('must not request'); }) as typeof fetch);
  await assert.rejects(configured.generate({ prompt: 'x', ratio: '16:9', model: 'm' }), /UNSUPPORTED_RATIO/);
});
