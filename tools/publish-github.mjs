// Publish 精神空间 to GitHub using ONLY api.github.com.
//
// Why: this machine reaches api.github.com reliably but github.com only
// intermittently. `git push` and the OAuth device flow both need github.com and
// fail at random; the REST API can create blobs / a tree / a commit / a ref
// directly, which is the same result as a push and never touches github.com.
//
// R77: the commit is now built from the **local HEAD** — same message, author,
// committer and dates — so the sha the API creates is the same sha git already
// has. That keeps the two histories converging: the next `git push` is still a
// fast-forward instead of a force-push, and the log stops saying "v1.2.0".
//
// Input:
//   .tools\gh-token.txt  (created by setup-github.cmd)
//   or NW_TOKEN_FILE=<path>, or the GITHUB_TOKEN environment variable.
// Output: prints the repository URL.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = process.env.NW_REPO || 'novel-writer';
const BRANCH = process.env.NW_BRANCH || 'main';
const DESC = '精神空间 — DeepSeek Harness 的沉浸式小说写作插件';

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const candidates = [
    process.env.NW_TOKEN_FILE,
    path.join(ROOT, '.tools', 'gh-token.txt'),
    path.join(process.env.TEMP || '', 'nw-cdp', 'gh-token.txt'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      /* try the next location */
    }
  }
  return '';
}

const token = readToken();
if (!token) {
  console.error('没有找到 GitHub token：请重跑 setup-github.cmd，或设置 GITHUB_TOKEN。');
  await halt();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop the script without crashing.
 *
 * process.exit() aborts while fetch's socket is still closing, which shows up
 * as "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" plus a 0xC0000409
 * exit code in the .cmd window. Every failure site already printed its reason,
 * so we only set the code and wait on a promise that never resolves: Node then
 * finishes the event loop on its own and exits with that code.
 */
function halt() {
  process.exitCode = 1;
  return new Promise(() => {});
}

/** One API call with plenty of retries — the link here is flaky but not dead. */
async function api(method, url, body, tries = 8) {
  let last = null;
  for (let i = 1; i <= tries; i += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'mindspace-publish',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
      return { status: res.status, json };
    } catch (err) {
      clearTimeout(timer);
      last = err;
      if (i < tries) await sleep(Math.min(600 * i, 5000));
    }
  }
  throw new Error(`api ${method} ${url} 无法连接：${last && last.message}`);
}

const me = await api('GET', 'https://api.github.com/user');
if (me.status !== 200) {
  console.error('token 无效或权限不足：', me.status, JSON.stringify(me.json).slice(0, 300));
  await halt();
}
const user = me.json.login;
console.log(`已认证：${user}`);

let full = `${user}/${REPO}`;
const probe = await api('GET', `https://api.github.com/repos/${full}`);
if (probe.status === 404) {
  const created = await api('POST', 'https://api.github.com/user/repos', {
    name: REPO,
    description: DESC,
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  });
  if (created.status !== 201) {
    console.error('创建仓库失败：', created.status, JSON.stringify(created.json).slice(0, 400));
    await halt();
  }
  console.log(`已创建 https://github.com/${full}`);
} else if (probe.status === 200) {
  full = probe.json.full_name;
  console.log(`仓库已存在：https://github.com/${full}`);
} else {
  console.error('查询仓库失败：', probe.status, JSON.stringify(probe.json).slice(0, 300));
  await halt();
}

// Upload only what git tracks — and upload it **from the git object store**, not
// from the working tree.
//
// R77b: reading files off disk uploaded the checked-out bytes (with CRLF, on this
// machine) instead of the blobs git actually stores, so the tree sha differed and
// the API commit could never match local HEAD. `ls-tree -r HEAD` hands us the
// blob shas that are already canonical; the content-addressed API returns the
// same sha back, and the rebuilt tree is byte-identical to the local one.
const GIT = path.join(ROOT, '.tools', 'git', 'cmd', 'git.exe');
const gitEnv = {
  ...process.env,
  PATH: path.join(ROOT, '.tools', 'git', 'cmd') + ';' + path.join(ROOT, '.tools', 'bin') + ';' + process.env.PATH,
};
const lsTree = execFileSync(GIT, ['ls-tree', '-r', '-z', 'HEAD'], {
  cwd: ROOT,
  env: gitEnv,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\u0000')
  .filter(Boolean);
console.log(`共 ${lsTree.length} 个文件`);

const localTree = execFileSync(GIT, ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, env: gitEnv, encoding: 'utf8' }).trim();
// The tree is content-addressed: if GitHub already has it, the whole upload can
// be skipped. That turns a re-publish from "100 API calls" into three.
let treeSha = localTree;
const existingTree = await api('GET', `https://api.github.com/repos/${full}/git/trees/${localTree}`);
if (existingTree.status === 200) {
  console.log('远端已有这棵树，跳过上传：' + localTree.slice(0, 7));
} else {
  const entries = [];
  for (const line of lsTree) {
    // "<mode> SP <type> SP <sha> TAB <path>"
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(' ');
    const rel = line.slice(tab + 1);
    const mode = meta[0] === '100755' ? '100755' : '100644';
    const blobSha = meta[2];
    const data = execFileSync(GIT, ['cat-file', 'blob', blobSha], {
      cwd: ROOT,
      env: gitEnv,
      maxBuffer: 64 * 1024 * 1024,
    });
    const blob = await api('POST', `https://api.github.com/repos/${full}/git/blobs`, {
      content: data.toString('base64'),
      encoding: 'base64',
    });
    if (blob.status !== 201) {
      console.error(`上传失败 ${rel}：`, blob.status, JSON.stringify(blob.json).slice(0, 200));
      await halt();
    }
    entries.push({ path: rel, mode, type: 'blob', sha: blob.json.sha });
    console.log(`  ${rel} (${data.length}B)`);
  }
  const tree = await api('POST', `https://api.github.com/repos/${full}/git/trees`, { tree: entries });
  if (tree.status !== 201) {
    console.error('创建目录树失败：', tree.status, JSON.stringify(tree.json).slice(0, 300));
    await halt();
  }
  treeSha = tree.json.sha;
}
if (treeSha !== localTree) {
  console.warn('注意：重建的目录树与本地不同（' + String(treeSha).slice(0, 7) + ' vs ' + localTree.slice(0, 7) + '）');
}

// Keep history when the branch already exists. `git/commits` takes an array of
// SHAs (not objects) — the trees endpoint is the one that wants objects.
// R77b: walk back from the local HEAD's parent and use the first commit GitHub
// already has. That is what makes the rebuilt commit hash equal to local HEAD
// (tree + parent + author + committer + message are all the local ones).
let parents = [];
const ref = await api('GET', `https://api.github.com/repos/${full}/git/ref/heads/${BRANCH}`);
try {
  let cursor = execFileSync(GIT, ['rev-parse', 'HEAD^'], { cwd: ROOT, env: gitEnv, encoding: 'utf8' }).trim();
  for (let i = 0; i < 50 && cursor; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const known = await api('GET', `https://api.github.com/repos/${full}/git/commits/${cursor}`);
    if (known.status === 200) break;
    try {
      cursor = execFileSync(GIT, ['rev-parse', cursor + '^'], { cwd: ROOT, env: gitEnv, encoding: 'utf8' }).trim();
    } catch (error) {
      cursor = '';
    }
  }
  if (cursor) parents = [cursor];
} catch (error) {
  /* a root commit has no parent */
}
if (parents.length === 0 && ref.status === 200) parents = [ref.json.object.sha];

/**
 * Local HEAD, in the shape the API needs.
 *
 * The point is the sha: a commit is a pure function of tree + parents + author +
 * committer + message. Sending the local values back makes the API produce the
 * very commit git already has, so `git push` stays a fast-forward afterwards.
 */
function git(args) {
  return execFileSync(GIT, args, { cwd: ROOT, env: gitEnv, encoding: 'utf8' });
}

function localHead() {
  let raw = '';
  try {
    raw = git(['cat-file', '-p', 'HEAD']);
  } catch (error) {
    return null;
  }
  const lines = raw.split('\n');
  const field = (prefix) => {
    const line = lines.find((item) => item.startsWith(prefix + ' '));
    return line ? line.slice(prefix.length + 1) : '';
  };
  const person = (value) => {
    const m = /^(.*?) <(.*?)> (\d+) ([+-])(\d{2})(\d{2})$/.exec(String(value).trim());
    if (!m) return null;
    const ts = Number(m[3]);
    const sign = m[4] === '-' ? -1 : 1;
    const offsetMin = sign * (Number(m[5]) * 60 + Number(m[6]));
    const local = new Date((ts + offsetMin * 60) * 1000).toISOString().slice(0, 19);
    return { name: m[1], email: m[2], date: local + m[4] + m[5] + ':' + m[6] };
  };
  const split = raw.indexOf('\n\n');
  return {
    sha: git(['rev-parse', 'HEAD']).trim(),
    author: person(field('author')),
    committer: person(field('committer')),
    message: split >= 0 ? raw.slice(split + 2) : '',
  };
}

const head = localHead();
const commitBody = {
  message: (head && head.message) || '精神空间 — 更新',
  tree: treeSha,
  parents,
};
if (head && head.author) commitBody.author = head.author;
if (head && head.committer) commitBody.committer = head.committer;
const commit = await api('POST', `https://api.github.com/repos/${full}/git/commits`, commitBody);
if (commit.status !== 201) {
  console.error('创建提交失败：', commit.status, JSON.stringify(commit.json).slice(0, 300));
  await halt();
}
if (head && head.sha && commit.json.sha !== head.sha) {
  console.warn('注意：远端提交与本地 HEAD 不同（' + String(commit.json.sha).slice(0, 7) + ' vs ' + head.sha.slice(0, 7) + '），下次 git push 需要 force 或先 fetch。');
} else if (head && head.sha) {
  console.log('远端提交与本地 HEAD 一致：' + head.sha.slice(0, 7));
}

if (parents.length === 0) {
  const made = await api('POST', `https://api.github.com/repos/${full}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: commit.json.sha,
  });
  if (made.status !== 201) {
    console.error('创建分支失败：', made.status, JSON.stringify(made.json).slice(0, 300));
    await halt();
  }
} else {
  const moved = await api('PATCH', `https://api.github.com/repos/${full}/git/refs/heads/${BRANCH}`, {
    sha: commit.json.sha,
    force: true,
  });
  if (moved.status !== 200) {
    console.error('更新分支失败：', moved.status, JSON.stringify(moved.json).slice(0, 300));
    await halt();
  }
}

await api('PATCH', `https://api.github.com/repos/${full}`, { default_branch: BRANCH });
console.log(`完成：https://github.com/${full}`);
