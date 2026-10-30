import { describe, it, expect } from 'vitest';
import worker from '../../infra/cloudflare/worker.mjs';
const origin = 'https://nam9nine.github.io';
const request = (path, options = {}) => new Request(`https://api.example.test${path}`, options);
describe('private recording gateway', () => {
  const path = '/v1/recordings/majima/00000000-0000-4000-8000-000000000001';
  it('forwards authenticated audio bytes to the private binding and never offers download', async () => {
    const calls = [];
    const env = {
      GATEWAY_SECRET: 'proof',
      CHAT_API: {
        fetch: async (url, options) => {
          calls.push({ url, options });
          return Response.json({ id: 'test' }, { status: 201 });
        },
      },
    };
    for (const mime of ['audio/webm;codecs=opus', 'audio/mp4']) {
      const audio = new Uint8Array([1, 2, 3, 4]);
      const response = await worker.fetch(
        request(path, {
          method: 'POST',
          headers: { Origin: origin, Authorization: 'Bearer synthetic', 'Content-Type': mime },
          body: audio,
        }),
        env,
      );
      expect(response.status).toBe(201);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const forwarded = calls.at(-1);
      expect(forwarded.url).toBe('http://kiryu-chat.internal' + path);
      expect(forwarded.options.headers.get('Content-Type')).toBe(mime);
      expect(forwarded.options.headers.get('Authorization')).toBe('Bearer synthetic');
      expect(forwarded.options.headers.get('X-Kiryu-Gateway')).toBe('proof');
      expect(forwarded.options.body).toEqual(audio);
    }
    expect((await worker.fetch(request(path), env)).status).toBe(405);
    const preflight = await worker.fetch(
      request(path, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(calls).toHaveLength(2);
  });
  it('rejects missing or empty bearer tokens before reading audio', async () => {
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
    for (const authorization of [null, 'Bearer ', 'Bearer', 'Basic token', 'Bearer two tokens']) {
      const headers = { Origin: origin, 'Content-Type': 'audio/webm' };
      if (authorization !== null) headers.Authorization = authorization;
      const upload = request(path, { method: 'POST', headers });
      Object.defineProperty(upload, 'body', {
        get() {
          throw new Error('Unauthenticated audio must not be read');
        },
      });
      const response = await worker.fetch(upload, env);
      expect(response.status).toBe(401);
    }
    expect(calls).toBe(0);
  });
  it('bounds audio at 2MiB without raising JSON request limits', async () => {
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
    const headers = {
      Origin: origin,
      Authorization: 'Bearer synthetic',
      'Content-Type': 'audio/webm',
    };
    expect(
      (
        await worker.fetch(
          request(path, { method: 'POST', headers, body: new Uint8Array(2 * 1024 * 1024) }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          request(path, { method: 'POST', headers, body: new Uint8Array(2 * 1024 * 1024 + 1) }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await worker.fetch(
          request(path, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'video/mp4' },
            body: 'x',
          }),
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await worker.fetch(
          request('/v1/chat', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: 'x'.repeat(16 * 1024 + 1),
          }),
          env,
        )
      ).status,
    ).toBe(413);
    expect(calls).toBe(1);
  });
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
