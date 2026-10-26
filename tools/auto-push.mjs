// Upload the current branch to GitHub, automatically, after every commit.
//
// Why a script instead of a plain "git push" in the hook:
//   * github.com is slow and occasionally dead from this machine, so the push
//     is retried with backoff and never blocks or fails a local commit;
//   * the token lives in .tools/gh-token.txt (gitignored) and is handed to git
//     through a one-shot http.extraheader, so it never lands in .git/config,
//     in the remote URL, or in the shell history;
//   * every attempt is logged to .tools/push.log and a failed one leaves
//     .tools/push-pending behind, so the next run (or "node tools/auto-push.mjs")
//     retries it.
//
// Usage:
//   node tools/auto-push.mjs            push now, in the foreground
//   node tools/auto-push.mjs --hook     used by .githooks/post-commit: detach
//   node tools/auto-push.mjs --status   show config, last push and pending state
//   node tools/auto-push.mjs --install  point core.hooksPath at .githooks
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOLS = path.join(ROOT, '.tools');
const CONFIG = path.join(TOOLS, 'github.json');
const TOKEN_FILE = path.join(TOOLS, 'gh-token.txt');
const LOG = path.join(TOOLS, 'push.log');
const PENDING = path.join(TOOLS, 'push-pending');
const STAMP = path.join(TOOLS, 'last-push');
const IP_CACHE = path.join(TOOLS, 'github-ip');

const args = new Set(process.argv.slice(2));
const GIT = process.env.NW_GIT || 'git';

function log(line) {
  try {
    fs.mkdirSync(TOOLS, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) {
      fs.writeFileSync(LOG, '');
    }
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(LOG, '[' + stamp + '] ' + line + '\n');
  } catch {
    /* logging must never break a commit */
  }
}

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  for (const file of [process.env.NW_TOKEN_FILE, TOKEN_FILE].filter(Boolean)) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      /* try the next location */
    }
  }
  return '';
}

function readConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (data && data.owner && data.repo) {
      return {
        owner: String(data.owner),
        repo: String(data.repo),
        branch: String(data.branch || 'main'),
      };
    }
  } catch {
    /* not configured yet */
  }
  return null;
}

function git(argv, options = {}) {
  return spawnSync(GIT, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeout || 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(options.env || {}) },
  });
}

/** One push attempt. Returns { ok, detail }. */
function attempt(token, branch, ip) {
  const auth = Buffer.from('x-access-token:' + token).toString('base64');
  const argv = [
    '-c', 'http.extraheader=Authorization: Basic ' + auth,
    '-c', 'credential.helper=',
  ];
  // Pinning the IP with --resolve skips a DNS answer that may point at an edge
  // this machine cannot reach (observed: 20.205.243.166 times out here while
  // 140.82.112.3 answers instantly), without touching the system hosts file.
  if (ip) argv.push('-c', 'http.curloptResolve=github.com:443:' + ip);
  argv.push('push', '--quiet', 'origin', 'HEAD:refs/heads/' + branch);
  const out = git(argv, { timeout: 180000 });
  if (out.status === 0) return { ok: true, detail: 'ok' };
  const detail = ((out.stderr || '') + (out.stdout || '')).trim().split('\n').slice(-4).join(' | ');
  return { ok: false, detail: detail || 'exit ' + out.status };
}

/**
 * Candidate IPv4 addresses for github.com, best first.
 *
 * The ISP's resolver here answers with an Azure edge (20.205.243.166) that
 * silently drops :443, so a plain `git push` can hang for 21s per try and then
 * fail while the very same account works fine through the US edges. Probing a
 * few known-good addresses with a short TCP connect keeps the retry loop honest:
 * we only pin an IP that actually accepted a socket.
 */
const FALLBACK_IPS = ['140.82.112.3', '140.82.113.3', '140.82.114.3', '20.27.177.113'];

function probeIPv4(ip, timeout = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    const socket = net.connect({ host: ip, port: 443 });
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function usableIPs() {
  const list = [];
  const push = (ip) => {
    if (typeof ip === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && !list.includes(ip)) list.push(ip);
  };
  try {
    const cached = fs.readFileSync(IP_CACHE, 'utf8').trim();
    push(cached);
  } catch { /* no cache yet */ }
  try {
    const resolved = await dns.promises.resolve4('github.com');
    for (const ip of resolved) push(ip);
  } catch { /* resolver down — the fallback list still applies */ }
  for (const ip of FALLBACK_IPS) push(ip);
  const alive = [];
  for (const ip of list) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeIPv4(ip)) alive.push(ip);
  }
  return alive;
}

async function pushNow() {
  const config = readConfig();
  if (!config) {
    log('skip: .tools/github.json 不存在（还没有配置仓库）');
    return 0;
  }
  const token = readToken();
  if (!token) {
    log('skip: 没有 token（.tools/gh-token.txt）');
    return 0;
  }

  // Keep origin pointing at the repository without embedding the token.
  const url = 'https://github.com/' + config.owner + '/' + config.repo + '.git';
  const remotes = git(['remote']);
  const hasOrigin = remotes.status === 0 && String(remotes.stdout).split('\n').includes('origin');
  if (!hasOrigin) {
    const added = git(['remote', 'add', 'origin', url]);
    if (added.status !== 0) {
      log('fail: git remote add: ' + String(added.stderr).trim());
      return 1;
    }
    log('origin -> ' + url);
  }

  const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = String(head.stdout || '').trim() || config.branch;
  if (branch === 'HEAD') {
    log('skip: detached HEAD');
    return 0;
  }

  const ips = await usableIPs();
  if (ips.length === 0) log('warn: 没有一个 github.com 地址能连上，将按域名直连重试');
  const waits = [0, 5000, 15000, 45000];
  let last = null;
  for (let i = 0; i < waits.length; i += 1) {
    if (waits[i]) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, ' + waits[i] + ')']);
    // First try the plain domain (normal path, and the only one that follows a
    // future DNS change); then rotate through the edges that accepted a socket,
    // so a blackholed or hijacked answer still recovers within the retry budget.
    const ip = i === 0 || ips.length === 0 ? null : ips[(i - 1) % ips.length];
    last = attempt(token, branch, ip);
    if (last.ok) {
      try { fs.writeFileSync(STAMP, new Date().toISOString() + '\n'); } catch { /* ignore */ }
      try { if (ip) fs.writeFileSync(IP_CACHE, ip + '\n'); } catch { /* ignore */ }
      try { fs.unlinkSync(PENDING); } catch { /* nothing pending */ }
      log('ok: ' + config.owner + '/' + config.repo + ' ' + branch + (ip ? ' via ' + ip : ''));
      return 0;
    }
    log('retry ' + (i + 1) + '/4: ' + last.detail);
  }

  try {
    fs.writeFileSync(PENDING, new Date().toISOString() + '\n' + last.detail + '\n');
  } catch { /* ignore */ }
  log('fail: 4 次都没推上去，已记下待重试');
  return 1;
}

const mode = ['--hook', '--status', '--install'].find((flag) => args.has(flag));

if (mode === '--status') {
  const config = readConfig();
  const stamp = (() => {
    try { return fs.readFileSync(STAMP, 'utf8').trim(); } catch { return '(never)'; }
  })();
  const pending = (() => {
    try { return fs.readFileSync(PENDING, 'utf8').trim().split('\n')[0]; } catch { return '(none)'; }
  })();
  console.log('repo:     ' + (config ? config.owner + '/' + config.repo + ' (' + config.branch + ')' : '(not configured)'));
  console.log('token:    ' + (readToken() ? 'present' : 'missing'));
  console.log('last ok:  ' + stamp);
  console.log('pending:  ' + pending);
  console.log('log:      ' + LOG);
  process.exit(0);
}

if (mode === '--install') {
  const set = git(['config', 'core.hooksPath', '.githooks']);
  if (set.status !== 0) {
    console.error('无法设置 core.hooksPath：' + String(set.stderr).trim());
    process.exit(1);
  }
  console.log('已启用 .githooks（core.hooksPath=.githooks）：每次提交后自动上传。');
  process.exit(0);
}

if (mode === '--hook') {
  // Detach so "git commit" returns at once; the child logs to .tools/push.log.
  const child = spawn(process.execPath, [path.join(HERE, 'auto-push.mjs')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.exit(0);
}

process.exit(await pushNow());
