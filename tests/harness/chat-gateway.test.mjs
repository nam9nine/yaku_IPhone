import { describe, it, expect } from 'vitest';
import worker from '../../infra/cloudflare/worker.mjs';
const origin = 'https://nam9nine.github.io';
const request = (path, options = {}) => new Request(`https://api.example.test${path}`, options);
describe('fixed chat gateway', () => {
  it('never routes owner/model/arbitrary paths or origins', async () => {
    for (const path of ['/admin', '/v1/chat/../admin', '/completion', '/v1/slots'])
      expect((await worker.fetch(request(path), {})).status).toBe(404);
    expect(
      (await worker.fetch(request('/v1/health', { headers: { Origin: 'https://evil.test' } }), {}))
        .status,
    ).toBe(403);
  });
  it('forwards only the private binding with replaced proof and IP headers', async () => {
    let captured;
    const response = await worker.fetch(
      request('/v1/chat', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'X-Kiryu-Gateway': 'forged',
          'X-Kiryu-Client-IP': 'forged',
          'CF-Connecting-IP': '192.0.2.3',
        },
      }),
      {
        GATEWAY_SECRET: 'server-only-proof',
        CHAT_API: {
          fetch: async (url, options) => {
            captured = { url, options };
            return Response.json({ job_id: 'test' });
          },
        },
      },
    );
    expect(response.status).toBe(200);
    expect(captured.url).toBe('http://kiryu-chat.internal/v1/chat');
    expect(captured.options.headers.get('X-Kiryu-Gateway')).toBe('server-only-proof');
    expect(captured.options.headers.get('X-Kiryu-Client-IP')).toBe('192.0.2.3');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.has('X-Kiryu-Gateway')).toBe(false);
  });
  it('rejects oversized bodies and upstream redirects without following', async () => {
    const env = {
      GATEWAY_SECRET: 'proof',
      CHAT_API: {
        fetch: async () =>
          new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }),
      },
    };
    expect(
      (
        await worker.fetch(
          request('/v1/sessions', {
            method: 'POST',
            body: 'x'.repeat(17000),
            headers: { 'Content-Type': 'application/json' },
          }),
          env,
        )
      ).status,
    ).toBe(413);
    expect((await worker.fetch(request('/v1/health'), env)).status).toBe(502);
    expect((await worker.fetch(request('/v1/history?url=https://evil.test'), env)).status).toBe(
      400,
    );
  });
});
