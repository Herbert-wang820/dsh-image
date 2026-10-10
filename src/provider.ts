import { createHash } from 'node:crypto';
import { VisualError } from './core.ts';
import type { ImageProvider, Ratio } from './core.ts';

/** OpenAI-compatible Images API. No automatic retries or URL downloads. */
export class OpenAIImageProvider implements ImageProvider {
  readonly id: string;
  private endpoint: string;
  private apiKey: string;
  private request: typeof fetch;
  constructor(baseURL: string, apiKey: string, request: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.request = request;
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VisualError('INVALID_ENDPOINT');
    this.endpoint = baseURL.replace(/\/+$/, '') + '/images/generations';
    this.id = 'openai-' + createHash('sha256').update(this.endpoint).digest('hex').slice(0, 16);
  }
  validate(input: { ratio: Ratio; model: string }) {
    if (!this.apiKey) throw new VisualError('CREDENTIAL_NOT_CONFIGURED');
    if (input.ratio !== '1:1') throw new VisualError('UNSUPPORTED_RATIO');
  }
  async generate(input: { prompt: string; ratio: Ratio; model: string; signal?: AbortSignal }) {
    this.validate(input);
    const key = this.apiKey;
    const size = '1024x1024';
    const response = await this.request(this.endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: input.model, prompt: input.prompt, n: 1, size, output_format: 'png' }),
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new VisualError('PROVIDER_ERROR');
    const body = await response.json() as { data?: { b64_json?: string }[] };
    const encoded = body.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || encoded.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new VisualError('INVALID_OUTPUT');
    return { bytes: new Uint8Array(Buffer.from(encoded, 'base64')), mime: 'image/png' as const, mock: false };
  }
}
