#!/usr/bin/env node
// Inline the window clips into the client bundle as data URIs.
//
// Why inlined: the host route (`GET novel-writer/api/scene.video`) only exists in
// a process that loaded the current lib/routes.js, i.e. after a restart. A page
// refresh is the one thing the writer can always do, so the bundle carries the
// two clips and the client prefers the route, falling back to these bytes the
// moment the route is missing. Regenerate after re-encoding assets/*.mp4:
//   node scripts/build-scene-media.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'client', 'src', '46-scene-media.js');
const FILES = [
  // The big tree is the window now; the droplet sheet that used to sit on top
  // of it is gone (the rain is drawn in the air instead), so only one clip has
  // to ride inside the bundle. Keep this one small — it is paid on every load.
  ['forest', join(root, 'assets', 'rain-forest.mp4')],
];

const rows = FILES.map(([key, file]) => {
  const bytes = readFileSync(file);
  if (bytes.length < 1000) throw new Error(`${key}: ${file} looks empty`);
  return `    ${key}:\n      'data:video/mp4;base64,${bytes.toString('base64')}',`;
});

const body = `;(() => {
  'use strict';

  // ============================================================================
  // 精神空间 · 窗外的两段影像 (NW.SCENE_MEDIA)
  //
  // R166. 雨、树、风是拍出来的，不是画出来的：上一版用 canvas 编了一棵树，
  // 作者的原话是「树呢，风呢，要真实」。这里把两段真实素材内联进 bundle——
  // 宿主的 scene.video 路由要重启进程才注册，而刷新页面就能拿到新 bundle，
  // 所以先保证「刷新一下就能看见真的」。路由可用时客户端仍优先走路由。
  //
  // 生成：node scripts/build-scene-media.mjs（源：assets/*.mp4，不要手改本文件）
  // ============================================================================

  NW.SCENE_MEDIA = {
${rows.join('\n')}
  };
})();
`;

writeFileSync(out, body, 'utf8');
const size = statSync(out).size;
console.log(`build-scene-media: wrote ${out} (${(size / 1048576).toFixed(2)} MB)`);
