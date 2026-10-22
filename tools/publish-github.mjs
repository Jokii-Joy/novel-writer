// Publish 精神空间 to GitHub using ONLY api.github.com.
//
// Why: this machine reaches api.github.com reliably but github.com only
// intermittently. `git push` and the OAuth device flow both need github.com and
// fail at random; the REST API can create blobs / a tree / a commit / a ref
// directly, which is the same result as a push and never touches github.com.
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
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  process.exit(1);
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
    process.exit(1);
  }
  console.log(`已创建 https://github.com/${full}`);
} else if (probe.status === 200) {
  full = probe.json.full_name;
  console.log(`仓库已存在：https://github.com/${full}`);
} else {
  console.error('查询仓库失败：', probe.status, JSON.stringify(probe.json).slice(0, 300));
  process.exit(1);
}

// Upload only what git tracks: .tools/ and other ignored paths stay local.
const GIT = path.join(ROOT, '.tools', 'git', 'cmd', 'git.exe');
const gitEnv = {
  ...process.env,
  PATH: path.join(ROOT, '.tools', 'git', 'cmd') + ';' + path.join(ROOT, '.tools', 'bin') + ';' + process.env.PATH,
};
const files = execFileSync(GIT, ['ls-files', '-z'], { cwd: ROOT, env: gitEnv, encoding: 'utf8' })
  .split('\u0000')
  .filter(Boolean);
console.log(`共 ${files.length} 个文件`);

const entries = [];
for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const blob = await api('POST', `https://api.github.com/repos/${full}/git/blobs`, {
    content: data.toString('base64'),
    encoding: 'base64',
  });
  if (blob.status !== 201) {
    console.error(`上传失败 ${rel}：`, blob.status, JSON.stringify(blob.json).slice(0, 200));
    process.exit(1);
  }
  entries.push({ path: rel.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.json.sha });
  console.log(`  ${rel} (${data.length}B)`);
}

const tree = await api('POST', `https://api.github.com/repos/${full}/git/trees`, { tree: entries });
if (tree.status !== 201) {
  console.error('创建目录树失败：', tree.status, JSON.stringify(tree.json).slice(0, 300));
  process.exit(1);
}

// Keep history when the branch already exists.
let parents = [];
const ref = await api('GET', `https://api.github.com/repos/${full}/git/ref/heads/${BRANCH}`);
if (ref.status === 200) parents = [{ sha: ref.json.object.sha }];

const commit = await api('POST', `https://api.github.com/repos/${full}/git/commits`, {
  message: '精神空间 v1.2.0 — DeepSeek Harness 沉浸式小说写作插件',
  tree: tree.json.sha,
  parents,
});
if (commit.status !== 201) {
  console.error('创建提交失败：', commit.status, JSON.stringify(commit.json).slice(0, 300));
  process.exit(1);
}

if (parents.length === 0) {
  const made = await api('POST', `https://api.github.com/repos/${full}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: commit.json.sha,
  });
  if (made.status !== 201) {
    console.error('创建分支失败：', made.status, JSON.stringify(made.json).slice(0, 300));
    process.exit(1);
  }
} else {
  const moved = await api('PATCH', `https://api.github.com/repos/${full}/git/refs/heads/${BRANCH}`, {
    sha: commit.json.sha,
    force: true,
  });
  if (moved.status !== 200) {
    console.error('更新分支失败：', moved.status, JSON.stringify(moved.json).slice(0, 300));
    process.exit(1);
  }
}

await api('PATCH', `https://api.github.com/repos/${full}`, { default_branch: BRANCH });
console.log(`完成：https://github.com/${full}`);
