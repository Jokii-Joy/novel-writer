/*
 * lansync.js — LAN pairing and book-level sync between this desktop plugin and
 * the phone app.
 *
 * Design decisions, and why:
 *
 * 1. **The host owns the sync copy.** The browser keeps the real library in
 *    IndexedDB; the host never saw it. For a phone to sync, *someone* on the
 *    desktop has to hold an addressable copy, so `sync.push` mirrors the whole
 *    library into `<DSH_HOME>/novel-writer/sync-state.json`. That file is the
 *    desktop's authoritative view for sync purposes; IndexedDB stays the editing
 *    surface.
 *
 * 2. **Book-level Last-Write-Wins.** The product rule is explicit: different
 *    books merge freely; the same book with two edits takes the newer
 *    `updatedAt`, whole-book. So the unit of merge is a book record
 *    `{id, title, author, updatedAt, deleted, chapters}`, and chapters never
 *    merge across devices. That is coarser than character-level merge, but it is
 *    what was asked for and it is the only rule that cannot silently interleave
 *    two authors' sentences.
 *
 * 3. **Deletes are tombstones, not absences.** "A book deleted while the peer was
 *    offline must not come back." An absent book is indistinguishable from a book
 *    the other side has never seen, so deletion writes `{deleted:true, updatedAt}`
 *    and tombstones are only dropped once both sides have acknowledged them
 *    (currently: kept forever — they are ~60 bytes each and the library is small).
 *
 * 4. **Pairing is a one-time token over the LAN, trust is a stored key.** The QR
 *    carries a token that expires, plus the host's device id and public key. A
 *    peer that completes pairing is written to `peers.json`; after that requests
 *    are authenticated by a per-peer shared secret derived at pairing time, not
 *    by the QR. Re-scanning is only required when the peer identity is lost.
 *
 * 5. **Discovery is UDP broadcast, not mDNS.** mDNS needs a responder on 5353 and
 *    a library; the requirement is "same LAN, find each other", and a broadcast
 *    beacon on a private port gets that with 40 lines and no dependency. It runs
 *    on the host only — the phone is expected to broadcast too, and the host
 *    listens.
 */

import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dataRoot, decryptMirrorText, deriveMirrorKey, encryptMirrorText, MIRROR_MAGIC } from './library.js';

export const PROTOCOL = 'nw-lansync/1';
export const DISCOVERY_PORT = 41287;
export const DEFAULT_PAIR_TTL_MS = 5 * 60 * 1000;

const DEVICE_FILE = 'device.json';
const PEERS_FILE = 'peers.json';
const STATE_FILE = 'sync-state.json';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function str(value) {
  return value == null ? '' : String(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nowMs() {
  const value = Number(Date.now());
  return Number.isFinite(value) ? value : 0;
}

function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Atomic replace: write a temp file beside the target, then rename over it. */
async function writeTextAtomic(target, text) {
  const temp = `${target}.${process.pid.toString(36)}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.writeFile(temp, text, 'utf8');
    await fsp.rename(temp, target);
  } catch (error) {
    try {
      await fsp.rm(temp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  await writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
}

/** Raw file text, or `fallback` when the file is missing or unreadable. */
async function readTextFile(target, fallback) {
  try {
    return await fsp.readFile(target, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonFile(target, fallback) {
  try {
    const text = await fsp.readFile(target, 'utf8');
    const parsed = readJson(text);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/** Every non-loopback IPv4 address, most likely LAN address first. */
export function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      const family = typeof entry.family === 'string' ? entry.family : `IPv${entry.family}`;
      if (family !== 'IPv4' || entry.internal) continue;
      out.push({ name, address: entry.address, netmask: entry.netmask });
    }
  }
  // 192.168/10./172.16-31 first: those are the ones a phone on the same Wi-Fi
  // will also be on. Anything else (VPN, docker) is a worse guess.
  const score = (address) => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    const match = /^172\.(\d+)\./.exec(address);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 2;
    return 3;
  };
  out.sort((a, b) => score(a.address) - score(b.address));
  return out;
}

export function primaryAddress() {
  const list = lanAddresses();
  return list.length ? list[0].address : '';
}

/** Broadcast addresses for every interface (x.x.x.255 style, from the netmask). */
function broadcastTargets() {
  const targets = new Set(['255.255.255.255']);
  for (const entry of lanAddresses()) {
    const mask = str(entry.netmask);
    const parts = mask.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) continue;
    const addr = entry.address.split('.').map((part) => Number(part));
    if (addr.length !== 4) continue;
    const broadcast = addr.map((part, index) => (part & parts[index]) | (~parts[index] & 0xff));
    targets.add(broadcast.join('.'));
  }
  return Array.from(targets);
}

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

let identityCache = null;

/**
 * This device's identity: a stable id plus an Ed25519 keypair.
 *
 * The private key never leaves `device.json`; it signs the pairing handshake so
 * a peer that scanned the QR knows the host it is talking to is the one it saw.
 * Losing this file is exactly the "device changed" case that requires re-pairing.
 */
export async function deviceIdentity() {
  if (identityCache) return identityCache;
  const target = path.join(dataRoot(), DEVICE_FILE);
  const stored = await readJsonFile(target, null);
  if (isObject(stored) && str(stored.id) && isObject(stored.keypair)) {
    identityCache = stored;
    return stored;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const record = {
    id: crypto.randomBytes(12).toString('hex'),
    name: os.hostname() || '台式机',
    createdAt: nowMs(),
    keypair: {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    },
  };
  await writeJsonAtomic(target, record);
  identityCache = record;
  return record;
}

/** The public half of the identity, in the shape the QR and the peers file use. */
export function publicIdentity(identity) {
  const pem = identity && identity.keypair ? str(identity.keypair.publicKey) : '';
  const der = pem ? crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }) : Buffer.alloc(0);
  return {
    id: str(identity && identity.id),
    name: str(identity && identity.name),
    publicKey: der.toString('base64url'),
  };
}

// ---------------------------------------------------------------------------
// pairing
// ---------------------------------------------------------------------------

/**
 * One pending pairing offer. Held in memory on purpose: an offer that survives a
 * restart is an offer an attacker has more time to guess, and the window is five
 * minutes anyway.
 */
let pendingOffer = null;

/**
 * `pair.start` → the QR payload.
 *
 * The payload is **only** `nw1:HOST:PORT:TOKEN`, about 34 bytes, because the
 * host's Ed25519 public key alone is 59 base64url characters and would push the
 * code past version 5 at level M (86 bytes). Everything else — device id, name,
 * public key — is fetched over the LAN in `handshake`, which the token unlocks.
 *
 * That trade is also the security argument: the token travels out of band
 * (screen → camera), so a device that can present it has physically seen this
 * machine. The desktop stays the one that proves itself, by signing the token.
 */
export async function startPairing(options = {}) {
  const identity = await deviceIdentity();
  const publicPart = publicIdentity(identity);
  const token = crypto.randomBytes(9).toString('base64url');
  const port = Number(options.port) || 0;
  const address = str(options.address) || primaryAddress();
  const ttl = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_PAIR_TTL_MS;
  pendingOffer = {
    token,
    createdAt: nowMs(),
    expiresAt: nowMs() + ttl,
  };
  return {
    payload: `nw1:${address}:${port}:${token}`,
    token,
    deviceId: publicPart.id,
    deviceName: publicPart.name,
    address,
    port,
    expiresAt: pendingOffer.expiresAt,
    ttlMs: ttl,
    addresses: lanAddresses().map((entry) => entry.address),
  };
}

/**
 * `pair.handshake {token}` → who this desktop is, proven by a signature.
 *
 * Unauthenticated except for the token, which is exactly the point: the phone
 * just scanned a code and needs to learn the host's identity before it can post
 * its own. A wrong token gets the same `pair-expired` answer as a stale one, so
 * this cannot be used to enumerate live sessions.
 */
export async function handshake(payload) {
  const offer = pendingPairing();
  const token = str(payload && payload.token).trim();
  if (!offer || !token || token !== offer.token) {
    return { ok: false, code: 'pair-expired', message: '配对码已过期，请在电脑上重新显示二维码。' };
  }
  const identity = await deviceIdentity();
  const publicPart = publicIdentity(identity);
  const signature = crypto.sign(null, Buffer.from(token, 'utf8'), identity.keypair.privateKey).toString('base64url');
  return {
    ok: true,
    protocol: PROTOCOL,
    deviceId: publicPart.id,
    deviceName: publicPart.name,
    publicKey: publicPart.publicKey,
    signature,
    expiresAt: offer.expiresAt,
  };
}

export function pendingPairing() {
  if (!pendingOffer) return null;
  if (nowMs() > pendingOffer.expiresAt) {
    pendingOffer = null;
    return null;
  }
  return { ...pendingOffer };
}

export function clearPairing() {
  pendingOffer = null;
}

/**
 * `sync.pair.accept {token, deviceId, deviceName, publicKey}` → the new peer.
 *
 * The phone scans the QR, keeps the token, and posts it back with its own
 * identity. The token proves the caller saw the screen; from then on the peer
 * record is the credential.
 */
export async function acceptPairing(payload) {
  const offer = pendingPairing();
  if (!offer) return { ok: false, code: 'pair-expired', message: '配对码已过期，请重新显示二维码。' };
  const token = str(payload && payload.token).trim();
  if (!token || token !== offer.token) {
    return { ok: false, code: 'pair-denied', message: '配对令牌不正确。' };
  }
  const deviceId = str(payload && payload.deviceId).trim();
  if (!deviceId) return { ok: false, code: 'pair-denied', message: '缺少设备标识。' };
  const publicKey = str(payload && payload.publicKey).trim();
  if (!publicKey) return { ok: false, code: 'pair-denied', message: '缺少设备公钥。' };

  const secret = crypto.randomBytes(32).toString('base64url');
  const peer = {
    id: deviceId,
    name: str(payload && payload.deviceName).trim() || '手机',
    publicKey,
    // Shared secret the peer must sign with on later calls. Derived at pairing
    // time precisely so the QR token is never reusable.
    secret,
    address: str(payload && payload.address).trim(),
    pairedAt: nowMs(),
    lastSeen: 0,
    lastSyncAt: 0,
  };
  const peers = await readPeers();
  const index = peers.findIndex((row) => str(row.id) === deviceId);
  if (index >= 0) peers[index] = { ...peers[index], ...peer };
  else peers.push(peer);
  await writeJsonAtomic(path.join(dataRoot(), PEERS_FILE), peers);
  // A token is single-use: the second phone to arrive must scan again.
  clearPairing();
  return { ok: true, peer: publicPeer(peer), peers: peers.map(publicPeer) };
}

/** Strip the secret before anything leaves the host. */
export function publicPeer(peer) {
  return {
    id: str(peer && peer.id),
    name: str(peer && peer.name),
    address: str(peer && peer.address),
    pairedAt: Number(peer && peer.pairedAt) || 0,
    lastSeen: Number(peer && peer.lastSeen) || 0,
    lastSyncAt: Number(peer && peer.lastSyncAt) || 0,
  };
}

async function readPeers() {
  const rows = await readJsonFile(path.join(dataRoot(), PEERS_FILE), []);
  return Array.isArray(rows) ? rows.filter((row) => isObject(row) && str(row.id)) : [];
}

export async function listPeers() {
  return (await readPeers()).map(publicPeer);
}

export async function removePeer(id) {
  const peers = await readPeers();
  const next = peers.filter((row) => str(row.id) !== str(id));
  if (next.length === peers.length) return { ok: false, code: 'peer-not-found', message: '找不到这台设备。' };
  await writeJsonAtomic(path.join(dataRoot(), PEERS_FILE), next);
  return { ok: true, peers: next.map(publicPeer) };
}

/**
 * The pairing secret, for the LAN server's `pair/accept` response only.
 *
 * Deliberately a separate function rather than a field on `publicPeer`: every
 * other caller of `listPeers` is browser code that must never see this value, and
 * a property that "is usually stripped" is a property that eventually leaks. The
 * only legitimate reader is the phone, at the one moment it can receive it.
 */
export async function peerSecret(id) {
  const peers = await readPeers();
  const peer = peers.find((row) => str(row.id) === str(id));
  return peer ? str(peer.secret) : '';
}

/** Authenticate a sync call: the peer signs `payload` with its stored secret. */
export async function verifyPeer(deviceId, signature, body) {
  const peers = await readPeers();
  const peer = peers.find((row) => str(row.id) === str(deviceId));
  if (!peer) return { ok: false, code: 'peer-unknown', message: '这台设备还没有配对。' };
  const expected = crypto
    .createHmac('sha256', Buffer.from(str(peer.secret), 'base64url'))
    .update(String(body == null ? '' : body))
    .digest('base64url');
  const given = str(signature);
  // Constant-time compare: a timing side channel here would leak the secret.
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!same) return { ok: false, code: 'peer-denied', message: '配对凭据无效，请重新配对。' };
  peer.lastSeen = nowMs();
  try {
    await writeJsonAtomic(path.join(dataRoot(), PEERS_FILE), peers);
  } catch {
    /* a failed lastSeen write must not fail the sync */
  }
  return { ok: true, peer };
}

// ---------------------------------------------------------------------------
// the merge engine
// ---------------------------------------------------------------------------

/** A book in sync terms: metadata + its chapters, ordered, plus a tombstone. */
function normalizeBook(raw) {
  if (!isObject(raw)) return null;
  const id = str(raw.id).trim();
  if (!id) return null;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .filter((row) => isObject(row) && str(row.id))
        .map((row) => ({
          id: str(row.id),
          title: str(row.title),
          content: typeof row.content === 'string' ? row.content : '',
          order: Number(row.order) || 0,
        }))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    : [];
  return {
    id,
    title: str(raw.title) || '未命名小说',
    author: str(raw.author),
    updatedAt: Number(raw.updatedAt) || 0,
    deleted: raw.deleted === true,
    chapters,
  };
}

export function normalizeLibrary(raw) {
  const books = Array.isArray(raw && raw.books) ? raw.books.map(normalizeBook).filter(Boolean) : [];
  return { version: 1, books };
}

function bookKey(book) {
  return str(book && book.id);
}

/**
 * Merge two libraries under book-level LWW.
 *
 * Returns `{books, stats}` where `stats` reports what moved, so the UI can say
 * "3 books updated, 1 deleted" instead of a mute "synced".
 *
 * Rules, in order:
 *   1. a book present on one side only is taken as-is (including tombstones —
 *      a delete from the phone must land on the desktop);
 *   2. both sides have it, one is a tombstone → the tombstone wins if it is
 *      newer, otherwise the live copy wins (an edit made *after* a delete is a
 *      deliberate resurrection);
 *   3. both live → the newer `updatedAt` wins, whole book;
 *   4. exact tie → the local copy wins, which keeps the merge stable across
 *      repeated calls instead of oscillating;
 *   5. exception to 3 and 4: an unreadable copy never beats a readable one — if
 *      every body the local side holds is `enc:v1:` ciphertext and the incoming
 *      copy is not, the incoming copy wins whatever the timestamps say. That is
 *      how a mirror written before R36 (ciphertext, same `updatedAt` as the
 *      browser's copy) gets washed back to plaintext by the first push.
 */
export function mergeLibraries(localRaw, remoteRaw) {
  const local = normalizeLibrary(localRaw);
  const remote = normalizeLibrary(remoteRaw);
  const byId = new Map();
  for (const book of local.books) byId.set(bookKey(book), { book, from: 'local' });
  const stats = { added: 0, updated: 0, deleted: 0, kept: 0, repaired: 0, remoteWins: 0, localWins: 0 };

  for (const incoming of remote.books) {
    const key = bookKey(incoming);
    const current = byId.get(key);
    if (!current) {
      byId.set(key, { book: incoming, from: 'remote' });
      if (incoming.deleted) stats.deleted += 1;
      else stats.added += 1;
      continue;
    }
    const mine = current.book;
    const mineTime = Number(mine.updatedAt) || 0;
    const theirsTime = Number(incoming.updatedAt) || 0;

    // Rule 5 above: the browser decrypts before pushing, so its copy carries the
    // same `updatedAt` as the ciphertext sitting in the mirror. Without this the
    // tie in rule 4 would preserve the unreadable copy forever; because the phone
    // replaces its library with the merge result, this one branch is also what
    // makes the phone start showing readable text again.
    if (bookSealed(mine) && !bookSealed(incoming)) {
      byId.set(key, { book: incoming, from: 'remote' });
      stats.repaired += 1;
      stats.remoteWins += 1;
      stats.updated += 1;
      continue;
    }

    if (mine.deleted !== incoming.deleted) {
      // Tombstone against a live copy: the newer timestamp decides, and an exact
      // tie goes to the live copy — a delete at the same millisecond as an edit
      // must not silently destroy the edit.
      //
      // Written as one expression on purpose: the previous version compared
      // "does the tombstone win" against "am I the tombstone", which flipped the
      // answer whenever the *live* side was the newer one, so a book edited after
      // being deleted stayed dead forever.
      const incomingWins = theirsTime > mineTime || (theirsTime === mineTime && !incoming.deleted);
      if (incomingWins) {
        byId.set(key, { book: incoming, from: 'remote' });
        stats.remoteWins += 1;
        if (incoming.deleted) stats.deleted += 1;
        else stats.updated += 1;
      } else {
        stats.localWins += 1;
      }
      continue;
    }

    if (theirsTime > mineTime) {
      byId.set(key, { book: incoming, from: 'remote' });
      stats.remoteWins += 1;
      if (incoming.deleted) stats.deleted += 1;
      else stats.updated += 1;
    } else {
      stats.localWins += 1;
      stats.kept += 1;
    }
  }

  const books = Array.from(byId.values())
    .map((entry) => entry.book)
    .sort((a, b) => {
      // Live books first, newest first — the order the phone list wants.
      if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) || a.id.localeCompare(b.id);
    });
  return { library: { version: 1, books }, stats };
}

// ---------------------------------------------------------------------------
// the desktop's sync mirror
// ---------------------------------------------------------------------------

/** `enc:v1:` — what the browser stores in IndexedDB when 正文加密 is on. */
const SEALED_CONTENT = 'enc:v1:';

function sealedContent(content) {
  return typeof content === 'string' && content.startsWith(SEALED_CONTENT);
}

/**
 * True when every non-empty chapter body of `book` is ciphertext.
 *
 * Only the browser can turn those back into text, and it does so before pushing
 * (see `syncLibrary` in client/src/90-app.js). A book in that state inside the
 * mirror is therefore unreadable to every peer, which is exactly what the merge
 * rule below uses to let a readable copy replace it.
 */
function bookSealed(book) {
  if (!book || book.deleted === true) return false;
  const chapters = (book.chapters || []).filter((chapter) => str(chapter.content).trim() !== '');
  if (!chapters.length) return false;
  return chapters.every((chapter) => sealedContent(chapter.content));
}

function statePath() {
  return path.join(dataRoot(), STATE_FILE);
}

/**
 * Read the desktop's sync mirror.
 *
 * R36: the file is stored as an `NWENC1` container (lib/library.js) because it
 * holds the same chapter text the browser keeps encrypted in IndexedDB — writing
 * it as plain JSON would quietly undo 正文加密 for every user of phone sync. The
 * same host key that encrypts the folder mirror is used, so there is one secret
 * to lose instead of two.
 *
 * Backwards compatible: a file from before R36 is plain JSON and is still
 * parsed. Anything unreadable (missing key after a secrets reset, a corrupt
 * container) degrades to an empty library rather than throwing — the browser's
 * next push refills it from IndexedDB, which is the authoritative copy.
 */
export async function readSyncState() {
  const text = await readTextFile(statePath(), '');
  if (!text.trim()) return normalizeLibrary({ books: [] });
  if (!text.startsWith(MIRROR_MAGIC)) return normalizeLibrary(readJson(text) || { books: [] });
  const key = await deriveMirrorKey();
  if (!Buffer.isBuffer(key)) return normalizeLibrary({ books: [] });
  try {
    return normalizeLibrary(readJson(decryptMirrorText(text, key)) || { books: [] });
  } catch {
    return normalizeLibrary({ books: [] });
  }
}

/**
 * Persist the sync mirror.
 *
 * Encrypted when a key is available. Without one (secrets store unreadable) the
 * mirror is written as plain JSON instead of failing the push: losing sync for
 * every peer is worse than a plaintext cache on the same disk the books already
 * sit on.
 */
export async function writeSyncState(library) {
  const normalized = normalizeLibrary(library);
  const target = statePath();
  let key = null;
  try {
    key = await deriveMirrorKey();
  } catch {
    key = null;
  }
  if (Buffer.isBuffer(key)) {
    await writeTextAtomic(target, encryptMirrorText(`${JSON.stringify(normalized, null, 2)}\n`, key));
  } else {
    await writeJsonAtomic(target, normalized);
  }
  return normalized;
}

/**
 * Serialise the read → merge → write cycles on the mirror.
 *
 * Three independent writers touch the same file: the browser pushing on every
 * library change, the phone pushing through the LAN listener, and sync.apply.
 * Each one is read → merge → write, and writeTextAtomic only guarantees the
 * *file* is swapped atomically — it cannot stop two merges from starting on the
 * same snapshot. When that happens the later write silently discards every book
 * the earlier one merged in, which is how a phone pushing while the browser
 * pushes loses an entire book.
 *
 * Chaining is the whole fix: the second task reads what the first one wrote.
 * A pull goes through the same queue, so it can never observe the half-finished
 * state of a push that is still in flight.
 */
let stateChain = Promise.resolve();

function withStateLock(task) {
  const run = stateChain.then(task, task);
  // Absorb rejections: one failed push must not poison every later merge.
  stateChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** sync.push — the browser hands over its current library. */
export function pushLibrary(raw) {
  // Normalise outside the lock: it is pure, and doing it here keeps the queued
  // task small.
  const incoming = normalizeLibrary(raw);
  return withStateLock(async () => {
    const current = await readSyncState();
    const merged = mergeLibraries(current, incoming);
    await writeSyncState(merged.library);
    return { library: merged.library, stats: merged.stats, books: merged.library.books.length };
  });
}

/** sync.pull — what the browser should apply to IndexedDB. */
export function pullLibrary() {
  return withStateLock(async () => {
    const library = await readSyncState();
    return { library, books: library.books.length, updatedAt: nowMs() };
  });
}

/** sync.apply {books} — a peer's library arrives; merge it in. */
export function applyRemote(raw) {
  return withStateLock(async () => {
    const current = await readSyncState();
    const merged = mergeLibraries(current, raw);
    await writeSyncState(merged.library);
    return { library: merged.library, stats: merged.stats, books: merged.library.books.length };
  });
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

let announcer = null;

/**
 * Broadcast "I am here" so the phone can find the desktop without a typed IP.
 *
 * Runs only while a socket exists: `startDiscovery` is idempotent, and the
 * plugin's dispose path calls `stopDiscovery`. A failure to bind (port in use by
 * a second copy of the plugin) is reported, never thrown — discovery is a
 * convenience, not a requirement, since pairing carries a literal address.
 */
export function startDiscovery(options = {}) {
  if (announcer) return { ok: true, already: true };
  const port = Number(options.port) || DISCOVERY_PORT;
  const announcePort = Number(options.announcePort) || 0;
  let socket;
  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch (error) {
    return { ok: false, code: 'discovery-failed', message: str(error && error.message) };
  }
  const targets = broadcastTargets();
  const send = async () => {
    const identity = await deviceIdentity().catch(() => null);
    if (!identity) return;
    const message = Buffer.from(
      JSON.stringify({
        protocol: PROTOCOL,
        role: 'host',
        id: str(identity.id),
        name: str(identity.name),
        port: announcePort,
        addresses: lanAddresses().map((entry) => entry.address),
        at: nowMs(),
      }),
    );
    for (const target of targets) {
      try {
        await new Promise((resolve) => socket.send(message, port, target, () => resolve()));
      } catch {
        /* one bad interface must not stop the others */
      }
    }
  };
  socket.on('error', () => {
    /* keep the plugin quiet; discovery is optional */
  });
  announcer = {
    socket,
    timer: setInterval(send, Number(options.intervalMs) || 30_000),
    send,
  };
  // Send once now so a phone already listening pairs without waiting 30s.
  send().catch(() => {});
  return { ok: true, targets, port };
}

export function stopDiscovery() {
  if (!announcer) return;
  try {
    clearInterval(announcer.timer);
    announcer.socket.close();
  } catch {
    /* ignore */
  }
  announcer = null;
}

export function discoveryStatus() {
  return {
    running: Boolean(announcer),
    port: DISCOVERY_PORT,
    addresses: lanAddresses().map((entry) => entry.address),
    primary: primaryAddress(),
  };
}
