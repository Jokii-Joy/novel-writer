// Minimal IMAP4rev1 client for @local/novel-writer (收件箱 / 退稿信).
//
// Dependency-free on purpose, same reasoning as lib/smtp.js: the plugin runs
// inside the Harness host with Node built-ins only. `node:tls` / `node:net`
// are the whole toolbox — no imapflow, no iconv-lite.
//
// What it does:
//   * greeting, `LOGIN`, `STATUS` / `SELECT`, `FETCH` (headers + a short body
//     snippet), `LOGOUT`
//   * literal-aware reading: IMAP announces `{123}` and then sends exactly 123
//     raw bytes, so a line reader alone is not enough
//   * STARTTLS upgrade on 143, implicit TLS on 993
//   * RFC 2047 header decoding (=?UTF-8?B?…?=) incl. GBK payloads via TextDecoder
//
// Nothing throws: `probe()` / `listRecent()` always resolve to
// `{ok:true, …}` or `{ok:false, code, message, hint}`.

import { Buffer } from 'node:buffer';
import net from 'node:net';
import tls from 'node:tls';

/** Wall-clock cap for a whole IMAP session. */
export const DEFAULT_TIMEOUT_MS = 20000;

/** How many recent messages the home screen asks for. */
export const DEFAULT_LIMIT = 12;

/** Bytes of the body kept for the snippet under each subject. */
const SNIPPET_BYTES = 32768;

const CRLF = '\r\n';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function messageOf(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

// ---------------------------------------------------------------------------
// Line / literal reader
// ---------------------------------------------------------------------------

/**
 * A single-waiter reader over a socket. IMAP is strictly sequential (one
 * outstanding command per connection), so a queue is unnecessary — but the
 * reader must hand out *bytes* as well as lines, because `FETCH` answers carry
 * literals whose terminator is a byte count, not a newline.
 */
class Reader {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiter = null;
    this.error = null;
    this.onData = (chunk) => {
      this.buf = this.buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buf, Buffer.from(chunk)]);
      this.flush();
    };
    this.onError = (error) => this.die(error);
    this.onClose = () => this.die(fail('imap-connection-closed', '邮件服务器关闭了连接'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  die(error) {
    if (!this.error) this.error = error;
    this.flush();
  }

  detach() {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('close', this.onClose);
  }

  flush() {
    const waiter = this.waiter;
    if (!waiter) return;
    if (waiter.kind === 'line') {
      const index = this.buf.indexOf(CRLF);
      if (index < 0) {
        if (this.error) {
          this.waiter = null;
          waiter.reject(this.error);
        }
        return;
      }
      const line = this.buf.subarray(0, index).toString('utf8');
      this.buf = this.buf.subarray(index + CRLF.length);
      this.waiter = null;
      waiter.resolve(line);
      return;
    }
    if (waiter.kind === 'skip-line') {
      const index = this.buf.indexOf(CRLF);
      if (index < 0) {
        if (this.error) {
          this.waiter = null;
          waiter.reject(this.error);
        }
        return;
      }
      this.buf = this.buf.subarray(index + CRLF.length);
      this.waiter = null;
      waiter.resolve('');
      return;
    }
    if (this.buf.length >= waiter.n) {
      const out = this.buf.subarray(0, waiter.n);
      this.buf = this.buf.subarray(waiter.n);
      this.waiter = null;
      waiter.resolve(out);
      return;
    }
    if (this.error) {
      this.waiter = null;
      waiter.reject(this.error);
    }
  }

  readLine() {
    return new Promise((resolve, reject) => {
      if (this.error && this.buf.indexOf(CRLF) < 0) {
        reject(this.error);
        return;
      }
      this.waiter = { kind: 'line', resolve, reject };
      this.flush();
    });
  }

  readBytes(n) {
    return new Promise((resolve, reject) => {
      if (this.error && this.buf.length < n) {
        reject(this.error);
        return;
      }
      this.waiter = { kind: 'bytes', n, resolve, reject };
      this.flush();
    });
  }
}

// ---------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------

const CERT_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function classifySocketError(error, host, port) {
  const code = str(error && error.code).toUpperCase();
  const raw = messageOf(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'EAI_NODATA') {
    return fail('imap-dns-failed', `域名解析失败：找不到 ${host}（${code}）`);
  }
  if (code === 'ECONNREFUSED') {
    return fail('imap-port-closed', `${host}:${port} 拒绝连接（端口未开放，或被防火墙拦截）`);
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENETDOWN') {
    return fail('imap-unreachable', `网络不可达 ${host}:${port}（${code}）`);
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return fail('imap-timeout', `连接 ${host}:${port} 超时（${code}）`);
  }
  if (CERT_ERROR_CODES.has(code)) {
    return fail('imap-cert-failed', `证书校验失败：${raw}（${code}）`);
  }
  return fail('imap-connect-failed', `无法连接 ${host}:${port}（${raw}）`);
}

function openSocket({ host, port, secure, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let socket;
    if (secure) {
      socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized, timeout: timeoutMs },
        () => resolve(socket),
      );
    } else {
      socket = net.connect({ host, port });
      socket.once('connect', () => resolve(socket));
    }
    socket.once('error', (error) => reject(classifySocketError(error, host, port)));
  });
}

function upgradeToTls(socket, host, timeoutMs, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect(
      { socket, servername: host, rejectUnauthorized, timeout: timeoutMs },
      () => resolve(secure),
    );
    secure.once('error', (error) => reject(classifySocketError(error, host, 143)));
  });
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function quote(value) {
  return `"${str(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

class Session {
  constructor(cfg) {
    this.cfg = cfg;
    this.socket = null;
    this.reader = null;
    this.counter = 0;
    this.certBypassed = false;
  }

  timeoutMs() {
    const value = Number(this.cfg.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  nextTag() {
    this.counter += 1;
    return `A${this.counter}`;
  }

  async connect() {
    const cfg = this.cfg;
    const port = Number.isFinite(Number(cfg.port)) && Number(cfg.port) > 0 ? Math.trunc(Number(cfg.port)) : cfg.secure ? 993 : 143;
    const host = str(cfg.host).trim();
    const rejectUnauthorized = cfg.rejectUnauthorized !== false;
    const shape = { host, port, secure: cfg.secure !== false, rejectUnauthorized, timeoutMs: this.timeoutMs() };

    try {
      this.socket = await openSocket(shape);
    } catch (error) {
      // Same lesson as SMTP: a TLS-inspecting proxy or antivirus rewrites the
      // chain, and 993-only providers have no other way in. Retry once blind.
      if (rejectUnauthorized && str(error && error.code).startsWith('imap-cert')) {
        this.certBypassed = true;
        this.socket = await openSocket({ ...shape, rejectUnauthorized: false });
      } else {
        throw error;
      }
    }

    this.reader = new Reader(this.socket);
    this.socket.setNoDelay?.(true);
    this.socket.setTimeout(this.timeoutMs(), () => {
      this.reader?.die(fail('imap-timeout', '邮件服务器长时间没有响应'));
    });

    const greeting = await this.reader.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greeting)) {
      throw fail('imap-greeting-failed', `${host} 拒绝会话：${greeting.slice(0, 200)}`);
    }

    // Plain 143 must be upgraded before LOGIN, otherwise the password travels in
    // the clear. Servers advertise STARTTLS in the CAPABILITY line.
    if (!shape.secure) {
      const capa = await this.command('CAPABILITY');
      const hasStartTls = capa.lines.some((line) => /STARTTLS/i.test(line));
      if (hasStartTls) {
        try {
          this.socket = await upgradeToTls(this.socket, host, this.timeoutMs(), rejectUnauthorized);
        } catch (error) {
          if (rejectUnauthorized && str(error && error.code).startsWith('imap-cert')) {
            this.certBypassed = true;
            this.socket = await upgradeToTls(this.socket, host, this.timeoutMs(), false);
          } else {
            throw error;
          }
        }
        this.reader.detach();
        this.reader = new Reader(this.socket);
      }
    }
  }

  /**
   * Send one tagged command and read until its completion line. Returns
   * `{lines, literals, status}` where `lines` are the untagged + tagged raw
   * lines and `literals` the byte buffers in arrival order.
   */
  async command(body) {
    const tag = this.nextTag();
    this.socket.write(`${tag} ${body}${CRLF}`);
    const lines = [];
    const literals = [];
    // `events` keeps lines and literals in arrival order. FETCH answers interleave
    // them ("…{123}" then 123 raw bytes then the next field), so a caller that
    // needs to know which literal belongs to which field must not flatten them.
    const events = [];
    for (;;) {
      const line = await this.reader.readLine();
      lines.push(line);
      events.push({ type: 'line', text: line });
      const lit = /\{(\d+)\+?\}$/.exec(line);
      if (lit) {
        const data = await this.reader.readBytes(Number(lit[1]));
        literals.push(data);
        events.push({ type: 'literal', data });
        continue;
      }
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const status = rest.split(' ')[0].toUpperCase();
        if (status === 'OK') return { lines, literals, events, status };
        const lower = rest.toLowerCase();
        // NetEase answers SELECT with "NO Unsafe Login. Please contact kefu@188.com"
        // when it considers the client unidentified. Without this branch the text
        // matches /login/ and gets mislabelled as a credential failure, sending the
        // user to re-check a password that is perfectly fine.
        if (lower.indexOf('unsafe login') >= 0) {
          throw fail(
            'imap-id-required',
            `${body.split(' ')[0]} 被拒绝：${rest}`,
          );
        }
        throw fail(
          lower.indexOf('authenticate') >= 0 || lower.indexOf('login') >= 0 || lower.indexOf('credential') >= 0
            ? 'imap-auth-failed'
            : 'imap-rejected',
          `${body.split(' ')[0]} 被拒绝：${rest}`,
        );
      }
      if (lines.length > 4000) throw fail('imap-protocol-error', '邮件服务器响应异常（行数过多）');
    }
  }

  async login() {
    const user = str(this.cfg.user).trim();
    const pass = str(this.cfg.pass);
    if (user) {
      await this.command(`LOGIN ${quote(user)} ${quote(pass)}`);
    }
  }

  /**
   * RFC 2971 `ID` handshake.
   *
   * NetEase (163 / 126 / yeah.net) answers a client that never identifies itself
   * with `NO SELECT Unsafe Login. Please contact kefu@188.com for help` — the
   * account logs in fine and then every SELECT is refused, which is exactly the
   * "邮箱测试能用，但收件箱报错" symptom. Sending ID right after LOGIN clears it.
   *
   * The command is optional in the protocol, so a server that answers BAD (or
   * doesn't advertise ID at all) must not fail the session: the failure is
   * swallowed and only recorded on `this.idStatus` for diagnostics.
   */
  async identify() {
    const payload = [
      '"name"',
      '"novel-writer"',
      '"version"',
      '"1.0.0"',
      '"vendor"',
      '"deepseek-harness"',
      '"support-email"',
      '"noreply@localhost"',
    ].join(' ');
    try {
      await this.command(`ID (${payload})`);
      this.idStatus = 'ok';
    } catch (error) {
      this.idStatus = str(error && error.code) === 'imap-rejected' ? 'rejected' : 'failed';
    }
  }

  async close() {
    try {
      await this.command('LOGOUT');
    } catch (error) {
      /* the server often closes the socket instead of answering LOGOUT */
    }
    try {
      this.socket.end();
    } catch (error) {
      /* already gone */
    }
    try {
      this.reader?.detach();
    } catch (error) {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Header decoding
// ---------------------------------------------------------------------------

/**
 * `=XX` → byte (RFC 2047 "Q" encoding, used by GBK-era Chinese mailers).
 * `_` is a space in Q encoding.
 */
function qDecode(text) {
  const source = str(text).replace(/_/g, ' ');
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      out.push(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) out.push(byte);
    }
  }
  return Buffer.from(out);
}

function decodeCharset(buffer, charset) {
  const label = str(charset).trim().toLowerCase() || 'utf-8';
  const normalised = label === 'gb2312' || label === 'gb_2312-80' ? 'gbk' : label;
  try {
    return new TextDecoder(normalised).decode(buffer);
  } catch (error) {
    return buffer.toString('utf8');
  }
}

/** Decode RFC 2047 encoded words (`=?UTF-8?B?…?=`) in a header value. */
export function decodeHeader(value) {
  return str(value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, encoding, payload) => {
    try {
      const bytes = /^b$/i.test(encoding) ? Buffer.from(payload, 'base64') : qDecode(payload);
      return decodeCharset(bytes, charset);
    } catch (error) {
      return whole;
    }
  });
}

/** Split a raw header block into `{name: value}`, unfolding continuation lines. */
export function parseHeaders(raw) {
  const map = {};
  const lines = str(raw).split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (!line) continue;
    if (/^[ \t]/.test(line) && current) {
      map[current] += ' ' + line.trim();
      continue;
    }
    const index = line.indexOf(':');
    if (index <= 0) continue;
    current = line.slice(0, index).trim().toLowerCase();
    map[current] = line.slice(index + 1).trim();
  }
  return map;
}

/**
 * Quoted-printable → text. `=XX` is a byte, so the decoded bytes must be run
 * through the declared charset (GBK mail is common in Chinese journals), not
 * through `String.fromCharCode` (which would mangle every CJK character).
 */
function decodeQuotedPrintable(raw, charset) {
  const source = str(raw).replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      bytes.push(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) bytes.push(byte);
    }
  }
  return decodeCharset(Buffer.from(bytes), charset || 'utf-8');
}

/**
 * Reduce a raw body block to one readable line for the inbox list.
 *
 * `BODY[TEXT]` of a multipart mail starts with MIME boundaries and per-part
 * headers, so a naive "first line" would show `--000000000` or
 * `Content-Type: text/plain`. Skip those, skip base64 blobs, then take the first
 * two real lines.
 */
export function snippetOf(raw, transferEncoding) {
  let text = str(raw);
  const transfer = str(transferEncoding).toLowerCase();
  if (transfer === 'base64') {
    try {
      text = Buffer.from(text.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8');
    } catch (error) {
      /* keep the raw text */
    }
  } else if (transfer === 'quoted-printable') {
    text = decodeQuotedPrintable(text);
  }
  // Marketing mail (and most webmail) ships text/html only. Without this pass
  // the list preview is the first 160 characters of `<!DOCTYPE html>`—every
  // row on the home screen reads the same. Detect markup before flattening.
  if (/<\s*(html|body|div|p|br|table|span)\b/i.test(text)) {
    // Webmail inlines 10–30 KB of `<style>` before any prose, and the partial
    // fetch cuts the document mid-`<head>`. Anything before `<body>` is
    // scaffolding for a preview, so start there when the tag survived the cut.
    const bodyAt = text.search(/<body\b/i);
    if (bodyAt > 0) text = text.slice(bodyAt);
    text = htmlToText(text);
  }
  const flat = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^-{2,}[A-Za-z0-9=_-]{6,}/.test(line)) return false; // MIME boundary
      if (/^[A-Za-z-]+:\s/.test(line)) return false; // part header
      if (/^[-=]{10,}$/.test(line)) return false; // separator rule
      if (line.length > 40 && !/\s/.test(line)) return false; // base64 blob
      return true;
    });
  return flat.slice(0, 2).join(' ').slice(0, 160);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function normalizeConfig(cfg) {
  const source = cfg != null && typeof cfg === 'object' ? cfg : {};
  const port = Number(source.port);
  return {
    host: str(source.host).trim(),
    port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 993,
    secure: source.secure !== false,
    user: str(source.user).trim(),
    pass: str(source.pass),
    from: str(source.from).trim(),
    timeoutMs: Number(source.timeoutMs) || DEFAULT_TIMEOUT_MS,
    rejectUnauthorized: source.rejectUnauthorized !== false,
  };
}

/** Turn a transport/auth failure into something the user can act on. */
export function hintFor(code, message = '', host = '') {
  const detail = str(message);
  const target = str(host) || '邮件服务器';
  switch (str(code)) {
    case 'imap-auth-failed':
      return `账号或密码被拒绝（${detail}）。收信同样需要「授权码 / 客户端专用密码」，不是网页登录密码；并确认邮箱网页端已开启 IMAP 服务。`;
    case 'imap-id-required':
      return `服务器以「Unsafe Login」拒绝了选择邮箱（${detail}）。这是 163 / 126 等网易邮箱对未声明客户端身份的封锁：插件已自动发送 IMAP ID 握手，仍失败请在邮箱网页端把本客户端加入白名单，或改用 QQ / Gmail 收信。`;
    case 'imap-dns-failed':
      return `域名解析失败（${detail}）：这台电脑找不到该收件服务器。请核对 IMAP 服务器名（QQ 是 imap.qq.com，163 是 imap.163.com）。`;
    case 'imap-port-closed':
      return `端口被拒绝（${detail}）：地址能解析但端口没开。请确认端口填的是 993（SSL）或 143（STARTTLS），并检查网络是否封锁了该端口。`;
    case 'imap-unreachable':
      return `网络不可达（${detail}）。请确认当前网络能正常访问外网。`;
    case 'imap-cert-failed':
      return `证书校验失败（${detail}）。多为公司网络或杀毒软件做中间人，插件已自动跳过校验重试过一次；仍失败请换网络。`;
    case 'imap-timeout':
      return `连接 ${target} 超时（${detail}）。请换端口（993 / 143）或换网络再试。`;
    case 'imap-greeting-failed':
      return `${target} 拒绝了会话（${detail}）。请确认这个地址是 IMAP 服务器，而不是 SMTP 或网页地址。`;
    case 'imap-rejected':
      return `服务器拒绝了请求（${detail}）。请确认账号已在邮箱网页端开启 IMAP 服务。`;
    case 'imap-connect-failed':
    case 'imap-connection-closed':
      return `无法连接到 ${target}（${detail}）。请核对 IMAP 地址与端口。`;
    default:
      return detail || `${target} 连接失败，请检查配置`;
  }
}

async function withSession(config, run) {
  const cfg = normalizeConfig(config);
  if (!cfg.host) {
    return { ok: false, code: 'imap-not-configured', message: '尚未配置收件邮箱（IMAP 主机）' };
  }
  const session = new Session(cfg);
  try {
    await session.connect();
    await session.login();
    // Identify before the first SELECT: NetEase refuses SELECT from anonymous
    // clients ("Unsafe Login"), and the call is harmless for everyone else.
    await session.identify();
    const value = await run(session, cfg);
    await session.close();
    return value;
  } catch (error) {
    try {
      session.socket?.destroy();
    } catch (destroyError) {
      /* already gone */
    }
    const code = str(error && error.code) || 'imap-error';
    return { ok: false, code, message: messageOf(error) };
  }
}

/**
 * Connect + LOGIN + STATUS INBOX, then LOGOUT.
 * Resolves to `{ok:true, messages, unseen, detail, certBypassed}` or a failure.
 */
export async function probe(config = {}) {
  const result = await withSession(config, async (session, cfg) => {
    const status = await session.command('STATUS INBOX (MESSAGES UNSEEN)');
    const line = status.lines.find((row) => /^\* STATUS/i.test(row)) || '';
    const messages = Number((/MESSAGES\s+(\d+)/i.exec(line) || [])[1]) || 0;
    const unseen = Number((/UNSEEN\s+(\d+)/i.exec(line) || [])[1]) || 0;
    return {
      ok: true,
      messages,
      unseen,
      detail: `已连接 ${cfg.host}:${cfg.port}${cfg.secure ? '（SSL/TLS）' : '（STARTTLS）'}`,
      certBypassed: session.certBypassed === true,
    };
  });
  if (result && result.ok === false) return { ...result, hint: hintFor(result.code, result.message, normalizeConfig(config).host) };
  return result;
}

/** Split a body block into `{headers, text}` — the part before the blank line. */
function splitMessage(raw) {
  const text = str(raw);
  const index = text.search(/\r?\n\r?\n/);
  if (index < 0) return { headers: text, text: '' };
  return { headers: text.slice(0, index), text: text.slice(index).replace(/^\r?\n\r?\n/, '') };
}

// ---------------------------------------------------------------------------
// Full message body (R12 ④: the inbox list was read-only text)
// ---------------------------------------------------------------------------

/** `text/html` → readable text. Mail clients send `<p>`, `<br>`, `<div>`. */
function htmlToText(raw) {
  // Marketing mail is built out of nested <table> cells with dozens of `&nbsp;`
  // spacers. Stripping tags alone leaves a column of blank lines that looks like
  // a broken render, so every line is trimmed and empties are collapsed at the
  // end — the reader should see the words, not the layout scaffolding.
  return (
    str(raw)
      // The list preview is a partial fetch (`<0.N>`), so `<style>` is often
      // cut off before its closing tag. Match "closed or end of string" or the
      // snippet degrades into raw CSS, which is worse than no snippet at all.
      .replace(/<style[^>]*>[\s\S]*?(?:<\/style>|$)/gi, '')
      .replace(/<script[^>]*>[\s\S]*?(?:<\/script>|$)/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      // Numeric entities (`&#12288;`, `&#x3000;`) appear in Chinese mail far
      // more often than the named forms, and decoding them costs one callback.
      .replace(/&#(\d+);/g, (all, code) => {
        const n = Number(code);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      })
      .replace(/&#[xX]([0-9a-fA-F]+);/g, (all, code) => {
        const n = parseInt(code, 16);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      })
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** One MIME part → `{type, text}` with its encoding and charset applied. */
function decodePart(raw) {
  const { headers, text } = splitMessage(raw);
  const map = parseHeaders(headers);
  const type = str(map['content-type']).toLowerCase() || 'text/plain';
  const encoding = str(map['content-transfer-encoding']).toLowerCase();
  const charset = (/charset\s*=\s*"?([\w.:-]+)/i.exec(str(map['content-type'])) || [])[1] || 'utf-8';
  let body = text;
  if (encoding === 'base64') {
    try {
      body = decodeCharset(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'), charset);
    } catch (error) {
      body = text;
    }
  } else if (encoding === 'quoted-printable') {
    body = decodeQuotedPrintable(body, charset);
  }
  return { type, text: body };
}

/**
 * Walk a raw RFC822 message and return `{headers, text}` with the best readable
 * body. Multipart mail is the norm (the letter is `text/plain`, the signature
 * block `text/html`), so taking the first part blindly would show either the
 * MIME preamble or the wrong alternative.
 */
function parseFullBody(raw) {
  const { headers: headerBlock, text: bodyText } = splitMessage(raw);
  const headers = parseHeaders(headerBlock);
  const contentType = str(headers['content-type']);
  const boundary = (/boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(contentType) || [])[1] || '';

  if (!/^multipart\//i.test(contentType) || !boundary) {
    const part = decodePart(raw);
    const text = part.type.indexOf('text/html') >= 0 ? htmlToText(part.text) : part.text;
    return { headers, text: text.trim() };
  }

  const segments = str(bodyText).split('--' + boundary);
  const plain = [];
  const html = [];
  for (const segment of segments) {
    const body = segment.replace(/^\r?\n/, '');
    if (!body || body.startsWith('--')) continue;
    const part = decodePart(body);
    if (part.type.indexOf('text/html') >= 0) html.push(part.text);
    else if (part.type.indexOf('text/plain') >= 0) plain.push(part.text);
  }
  const chosen = plain.length > 0 ? plain.join('\n\n') : htmlToText(html.join('\n'));
  return { headers, text: chosen.trim() };
}

/**
 * Read one message in full.
 *
 * R14 ②: opening a message now marks it as read, which is what every mail
 * client does and what people expect from the 未读 badge. The body is fetched
 * with `BODY.PEEK[]` **first** (so a failed STORE still returns the letter),
 * then a best-effort `+FLAGS (\Seen)` runs. `options.markSeen === false` keeps
 * the old peek-and-leave behaviour for anyone who wants it.
 */
export async function readMessage(config = {}, options = {}) {
  const uid = Number(options.uid);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, code: 'imap-bad-uid', message: '缺少要读取的邮件编号' };
  }
  const markSeen = options.markSeen !== false;
  const result = await withSession(config, async (session) => {
    await session.command('SELECT INBOX');
    const fetched = await session.command(`UID FETCH ${uid} (FLAGS BODY.PEEK[])`);
    let literal = null;
    let flags = '';
    for (const event of fetched.events) {
      if (event.type === 'literal' && literal === null) {
        literal = event.data;
        continue;
      }
      if (event.type === 'line') {
        const flagMatch = /FLAGS\s+\(([^)]*)\)/i.exec(event.text);
        if (flagMatch) flags = flagMatch[1];
      }
    }
    if (!literal) {
      return { ok: false, code: 'imap-not-found', message: '这封邮件在服务器上已经不存在了（可能被移动或删除）' };
    }
    const { headers, text } = parseFullBody(literal.toString('utf8'));
    const fromRaw = decodeHeader(headers.from || '');
    const address = (/<([^>]+)>/.exec(fromRaw) || [])[1] || (/[\w.+-]+@[\w.-]+/.exec(fromRaw) || [])[0] || '';
    const name = fromRaw.replace(/<[^>]*>/g, '').replace(/^["'\s]+|["'\s]+$/g, '') || address;
    // Mark as read only after the letter is safely in hand. A server that
    // refuses STORE (read-only mailbox, quota, odd provider) must not turn a
    // successful read into an error — the flag is cosmetic, the text is not.
    let seen = /\\Seen/i.test(flags);
    if (markSeen && !seen) {
      try {
        await session.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
        seen = true;
      } catch (ignored) {
        // Keep `seen` false; the caller refreshes from the server anyway.
      }
    }
    return {
      ok: true,
      message: {
        uid,
        unseen: !seen,
        from: name,
        address,
        to: decodeHeader(headers.to || ''),
        subject: decodeHeader(headers.subject || '') || '（无主题）',
        date: decodeHeader(headers.date || ''),
        messageId: decodeHeader(headers['message-id'] || ''),
        text,
      },
    };
  });

  if (result && result.ok === false) {
    return { ...result, hint: hintFor(result.code, result.message, normalizeConfig(config).host) };
  }
  return result;
}

/**
 * Read the newest `limit` messages of INBOX (headers + a short snippet).
 * Resolves to `{ok:true, messages:[{uid,unseen,from,address,subject,date,snippet,messageId}], total, unseen}`.
 */
export async function listRecent(config = {}, options = {}) {
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(options.limit) || DEFAULT_LIMIT)));
  const result = await withSession(config, async (session, cfg) => {
    await session.command('SELECT INBOX');
    const status = await session.command('STATUS INBOX (MESSAGES UNSEEN)');
    const statusLine = status.lines.find((row) => /^\* STATUS/i.test(row)) || '';
    const total = Number((/MESSAGES\s+(\d+)/i.exec(statusLine) || [])[1]) || 0;
    const unseen = Number((/UNSEEN\s+(\d+)/i.exec(statusLine) || [])[1]) || 0;
    if (total === 0) {
      return {
        ok: true,
        messages: [],
        total: 0,
        unseen: 0,
        certBypassed: session.certBypassed === true,
        idStatus: str(session.idStatus),
      };
    }

    const start = Math.max(1, total - limit + 1);
    // Headers come back as a literal; the body snippet uses a partial fetch
    // (`<0.N>`) so a 30 MB attachment never crosses the wire.
    //
    // CONTENT-TYPE / CONTENT-TRANSFER-ENCODING are requested on purpose: a
    // single-part mail declares `base64` in the MESSAGE headers, never inside
    // the body literal. Without them the preview sees raw base64 and the
    // "long line, no spaces" filter throws every candidate away — the row
    // renders with an empty snippet.
    const fetched = await session.command(
      `FETCH ${start}:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.${SNIPPET_BYTES}>)`,
    );

    // Walk lines and literals in arrival order: a literal always belongs to the
    // field named on the line right before it, so remember that field name.
    //
    // A short FETCH response puts the section names on the SAME line as the
    // `* n FETCH` prefix and the literal size: `* 1 FETCH (UID 7 FLAGS ()
    // BODY[HEADER.FIELDS (...)] {1234}`. So the field must be read from the
    // prefix line too — bailing out right after creating `pending` (the R12
    // version of this loop did) leaves `field` empty, the header literal falls
    // through to the `text` slot and every mail shows「（无主题）」.
    const fieldOf = (line) => {
      if (/BODY\[HEADER/i.test(line)) return 'header';
      if (/BODY\[TEXT\]/i.test(line)) return 'text';
      return '';
    };
    const messages = [];
    let pending = null;
    let field = '';
    for (const event of fetched.events) {
      if (event.type === 'literal') {
        if (pending && field === 'header') pending.headers = event.data.toString('utf8');
        else if (pending && field === 'text') pending.body = event.data.toString('utf8');
        field = '';
        continue;
      }
      const line = event.text;
      const head = /^\* (\d+) FETCH/i.exec(line);
      if (head) {
        pending = { index: Number(head[1]), uid: 0, flags: '', headers: null, body: null };
        const uidMatch = /UID\s+(\d+)/i.exec(line);
        if (uidMatch) pending.uid = Number(uidMatch[1]);
        const flagMatch = /FLAGS\s+\(([^)]*)\)/i.exec(line);
        if (flagMatch) pending.flags = flagMatch[1];
        messages.push(pending);
      }
      const next = fieldOf(line);
      if (next) field = next;
    }

    const out = messages
      .map((row) => {
        const headers = parseHeaders(row.headers || '');
        const fromRaw = decodeHeader(headers.from || '');
        const address = (/<([^>]+)>/.exec(fromRaw) || [])[1] || (/[\w.+-]+@[\w.-]+/.exec(fromRaw) || [])[0] || '';
        const name = fromRaw.replace(/<[^>]*>/g, '').replace(/^["'\s]+|["'\s]+$/g, '') || address;
        // Rebuild the message (headers + partial body) and let `parseFullBody()`
        // pick the text/plain or text/html part, exactly like the full reader.
        //
        // The header literal arrives with its own trailing blank line. Concatenate
        // another separator without trimming and `splitMessage()` lands on the
        // wrong boundary: the MIME split then finds no parts and the snippet is
        // empty again for every mail that actually has a body.
        const rebuilt = str(row.headers || '').replace(/\r?\n+\s*$/, '') + '\r\n\r\n' + (row.body || '');
        const body = parseFullBody(rebuilt);
        return {
          uid: row.uid || row.index,
          index: row.index,
          unseen: !/\\Seen/i.test(row.flags || ''),
          from: name,
          address,
          subject: decodeHeader(headers.subject || '') || '（无主题）',
          date: decodeHeader(headers.date || ''),
          messageId: decodeHeader(headers['message-id'] || ''),
          snippet: snippetOf(body.text, ''),
        };
      })
      .sort((a, b) => b.index - a.index)
      .slice(0, limit);

    return {
      ok: true,
      messages: out,
      total,
      unseen,
      certBypassed: session.certBypassed === true,
      // Recorded so the UI can say "the server accepted our ID" instead of the
      // author having to guess why a mailbox is empty on NetEase.
      idStatus: str(session.idStatus),
    };
  });

  if (result && result.ok === false) {
    return { ...result, hint: hintFor(result.code, result.message, normalizeConfig(config).host) };
  }
  return result;
}

/** Provider presets shown in the settings dialog (mirrors smtp.PRESETS). */
export const PRESETS = Object.freeze([
  { id: 'qq', name: 'QQ 邮箱', host: 'imap.qq.com', port: 993, secure: true, note: '需在 QQ 邮箱「设置 → 账户」开启 IMAP 服务，密码填授权码' },
  { id: '163', name: '网易 163', host: 'imap.163.com', port: 993, secure: true, note: '需开启 IMAP 并使用客户端授权密码' },
  { id: '126', name: '网易 126', host: 'imap.126.com', port: 993, secure: true, note: '同 163：密码处填客户端授权密码' },
  { id: 'sina', name: '新浪邮箱', host: 'imap.sina.com', port: 993, secure: true, note: '需在网页端开启 IMAP 服务' },
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true, note: '需开启两步验证并生成「应用专用密码」' },
  { id: 'outlook', name: 'Outlook / Hotmail', host: 'outlook.office365.com', port: 993, secure: true, note: '新式验证账号可能需要应用密码' },
  { id: 'icloud', name: 'iCloud', host: 'imap.mail.me.com', port: 993, secure: true, note: '需在 Apple ID 中生成「App 专用密码」' },
  { id: 'custom', name: '自定义', host: '', port: 993, secure: true, note: '填写你所用邮箱服务商提供的 IMAP 地址与端口' },
]);

