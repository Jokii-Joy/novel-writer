// Diagnostic probe for the dock: does the shipped bundle actually contain the
// wiring we think it does?
//
// Why: R58 was reported as "点击也没反应" after a fix that the static CSS audit
// passed. A passing CSS audit says nothing about whether the click handler is
// reachable, so this probe reads the BUILT bundle (client/client.js) rather than
// the sources — the bundle is what the harness loads.
//
// Usage: node scripts/probe-dock.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, '..', 'client', 'client.js'), 'utf8');
// R59: CSS comments routinely mention selectors by name ("there is no pixel of
// .nw-dock left between them"), and a selector regex will happily treat that
// prose as a rule — which is how "nothing in the dock paints over the rows"
// started failing on a sentence about the fix instead of on a declaration.
// Stripping every /* */ pair globally is NOT the answer: JS strings such as a
// `/*` inside a path pair up with an unrelated `*/` further down and the strip
// deletes real code (it ate the whole dialog registry when tried). So each
// candidate match is checked instead — prose in this bundle always straddles a
// comment terminator, real rules never do.
const isProse = (text) => /\*\//.test(text);

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail });

// 1. The dock component exists and renders five rows.
ok('Dock component present', /function Dock\(props\)/.test(bundle));
ok(
  'five rows rendered',
  (bundle.match(/className: 'nw-dock-btn'/g) || []).length >= 1 &&
    ['proofread', 'typeset', 'sparkle', 'book', 'send'].every((k) =>
      new RegExp(`item\\('${k}'`).test(bundle),
    ),
  'each action goes through item()',
);

// 2. The click path: onClick present, onBlocked present, no `disabled`.
ok('onClick wired on rows', /onClick: \(\) => \{[\s\S]{0,200}?typeof onClick === 'function'/.test(bundle));
ok('onBlocked wired', /onBlocked: \(name\) => \{/.test(bundle));
ok(
  'rows are NOT disabled (R58)',
  !/className: 'nw-dock-btn',\s*\n\s*'?disabled'?:/.test(bundle) &&
    !/disabled: needsChapter/.test(bundle),
  'a disabled row fires nothing — that was the R58 root cause',
);

// 3. The toast channel must actually exist, or onBlocked speaks into the void.
ok('pushToast defined', /const pushToast = useCallback/.test(bundle));
ok('toast host rendered', /className: 'nw-toast-wrap'/.test(bundle));

// 4. openDialog must reach a registered dialog for every kind the dock opens.
for (const kind of ['proofread', 'typeset', 'submit']) {
  const registered = new RegExp(`NW\\.dialogs\\.${kind[0].toUpperCase()}${kind.slice(1)} =`).test(bundle);
  ok(`openDialog('${kind}') has a registered dialog`, registered);
}

// 5. R59: the rail must NOT be composited, and must not swallow its own clicks.
//    R58 painted it with a backdrop blur and this probe asserted that blur was
//    present. R59 removed it on purpose: a composited layer was one more thing
//    between the pointer and buttons that had already failed five times, and at
//    40% opacity the blur read as fog, not glass. So the assertion is inverted —
//    flat translucent tokens only.
// R59: every non-prose `.nw-dock` rule body, not just the last one. Taking only
// the last match silently reads a tiny media-query override (`opacity:.85` inside
// `@media (hover:none)`) and reports on that instead of the real rule — which is
// how a mutated `padding:5px` slipped past this probe on the first try.
const dockRules = (() => {
  const re = /\.nw-dock\{([\s\S]{0,700}?)\}(?=\s*(?:\.|@|$|\/\*))/g;
  const out = [];
  let m;
  while ((m = re.exec(bundle))) if (!isProse(m[1])) out.push(m[1]);
  return out;
})();
const anyDockRule = (re) => dockRules.some((body) => re.test(body));
ok(
  'dock is flat (no backdrop-filter)',
  dockRules.length > 0 && !anyDockRule(/backdrop-filter/),
  'a composited layer under the rail is a hit-testing variable nobody needs',
);
ok(
  'dock strip owns no padding/gap',
  dockRules.length > 0 &&
    !anyDockRule(/(?:^|;)\s*padding\s*:\s*[1-9]/) &&
    !anyDockRule(/(?:^|;)\s*gap\s*:\s*[1-9]/),
  "the strip's own padding is a plain div — the pointer shows an arrow there",
);
ok(
  'nothing in the dock paints over the rows',
  !(() => {
    const re2 = /\.nw-dock(?![\w-])[^{]*\{([^}]*)\}/g;
    let m2;
    while ((m2 = re2.exec(bundle))) {
      if (isProse(m2[1]) || isProse(m2[0])) continue;
      if (/pointer-events:\s*none/.test(m2[1])) return true;
    }
    return false;
  })(),
  'a pointer-events:none ancestor would make every row unclickable',
);

// 6. The one that matters most: is anything positioned over the dock's corner?
//    Report every absolutely-positioned rule that claims the bottom-right.
const overlays = [];
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(bundle))) {
  const sel = m[1].trim();
  const body = m[2];
  if (!/(^|[;\s])position\s*:\s*(absolute|fixed)/.test(body)) continue;
  if (!/(^|[;\s])bottom\s*:/.test(body)) continue;
  if (!/(^|[;\s])right\s*:/.test(body)) continue;
  if (/pointer-events\s*:\s*none/.test(body)) continue;
  overlays.push({ sel: sel.replace(/\s+/g, ' ').slice(-70), body: body.replace(/\s+/g, ' ').slice(0, 110) });
}
ok(
  'no unpainted bottom-right overlay besides the dock',
  overlays.filter((o) => /dock/.test(o.sel)).length > 0,
  `${overlays.length} bottom-right anchored layers`,
);

console.log('probe-dock: what the shipped bundle actually wires');
console.log('');
for (const c of checks) {
  console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '\n       ' + c.detail : ''}`);
}
console.log('');
console.log('bottom-right anchored, pointer-receiving layers:');
for (const o of overlays) console.log('  - ' + o.sel + '\n    ' + o.body);
console.log('');
const failed = checks.filter((c) => !c.pass);
if (failed.length) {
  console.log(`结果: ${failed.length} 项失败`);
  process.exit(1);
}
console.log('结果: bundle 接线全部对得上');
