/*
 * probe-lan-ai.mjs — one manual end-to-end call against the live AI route.
 *
 * Not part of the test suite: it signs as a really-paired device (reading the
 * peer secret the host already has) and therefore **spends a real model call**.
 * Use it when "the phone says 校对失败" needs to be split into "the LAN route is
 * broken" vs "the phone UI is broken".
 *
 *   node scripts/probe-lan-ai.mjs "他的的房间里很安静。"
 *   node scripts/probe-lan-ai.mjs              # 默认一句干净的正文
 *
 * Requires: the desktop host running with the plugin enabled (the LAN listener
 * is only up while the plugin is mounted) and at least one paired phone.
 */
import crypto from 'node:crypto';
import http from 'node:http';

import * as lansync from '../lib/lansync.js';

const sign = (secret, body) =>
  crypto.createHmac('sha256', Buffer.from(String(secret), 'base64url')).update(String(body)).digest('base64url');

const peers = await lansync.listPeers();
console.log('peers:', peers.map((p) => `${p.id}:${p.name || '?'}`).join(', ') || '(none)');
if (!peers.length) process.exit(2);

const peer = peers[0];
const secret = await lansync.peerSecret(peer.id);
const TEXT = process.argv[3] || '他走进了屋子。';
const VERB = ['proofread', 'models'].includes(process.argv[2]) ? process.argv[2] : 'revise';
const PROVIDER = process.argv[4] || '';
const MODEL = process.argv[5] || '';
const request = { text: TEXT, mode: 'normal', focus: 'all' };
if (PROVIDER) request.provider = PROVIDER;
if (MODEL) request.model = MODEL;
if (process.argv[6] === 'stream') request.stream = true;
const inner = Buffer.from(JSON.stringify(request), 'utf8').toString('base64url');
const payload = JSON.stringify({ deviceId: peer.id, body: inner, signature: sign(secret, inner) });

const started = Date.now();
const req = http.request(
  { host: '127.0.0.1', port: 41288, path: '/nw/v1/ai/' + VERB, method: 'POST', headers: { 'content-type': 'application/json' } },
  (res) => {
    const chunks = [];
    let buffered = '';
    res.on('data', (c) => {
      if (!request.stream) {
        chunks.push(c);
        return;
      }
      // Streaming: print each event with its arrival time so progress can be
      // seen moving (or not) rather than read after the fact.
      buffered += c.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        if (line.trim()) console.log(`[${Date.now() - started} ms]`, line.slice(0, 300));
      }
    });
    res.on('end', () => {
      if (request.stream && buffered.trim()) console.log('tail:', buffered.slice(0, 300));
      console.log('status', res.statusCode, 'in', Date.now() - started, 'ms');
      if (!request.stream) console.log(Buffer.concat(chunks).toString('utf8').slice(0, 1200));
    });
  }
);
req.on('error', (e) => console.error('ERR', e.message));
req.end(payload);
