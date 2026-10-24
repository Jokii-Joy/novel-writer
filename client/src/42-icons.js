;(() => {
  'use strict';

  // ============================================================== Icons ======
  //
  // One inline SVG set for the whole plugin. R4 and earlier used text glyphs
  // (☰ ▢ ⛶ ⚙ 🔒 ✍ ¶ ✉) in the toolbar and dock — they render at different
  // sizes on every platform, inherit the emoji font's colour in some hosts, and
  // turn into tofu when the host font stack lacks them. These are plain stroked
  // paths on `currentColor`, so a theme only has to move `color`.
  //
  // R20 rebuilt the whole table from scratch. The old set was drawn on a 16×16
  // canvas, which left too little room between strokes: at a 16px render every
  // glyph sat within 1.5…14.5 and the 1.5 stroke turned to mush (the gear grew
  // four stray ticks, the star-burst "proofread" read as a splat). This set uses
  // a 20×20 grid with a 2-unit optical margin, so the same nominal stroke has
  // 25% more breathing room and corners stay clean.
  //
  // Geometry contract: 20×20 viewBox, nothing outside 2…18, round caps and
  // joins, arcs prefer `a` over approximated line fans, and every glyph is
  // optically centred in its box rather than mathematically centred — a book or
  // a folder looks lower than it measures, so it is nudged up half a unit.
  //
  // `NW.icon(name, opts)` → React element. Unknown names draw nothing rather
  // than throwing: an icon is decoration, never content.
  // ===========================================================================

  const PATHS = {
    // ---- creation / editing ------------------------------------------------
    plus: ['M10 4.2v11.6', 'M4.2 10h11.6'],
    minus: ['M4.2 10h11.6'],
    pencil: ['M12.9 3.6l3.5 3.5-8.9 8.9-4.4.9.9-4.4z', 'M11 5.5l3.5 3.5'],
    trash: [
      'M3.6 6h12.8',
      'M7.6 6V3.6h4.8V6',
      'M5.4 6l.8 10.4h7.6L14.6 6',
      'M8.6 9v4.6',
      'M11.4 9v4.6',
    ],
    child: ['M5.2 3.6v4.6a2.6 2.6 0 0 0 2.6 2.6h4.8', 'M10.6 8.2l2.8 2.6-2.8 2.6'],
    // A closed book seen from the front: the outer board, the page block, and
    // the spine groove down the left edge. The old single rounded rectangle
    // read as a phone at small sizes.
    book: [
      'M4.4 4.2h9.2a2 2 0 0 1 2 2v10H6.4a2 2 0 0 1-2-2z',
      'M6.6 4.2v12',
      'M8.8 8.2h4.4',
      'M8.8 11h4.4',
    ],
    doc: ['M5.2 3.2h6.2l4 4v9.6H5.2z', 'M11.4 3.2v4h4'],
    save: [
      'M3.6 3.6h9.4l3.4 3.4v9.4H3.6z',
      'M6.8 3.6v4.4h6.4V3.6',
      'M6.8 11.6h6.4v4.8H6.8z',
    ],
    search: ['M9.2 3.6a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2z', 'M13.2 13.2l4 4'],
    filter: ['M3 5.2h14l-5.6 6.4v4.6l-2.8 1.4v-6z'],

    // ---- navigation --------------------------------------------------------
    // Tree disclosure. Kept a chevron (the conventional affordance, and the
    // shelf rotates it 90 degrees when a chapter expands) but pulled in tighter
    // and shorter than `chevright` so the two never read as the same control
    // when they happen to sit near each other.
    caret: ['M8.2 6.4l3.6 3.6-3.6 3.6'],
    chevleft: ['M12.4 4.2L6.6 10l5.8 5.8'],
    chevright: ['M7.6 4.2L13.4 10l-5.8 5.8'],
    chevdown: ['M4.2 7.6L10 13.4l5.8-5.8'],
    chevup: ['M4.2 12.4L10 6.6l5.8 5.8'],
    home: ['M3 9.6L10 3.2l7 6.4', 'M5.4 8.4v9.2h9.2V8.4', 'M8.4 17.6v-4.8h3.2v4.8'],
    external: ['M11.6 3.4h5v5', 'M16.6 3.4L9.4 10.6', 'M14.2 12v4.6H4V6.4h4.6'],

    // ---- app chrome --------------------------------------------------------
    // "Settings" is drawn as two rails with knobs rather than a gear: a gear
    // needs eight teeth to read as a gear, and at 16px that turns into a grey
    // disc. Rails stay legible at every size on the ladder.
    gear: [
      'M3.6 6.6h5.2',
      'M11.2 4.6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
      'M13.2 6.6h3.2',
      'M3.6 13.4h3.2',
      'M8.8 11.4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
      'M10.8 13.4h5.6',
    ],
    more: ['M5.4 10h.01', 'M10 10h.01', 'M14.6 10h.01'],
    x: ['M5.4 5.4l9.2 9.2', 'M14.6 5.4l-9.2 9.2'],
    check: ['M4 10.4l4 4 8-8.8'],
    minusbox: ['M4 4h12v12H4z', 'M7.2 10h5.6'],
    panel: ['M3.4 4h13.2v12H3.4z', 'M8.2 4v12'],
    immersive: ['M3.4 7.8V3.4h4.4', 'M16.6 7.8V3.4h-4.4', 'M3.4 12.2v4.4h4.4', 'M16.6 12.2v4.4h-4.4'],
    lock: [
      'M5 9.2h10v8H5z',
      'M7.4 9.2V6.6a2.6 2.6 0 0 1 5.2 0v2.6',
      'M10 12.6v1.6',
    ],
    unlock: [
      'M5 9.2h10v8H5z',
      'M7.4 9.2V6.6a2.6 2.6 0 0 1 5-.9',
      'M10 12.6v1.6',
    ],
    keyboard: [
      'M2.6 6.2h14.8v7.6H2.6z',
      'M5.4 9h.01',
      'M8.2 9h.01',
      'M11 9h.01',
      'M13.8 9h.01',
      'M6.6 11.6h6.8',
    ],

    // ---- transport ---------------------------------------------------------
    upload: ['M10 14.2V3.8', 'M6 7.8l4-4 4 4', 'M3.6 16.6h12.8'],
    download: ['M10 3.8v10.4', 'M6 10.2l4 4 4-4', 'M3.6 16.6h12.8'],
    refresh: [
      'M4.4 10a5.6 5.6 0 0 1 9.6-3.9',
      'M14.4 3.4v3.2h-3.2',
      'M15.6 10a5.6 5.6 0 0 1-9.6 3.9',
      'M5.6 16.6v-3.2h3.2',
    ],
    cloud: ['M6.6 15.4a3.3 3.3 0 0 1-.4-6.6 4.3 4.3 0 0 1 8.2-1.1A3 3 0 0 1 14.2 15.4z'],
    folder: ['M3.2 5.4h5.2l2 2.4h6.4v8.8H3.2z'],

    // ---- writing tools -----------------------------------------------------
    proofread: [
      'M3.4 6h7',
      'M3.4 10h7',
      'M3.4 14h4.2',
      'M14.2 4.4l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z',
    ],
    typeset: ['M3.4 5.2h13.2', 'M3.4 9h8.8', 'M3.4 12.8h13.2', 'M3.4 16.6h6.2'],
    typewriter: ['M10 6.6v6.8', 'M3.4 10h4.2', 'M12.4 10h4.2', 'M6.6 3.6h6.8'],
    send: ['M17 3.2L3.4 8.8l5.4 2.4 2.4 5.4z', 'M8.8 11.2l8.2-8'],
    mail: ['M3.2 5.4h13.6v9.2H3.2z', 'M3.2 6l6.8 4.8L16.8 6'],
    journal: ['M4 3.4h12v13.2H4z', 'M6.6 6.6h6.8', 'M6.6 9.8h6.8', 'M6.6 13h4.2'],
    eye: [
      'M2 10s3-5.2 8-5.2S18 10 18 10s-3 5.2-8 5.2S2 10 2 10z',
      'M10 7.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
    ],
    clock: ['M10 3.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2z', 'M10 6.4V10l2.8 1.8'],
    star: ['M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 4.9L10 14.2l-4.5 2.3.9-4.9L2.8 8.1l5-.7z'],
    sparkle: [
      'M7.4 3.4l1.6 3.8 3.8 1.6-3.8 1.6-1.6 3.8L5.8 10.4 2 8.8l3.8-1.6z',
      'M15 11.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z',
    ],

    // ---- state -------------------------------------------------------------
    info: ['M10 3.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2z', 'M10 9v4.6', 'M10 6.4h.01'],
    warn: ['M10 2.8l7.2 13.4H2.8z', 'M10 8v3.6', 'M10 13.8h.01'],
    success: [
      'M10 3.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2z',
      'M6.6 10.2l2.2 2.2 4.4-4.8',
    ],
    moon: ['M15.8 12.2A6.6 6.6 0 0 1 8 4.2a6.6 6.6 0 1 0 7.8 8z'],
    sun: [
      'M10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
      'M10 2.2v1.8',
      'M10 16v1.8',
      'M2.2 10h1.8',
      'M16 10h1.8',
      'M4.5 4.5l1.3 1.3',
      'M14.2 14.2l1.3 1.3',
      'M15.5 4.5l-1.3 1.3',
      'M5.8 14.2l-1.3 1.3',
    ],
    list: [
      'M7.4 5.4h9.2',
      'M7.4 10h9.2',
      'M7.4 14.6h9.2',
      'M3.8 5.4h.01',
      'M3.8 10h.01',
      'M3.8 14.6h.01',
    ],
  };

  const EMPTY = [];

  /**
   * One size ladder for the whole plugin.
   *
   * Call sites used to pass whatever looked right in isolation (13, 14, 15,
   * 16, 17, 18 …), so icons sitting next to each other in the same toolbar had
   * visibly different weights and heights. Snapping to a ladder keeps every
   * row optically even, and it is the only place that has to change when the
   * shell scale moves.
   */
  const SIZE_LADDER = [12, 14, 16, 18, 20, 24, 28, 32];

  function snapSize(value) {
    const want = Number(value) > 0 ? Number(value) : 16;
    let best = SIZE_LADDER[0];
    let bestGap = Infinity;
    for (const step of SIZE_LADDER) {
      const gap = Math.abs(step - want);
      // Ties go to the larger step: an icon rendered 1px too small reads as
      // broken next to its neighbours, one 1px too large still reads as bold.
      if (gap < bestGap || (gap === bestGap && step > best)) {
        best = step;
        bestGap = gap;
      }
    }
    return best;
  }

  /**
   * Optical stroke weight, in viewBox units.
   *
   * The paths live in a 20-unit box, so a rendered 16px icon scales the stroke
   * by 0.8. These numbers are chosen so the on-screen stroke lands near 1.5px
   * at the small end and near 2.5px at the large end — the same target the old
   * 16-unit set aimed at, but reached without the paths crowding each other.
   */
  function strokeFor(size) {
    if (size <= 14) return 2.1;
    if (size <= 18) return 1.9;
    if (size <= 24) return 1.7;
    return 1.55;
  }

  /** Draw one icon. `opts` = `{size, weight, className, title, style}`. */
  function icon(name, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const paths = PATHS[name] || EMPTY;
    const size = snapSize(options.size);
    const weight = Number(options.weight) > 0 ? Number(options.weight) : strokeFor(size);
    const label = options.title ? String(options.title) : '';
    return NW.h(
      'svg',
      {
        viewBox: '0 0 20 20',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: weight,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: options.className ? options.className : undefined,
        // Decorative by default; a caller that passes `title` opts into the
        // exposed-label path so screen readers announce the action.
        'aria-hidden': label ? undefined : 'true',
        role: label ? 'img' : undefined,
        'aria-label': label || undefined,
        focusable: 'false',
        style: Object.assign(
          { display: 'block', flex: '0 0 auto', pointerEvents: 'none', overflow: 'visible' },
          options.style || null,
        ),
      },
      paths.map((d, index) => NW.h('path', { key: index, d })),
    );
  }

  NW.icon = icon;
  NW.iconNames = Object.keys(PATHS);
  NW.ICON_PATHS = PATHS;

  NW.CSS_PARTS.push(`
/* Icons are line art on currentColor: nothing here sets a colour, so a themed
   shell only has to change what color resolves to. */
.nw-icon{display:block;flex:0 0 auto;pointer-events:none;}
.nw-iconbtn{display:inline-flex;align-items:center;justify-content:center;}
`);
})();
