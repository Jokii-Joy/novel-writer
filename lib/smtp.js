// Minimal SMTP client for @local/novel-writer (投稿).
//
// Dependency-free on purpose: the plugin must run inside the Harness host with
// only Node built-ins. Only `node:net` / `node:tls` are used, no nodemailer.
//
// Supported wire features:
//   * greeting / EHLO (HELO fallback) / QUIT
//   * STARTTLS upgrade when `secure:false` and the server advertises it
//   * AUTH PLAIN and AUTH LOGIN (whichever the server advertises)
//   * multipart/mixed with base64 attachments, multipart/alternative for
//     text+html, base64-encoded bodies, RFC 2047 encoded headers
//   * a hard wall-clock timeout (default 15 s) that destroys the socket
//
// Nothing throws: `send()` / `verify()` always resolve to
// `{ok:true, …}` or `{ok:false, code, message}`.

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

/** Wall-clock cap for a whole session (connect + auth + DATA). */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Refuse absurd payloads before they hit the socket. */
const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

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

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Structured failure from a caught error. */
function failure(error, fallbackCode = 'smtp-error') {
  const code = error && typeof error.code === 'string' && /^[a-z][a-z0-9-]*$/.test(error.code) ? error.code : fallbackCode;
  return { ok: false, code, message: messageOf(error) };
}

// ---------------------------------------------------------------------------
// Line-oriented socket reader
// ---------------------------------------------------------------------------

/**
 * Reads CRLF-terminated lines and hands them out one at a time. SMTP is strictly
 * sequential (one outstanding command), so a single-waiter queue is enough.
 */
class LineReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.queue = [];
    this.waiter = null;
    this.error = null;
    this.onData = (chunk) => this.push(chunk);
    this.onError = (error) => this.die(error);
    this.onClose = () => this.die(fail('smtp-connection-closed', '邮件服务器关闭了连接'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  push(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.queue.push(raw.replace(/\r$/, ''));
    }
    this.flush();
  }

  flush() {
    if (!this.waiter) return;
    if (this.queue.length > 0) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve(this.queue.shift());
      return;
    }
    if (this.error) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(this.error);
    }
  }

  die(error) {
    if (!this.error) this.error = error;
    this.flush();
  }

  readLine() {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  detach() {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('close', this.onClose);
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// R7: the old code collapsed every socket failure into `smtp-tls-failed` /
// `smtp-connect-failed`, which pointed the user at "switch ports" even when the
// real cause was DNS, a blocked port, or a TLS-inspecting proxy. Classify on
// `error.code` so the hint names the actual layer.
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

function isCertificateFailure(error) {
  return CERT_ERROR_CODES.has(str(error && error.code).toUpperCase());
}

function classifySocketError(error, host, port) {
  const code = str(error && error.code).toUpperCase();
  const raw = messageOf(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL' || code === 'EAI_NODATA') {
    return fail('smtp-dns-failed', `域名解析失败：找不到 ${host}（${code}）`);
  }
  if (code === 'ECONNREFUSED') {
    return fail('smtp-port-closed', `${host}:${port} 拒绝连接（端口未开放，或被防火墙/安全软件拦截）`);
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENETDOWN' || code === 'EADDRNOTAVAIL') {
    return fail('smtp-unreachable', `网络不可达 ${host}:${port}（${code}）`);
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return fail('smtp-timeout', `连接 ${host}:${port} 超时（${code}）`);
  }
  if (CERT_ERROR_CODES.has(code)) {
    return fail('smtp-cert-failed', `证书校验失败：${raw}（${code}）`);
  }
  return fail('smtp-connect-failed', `无法连接 ${host}:${port}（${raw}）`);
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

class Session {
  constructor(cfg) {
    this.cfg = cfg;
    this.socket = null;
    this.reader = null;
    this.timeoutError = null;
    this.capabilities = new Map();
    this.greeted = false;
    this.certBypassed = false;
  }

  async connect() {
    const cfg = this.cfg;
    const port = Number.isFinite(cfg.port) ? Number(cfg.port) : cfg.secure ? 465 : 587;
    const host = cfg.host;
    const rejectUnauthorized = cfg.rejectUnauthorized !== false;

    const shape = { host, port, secure: cfg.secure, rejectUnauthorized, timeoutMs: this.timeoutMs() };
    try {
      this.socket = await openSocket(shape);
    } catch (error) {
      // R7: a TLS-inspecting proxy, corporate CA or antivirus rewrites the
      // certificate chain, so strict verification fails on a server that is
      // otherwise fine. Retry once without verification instead of telling the
      // user to change ports (465-only providers cannot be reached any other way).
      if (rejectUnauthorized && isCertificateFailure(error)) {
        this.certBypassed = true;
        this.socket = await openSocket({ ...shape, rejectUnauthorized: false });
      } else {
        throw error;
      }
    }

    this.reader = new LineReader(this.socket);
    this.socket.setNoDelay?.(true);
  }

  timeoutMs() {
    const value = Number(this.cfg.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  async readResponse() {
    const lines = [];
    for (;;) {
      const line = await this.reader.readLine();
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        return { code: Number(line.slice(0, 3)), lines, text: lines.join('\n') };
      }
      if (lines.length > 200) throw fail('smtp-protocol-error', '邮件服务器响应异常（行数过多）');
    }
  }

  async command(text, expect = [250]) {
    this.socket.write(`${text}${CRLF}`);
    const reply = await this.readResponse();
    if (!expect.includes(reply.code)) {
      throw fail(
        reply.code === 535 || reply.code === 530 ? 'smtp-auth-failed' : 'smtp-rejected',
        `${text.split(' ')[0]} 被拒绝（${reply.code}）：${reply.text}`,
      );
    }
    return reply;
  }

  parseEhlo(reply) {
    this.capabilities.clear();
    for (const line of reply.lines.slice(1)) {
      const clean = line.replace(/^\d{3}[- ]/, '').trim();
      if (!clean) continue;
      const [rawName, ...rest] = clean.split(/\s+/);
      this.capabilities.set(rawName.toUpperCase(), rest.join(' '));
    }
  }

  async hello() {
    const name = this.cfg.clientName || os.hostname() || 'localhost';
    try {
      const reply = await this.command(`EHLO ${name}`, [250]);
      this.parseEhlo(reply);
    } catch {
      // Ancient servers only speak HELO; fall back rather than abort.
      await this.command(`HELO ${name}`, [250]);
      this.capabilities.clear();
    }
    this.greeted = true;
  }

  supports(name) {
    return this.capabilities.has(name.toUpperCase());
  }

  async upgradeTls() {
    const cfg = this.cfg;
    const host = cfg.host;
    const plain = this.socket;
    this.reader.detach();
    const open = (rejectUnauthorized) => new Promise((resolve, reject) => {
      const socket = tls.connect(
        { socket: plain, servername: host, rejectUnauthorized },
        () => resolve(socket),
      );
      socket.once('error', (error) => reject(classifySocketError(error, host, cfg.port)));
    });

    let secure;
    const strict = cfg.rejectUnauthorized !== false;
    try {
      secure = await open(strict);
    } catch (error) {
      if (strict && isCertificateFailure(error)) {
        this.certBypassed = true;
        secure = await open(false);
      } else {
        throw error;
      }
    }
    this.socket = secure;
    this.reader = new LineReader(secure);
    this.socket.setNoDelay?.(true);
    // Capabilities must be re-read after the upgrade.
    this.capabilities.clear();
    await this.hello();
  }

  async authenticate() {
    const user = str(this.cfg.user);
    const pass = str(this.cfg.pass ?? this.cfg.password);
    if (!user && !pass) return;

    const authLine = str(this.capabilities.get('AUTH')).toUpperCase();
    const mechanisms = authLine.split(/\s+/).filter(Boolean);
    const canPlain = mechanisms.length === 0 || mechanisms.includes('PLAIN');
    const canLogin = mechanisms.length === 0 || mechanisms.includes('LOGIN');

    if (canPlain) {
      const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
      try {
        await this.command(`AUTH PLAIN ${token}`, [235]);
        return;
      } catch (error) {
        if (!canLogin) throw error;
      }
    }
    if (canLogin) {
      this.socket.write(`AUTH LOGIN${CRLF}`);
      let reply = await this.readResponse();
      if (reply.code !== 334) throw fail('smtp-auth-failed', `AUTH LOGIN 不被接受（${reply.code}）：${reply.text}`);
      this.socket.write(`${Buffer.from(user, 'utf8').toString('base64')}${CRLF}`);
      reply = await this.readResponse();
      if (reply.code !== 334) throw fail('smtp-auth-failed', `用户名不被接受（${reply.code}）：${reply.text}`);
      this.socket.write(`${Buffer.from(pass, 'utf8').toString('base64')}${CRLF}`);
      reply = await this.readResponse();
      if (reply.code !== 235) throw fail('smtp-auth-failed', `密码不被接受（${reply.code}）：${reply.text}`);
      return;
    }

    throw fail('smtp-auth-unsupported', '邮件服务器不支持 AUTH PLAIN / AUTH LOGIN，无法登录');
  }

  async quit() {
    try {
      this.socket.write(`QUIT${CRLF}`);
      await this.readResponse();
    } catch {
      /* QUIT is best effort */
    }
    this.close();
  }

  close() {
    if (!this.socket) return;
    this.reader?.detach();
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.reader = null;
  }
}

// ---------------------------------------------------------------------------
// Message assembly
// ---------------------------------------------------------------------------

/** RFC 2047 encode a header value when it contains non-ASCII. */
function encodeHeaderValue(value) {
  const text = str(value).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** base64 with CRLF every 76 chars (RFC 2045). */
function base64Lines(input) {
  const encoded = Buffer.from(input).toString('base64');
  const out = [];
  for (let index = 0; index < encoded.length; index += 76) out.push(encoded.slice(index, index + 76));
  return out.join(CRLF);
}

/** Escape a leading dot so the DATA terminator cannot appear in the body. */
function dotStuff(body) {
  return body.replace(/^(\.)/gm, '$1$1');
}

function addressOf(value) {
  const text = str(value).trim();
  return text;
}

/** Render one body part (plain / html) as a MIME entity. */
function bodyPart({ subtype, content }) {
  return [
    `Content-Type: text/${subtype}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(str(content), 'utf8')),
  ].join(CRLF);
}

function attachmentPart(attachment, index) {
  const filename = str(attachment && attachment.filename).trim() || `附件-${index + 1}.bin`;
  const mime = str(attachment && attachment.mime).trim() || 'application/octet-stream';
  const raw = str(attachment && attachment.base64).replace(/^data:[^;,]+;base64,/, '');
  const bytes = Buffer.from(raw, 'base64');
  const encodedName = encodeHeaderValue(filename);
  return [
    `Content-Type: ${mime}; name="${encodedName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodedName}"`,
    '',
    base64Lines(bytes),
  ].join(CRLF);
}

/**
 * Build the RFC 5322 message. Returns `{raw, messageId, subject}` where `raw`
 * still lacks the DATA terminator.
 */
export function buildMessage(msg = {}) {
  const from = addressOf(msg.from);
  const toList = (Array.isArray(msg.to) ? msg.to : [msg.to]).map(addressOf).filter(Boolean);
  const subject = str(msg.subject);
  const text = str(msg.text);
  const html = str(msg.html);
  const attachments = Array.isArray(msg.attachments) ? msg.attachments.filter(Boolean) : [];

  const domain = (from.split('@')[1] || 'novel-writer.local').replace(/[^a-zA-Z0-9.-]/g, '') || 'novel-writer.local';
  const messageId = `<${Date.now().toString(36)}.${randomBytes(6).toString('hex')}@${domain}>`;

  const headers = [
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `From: ${from}`,
    `To: ${toList.join(', ')}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];
  if (msg.cc) headers.push(`Cc: ${str(msg.cc)}`);
  if (msg.replyTo) headers.push(`Reply-To: ${str(msg.replyTo)}`);

  const plainPart = text || !html ? bodyPart({ subtype: 'plain', content: text }) : null;
  const htmlPart = html ? bodyPart({ subtype: 'html', content: html }) : null;

  let bodyEntity;
  if (plainPart && htmlPart) {
    const altBoundary = `=_nw_alt_${randomBytes(8).toString('hex')}`;
    bodyEntity = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      plainPart,
      `--${altBoundary}`,
      htmlPart,
      `--${altBoundary}--`,
      '',
    ].join(CRLF);
  } else if (htmlPart) {
    bodyEntity = htmlPart;
  } else {
    bodyEntity = plainPart || bodyPart({ subtype: 'plain', content: '' });
  }

  let entity = bodyEntity;
  if (attachments.length > 0) {
    const boundary = `=_nw_mix_${randomBytes(8).toString('hex')}`;
    const parts = [bodyEntity];
    attachments.forEach((attachment, index) => parts.push(attachmentPart(attachment, index)));
    entity = [
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      ...parts.flatMap((part) => [`--${boundary}`, part]),
      `--${boundary}--`,
      '',
    ].join(CRLF);
  }

  return { raw: `${headers.join(CRLF)}${CRLF}${entity}`, messageId, subject, recipients: toList };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function normalizeConfig(cfg) {
  const source = isPlainObject(cfg) ? cfg : {};
  const host = str(source.host).trim();
  const rawPort = Number(source.port);
  const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : source.secure === true ? 465 : 587;
  // R7: when the caller omits `secure`, infer it from the port. Previously a
  // manually typed 465 with no explicit flag fell back to `secure:false` and
  // spoke plaintext at a TLS port — the single most common "连不上" case.
  const secure = source.secure === undefined ? port === 465 : source.secure === true;
  return {
    host,
    port,
    secure,
    user: str(source.user).trim(),
    pass: str(source.pass ?? source.password),
    from: str(source.from).trim(),
    clientName: str(source.clientName).trim(),
    rejectUnauthorized: source.rejectUnauthorized !== false,
    timeoutMs: Number.isFinite(Number(source.timeoutMs)) && Number(source.timeoutMs) > 0 ? Number(source.timeoutMs) : DEFAULT_TIMEOUT_MS,
  };
}

export function isConfigured(cfg) {
  const config = normalizeConfig(cfg);
  return Boolean(config.host);
}

/** Wrap a whole session in the hard timeout. */
async function withSession(cfg, task) {
  const config = normalizeConfig(cfg);
  if (!config.host) return { ok: false, code: 'smtp-not-configured', message: '未配置邮件服务器（SMTP 主机）' };

  const session = new Session(config);
  const timer = setTimeout(() => {
    session.timeoutError = fail('smtp-timeout', `邮件服务器响应超时（${config.timeoutMs} 毫秒）`);
    try {
      session.socket?.destroy();
    } catch {
      /* already gone */
    }
  }, config.timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    await session.connect();
    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw fail('smtp-greeting-failed', `邮件服务器拒绝连接（${greeting.code}）：${greeting.text}`);
    }
    await session.hello();

    if (!config.secure && config.port !== 465 && session.supports('STARTTLS') && config.starttls !== false) {
      await session.command('STARTTLS', [220]);
      await session.upgradeTls();
    }

    const result = await task(session, config);
    await session.quit();
    return result;
  } catch (error) {
    session.close();
    // A destroyed socket surfaces as "connection closed"; prefer the timeout.
    return failure(session.timeoutError || error);
  } finally {
    clearTimeout(timer);
    session.close();
  }
}

/**
 * Provider presets shown as one-click buttons in the settings dialog.
 *
 * Mail providers overwhelmingly reject the account password: QQ/163/126/Gmail
 * all require an app-specific password. Every preset therefore carries the note
 * that matters, so the user does not spend a round trip discovering it.
 */
export const PRESETS = Object.freeze([
  {
    id: 'qq',
    name: 'QQ 邮箱',
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    note: '需在 QQ 邮箱「设置 → 账户」开启 SMTP 服务，密码处填写生成的授权码（不是 QQ 密码）',
  },
  {
    id: '163',
    name: '网易 163',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    note: '需开启 SMTP 并使用客户端授权密码；若提示 550，请先在网页端完成手机验证',
  },
  {
    id: '126',
    name: '网易 126',
    host: 'smtp.126.com',
    port: 465,
    secure: true,
    note: '同 163：密码处填客户端授权密码',
  },
  {
    id: 'yeah',
    name: 'Yeah 邮箱',
    host: 'smtp.yeah.net',
    port: 465,
    secure: true,
    note: '密码处填客户端授权密码',
  },
  {
    id: 'sina',
    name: '新浪邮箱',
    host: 'smtp.sina.com',
    port: 465,
    secure: true,
    note: '需在网页端开启 SMTP 服务',
  },
  {
    id: 'aliyun',
    name: '阿里邮箱',
    host: 'smtp.aliyun.com',
    port: 465,
    secure: true,
    note: '个人邮箱与企业邮箱域名不同，企业邮箱请填 smtp.<你的域名>',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    note: '需开启两步验证并生成「应用专用密码」，普通密码无法登录',
  },
  {
    id: 'outlook',
    name: 'Outlook / Hotmail',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    note: '使用 STARTTLS 587；若账号开启了两步验证，需使用应用密码',
  },
  {
    id: 'icloud',
    name: 'iCloud',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    note: '需在 Apple ID 中生成「App 专用密码」',
  },
  {
    id: 'custom',
    name: '自定义',
    host: '',
    port: 465,
    secure: true,
    note: '填写你所用邮箱服务商提供的 SMTP 地址与端口',
  },
]);

/**
 * Connection shapes to try, in order, when the configured one fails. Providers
 * disagree about which port speaks TLS, and the error for "wrong port" is often
 * indistinguishable from "blocked network" — so we just try all three.
 */
const VARIANTS = Object.freeze([
  { port: 465, secure: true, label: 'SSL 465' },
  { port: 587, secure: false, label: 'STARTTLS 587' },
  { port: 25, secure: false, label: '明文 25' },
]);

/** Turn a transport/auth failure into something the user can act on. */
export function hintFor(code, message = '', host = '') {
  const detail = str(message);
  const target = str(host) || '邮件服务器';
  switch (str(code)) {
    case 'smtp-auth-failed':
      return `账号或密码被拒绝（${detail}）。多数邮箱不允许用登录密码发信：请先在网页端开启 SMTP 服务，再用它生成的「授权码 / 客户端专用密码」。`;
    case 'smtp-auth-unsupported':
      return `该服务器不接受 AUTH PLAIN / AUTH LOGIN 登录（${detail}），请改用支持标准 SMTP 认证的服务商。`;
    case 'smtp-dns-failed':
      return `域名解析失败（${detail}）：这台电脑找不到该邮件服务器的地址。请核对 SMTP 服务器名是否拼错，并确认网络能正常上网（挂了代理 / 加速器 / 修改过 hosts 都会导致解析失败）。`;
    case 'smtp-port-closed':
      return `端口被拒绝（${detail}）：地址能解析，但该端口没有开放。绝大多数情况是公司/学校网络、运营商或安全软件封锁了发信端口。请依次试 465（SSL）→ 587（STARTTLS）→ 25（明文），或改用手机热点。`;
    case 'smtp-unreachable':
      return `网络不可达（${detail}）。请确认当前网络需要代理才能访问外网，或换一个网络再试。`;
    case 'smtp-cert-failed':
      return `服务器证书校验失败（${detail}）。常见于公司网络、抓包工具或杀毒软件做了 HTTPS 中间人。插件已经自动用「跳过校验」重试过一次；若仍失败，请关闭中间人代理，或改用手机热点。`;
    case 'smtp-tls-failed':
      return `TLS 握手失败（${detail}）。该端口可能不支持直接 SSL（465 才用 SSL，587 用 STARTTLS），请核对端口与 SSL 开关是否匹配。`;
    case 'smtp-timeout':
      return `连接 ${target} 超时（${detail}）。可能是网络或防火墙封了该端口，请换端口（465 / 587 / 25）或换网络再试。`;
    case 'smtp-connect-failed':
    case 'smtp-connection-closed':
      return `无法连接到 ${target}（${detail}）。请核对 SMTP 地址与端口，并确认该端口没有被网络环境封锁。`;
    case 'smtp-greeting-failed':
      return `${target} 拒绝会话（${detail}）。若提示 554/421，多为 IP 被临时限制，请稍后或换网络重试。`;
    case 'smtp-rejected':
      return `服务器拒绝了请求（${detail}）。常见原因是收件人地址不存在，或被判定为垃圾邮件（正文过短 / 无主题）。`;
    case 'smtp-message-too-large':
      return `邮件超过 40MB（${detail}）。请把长篇稿件拆分成多封，或改为只附 TXT。`;
    default:
      return detail || `${target} 连接失败，请检查配置`;
  }
}

/**
 * Try the configured connection shape first, then the other two ports, and
 * report every attempt. Stops early on an auth failure — the socket clearly
 * worked, so trying another port cannot help.
 */
export async function diagnose(config = {}) {
  const base = normalizeConfig(config);
  if (!base.host) {
    return { ok: false, code: 'smtp-not-configured', message: '尚未配置邮箱（SMTP 主机）', attempts: [] };
  }

  const ordered = [
    { port: base.port, secure: base.secure, label: base.secure ? `SSL ${base.port}` : `STARTTLS ${base.port}` },
    ...VARIANTS.filter((variant) => variant.port !== base.port),
  ];

  const attempts = [];
  for (const variant of ordered) {
    const result = await verify({ ...base, port: variant.port, secure: variant.secure });
    if (result && result.ok === true) {
      return {
        ok: true,
        detail: result.detail,
        variant,
        attempts: [...attempts, { variant: variant.label, ok: true, detail: result.detail }],
      };
    }
    const failure = result || {};
    const code = str(failure.code) || 'smtp-test-failed';
    attempts.push({ variant: variant.label, ok: false, code, detail: str(failure.message) });
    // A socket that answered but refused credentials means OTHER ports would at
    // best repeat the same auth failure; a hostname that does not resolve or a
    // network that is unreachable makes every other port pointless as well.
    if (
      code === 'smtp-auth-failed' ||
      code === 'smtp-auth-unsupported' ||
      code === 'smtp-dns-failed' ||
      code === 'smtp-unreachable'
    ) {
      break;
    }
  }

  // Report the failure of the *configured* shape first: that is what the real
  // send will use, and it is the one the user can act on. The extra ports are
  // only a hint that another shape might work.
  const primary = attempts[0] || {};
  const alternative = attempts.find((row) => row.ok === false && row.code !== primary.code) || null;
  return {
    ok: false,
    code: str(primary.code) || 'smtp-test-failed',
    message: hintFor(primary.code, primary.detail, base.host),
    attempts,
    alternative: alternative ? { variant: alternative.variant, code: alternative.code, detail: alternative.detail } : null,
  };
}

/**
 * Test a configuration: connect, EHLO, optional STARTTLS, optional AUTH, QUIT.
 * Resolves to `{ok:true, detail, capabilities}` or `{ok:false, code, message}`.
 */
export async function verify(config = {}) {
  const result = await withSession(config, async (session, cfg) => {
    if (cfg.user || cfg.pass) await session.authenticate();
    const features = [...session.capabilities.keys()].sort();
    const shape = `${cfg.host}:${cfg.port}${cfg.secure ? '（SSL/TLS）' : session.capabilities.has('STARTTLS') ? '（STARTTLS）' : '（明文）'}`;
    const bypass = session.certBypassed ? '；证书校验已自动跳过（多为公司网络/杀毒软件的中间人代理）' : '';
    return {
      ok: true,
      detail: `已连接 ${shape}${cfg.user ? '，登录成功' : ''}${bypass}`,
      capabilities: features,
      tls: cfg.secure || session.capabilities.has('STARTTLS'),
      certBypassed: session.certBypassed === true,
      auth: Boolean(cfg.user || cfg.pass),
    };
  });
  if (result && result.ok === false) {
    return { ...result, message: hintFor(result.code, result.message, normalizeConfig(config).host) };
  }
  return result;
}

/**
 * Send one mail.
 * `{host,port,secure,user,pass,from,to,subject,text,html,attachments,timeoutMs}`
 * Resolves to `{ok:true, messageId, accepted, response}` or a structured failure.
 */
export async function send(msg = {}) {
  const source = isPlainObject(msg) ? msg : {};
  const from = addressOf(source.from || source.user);
  if (!from) return { ok: false, code: 'smtp-invalid-config', message: '缺少发件人地址（from）' };

  const toList = (Array.isArray(source.to) ? source.to : [source.to]).map(addressOf).filter(Boolean);
  if (toList.length === 0) return { ok: false, code: 'smtp-invalid-config', message: '缺少收件人地址（to）' };

  const built = buildMessage({ ...source, from, to: toList });
  const body = `${built.raw}${CRLF}.${CRLF}`;
  const stuffed = `${dotStuff(built.raw)}${CRLF}.${CRLF}`;
  if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) {
    return { ok: false, code: 'smtp-message-too-large', message: '邮件体积过大（超过 40MB）' };
  }

  return withSession({ ...source, from }, async (session, cfg) => {
    if (cfg.user || cfg.pass) await session.authenticate();

    await session.command(`MAIL FROM:<${from}>`, [250]);
    const accepted = [];
    for (const recipient of toList) {
      const reply = await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
      accepted.push({ recipient, code: reply.code });
    }

    await session.command('DATA', [354]);
    session.socket.write(`${stuffed}`);
    const reply = await session.readResponse();
    if (reply.code !== 250) {
      throw fail('smtp-rejected', `邮件被拒绝（${reply.code}）：${reply.text}`);
    }
    return {
      ok: true,
      messageId: built.messageId,
      subject: built.subject,
      accepted: accepted.map((row) => row.recipient),
      response: reply.text,
    };
  });
}
