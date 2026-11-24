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
  // four stray ticks, the old star-burst read as a splat). This set uses
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
    // 摊开的书：书脊 + 左右两页。用在目录里「读这一章」与「读整本」上，
    // 与「新建小说」的合上的书区分开。
    openbook: [
      'M10 6.1C8.5 5 6.6 4.6 4.2 4.8v9.8c2.4-.2 4.3.2 5.8 1.3',
      'M10 6.1c1.5-1.1 3.4-1.5 5.8-1.3v9.8c-2.4-.2-4.3.2-5.8 1.3',
      'M10 6.1v9.8',
    ],
    // 喇叭（朗读）。mute 是同一个喇叭加一道斜杠，两个共用外框，切换时不会跳。
    volume: [
      'M4.2 8.2h2.6l3.6-3.1v9.8L6.8 11.8H4.2z',
      'M13.4 7.4a3.4 3.4 0 0 1 0 5.2',
      'M15.6 5.2a6.4 6.4 0 0 1 0 9.6',
    ],
    volumeoff: [
      'M4.2 8.2h2.6l3.6-3.1v9.8L6.8 11.8H4.2z',
      'M13.2 7.8l4.4 4.4',
      'M17.6 7.8l-4.4 4.4',
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
    // R118: the `proofread` star-burst is gone with the 「AI 校对」 dialog; the
    // 字词与标点 angle now reuses the same AI建议 card, so no glyph is needed.
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

  // ---- brand marks ---------------------------------------------------------
  //
  // The DeepSeek whale, copied from the host's own /favicon.svg: a single
  // 50×50 fill path (M / C / Z). It is drawn solid rather than stroked — at
  // dock size a line version loses the tail notch and the eye completely.
  // The transform maps that 50-unit artboard onto the same 2…18 optical box
  // as the line set: width 48.8 units → 16.35, i.e. 0.335 scale, centred on
  // the path's own bbox centre (25, 25.25).
  const WHALE = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z';
  const SOLID = {
    whale: { transform: 'translate(1.63 1.54) scale(0.335)', d: WHALE },
  };

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
    const solid = SOLID[name];
    if (solid) {
      return NW.h(
        'svg',
        {
          viewBox: '0 0 20 20',
          width: size,
          height: size,
          fill: 'currentColor',
          stroke: 'none',
          className: options.className ? options.className : undefined,
          'aria-hidden': label ? undefined : 'true',
          role: label ? 'img' : undefined,
          'aria-label': label || undefined,
          focusable: 'false',
          style: Object.assign(
            { display: 'block', flex: '0 0 auto', pointerEvents: 'none', overflow: 'visible' },
            options.style || null,
          ),
        },
        NW.h('path', { d: solid.d, transform: solid.transform, fillRule: 'nonzero' }),
      );
    }
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
  NW.iconNames = Object.keys(PATHS).concat(Object.keys(SOLID));
  NW.ICON_PATHS = PATHS;

  NW.CSS_PARTS.push(`
/* Icons are line art on currentColor: nothing here sets a colour, so a themed
   shell only has to change what color resolves to. */
.nw-icon{display:block;flex:0 0 auto;pointer-events:none;}
.nw-iconbtn{display:inline-flex;align-items:center;justify-content:center;}
`);
})();
