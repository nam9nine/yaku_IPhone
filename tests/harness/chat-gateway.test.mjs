import { describe, it, expect } from 'vitest';
import worker from '../../infra/cloudflare/worker.mjs';
const origin = 'https://nam9nine.github.io';
const request = (path, options = {}) => new Request(`https://api.example.test${path}`, options);
it('rejects retired audio uploads without reading the body or calling the Mac', async () => {
  const path = '/v1/recordings/majima/00000000-0000-4000-8000-000000000001';
  let calls = 0;
  const env = {
    GATEWAY_SECRET: 'proof',
    CHAT_API: {
      fetch: async () => {
        calls++;
        return Response.json({});
      },
    },
  };
  const upload = request(path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'audio/webm' },
  });
  Object.defineProperty(upload, 'body', {
    get() {
      throw new Error('Audio body must not be read');
    },
  });
  const response = await worker.fetch(upload, env);
  expect(response.status).toBe(410);
  expect((await response.json()).error.code).toBe('recording_disabled');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(calls).toBe(0);
  expect((await worker.fetch(request(path), env)).status).toBe(405);
  const preflight = await worker.fetch(
    request(path, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    }),
    env,
  );
  expect(preflight.status).toBe(204);
});
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

describe('push gateway', () => {
  it('forwards authenticated subscription bodies for POST and DELETE only', async () => {
    const calls = [];
    const env = {
      GATEWAY_SECRET: 'proof',
      CHAT_API: {
        fetch: async (url, options) => {
          calls.push({ url, options });
          return Response.json({ ok: true });
        },
      },
    };
    for (const method of ['POST', 'DELETE']) {
      const result = await worker.fetch(
        request('/v1/push/subscriptions', {
          method,
          headers: {
            Origin: origin,
            Authorization: 'Bearer synthetic',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endpoint: 'https://web.push.apple.com/example' }),
        }),
        env,
      );
      expect(result.status).toBe(200);
      const call = calls.at(-1);
      expect(call.url).toBe('http://kiryu-chat.internal/v1/push/subscriptions');
      expect(call.options.method).toBe(method);
      expect(call.options.headers.get('Authorization')).toBe('Bearer synthetic');
      expect(new TextDecoder().decode(call.options.body)).toContain('endpoint');
    }
    expect((await worker.fetch(request('/v1/push/subscriptions'), env)).status).toBe(405);
    expect((await worker.fetch(request('/v1/push/send'), env)).status).toBe(404);
    expect((await worker.fetch(request('/v1/push/key'), env)).status).toBe(200);
    expect((await worker.fetch(request('/v1/push/key?url=https://evil.test'), env)).status).toBe(
      400,
    );
  });
  it('allows DELETE preflight only on the subscription route', async () => {
    const options = {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'DELETE' },
    };
    const response = await worker.fetch(request('/v1/push/subscriptions', options), {});
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, DELETE');
    expect((await worker.fetch(request('/v1/chat', options), {})).status).toBe(405);
    expect((await worker.fetch(request('/v1/push/key', options), {})).status).toBe(405);
  });
  it('bounds and validates DELETE bodies before forwarding', async () => {
    let calls = 0;
    const env = {
      GATEWAY_SECRET: 'proof',
      CHAT_API: {
        fetch: async () => {
          calls++;
          return Response.json({});
        },
      },
    };
    expect(
      (
        await worker.fetch(
          request('/v1/push/subscriptions', { method: 'DELETE', body: 'bad' }),
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await worker.fetch(
          request('/v1/push/subscriptions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: 'x'.repeat(17000),
          }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(calls).toBe(0);
  });
});
