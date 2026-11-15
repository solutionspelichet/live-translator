// DualCast web relay — a Cloudflare Worker you deploy on YOUR OWN account (free plan is enough). See proxy/README.md.
//
// A web page cannot (1) call DeepL (no CORS headers) nor (2) send headers on a WebSocket (BytePlus / Doubao wants X-Api-Key). This relay does both:
//   GET/POST  /fetch?url=<encoded https url>   → forwards the request (method, body, headers) and adds CORS headers to the answer
//   WS        /ws?url=<encoded wss url>        → opens the upstream WebSocket with the headers given in the sub-protocol « dc-h.<base64url(JSON)> »
//
// Safety: only the hosts in ALLOWED_HOSTS are reachable (it is not an open proxy), only from the origins in ALLOWED_ORIGINS when you set them,
// and nothing is stored or logged: the keys pass through, they are not kept.

const ALLOWED_HOSTS = ['api.deepl.com', 'api-free.deepl.com', 'voice.ap-southeast-1.bytepluses.com', 'openspeech.bytedance.com'];
// Set your own page here (recommended), e.g. ['https://your-name.github.io']. Empty list = any origin.
const ALLOWED_ORIGINS = [];

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

function parseHeadersProtocol(protocol) {
  const m = /^dc-h\.([A-Za-z0-9_-]+)$/.exec(String(protocol || '').trim());
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

function target(request) {
  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return ALLOWED_HOSTS.includes(url.host) ? url : null;
}

const originOk = (origin) => !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin);

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const path = new URL(request.url).pathname;
    if (!originOk(origin) && origin) return new Response('origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = target(request);
    if (!url) return new Response('host not allowed', { status: 403, headers: cors(origin) });

    if (path === '/fetch') {
      const headers = new Headers(request.headers);
      for (const h of ['origin', 'referer', 'host', 'cf-connecting-ip', 'x-forwarded-for']) headers.delete(h);
      const upstream = await fetch(url.toString(), { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body });
      const out = new Response(upstream.body, upstream);
      for (const [k, v] of Object.entries(cors(origin))) out.headers.set(k, v);
      return out;
    }

    if (path === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426, headers: cors(origin) });
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const carried = protocols.find((p) => p.startsWith('dc-h.'));
      const extra = (carried && parseHeadersProtocol(carried)) || {};
      const upstreamHeaders = { Upgrade: 'websocket', ...extra };
      const upstream = await fetch(url.toString().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), { headers: upstreamHeaders });
      const upstreamSocket = upstream.webSocket;
      if (!upstreamSocket) return new Response(`upstream refused (${upstream.status})`, { status: 502, headers: cors(origin) });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      upstreamSocket.accept();
      server.addEventListener('message', (e) => upstreamSocket.send(e.data));
      upstreamSocket.addEventListener('message', (e) => server.send(e.data));
      const closeBoth = (code, reason) => {
        try { server.close(code || 1000, reason); } catch {}
        try { upstreamSocket.close(code || 1000, reason); } catch {}
      };
      server.addEventListener('close', (e) => closeBoth(e.code, e.reason));
      upstreamSocket.addEventListener('close', (e) => closeBoth(e.code, e.reason));
      server.addEventListener('error', () => closeBoth(1011, 'error'));
      upstreamSocket.addEventListener('error', () => closeBoth(1011, 'error'));
      // Echo one of the offered sub-protocols (a browser closes the socket otherwise); never the one that carries the headers' content.
      const echoed = protocols.find((p) => !p.startsWith('dc-h.'));
      return new Response(null, { status: 101, webSocket: client, headers: echoed ? { 'Sec-WebSocket-Protocol': echoed } : {} });
    }

    return new Response('DualCast relay: /fetch?url=… or /ws?url=…', { status: 200, headers: cors(origin) });
  },
};
