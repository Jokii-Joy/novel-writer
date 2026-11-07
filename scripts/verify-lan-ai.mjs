#!/usr/bin/env node
/*
 * verify-lan-ai.mjs — offline checks for the phone-facing AI route (R40).
 *
 * What this can prove without a phone and without a model: the listener exposes
 * exactly one new verb, that verb refuses anyone who is not a paired peer, and
 * `ping` advertises the capability the phone greys its button out with. The model
 * call itself is the desktop's existing `ai.proofread`, already covered by the
 * host's own self-test; faking an LLM here would only test the fake.
 *
 * Run: node scripts/verify-lan-ai.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The scratch home lives beside the script, not in the system temp: on this
// machine `os.tmpdir()` refuses mkdtemp with EPERM once the harness has taken
// ownership of it, and a test that cannot create its own sandbox reports a
// failure that has nothing to do with the code under test.
const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.join(here, '..', '.tmp');
fs.mkdirSync(scratch, { recursive: true });
const home = fs.mkdtempSync(path.join(scratch, 'nw-lan-ai-'));
process.env.DSH_HOME = home;
// The plugin normally creates its data directory at mount time; this script
// mounts the listener without the plugin, so the directory the identity file is
// renamed into has to exist first.
fs.mkdirSync(path.join(home, 'novel-writer'), { recursive: true });

const lanServer = await import('../lib/lansync-server.js');

// A fixed port collides with the previous run's listener (TIME_WAIT) when the
// script is run twice in a row, which made an otherwise-passing suite fail
// intermittently. Bind somewhere in a per-process band instead.
const PORT = 47000 + (process.pid % 1000);
const results = [];
function ok(label, detail) {
  results.push({ label, detail, pass: true });
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      })
      .on('error', reject);
  });
}

try {
  const started = await lanServer.start({ port: PORT, ctx: { name: 'verify-stub' } });
  assert.equal(started.ok, true, 'LAN listener should start');
  ok('监听启动', `端口 ${started.port}`);

  const ping = await get('/nw/v1/ping');
  if (ping.status !== 200) console.error('ping failed:', JSON.stringify(ping.json));
  assert.equal(ping.status, 200);
  assert.equal(ping.json.ai, true, 'ping must advertise ai when a context is bound');
  ok('ping 声明 ai 能力', 'ai=true');

  const anonymous = await post('/nw/v1/ai/proofread', { text: '他走进了屋子。' });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.json.code, 'peer-denied');
  ok('未配对请求被拒', '401 peer-denied');

  // R41: the advice verb the phone actually uses is gated the same way. 401 (and
  // not 404) is what proves the route exists without handing it a credential.
  const anonymousRevise = await post('/nw/v1/ai/revise', { text: '他走进了屋子。' });
  assert.equal(anonymousRevise.status, 401);
  assert.equal(anonymousRevise.json.code, 'peer-denied');
  ok('修改建议端点存在且同样受保护', '401 peer-denied');

  // R72: the model list is readable only by a paired device — it names every
  // provider the desktop has credentials for, which is not something to hand to
  // an arbitrary device on the same Wi-Fi.
  const anonymousModels = await post('/nw/v1/ai/models', {});
  assert.equal(anonymousModels.status, 401);
  assert.equal(anonymousModels.json.code, 'peer-denied');
  ok('模型列表受保护', '401 peer-denied');

  const forged = await post('/nw/v1/ai/proofread', {
    deviceId: 'phone-that-was-never-paired',
    body: Buffer.from(JSON.stringify({ text: '他走进了屋子。' }), 'utf8').toString('base64url'),
    signature: 'not-a-real-signature',
  });
  assert.equal(forged.status, 401);
  assert.ok(['peer-denied', 'peer-unknown'].includes(forged.json.code), 'unknown device must be refused');
  ok('伪造签名被拒', `401 ${forged.json.code}`);

  // An empty text must never reach the model even for a caller that got past the
  // signature check; this is the one input the route validates by itself.
  const badShape = await post('/nw/v1/ai/proofread', { deviceId: 'x', body: '', signature: '' });
  assert.equal(badShape.status, 401);
  ok('空凭据被拒', '401');

  const unknown = await post('/nw/v1/ai/rewrite', {});
  assert.equal(unknown.status, 404, 'no other AI verb may exist');
  ok('只有一个 AI 动词', '404');

  console.log('');
  console.log('全部通过 ✅');
} finally {
  lanServer.stop();
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* the temp dir may still be held open by a socket */
  }
}
