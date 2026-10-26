/** A fixed, bounded gateway. Only CHAT_API is bound to Mac's chat port. */
const ORIGIN = 'https://nam9nine.github.io';
const LIMIT = 16 * 1024;
const routes = new Map([
  ['/v1/health', ['GET']],
  ['/v1/sessions', ['POST']],
  ['/v1/history', ['GET']],
  ['/v1/chat', ['POST']],
  ['/v1/push/key', ['GET']],
  ['/v1/push/subscriptions', ['POST', 'DELETE']],
]);
function headers(origin) {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    ...(origin === ORIGIN ? { 'Access-Control-Allow-Origin': ORIGIN, Vary: 'Origin' } : {}),
  };
}
function error(status, code, origin) {
  return new Response(JSON.stringify({ error: { code, message: '잠시 후 다시 시도해 주세요.' } }), {
    status,
    headers: headers(origin),
  });
}
async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMIT) throw new RangeError('request size');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== ORIGIN) return error(403, 'origin_denied', null);
    const expected =
      routes.get(url.pathname) ??
      (/^\/v1\/jobs\/[0-9a-f-]{36}$/i.test(url.pathname) ? ['GET'] : null);
    if (!expected) return error(404, 'not_found', origin);
    if (request.method === 'OPTIONS') {
      if (!expected.includes(request.headers.get('Access-Control-Request-Method')))
        return error(405, 'method_denied', origin);
      return new Response(null, {
        status: 204,
        headers: {
          ...headers(origin),
          'Access-Control-Allow-Methods': expected.join(', '),
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '300',
        },
      });
    }
    if (!expected.includes(request.method)) return error(405, 'method_denied', origin);
    const allowedQuery = url.pathname === '/v1/history' ? ['character', 'cursor'] : [];
    if ([...url.searchParams.keys()].some((key) => !allowedQuery.includes(key)))
      return error(400, 'invalid_query', origin);
    if (!env.CHAT_API || !env.GATEWAY_SECRET) return error(503, 'unavailable', origin);
    const forwarding = new Headers();
    if (origin) forwarding.set('Origin', origin);
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      if (authorization.length > 256 || !authorization.startsWith('Bearer '))
        return error(401, 'unauthorized', origin);
      forwarding.set('Authorization', authorization);
    }
    forwarding.set('X-Kiryu-Gateway', env.GATEWAY_SECRET);
    forwarding.set('X-Kiryu-Client-IP', request.headers.get('CF-Connecting-IP') ?? 'unknown');
    let body;
    if (request.method === 'POST' || request.method === 'DELETE') {
      if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
        return error(415, 'content_type', origin);
      try {
        body = await limitedBody(request);
      } catch {
        return error(413, 'body_too_large', origin);
      }
      forwarding.set('Content-Type', 'application/json');
    }
    try {
      const upstream = await env.CHAT_API.fetch(
        `http://kiryu-chat.internal${url.pathname}${url.search}`,
        {
          method: request.method,
          headers: forwarding,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (upstream.status >= 300 && upstream.status < 400)
        return error(502, 'upstream_redirect', origin);
      // Never forward cookies, authentication challenges, provider diagnostics,
      // Location headers, or user-selected destinations.
      if (!upstream.headers.get('Content-Type')?.startsWith('application/json'))
        return error(502, 'upstream_format', origin);
      return new Response(upstream.body, { status: upstream.status, headers: headers(origin) });
    } catch {
      return error(503, 'unavailable', origin);
    }
  },
};
