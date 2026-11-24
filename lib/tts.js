// Text-to-speech for the 「念给我听」 button in the reader.
//
// R131: the reader used to speak only through `window.speechSynthesis` — the
// voices baked into the OS. That works offline and never sends a character
// anywhere, but it sounds like a 2010 GPS. This module adds two engines the
// writer can opt into, both behind one host route so the break-glass path stays
// local:
//
//   edge — Microsoft's Edge read-aloud voices (zh-CN-XiaoxiaoNeural and friends).
//          Free, no key, but it is an undocumented websocket and it talks to
//          Microsoft: the paragraph leaves the machine. In some networks the
//          handshake is refused outright (403). We surface the status instead of
//          pretending it worked.
//   api  — anything that speaks the OpenAI `/v1/audio/speech` shape: OpenAI
//          itself, Azure proxies, 智谱 / 火山 / MiniMax gateways, and the local
//          servers people run for GPT-SoVITS, CosyVoice and Kokoro. The writer
//          fills in URL / key / model / voice in settings; nothing is stored
//          here, the config rides along with each request.
//
// Everything returns `{ audio: Buffer, mime }`. Errors are plain Errors with a
// `code` so `routes.js` can turn them into the usual `{ok:false}` envelope.

import crypto from 'node:crypto';
import tls from 'node:tls';

/** Longest single snippet we will synthesize in one request. */
export const TTS_MAX_CHARS = 1200;
/** Hard ceiling for one synthesis, in milliseconds. */
const TTS_TIMEOUT = 20000;

const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_HOST = 'speech.platform.bing.com';
const EDGE_PATH = '/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_VERSION = '1-130.0.2849.68';
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

/** Edge's anti-abuse token: SHA-256 of (windows file time, 5-minute-rounded) + token. */
function edgeToken() {
  const ticks = Math.floor(Date.now() / 1000 + 11644473600) * 10000000;
  const rounded = ticks - (ticks % 3000000000);
  return crypto.createHash('sha256').update(`${rounded}${EDGE_TRUSTED_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

function ttsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** One masked client frame (text or close/ping). */
function wsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) body[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, body]);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Speak one paragraph with an Edge read-aloud voice.
 *
 * The protocol is undocumented; it is the same one the `edge-tts` project speaks:
 * a raw websocket to Microsoft's endpoint, a `speech.config` frame, then an SSML
 * frame, then binary frames that carry `Path:audio` followed by MP3 bytes. Node's
 * built-in `WebSocket` cannot set the `Origin` header the endpoint wants, hence
 * the hand-rolled TLS upgrade below.
 */
export function edgeSynthesize({ text, voice, rate = 1 } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw ttsError('tts-empty', '没有可朗读的文字');
  const speakText = trimmed.slice(0, TTS_MAX_CHARS);
  const voiceName = String(voice || 'zh-CN-XiaoxiaoNeural');
  const percent = Math.round((clampRate(rate) - 1) * 100);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let settled = false;
    let socket;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      if (error) reject(error);
      else if (!chunks.length) reject(ttsError('tts-empty-audio', '在线语音没有返回音频'));
      else resolve({ audio: Buffer.concat(chunks), mime: 'audio/mpeg' });
    };

    const timer = setTimeout(() => finish(ttsError('tts-timeout', '在线语音超时，请检查网络')), TTS_TIMEOUT);

    const key = crypto.randomBytes(16).toString('base64');
    const query =
      `?TrustedClientToken=${EDGE_TRUSTED_TOKEN}` +
      `&Sec-MS-GEC=${edgeToken()}` +
      `&Sec-MS-GEC-Version=${EDGE_VERSION}` +
      `&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}`;

    try {
      socket = tls.connect({ host: EDGE_HOST, port: 443, servername: EDGE_HOST }, () => {
        socket.write(
          `GET ${EDGE_PATH}${query} HTTP/1.1\r\n` +
            `Host: ${EDGE_HOST}\r\n` +
            'Connection: Upgrade\r\n' +
            'Upgrade: websocket\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Pragma: no-cache\r\n' +
            'Cache-Control: no-cache\r\n' +
            `Origin: ${EDGE_ORIGIN}\r\n` +
            `User-Agent: ${EDGE_UA}\r\n` +
            'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8\r\n\r\n'
        );
      });
    } catch (error) {
      finish(ttsError('tts-offline', `无法连接在线语音：${error.message}`));
      return;
    }

    socket.on('error', (error) => {
      finish(ttsError('tts-offline', `在线语音连接失败：${error.code || error.message}`));
    });

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      if (!upgraded) {
        const split = buffer.indexOf('\r\n\r\n');
        if (split < 0) return;
        const head = buffer.slice(0, split).toString('latin1');
        buffer = buffer.slice(split + 4);
        const statusLine = head.split('\r\n')[0] || '';
        if (!/ 101 /.test(statusLine)) {
          const status = (statusLine.match(/ (\d{3}) /) || [])[1] || '?';
          finish(
            ttsError(
              'tts-refused',
              status === '403'
                ? '微软的在线语音拒绝了这台机器的连接（403）。换用「自定义 API」，或在设置里把引擎切回系统语音。'
                : `在线语音握手失败（HTTP ${status}）`
            )
          );
          return;
        }
        upgraded = true;
        socket.write(
          wsFrame(
            `X-Timestamp:${new Date().toString()}\r\n` +
              'Content-Type:application/json; charset=utf-8\r\n' +
              'Path:speech.config\r\n\r\n' +
              '{"context":{"synthesis":{"audio":{"metadataoptions":' +
              '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
              '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
          )
        );
        const ssml =
          "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
          `<voice name='${escapeXml(voiceName)}'>` +
          `<prosody rate='${percent >= 0 ? '+' : ''}${percent}%' pitch='+0Hz'>` +
          escapeXml(speakText) +
          '</prosody></voice></speak>';
        socket.write(
          wsFrame(
            `X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\n` +
              'Content-Type:application/ssml+xml\r\n' +
              `X-Timestamp:${new Date().toString()}Z\r\n` +
              'Path:ssml\r\n\r\n' +
              ssml
          )
        );
        return;
      }

      // Frame-by-frame: ping → pong, close → done, text → turn.end is the finisher,
      // binary → header line `Path:audio` then the MP3 chunk.
      for (;;) {
        if (buffer.length < 2) return;
        const first = buffer[0];
        const second = buffer[1];
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (masked) offset += 4;
        if (buffer.length < offset + length) return;
        const payload = buffer.slice(offset, offset + length);
        buffer = buffer.slice(offset + length);

        if (opcode === 0x9) {
          socket.write(wsFrame(payload, 0xa));
          continue;
        }
        if (opcode === 0x8) {
          finish(null);
          return;
        }
        if (opcode === 0x1) {
          if (payload.toString('utf8').includes('Path:turn.end')) {
            finish(null);
            return;
          }
          continue;
        }
        if (opcode === 0x2) {
          const split = payload.indexOf('\r\n\r\n');
          if (split >= 0 && payload.slice(0, split).toString('latin1').includes('Path:audio')) {
            chunks.push(payload.slice(split + 4));
          }
        }
      }
    });
  });
}

/**
 * Baidu's translator voice: free, no key, and it answers from mainland China
 * (Microsoft's endpoint does not always). There is no public contract behind
 * `fanyi.baidu.com/gettts` — it is the same unauthenticated endpoint the web
 * translator calls. One female voice, speed 1–15, MP3 back.
 */
export async function baiduSynthesize({ text, rate = 1 } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw ttsError('tts-empty', '没有可朗读的文字');
  const speakText = trimmed.slice(0, TTS_MAX_CHARS);
  const spd = Math.min(15, Math.max(1, Math.round(clampRate(rate) * 5)));
  const url =
    'https://fanyi.baidu.com/gettts?lan=zh&spd=' +
    spd +
    '&source=web&text=' +
    encodeURIComponent(speakText);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        referer: 'https://fanyi.baidu.com/',
      },
      signal: AbortSignal.timeout(TTS_TIMEOUT),
    });
  } catch (error) {
    const reason = error && (error.cause && error.cause.code ? error.cause.code : error.name);
    throw ttsError('tts-offline', `连不上百度朗读${reason ? `（${reason}）` : ''}`);
  }

  const type = String(response.headers.get('content-type') || '');
  const audio = Buffer.from(await response.arrayBuffer());
  // 这个接口出错时会吐 JSON（限额 / 参数不对），不是音频。
  if (!/^audio\//i.test(type) || !audio.length) {
    const detail = audio.slice(0, 200).toString('utf8');
    throw ttsError('tts-api-error', `百度朗读没有返回音频${detail ? `：${detail}` : ''}`);
  }
  return { audio, mime: 'audio/mpeg' };
}

function clampRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

/** `https://host/v1` and `https://host/v1/audio/speech` should both work. */
function speechEndpoint(raw) {
  const url = String(raw || '').trim();
  if (!url) throw ttsError('tts-no-url', '还没有填写 API 地址（设置 → 阅读 → 朗读）');
  if (/\/audio\/speech\/?$/i.test(url)) return url.replace(/\/+$/, '');
  const base = url.replace(/\/+$/, '');
  if (/\/v\d+$/i.test(base)) return `${base}/audio/speech`;
  return `${base}/v1/audio/speech`;
}

/**
 * Speak one paragraph through an OpenAI-compatible `/v1/audio/speech` endpoint.
 * `api` is the writer's config: `{ url, key, model, voice, format }`.
 */
export async function apiSynthesize({ text, voice, rate = 1, api = {} } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw ttsError('tts-empty', '没有可朗读的文字');
  const speakText = trimmed.slice(0, TTS_MAX_CHARS);
  const endpoint = speechEndpoint(api.url);
  const headers = { 'content-type': 'application/json' };
  const key = String(api.key || '').trim();
  if (key) headers.authorization = /^Bearer /i.test(key) ? key : `Bearer ${key}`;

  const body = {
    model: String(api.model || 'tts-1').trim() || 'tts-1',
    input: speakText,
    voice: String(api.voice || voice || 'alloy').trim() || 'alloy',
    speed: clampRate(rate),
    response_format: String(api.format || 'mp3').trim() || 'mp3',
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TTS_TIMEOUT),
    });
  } catch (error) {
    const reason = error && (error.cause && error.cause.code ? error.cause.code : error.name);
    throw ttsError('tts-offline', `连不上 ${endpoint}${reason ? `（${reason}）` : ''}`);
  }

  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim();
  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      detail = text.slice(0, 300);
    } catch {
      detail = '';
    }
    throw ttsError('tts-api-error', `朗读接口返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw ttsError('tts-empty-audio', '朗读接口没有返回音频');
  return { audio, mime: /^audio\//i.test(mime) ? mime : 'audio/mpeg' };
}

/** Which engine a payload asks for; anything unknown falls back to the system one. */
export function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  if (engine === 'edge' || engine === 'api' || engine === 'baidu') return engine;
  return 'system';
}

/**
 * Route one paragraph to the engine the writer picked. `system` never reaches
 * this module (the reader speaks it in the renderer), so it is an error here.
 */
export async function synthesize(payload = {}) {
  const engine = normalizeEngine(payload.engine);
  if (engine === 'edge') {
    const result = await edgeSynthesize({ text: payload.text, voice: payload.voice || payload.edgeVoice, rate: payload.rate });
    return { ...result, engine };
  }
  if (engine === 'api') {
    const result = await apiSynthesize({ text: payload.text, voice: payload.voice, rate: payload.rate, api: payload.api });
    return { ...result, engine };
  }
  if (engine === 'baidu') {
    const result = await baiduSynthesize({ text: payload.text, rate: payload.rate });
    return { ...result, engine };
  }
  throw ttsError('tts-wrong-engine', '系统语音由浏览器自己念，不走这条路由');
}
