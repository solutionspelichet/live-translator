// Web version only: what a browser cannot do on its own (pure → unit-tested).
//  - DeepL answers no cross-origin (CORS) request from a web page;
//  - a browser WebSocket cannot send headers, and BytePlus (Doubao) wants an `X-Api-Key` header.
// Both go through a small relay the user runs on their own Cloudflare account (proxy/worker.js): it adds the CORS headers / the WebSocket headers
// and forwards to a fixed list of hosts. The address of that relay is a setting (« Passerelle web »).

/** Hosts a page cannot call directly. */
export const FETCH_PROXY_HOSTS = Object.freeze(['api.deepl.com', 'api-free.deepl.com']);
/** Hosts whose WebSocket needs headers a browser cannot send. */
export const WS_PROXY_HOSTS = Object.freeze(['voice.ap-southeast-1.bytepluses.com', 'openspeech.bytedance.com']);

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const base = (proxy) => String(proxy ?? '').trim().replace(/\/+$/, '');

export const needsFetchProxy = (url) => FETCH_PROXY_HOSTS.includes(hostOf(url));
export const needsWsProxy = (url) => WS_PROXY_HOSTS.includes(hostOf(url));

/** The relay's URL for a fetch to `url`. */
export const proxyFetchUrl = (proxy, url) => `${base(proxy)}/fetch?url=${encodeURIComponent(url)}`;

/** The relay's WebSocket URL for `url` (http(s) → ws(s)). */
export const proxyWsUrl = (proxy, url) => `${base(proxy).replace(/^http/i, 'ws')}/ws?url=${encodeURIComponent(url)}`;

const b64url = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Headers to add to the upstream WebSocket, carried in a sub-protocol (the one thing a browser WebSocket can send): `dc-h.<base64url(JSON)>`. */
export const headersProtocol = (headers) => `dc-h.${b64url(JSON.stringify(headers))}`;

/** Inverse of headersProtocol, used by the relay (and the tests). */
export function parseHeadersProtocol(protocol) {
  const m = /^dc-h\.([A-Za-z0-9_-]+)$/.exec(String(protocol ?? '').trim());
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

// ───────────── runtime helpers (no React Native import: the services that use them run under node in the tests) ─────────────
let relay;
export const setWebProxy = (url) => {
  relay = String(url ?? '').trim().replace(/\/+$/, '') || undefined;
};
export const getWebProxy = () => relay;
/** A page in a browser (React Native has no `document`). */
export const isWeb = () => typeof document !== 'undefined';

/** fetch that goes through the user's relay for the hosts a web page cannot call (DeepL); a plain fetch everywhere else and on the phone. */
export function webFetch(url, init) {
  if (isWeb() && relay && needsFetchProxy(url)) return fetch(proxyFetchUrl(relay, url), init);
  return fetch(url, init);
}

/**
 * Opens a WebSocket the way the platform allows. On the phone (React Native) headers go in a third argument. A browser cannot send headers:
 *  - through the user's relay for the hosts that need them (BytePlus / Doubao);
 *  - or with `webProtocols` (OpenAI takes its key as a sub-protocol);
 *  - or plainly (the service must then accept the key in the URL / first message, as Gemini and ElevenLabs do).
 */
export function openSocket(WebSocketImpl, url, { protocols, headers, webProtocols } = {}) {
  if (!isWeb()) {
    if (headers) return new WebSocketImpl(url, protocols, { headers });
    return protocols ? new WebSocketImpl(url, protocols) : new WebSocketImpl(url);
  }
  if (headers && relay && needsWsProxy(url)) return new WebSocketImpl(proxyWsUrl(relay, url), [...(protocols ?? []), headersProtocol(headers)]);
  const wanted = webProtocols ?? protocols;
  return wanted ? new WebSocketImpl(url, wanted) : new WebSocketImpl(url);
}
