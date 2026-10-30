// Static hit-area audit for the dock.
//
// Why this exists: "鼠标监听没有覆盖整个按钮框" is a claim about the *computed*
// style of a button, and the two causes are both visible in CSS alone —
//  1. a hover/active rule that transforms the element, so its hit area moves
//     out from under the pointer (R54c), and
//  2. a border-radius, which makes hit-testing follow the rounded shape, so the
//     corners of a pill/round button are dead (R54d).
// This script renders the plugin's own CSS text, computes the cascade for the
// dock selectors, and asserts both invariants. It is not a browser: it is a
// guard that no future edit brings either cause back.
//
// Usage: node scripts/verify-dock-hit.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'client', 'src');

const files = readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
const css = files
  .map((f) => readFileSync(join(srcDir, f), 'utf8'))
  .join('\n')
  // Only the CSS payloads matter; the rest of each file is JavaScript.
  .split('\n')
  .join('\n');

/** Pull every rule block out of the concatenated sources. */
function rules(text) {
  const out = [];
  const re = /([^{}\n][^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    // R58: the selector capture starts wherever the previous `}` left off, so it
    // drags the CSS comment that sits above the rule into `sel`. Left in, every
    // exact-match assertion (`s === '.nw-dock'`) silently stops matching the
    // main rule and only sees the handful of one-liners in the responsive file —
    // which is how `align-items:stretch` slipped past this audit. Strip
    // comments first, then trim.
    const sel = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const body = m[2];
    // Skip anything that is plainly JavaScript around a CSS literal.
    if (/^\s*(return|if|for|const|let|var|function)\b/.test(sel)) continue;
    if (!/\.|:|#/.test(sel)) continue;
    if (!sel) continue;
    out.push({ sel, body });
  }
  return out;
}

const all = rules(css);

/** All declarations that apply to a selector list, in source order. */
function declsFor(predicate) {
  const out = [];
  for (const r of all) {
    const sels = r.sel.split(',').map((s) => s.trim());
    if (sels.some(predicate)) out.push({ sel: r.sel, body: r.body });
  }
  return out;
}

const problems = [];
const notes = [];

// ---- 1. no transform on dock hover/active --------------------------------
const movingSel = (s) =>
  /\.nw-dock-(fab|btn)/.test(s) && /:(hover|active)/.test(s);

for (const r of declsFor(movingSel)) {
  if (/\btransform\s*:/.test(r.body) && !/transform\s*:\s*none/.test(r.body)) {
    problems.push(
      `hover/active transform on "${r.sel}" — the hit area moves out from under the pointer ` +
      `(a press near the edge becomes a hover-leave/enter loop)`,
    );
  }
}

// ---- 2. the button box itself must be square; the pill is painted ---------
// R56/R57: the whole approach flipped. Four earlier attempts added a layer
// *over* a rounded button and asked that layer to answer the pointer — a
// transparent pseudo-element, then a real span. All four failed the same way,
// because the premise never changed: hit-testing follows the button's own
// border-radius, and every extra layer is another box with its own cursor
// question.
//
// Now the button box has NO radius (a plain rectangle, so there is nothing to
// round when deciding whether the pointer is inside), and the pill is drawn by a
// pseudo-element that is pointer-events:none and sits behind the content. The
// pointer therefore can only ever be answered by the button box itself.
//
// The assertions follow that structure: square box, painted layer inert, host
// positioned, children inert.
// R60: the shape is a FAB again (collapsed circle → menu of five rows), so the
// R57 assertions about "rest = one character, hover = icon + name" no longer
// describe this UI and were removed rather than silently relaxed. What survives
// is the part that was never about the shape: the pointer must never land on a
// box that does not belong to a button.
//
// That lesson is R59's, and it cost five wrong attempts at the buttons: the dead
// band behind "上半部分显示箭头、点击没反应" was the strip's OWN 5px padding — a
// plain div with cursor:auto sitting directly above the first row. A FAB has the
// same failure mode if the menu rows are spaced apart inside a container that
// paints nothing and answers nothing.
//
// So the invariants are now:
//   * every clickable box is square (radius 0) and paints with ::before,
//   * the container owns no padding, no gap, no background, no border,
//   * the rows and the FAB are adjacent with no margin between them,
//   * the FAB exists and is rendered (the shape really is collapsed → open).
const containerClasses = ['nw-dock', 'nw-dock-menu'];

for (const cls of containerClasses) {
  const own = declsFor((s) => s === '.' + cls);
  const last = (prop) => {
    let value = null;
    for (const r of own) {
      const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'g');
      let m;
      while ((m = re.exec(r.body))) value = m[1].trim();
    }
    return value;
  };
  for (const prop of ['padding', 'gap', 'border-width', 'background']) {
    const value = last(prop);
    if (value == null) continue;
    const harmless = /^0(\s|$)/.test(value) || /^(none|transparent)(\s|$)/.test(value);
    if (!harmless) {
      problems.push(
        '.' + cls + ' declares ' + prop + ':' + value + ' — this container paints a ' +
        'surface or owns space between interactive boxes, and that space resolves the ' +
        'cursor to the page (arrow) while swallowing the click',
      );
    }
  }
  if (!problems.length) {
    notes.push('.' + cls + ' — owns no padding, gap, border or background');
  }
}

// Every clickable box in the dock: square, painted by ::before, children inert.
for (const cls of ['nw-dock-btn', 'nw-dock-fab']) {
  const own = declsFor((s) => new RegExp('(^|[,\\s])\\.' + cls + '(\\s*$|\\s*[,{])').test(s));
  const lastDecl = (prop) => {
    let value = null;
    for (const r of own) {
      const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'g');
      let m;
      while ((m = re.exec(r.body))) value = m[1].trim();
    }
    return value;
  };

  // (a) square box — the load-bearing assertion. A rounded box makes hit-testing
  // follow the curved shape, so the corners of a pill/circle are dead.
  const radius = lastDecl('border-radius');
  if (radius == null || !/^0(\s|$)/.test(radius)) {
    problems.push(
      '.' + cls + ' — winning border-radius is "' + (radius === null ? '(unset)' : radius) + '", not 0; ' +
      'a rounded box makes hit-testing follow the rounded shape, so the corners and ' +
      'the padding are dead to the pointer',
    );
  } else {
    notes.push('.' + cls + ' — winning border-radius is 0 (the shape is painted, not the box)');
  }

  // (b) no border on the box.
  const border = lastDecl('border');
  const borderW = lastDecl('border-width');
  const hasBorder = (border != null && !/^0(\s|$)/.test(border))
    || (borderW != null && !/^0(\s|$)/.test(borderW));
  if (hasBorder) {
    problems.push('.' + cls + ' — the winning border is "' + (border || borderW) + '"; the shape must be painted by ::before');
  }

  // (c) the painted layer must exist (inset + radius), be behind, stay inside.
  const layer = declsFor((s) => new RegExp('\\.' + cls + '::before').test(s));
  const pill = layer.find((r) => /inset\s*:/.test(r.body) && /border-radius\s*:/.test(r.body));
  if (!pill) {
    problems.push('.' + cls + '::before — missing the painted shape (inset + border-radius)');
  } else {
    if (!/pointer-events\s*:\s*none/.test(pill.body)) {
      problems.push(
        '.' + cls + '::before — the painted layer answers the pointer; it must be ' +
        'pointer-events:none so the button box is what the cursor is resolved from',
      );
    } else {
      notes.push('.' + cls + '::before — paints the shape, inert to the pointer');
    }
    if (!/z-index\s*:\s*-\d/.test(pill.body)) {
      problems.push('.' + cls + '::before — the painted shape is not behind the content (expected z-index:-1)');
    }
    if (/inset\s*:\s*-\d/.test(pill.body)) {
      problems.push('.' + cls + '::before — the painted shape overflows the button box');
    }
  }

  // (d) children must not answer the pointer.
  const kidsInert = declsFor((s) => new RegExp('\\.' + cls + '\\s*>\\s*\\*').test(s))
    .some((r) => /pointer-events\s*:\s*none/.test(r.body));
  if (!kidsInert) {
    problems.push('.' + cls + ' — children are not pointer-events:none, so one of them can answer the pointer');
  } else {
    notes.push('.' + cls + ' — children are inert, the box is the only hit target');
  }

  // (e) containing block for the painted layer.
  if (!own.some((r) => /position\s*:\s*relative/.test(r.body))) {
    problems.push('.' + cls + ' — the host is not position:relative, so the painted layer anchors elsewhere');
  }
}

// (f) no leftover hit-layer element from the abandoned R54d/R54f/R54g approach.
const leftover = files.filter((f) => /nw-dock-hit/.test(readFileSync(join(srcDir, f), 'utf8')));
if (leftover.length) {
  problems.push('.nw-dock-hit — still present in ' + leftover.join(', ') + '; R56 removed the approach entirely');
}

// (g) R60: the FAB must actually be rendered, and the menu must exist. A leftover
// CSS rule is harmless, but a missing render would leave the five actions with no
// way to be reached at all.
const fabRender = files.filter((f) =>
  /className:\s*'nw-dock-fab'/.test(readFileSync(join(srcDir, f), 'utf8')));
if (!fabRender.length) {
  problems.push('.nw-dock-fab — not rendered anywhere; the dock would have no way to open');
} else {
  notes.push('.nw-dock-fab — rendered (collapsed → open)');
}
const menuRender = files.filter((f) =>
  /className:\s*'nw-dock-menu'/.test(readFileSync(join(srcDir, f), 'utf8')));
if (!menuRender.length) {
  problems.push('.nw-dock-menu — not rendered; the FAB would have nothing to open');
}

// (h) R60: the FAB's resting opacity must be lowered and restored on hover, so the
// collapsed dock melts into the paper instead of sitting on it.
const fabPill = declsFor((s) => /\.nw-dock-fab::before/.test(s))
  .find((r) => /opacity\s*:\s*\.\d+/.test(r.body));
if (!fabPill) {
  problems.push('.nw-dock-fab::before — no resting opacity; the collapsed dock would sit at full contrast');
} else {
  notes.push('.nw-dock-fab::before — fades at rest');
}
const fabHover = declsFor((s) => /\.nw-dock-fab:hover/.test(s) || /\.nw-dock-fab\[aria-expanded/.test(s));
if (!fabHover.some((r) => /opacity\s*:\s*1/.test(r.body))) {
  problems.push('.nw-dock-fab — never returns to full opacity on hover or when open');
}

// ---- 5. R62: the rail sits where it is supposed to ----------------------
// R61 added this section to keep the rail clear of the bottom-right corner, because
// a third-party always-on-top floating ball had been eating its clicks there. That
// ball is gone now (the writer switched it off), and the rail is back at its
// original corner, so the old `bottom >= 80` floor no longer describes the design
// — it would forbid the very placement the writer asked to restore.
// What is still worth guarding is the thing that section was built on top of: the
// offset must exist at all, must be a plain number, and every breakpoint must be
// coherent — a dock positioned only by its base rule and then reset to `0` in a
// media query would drop the circle onto the window edge on that width alone,
// which is indistinguishable from "the buttons stopped working".
const RE_FLOOR = 0; // a zero offset is the one value that always looks broken
const positionDecls = [];
const selMissingOffset = [];
for (const r of all) {
  const sels = r.sel.split(',').map((s) => s.trim());
  if (!sels.some((s) => s === '.nw-dock')) continue;
  const m = /(?:^|;)\s*bottom\s*:\s*(\d+)px/.exec(r.body);
  if (m) positionDecls.push(Number(m[1]));
  else if (/position\s*:/.test(r.body) || /right\s*:/.test(r.body)) selMissingOffset.push(r.sel);
}
if (!positionDecls.length) {
  problems.push('.nw-dock — no bottom offset at all; the rail would sit flush on the window edge');
} else if (positionDecls.some((v) => v <= RE_FLOOR)) {
  problems.push(
    `.nw-dock — a bottom offset of 0 leaves the circle on the window edge, under the ` +
    'resize grip and any tray overlay; every breakpoint needs a real offset',
  );
} else {
  notes.push(
    `.nw-dock — every placement carries a real bottom offset (${positionDecls
      .slice()
      .sort((a, b) => a - b)
      .join(', ')}px across breakpoints)`,
  );
}

// ---- 6. R63: the card is five rows and nothing else -----------------------
// The R63 redesign gave the menu a notch, the rows a trailing arrow and the FAB
// an inner ring — three new painted layers inside the dock. Each one is another
// chance to put a box over a button, which is the R59 failure mode one level in:
// a strip of card between/around the rows that resolves the cursor to `auto`
// and swallows the click.
//
// Two invariants keep that honest:
//   (i)  the menu's children are exactly the five item() rows — no header, no
//        footer, no spacer. Anything else is card that answers the pointer,
//   (ii) a row carries no margin: a vertical margin between rows is a dead band
//        *inside* the card, which reads as "the gap between two buttons is
//        broken" while looking like a layout detail.
const appFiles = files.filter((f) => /className:\s*'nw-dock-menu'/.test(readFileSync(join(srcDir, f), 'utf8')));
if (appFiles.length) {
  const dockSrc = readFileSync(join(srcDir, appFiles[0]), 'utf8');
  const a = dockSrc.indexOf("className: 'nw-dock-menu'");
  const b = dockSrc.indexOf("className: 'nw-dock-fab'", a);
  const seg = a >= 0 && b > a ? dockSrc.slice(a, b) : '';
  // Split on the row calls rather than counting `h(` in the raw slice: the slice
  // always runs on into the FAB's own `h('button', {...})`, so a raw count finds
  // one "extra element" that is not a menu child at all.
  const parts = seg.split(/\bitem\(/);
  const rows = parts.length - 1;
  const extra = (parts.slice(0, -1).join('').match(/\bh\(/g) || []).length;
  const local = [];
  if (rows !== 5) local.push(`.nw-dock-menu — renders ${rows} item(...) rows, expected 5`);
  if (extra) {
    local.push(
      `.nw-dock-menu — renders ${extra} extra element(s) beside the five rows; anything that is not a ` +
      'button row is a strip of card that resolves the pointer to an arrow and swallows the click',
    );
  }
  problems.push(...local);
  if (!local.length) notes.push('.nw-dock-menu — five rows and nothing else in the menu');
}

{
  const rowOwn = declsFor((s) => new RegExp('(^|[,\\s])\\.nw-dock-btn(\\s*$|\\s*[,{])').test(s));
  let margin = null;
  for (const r of rowOwn) {
    const re = /(?:^|;)\s*margin\s*:\s*([^;]+)/g;
    let m;
    while ((m = re.exec(r.body))) margin = m[1].trim();
  }
  if (margin != null && !/^0(\s|$)/.test(margin)) {
    problems.push(
      '.nw-dock-btn declares margin:' + margin + ' — a margin between rows is a dead band inside the card ' +
      '(the R59 symptom, one level in): the gap looks like padding but resolves the cursor to the page',
    );
  } else if (margin == null) {
    notes.push('.nw-dock-btn — no margin, so the row boxes stay edge to edge (the air between buttons is painted, not laid out)');
  } else {
    notes.push('.nw-dock-btn — margin is 0, so the row boxes stay edge to edge');
  }
}

// ---- 7. R63/R65: every painted layer in the dock is inert -----------------
// R63 added painted layers (the card, its notch, the arrow, the FAB's ring);
// R65 removed all but one per button. The rule that survives is the one that
// matters: any ::before/::after under a dock class must be pointer-events:none,
// with nothing setting it back — otherwise a painted box sits over a button and
// answers the cursor instead of the button box.
{
  const painted = all.filter((r) => /\.nw-dock-(?:menu|btn|fab)[^,]*?::(?:before|after)/.test(r.sel));
  const layers = new Map();
  for (const r of painted) {
    const m = r.sel.match(/\.(nw-dock-(?:menu|btn|fab))[^,]*?(::(?:before|after))/);
    if (!m) continue;
    const key = m[1] + m[2];
    const entry = layers.get(key) || { inert: false, offender: null };
    const pe = /pointer-events\s*:\s*([^;]+)/.exec(r.body);
    if (pe) {
      if (/^none/.test(pe[1].trim())) entry.inert = true;
      else entry.offender = r.sel;
    }
    layers.set(key, entry);
  }
  const wanted = ['nw-dock-btn::before', 'nw-dock-fab::before'];
  const local = [];
  for (const key of wanted) {
    const entry = layers.get(key);
    if (!entry || !entry.inert) {
      local.push(
        '.' + key + ' — not pointer-events:none; every painted layer in the dock must be inert so ' +
        'the cursor is only ever resolved from a button box',
      );
    }
  }
  for (const [key, entry] of layers) {
    if (entry.offender) local.push('.' + key + ' — "' + entry.offender + '" sets pointer-events back to something answerable');
  }
  // R65: the menu is a column, not a card. Every visible surface in the dock
  // belongs to a button; if the menu grows a surface again the rows stop being
  // five separate buttons and the gap between them becomes card, not paper.
  const menuSurface = painted.filter((r) => /\.nw-dock-menu\s*::(?:before|after)/.test(r.sel)
    && /(^|;)\s*(background|inset)\s*:/.test(r.body));
  if (menuSurface.length) {
    local.push(
      '.nw-dock-menu — paints its own surface (' + menuSurface[0].sel + '); after R65 the menu is a bare column ' +
      'and the five rows paint themselves',
    );
  }
  problems.push(...local);
  if (!local.length) notes.push('every painted layer (' + layers.size + ') is inert, and the menu paints nothing itself');
}

// ---- 8. R65: each row is its own button, with real air between them -------
// The user asked for "每一个都是独立的按钮，按钮间有点间隔". The gap is made by
// insetting each row's painted shape vertically, NOT by a container gap: a gap
// belongs to the container, and the pointer that lands in it hits a div that
// paints nothing — R59's dead band wearing a different hat. So the assertions
// are (i) the row really paints a surface (not a transparent hover-only layer),
// and (ii) that surface is inset and smaller than the row box, which is where
// the visual gap comes from while the hit boxes stay edge to edge.
{
  const local = [];
  // Comment bodies are not stripped by rules(), so match on word boundaries
  // rather than on a leading `;` — a comment between two declarations would
  // otherwise hide the declaration that follows it.
  const base = declsFor((s) => s === '.nw-dock-btn::before');
  const inset = base.map((r) => /\binset\s*:\s*([^;]+)/.exec(r.body)).find(Boolean);
  const bg = base.map((r) => /\bbackground\s*:\s*([^;]+)/.exec(r.body)).find(Boolean);
  if (!bg || /^(none|transparent)(\s|$)/.test(bg[1].trim())) {
    local.push('.nw-dock-btn::before — no resting surface; the rows would read as bare text, not five buttons');
  }
  if (!inset) {
    local.push('.nw-dock-btn::before — no inset; the five buttons would touch edge to edge');
  } else {
    const top = /^(\d+(?:\.\d+)?)px/.exec(inset[1].trim());
    if (!top || Number(top[1]) <= 0) {
      local.push('.nw-dock-btn::before — inset ' + inset[1].trim() + ' leaves no vertical air; the buttons would touch');
    } else {
      notes.push('.nw-dock-btn::before — paints a chip inset ' + top[1] + 'px top, so the buttons are ' +
        (2 * Number(top[1])) + 'px apart while their hit boxes stay edge to edge');
    }
  }
  problems.push(...local);
}

console.log('verify-dock-hit: dock hit-area audit');
console.log('');
for (const n of notes) console.log('  ok   ' + n);
for (const p of problems) console.log('  FAIL ' + p);
console.log('');
if (problems.length) {
  console.log(`结果: ${problems.length} 处命中区问题`);
  process.exit(1);
}
console.log('结果: 全部通过 ✅（无位移、命中层覆盖整个按钮框）');
