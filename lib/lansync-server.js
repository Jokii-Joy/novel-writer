/*
 * lansync-server.js — the TCP listener the phone talks to.
 *
 * Why this exists at all: `dsh web` binds the plugin's routes to 127.0.0.1 (the
 * plugin's HTTP prefix is served by the harness web server, which listens on the
 * loopback interface only). A phone on the same Wi-Fi therefore cannot reach
 * `pair.handshake` or `sync.*` — verified with netstat while pairing returned
 * 200 for the browser and timed out for any LAN address.
 *
 * So the LAN side gets its own minimal HTTP server on 0.0.0.0. It is deliberately
 * *not* a second copy of the plugin API:
 *
 *   - only four verbs exist (ping, pair/handshake, pair/accept, sync);
 *   - pairing paths are token-gated, sync paths are HMAC-gated with the secret
 *     issued at pairing time, so an unpaired device on the same Wi-Fi can read
 *     nothing;
 *   - no file access, no settings access, no AI — a compromised LAN port must not
 *     be able to do anything but move books.
 *
 * The protocol is JSON over HTTP with no keep-alive tricks, because the phone
 * side is hand-written Java and a longer-lived socket would only add failure
 * modes to debug at 1 a.m.
 */

import crypto from 'node:crypto';
import http from 'node:http';

import * as lansync from './lansync.js';

export const LAN_PROTOCOL = 'nw-lan/1';
export const DEFAULT_LAN_PORT = 41288;
const MAX_BODY_BYTES = 16 * 1024 * 1024; // a full library of prose, with room
const REQUEST_TIMEOUT_MS = 20_000;

let server = null;
let listeningPort = 0;
let lastError = '';

function str(value) {
  return value == null ? '' : String(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One JSON answer. `cache-control: no-store` matters: a phone that roams between
 * Wi-Fi and mobile data can otherwise replay a stale pairing payload.
 */
function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload == null ? {} : payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { code: 'payload-too-large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Canonical JSON for signing.
 *
 * Both sides must hash the *same bytes*. `JSON.stringify` is free to reorder
 * nothing but it does differ in whitespace from a hand-written Java builder, so
 * the phone sends its library as a base64url string and signs that exact string.
 * Keeping the body opaque here is what makes the signature checkable on both
 * ends without shipping a canonical-JSON implementation to Android.
 */
function verify(body, deviceId, signature) {
  return lansync.verifyPeer(deviceId, signature, body);
}

async function route(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '');

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  // ---- unauthenticated: identity only. A phone uses this to tell "the desktop
  // is here" from "some other device answered the broadcast".
  if (path === '/nw/v1/ping') {
    const identity = await lansync.publicIdentity(await lansync.deviceIdentity());
    send(res, 200, {
      ok: true,
      protocol: LAN_PROTOCOL,
      deviceId: identity.id,
      deviceName: identity.name,
      port: listeningPort,
      at: Date.now(),
    });
    return;
  }

  if (req.method !== 'POST') {
    send(res, 405, { ok: false, code: 'method-not-allowed', message: '这个地址只接受 POST' });
    return;
  }

  const raw = await readBody(req);
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      send(res, 400, { ok: false, code: 'bad-json', message: '请求体不是合法的 JSON' });
      return;
    }
    if (!isObject(payload)) {
      send(res, 400, { ok: false, code: 'bad-json', message: '请求体必须是对象' });
      return;
    }
  }

  // ---- pairing step 1: prove we are the desktop the QR came from.
  if (path === '/nw/v1/pair/handshake') {
    const result = await lansync.handshake(payload);
    send(res, result && result.ok === false ? 410 : 200, result);
    return;
  }

  // ---- pairing step 2: the phone posts its identity and receives the secret.
  //
  // The browser-side `pair.accept` strips the secret because the browser is the
  // desktop UI and has no use for it. Here it must come back: this response is
  // the *only* time the phone can learn the credential it will sign with, and
  // without it the phone could never authenticate (the earlier design did strip
  // it, which made every sync call fail with peer-denied).
  if (path === '/nw/v1/pair/accept') {
    const result = await lansync.acceptPairing(payload);
    if (!result || result.ok === false) {
      send(res, 410, result || { ok: false, code: 'pair-expired', message: '配对码已过期' });
      return;
    }
    const peers = await lansync.listPeers();
    const peer = peers.find((row) => str(row.id) === str(result.peer && result.peer.id)) || null;
    const secret = await lansync.peerSecret(result.peer && result.peer.id);
    const snapshot = await lansync.pullLibrary();
    send(res, 200, {
      ok: true,
      protocol: LAN_PROTOCOL,
      secret,
      peer,
      deviceId: (await lansync.publicIdentity(await lansync.deviceIdentity())).id,
      deviceName: (await lansync.publicIdentity(await lansync.deviceIdentity())).name,
      port: listeningPort,
      library: snapshot.library,
      books: snapshot.books,
    });
    return;
  }

  // ---- sync: HMAC-gated. `body` is the base64url of the library JSON, and the
  // signature covers exactly those bytes.
  if (path === '/nw/v1/sync' || path === '/nw/v1/library') {
    const deviceId = str(payload.deviceId);
    const signature = str(payload.signature);
    const signedBody = str(payload.body);
    if (!deviceId || !signature) {
      send(res, 401, { ok: false, code: 'peer-denied', message: '缺少设备凭据' });
      return;
    }
    const auth = await verify(signedBody, deviceId, signature);
    if (auth.ok === false) {
      send(res, 401, { ok: false, code: auth.code || 'peer-denied', message: auth.message || '设备未配对' });
      return;
    }

    if (path === '/nw/v1/library') {
      const snapshot = await lansync.pullLibrary();
      send(res, 200, { ok: true, library: snapshot.library, books: snapshot.books, at: Date.now() });
      return;
    }

    let library = null;
    try {
      library = JSON.parse(Buffer.from(signedBody, 'base64url').toString('utf8'));
    } catch (error) {
      send(res, 400, { ok: false, code: 'bad-json', message: '同步数据不是合法的 JSON' });
      return;
    }
    const merged = await lansync.applyRemote(library);
    // Only after the merge succeeded: 「上次同步」 has to mean "the two sides
    // actually met", not "the phone managed to open a socket".
    await lansync.markPeerSync(deviceId);
    send(res, 200, {
      ok: true,
      protocol: LAN_PROTOCOL,
      library: merged.library,
      books: merged.books,
      stats: merged.stats,
      at: Date.now(),
    });
    return;
  }

  send(res, 404, { ok: false, code: 'not-found', message: `没有这个接口：${path}` });
}

/**
 * Starts the listener. Idempotent: a second call returns the running port instead
 * of failing, because the plugin's settings page and the boot hook may both ask.
 */
export async function start(options = {}) {
  if (server && server.listening) {
    return { ok: true, already: true, port: listeningPort, addresses: addressList() };
  }
  const wanted = Number(options.port) > 0 ? Number(options.port) : DEFAULT_LAN_PORT;
  server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch (error) {
      send(res, 400, { ok: false, code: 'bad-url', message: '无法解析的地址' });
      return;
    }
    route(req, res, url).catch((error) => {
      const code = (error && error.code) || 'lan-error';
      const message = (error && error.message) || '局域网服务出错';
      lastError = message;
      try {
        send(res, 500, { ok: false, code, message });
      } catch {
        /* the socket may already be gone */
      }
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS + 5_000;
  server.keepAliveTimeout = 5_000;

  const bound = await new Promise((resolve) => {
    const onError = (error) => {
      server = null;
      lastError = (error && error.message) || String(error);
      resolve({ ok: false, code: 'lan-bind-failed', message: `局域网端口 ${wanted} 无法监听：${lastError}` });
    };
    server.once('error', onError);
    // 0.0.0.0 not a specific interface: the phone may be on Wi-Fi while a VPN
    // owns the default route, and binding the "primary" address would then be
    // silently unreachable.
    server.listen(wanted, '0.0.0.0', () => {
      server.removeListener('error', onError);
      listeningPort = server.address().port;
      resolve({ ok: true, port: listeningPort, addresses: addressList() });
    });
  });

  if (!bound.ok) return bound;
  // Keep the beacon in step with the real port: the phone finds us by UDP first.
  lansync.startDiscovery({ announcePort: listeningPort });
  return bound;
}

export function stop() {
  if (!server) return { ok: true, already: true };
  try {
    server.close();
  } catch {
    /* ignore */
  }
  server = null;
  listeningPort = 0;
  lansync.stopDiscovery();
  return { ok: true };
}

export function status() {
  return {
    running: Boolean(server && server.listening),
    port: listeningPort || DEFAULT_LAN_PORT,
    protocol: LAN_PROTOCOL,
    addresses: addressList(),
    primary: lansync.primaryAddress(),
    discovery: lansync.discoveryStatus(),
    error: lastError,
  };
}

/** Every LAN address the phone could use, most plausible first. */
export function addressList() {
  return lansync.lanAddresses().map((entry) => ({ address: entry.address, name: entry.name, url: `http://${entry.address}:${listeningPort || DEFAULT_LAN_PORT}` }));
}

/** Signs a body the way a paired phone signs it — used by the desktop self-test. */
export function signAs(secret, body) {
  return crypto.createHmac('sha256', Buffer.from(str(secret), 'base64url')).update(str(body)).digest('base64url');
}
