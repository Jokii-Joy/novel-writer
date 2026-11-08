#!/usr/bin/env node
// Restore-planning check for the client half.
//
// Why this script exists: `NW.db.replaceAll` is the one function where a wrong
// decision destroys data a writer cannot get back. Before R79 it cleared all
// nine object stores and then refilled whatever the snapshot happened to carry,
// so "restore from the folder" silently took annotations, version history,
// 设定集, accepted suggestions and the trash with it — the folder snapshot never
// carried those keys in the first place.
//
// `planRestore` is the pure decision table behind the fix, exported through
// `NW.db.planRestore`. Evaluating `10-db.js` needs no IndexedDB (every access is
// inside a function), so this runs in plain Node.
//
// Usage: node scripts/verify-restore.mjs      (exits 1 on any regression)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '..', 'client', 'src', '10-db.js');
const code = readFileSync(file, 'utf8');

/** The module only touches NW.crypto / NW.format inside functions. */
const NW = {
  crypto: {
    isUnlocked: () => false,
    encryptionOn: async () => false,
    isEncrypted: () => false,
  },
  format: { wordCount: (text) => String(text == null ? '' : text).length },
};

try {
  // eslint-disable-next-line no-new-func
  new Function('NW', 'window', 'indexedDB', code)(NW, undefined, undefined);
} catch (error) {
  console.error('verify-restore: could not evaluate client/src/10-db.js');
  console.error(`  ${error && error.message}`);
  process.exit(1);
}

if (!NW.db || typeof NW.db.planRestore !== 'function') {
  console.error('verify-restore: NW.db.planRestore is not exposed');
  process.exit(1);
}
if (!Array.isArray(NW.db.STORES) || NW.db.STORES.length !== 9) {
  console.error(`verify-restore: NW.db.STORES should list nine stores (got ${JSON.stringify(NW.db.STORES)})`);
  process.exit(1);
}

const STORES = NW.db.STORES;
const SETTINGS_KEY = 'app';
let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

function plan(snapshot) {
  return NW.db.planRestore(snapshot, STORES, SETTINGS_KEY);
}
function entry(snapshot, store) {
  return plan(snapshot).find((row) => row.store === store) || {};
}

console.log('verify-restore: planRestore 决策表');

// 1. A folder snapshot written by R79: five keys, none of versions/trash.
const folder = {
  novels: [{ id: 'n1' }],
  chapters: [{ id: 'c1' }],
  settings: { theme: 'claude' },
  notes: [{ id: 'note1' }],
  marks: [{ id: 'm1' }],
  lore: [{ id: 'l1' }],
  revisions: [{ id: 'r1' }],
};
check('小说 / 章节 / 设置 / 便签 / 标注 / 设定 / 已接收都被承载',
  ['novels', 'chapters', 'settings', 'notes', 'marks', 'lore', 'revisions']
    .every((store) => entry(folder, store).carried === true));
check('版本历史不被承载（保留，不清空）', entry(folder, 'versions').carried === false);
check('回收站不被承载（保留，不清空）', entry(folder, 'trash').carried === false);

// 2. An older folder snapshot: no marks/lore/revisions → preserved, not wiped.
const oldFolder = { novels: [{ id: 'n1' }], chapters: [], settings: {}, notes: [] };
check('旧快照缺标注 → 保留', entry(oldFolder, 'marks').carried === false);
check('旧快照缺设定集 → 保留', entry(oldFolder, 'lore').carried === false);
check('旧快照缺已接收 → 保留', entry(oldFolder, 'revisions').carried === false);

// 3. A full JSON backup (db.dump) carries all nine keys → whole-database replace.
const full = {
  novels: [{ id: 'n1' }],
  chapters: [{ id: 'c1' }],
  versions: [{ id: 'v1' }],
  trash: [{ id: 't1' }],
  settings: { theme: 'night' },
  notes: [{ id: 'note1' }],
  marks: [{ id: 'm1' }],
  revisions: [{ id: 'r1' }],
  lore: [{ id: 'l1' }],
};
check('完整备份九个 store 全部承载', STORES.every((store) => entry(full, store).carried === true));
check('完整备份仍能清空版本/回收站（恢复语义不变）',
  entry(full, 'versions').carried === true && entry(full, 'trash').carried === true);

// 4. An explicit empty array means "make it empty" and must still clear.
const emptied = Object.assign({}, full, { marks: [], versions: [] });
check('显式空数组会清空（不是保留）', entry(emptied, 'marks').carried === true && entry(emptied, 'marks').rows.length === 0);
check('显式空数组对版本同样成立', entry(emptied, 'versions').carried === true && entry(emptied, 'versions').rows.length === 0);

// 5. settings accepts both an object (the dump shape) and a row array.
const settingsObject = entry(folder, 'settings');
check('settings 对象被包成单行设置', settingsObject.carried === true
  && settingsObject.rows.length === 1
  && settingsObject.rows[0].key === SETTINGS_KEY
  && settingsObject.rows[0].value === folder.settings);
const settingsRows = entry({ settings: [{ key: 'app', value: { a: 1 } }] }, 'settings');
check('settings 数组原样通过', settingsRows.carried === true && settingsRows.rows.length === 1);

// 6. Malformed values are treated like missing ones — preserve, never wipe.
check('marks: null 不触发清空', entry({ marks: null }, 'marks').carried === false);
check('versions: "x" 不触发清空', entry({ versions: 'x' }, 'versions').carried === false);
check('settings: null 不触发清空', entry({ settings: null }, 'settings').carried === false);

// 7. Nothing to restore at all → nothing is cleared (replaceAll becomes a no-op).
check('空快照不产生任何写入计划',
  plan(null).every((row) => row.carried === false)
  && plan({}).every((row) => row.carried === false));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
