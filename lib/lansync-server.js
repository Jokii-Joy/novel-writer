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
 *   - only a handful of verbs exist (ping, pair/handshake, pair/accept, sync,
 *     ai/proofread);
 *   - pairing paths are token-gated, sync and AI paths are HMAC-gated with the
 *     secret issued at pairing time, so an unpaired device on the same Wi-Fi can
 *     read nothing and, more importantly, cannot spend the writer's model quota;
 *   - no file access, no settings access — a compromised LAN port can move books
 *     and ask for a proofreading, nothing else.
 *
 * R72 added `ai/proofread`. The original R34 note said "no AI" and meant it:
 * the model call is the one thing here that costs money, so it is gated exactly
 * like `sync` (same per-device HMAC, same `peer-denied` answer), serialised so a
 * tap-happy phone cannot launch ten model runs at once, and hard-capped in
 * characters. The result is still only suggestions — the host never writes to
 * the phone's draft.
 *
 * The protocol is JSON over HTTP with no keep-alive tricks, because the phone
 * side is hand-written Java and a longer-lived socket would only add failure
 * modes to debug at 1 a.m.
 */

import crypto from 'node:crypto';
import http from 'node:http';

import * as ai from './ai.js';
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
 *
 * `connection: close` matters just as much. Node closes an idle keep-alive
 * socket after `keepAliveTimeout`; Android's HttpURLConnection keeps pooling
 * connections for longer, so a phone that synced once and then sat idle would
 * reuse a socket the desktop had already closed. That surfaces as
 * `unexpected end of stream` / an empty response, which the app read as
 * "unreachable" — one of the reasons a second or third tap suddenly worked.
 * These calls are rare and their bodies are the whole library, so paying for a
 * fresh TCP handshake is the cheap end of this trade.
 */
function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload == null ? {} : payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    connection: 'close',
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

/**
 * R72: everything `ai/proofread` needs to be safe on a shared Wi-Fi.
 *
 * `AI_MAX_CHARS` is a spend cap, not a technical limit: `ai.proofread` chunks the
 * text by paragraph and calls the model once per block, so a 200k-character book
 * pasted in would be dozens of paid calls from a phone that merely re-tapped the
 * button. 20000 covers a long chapter with room to spare.
 *
 * `AI_BUSY` is a one-slot gate. The phone already disables its button while a
 * request is in flight, but a second device (or a stale request the user thought
 * had died) must not run a second model call alongside the first.
 */
const AI_MAX_CHARS = 20000;
let hostCtx = null;
let aiBusy = false;

/** Called by the host at mount time so the AI route can reach the LLM service. */
export function bindContext(ctx) {
  hostCtx = ctx || null;
}

/**
 * Verify a signed request and hand back the decoded JSON body.
 *
 * Both `sync` and `ai/proofread` send `{deviceId, body: base64url(json), signature}`
 * with the HMAC over the exact base64url string, so the shared half lives here
 * instead of being copy-pasted (the copy is what drifts when one side changes).
 */
async function openSigned(payload, res) {
  const deviceId = str(payload.deviceId);
  const signature = str(payload.signature);
  const signedBody = str(payload.body);
  if (!deviceId || !signature) {
    send(res, 401, { ok: false, code: 'peer-denied', message: '缺少设备凭据' });
    return null;
  }
  const auth = await verify(signedBody, deviceId, signature);
  if (auth.ok === false) {
    send(res, 401, { ok: false, code: auth.code || 'peer-denied', message: auth.message || '设备未配对' });
    return null;
  }
  let json = null;
  try {
    json = JSON.parse(Buffer.from(signedBody, 'base64url').toString('utf8'));
  } catch (error) {
    send(res, 400, { ok: false, code: 'bad-json', message: '请求内容不是合法的 JSON' });
    return null;
  }
  return { deviceId, body: signedBody, json: isObject(json) ? json : {} };
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
      // R72: lets the phone grey out 「AI 校对」 instead of failing after a tap.
      // A mounted host without an LLM service still answers ping, so this is the
      // honest capability flag rather than "the port is open".
      ai: Boolean(hostCtx),
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

  // ---- R72: the model list, so the phone can pick one before a run.
  //
  // Same gate as the AI verbs. Without it the phone could only ever use
  // whatever the desktop currently had selected — and "which model read my
  // chapter" is the one setting a writer cares about when today's advice reads
  // differently from yesterday's.
  if (path === '/nw/v1/ai/models') {
    const opened = await openSigned(payload, res);
    if (!opened) return;
    if (!hostCtx) {
      send(res, 503, { ok: false, code: 'ai-unavailable', message: '电脑端没有可用的模型服务' });
      return;
    }
    try {
      const listed = await ai.listModels(hostCtx);
      send(res, 200, {
        ok: true,
        protocol: LAN_PROTOCOL,
        // {provider, id, name} — the same rows the desktop's own picker shows.
        models: Array.isArray(listed && listed.models) ? listed.models : [],
        current: (listed && listed.current) || null,
        at: Date.now(),
      });
    } catch (error) {
      send(res, 502, { ok: false, code: 'models-failed', message: (error && error.message) || '读取模型列表失败' });
    }
    return;
  }

  // ---- R72: the writer's model, over the LAN.
  //
  // Two verbs, because the desktop has two different things to say:
  //   `ai/proofread` — typos and grammar, answered as drop-in replacements;
  //   `ai/revise`    — the editor's opinion (quote / issue / why / advice /
  //                    example), which is what the phone pins under each
  //                    paragraph. Advice is not a replacement; the writer edits
  //                    the paragraph themselves.
  //
  // Both are signed exactly like `sync` (an unpaired phone that guessed the
  // path gets `peer-denied` before any model call), share one busy gate so a
  // tap-happy phone cannot launch parallel model runs, and are capped in
  // characters because every call costs money.
  if (path === '/nw/v1/ai/proofread' || path === '/nw/v1/ai/revise') {
    const revise = path.endsWith('/revise');
    const verb = revise ? '点评' : '校对';
    const opened = await openSigned(payload, res);
    if (!opened) return;
    if (!hostCtx) {
      send(res, 503, { ok: false, code: 'ai-unavailable', message: '电脑端没有可用的模型服务' });
      return;
    }
    const text = str(opened.json.text);
    if (!text.trim()) {
      send(res, 400, { ok: false, code: 'empty-text', message: `没有需要${verb}的正文` });
      return;
    }
    if (text.length > AI_MAX_CHARS) {
      send(res, 413, { ok: false, code: 'text-too-long', message: `一次最多 ${AI_MAX_CHARS} 字，请先选中一段` });
      return;
    }
    if (aiBusy) {
      send(res, 429, { ok: false, code: 'busy', message: `上一次${verb}还没结束，请稍等` });
      return;
    }
    // R81: the busy flag is set inside the try/finally below. Setting it before
    // the try and then throwing from `res.writeHead` used to leave the gate
    // stuck closed forever (every later AI call answered 429 until a restart).
    // R72: `stream: true` answers with one JSON object per line instead of a
    // single body: `{"type":"progress","done":i,"total":n}` before every
    // paragraph block, then one final `{"type":"result",...}`. A chapter split
    // into four blocks therefore moves a real bar four times; without the flag
    // the same request gets the old single JSON answer, so an older APK keeps
    // working.
    const streaming = opened.json.stream === true;
    // Hanging up is how the phone cancels: it disconnects, `close` fires before
    // the response ended, and the abort reaches the model stream — so a tap on
    // the ✕ stops the spend rather than just hiding the spinner.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const writeEvent = (event) => {
      if (!streaming || res.writableEnded || res.destroyed) return;
      try {
        res.write(`${JSON.stringify(event)}\n`);
      } catch {
        /* the phone hung up mid-write */
      }
    };
    try {
      aiBusy = true;
      if (streaming) {
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'close',
        });
      }
      // Stable per-device routing key; see the note in ai.proofread. Without it
      // an OpenCode-backed model answers 400 MissingSessionID.
      const common = {
        provider: str(opened.json.provider) || undefined,
        model: str(opened.json.model) || undefined,
        text,
        sessionId: `nw-lan-${opened.deviceId}`,
        signal: controller.signal,
        onProgress: (done, total) => writeEvent({ type: 'progress', done, total }),
      };
      const result = revise
        ? await ai.revise(hostCtx, {
            ...common,
            // The phone's focus chips map 1:1 onto the desktop's dimensions.
            focus: str(opened.json.focus) || 'all',
            note: str(opened.json.note),
          })
        : await ai.proofread(hostCtx, {
            ...common,
            mode: str(opened.json.mode) || 'normal',
            // The desktop's own 「校对要求」 belongs to the other device's
            // screen; the shipped default is what both sides get here.
            rules: '',
          });
      const suggestions = Array.isArray(result && result.suggestions) ? result.suggestions : [];
      const answer = {
        ok: true,
        protocol: LAN_PROTOCOL,
        kind: revise ? 'revise' : 'proofread',
        suggestions,
        count: suggestions.length,
        // How many blocks came back with an empty reply. "The model said nothing"
        // and "the text was clean" both produce zero suggestions; the phone has
        // to tell them apart to give the writer a next step.
        empty: revise ? Number(result && result.emptyReplies) || 0 : 0,
        model: str(result && result.model),
        at: Date.now(),
      };
      if (streaming) {
        writeEvent({ type: 'result', ...answer });
        res.end();
      } else {
        send(res, 200, answer);
      }
    } catch (error) {
      const message = (error && error.message) || '模型调用失败';
      const aborted = controller.signal.aborted || (error && error.code === 'aborted');
      const answer = aborted
        ? { ok: false, code: 'aborted', message: '已取消' }
        : { ok: false, code: (error && error.code) || 'ai-failed', message };
      if (streaming) {
        if (!aborted) writeEvent({ type: 'result', ...answer });
        if (!res.writableEnded) res.end();
      } else if (!res.destroyed) {
        send(res, aborted ? 499 : 502, answer);
      }
    } finally {
      aiBusy = false;
    }
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
  // Bind on every call, including the idempotent one: the settings page calls
  // `start()` again from a different code path, and that must not clear the
  // context the AI route captured at mount time.
  if (options && options.ctx) bindContext(options.ctx);
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
    // R99: close() only stops *new* connections. A phone holding a keep-alive
    // socket kept being served after "停止配对", and dropping the reference
    // below left that socket with no way to shut it down.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
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
