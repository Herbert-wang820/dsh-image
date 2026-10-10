import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

export interface ConnectionSettings { provider: string; model: string; baseURL: string; apiKey: string }
export interface ConnectionResult { ok: boolean; code: string; model: string; status?: number }

/** Only queries model metadata; never submits an image generation request. */
export async function checkConnection(settings: ConnectionSettings, request: typeof fetch = fetch): Promise<ConnectionResult> {
  const result = (ok: boolean, code: string, status?: number): ConnectionResult => ({ ok, code, model: settings.model, ...(status === undefined ? {} : { status }) });
  if (settings.provider === 'disabled') return result(false, 'DISABLED');
  if (settings.provider === 'mock') return result(settings.model === 'mock-v1', settings.model === 'mock-v1' ? 'MOCK_READY' : 'INVALID_MODEL');
  if (settings.provider !== 'openai') return result(false, 'INVALID_CONFIG');
  let endpoint: string;
  try {
    const url = new URL(settings.baseURL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return result(false, 'INVALID_ENDPOINT');
    if (!settings.model.trim()) return result(false, 'INVALID_CONFIG');
    endpoint = settings.baseURL.replace(/\/+$/, '') + '/models/' + encodeURIComponent(settings.model);
  } catch { return result(false, 'INVALID_ENDPOINT'); }
  const key = settings.apiKey;
  if (!key) return result(false, 'CREDENTIAL_NOT_CONFIGURED');
  try {
    const response = await request(endpoint, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return result(false, 'AUTH_FAILED', response.status); }
    if (response.status === 404 || response.status === 405 || response.status === 501) { await response.body?.cancel(); return result(false, 'MODEL_OR_ENDPOINT_UNAVAILABLE', response.status); }
    if (!response.ok) { await response.body?.cancel(); return result(false, response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', response.status); }
    // Limit metadata reads, including chunked responses, and do not return provider text.
    const reader = response.body?.getReader();
    if (!reader) return result(false, 'INVALID_RESPONSE');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 1024 * 1024) { await reader.cancel(); return result(false, 'INVALID_RESPONSE'); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body?.id === settings.model ? result(true, 'CONNECTED') : result(false, 'MODEL_MISMATCH');
  } catch (error) {
    return result(false, (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_OR_RESPONSE_ERROR');
  }
}

/** DSH Gateway discovers the public Remote marker without TS decorator syntax. */
export class VisualConnectionService extends TypertRemoteService {
  private readSettings: () => ConnectionSettings;
  constructor(ctx: any, readSettings: () => ConnectionSettings) {
    super(ctx, 'autoVisualConnection');
    this.readSettings = readSettings;
    for (const initialize of initializers) initialize.call(this);
  }
  async checkConnection(): Promise<ConnectionResult> {
    try { return await checkConnection(this.readSettings()); }
    catch { return { ok: false, code: 'INVALID_CONFIG', model: '' }; }
  }
}
const initializers: ((this: VisualConnectionService) => void)[] = [];
Remote(VisualConnectionService.prototype.checkConnection, {
  kind: 'method', name: 'checkConnection', static: false, private: false,
  addInitializer: (initializer: (this: VisualConnectionService) => void) => { initializers.push(initializer); },
} as any);
