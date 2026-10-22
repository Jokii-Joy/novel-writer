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
  // Geometry contract: 16×16 viewBox, stroke 1.5, round caps and joins, and
  // nothing outside 1.5…14.5 so a glyph never clips when scaled down to 13px.
  //
  // `NW.icon(name, opts)` → React element. Unknown names draw nothing rather
  // than throwing: an icon is decoration, never content.
  // ===========================================================================

  const PATHS = {
    // ---- creation / editing ------------------------------------------------
    plus: ['M8 3.2v9.6', 'M3.2 8h9.6'],
    minus: ['M3.2 8h9.6'],
    pencil: ['M11.1 2.4l2.5 2.5-8 8-3.2.7.7-3.2z', 'M9.5 4l2.5 2.5'],
    trash: ['M2.8 4.2h10.4', 'M6.1 4.2V2.8h3.8v1.4', 'M4.2 4.2l.6 9h6.4l.6-9', 'M6.6 6.6v4.2', 'M9.4 6.6v4.2'],
    child: ['M4 3.2v3.6a2 2 0 0 0 2 2h4.2', 'M8.4 6.6l2 2.2-2 2.2'],
    book: ['M3.4 2.6h6.6a2 2 0 0 1 2 2v9H5.4a2 2 0 0 1-2-2z', 'M3.4 11.6h8.6'],
    doc: ['M4.2 2.4h5l3 3v8.2h-8z', 'M9.2 2.4v3h3'],
    save: ['M3 3h7.4L13 5.6V13H3z', 'M5.6 3v3.4h4.6V3', 'M5.4 9.2h5.2v3.8H5.4z'],
    search: ['M7.2 2.4a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6', 'M10.8 10.8l2.6 2.6'],
    filter: ['M2.6 3.4h10.8l-4.2 4.8v4.2l-2.4 1.2V8.2z'],

    // ---- navigation --------------------------------------------------------
    caret: ['M6.2 3.8l4.4 4.2-4.4 4.2'],
    chevleft: ['M9.6 3.6L6 8l3.6 4.4'],
    chevright: ['M6.4 3.6L10 8l-3.6 4.4'],
    chevdown: ['M3.6 6.2L8 9.8l4.4-3.6'],
    chevup: ['M3.6 9.8L8 6.2l4.4 3.6'],
    home: ['M2.6 7.4L8 2.8l5.4 4.6', 'M4.2 6.6v6.6h7.6V6.6'],
    external: ['M9.4 2.6h4v4', 'M13.4 2.6L7.6 8.4', 'M11.4 9.6v3.8H2.6V4.4h3.8'],

    // ---- app chrome --------------------------------------------------------
    gear: [
      'M8 2.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 0 0 0-11.2',
      'M8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4',
      'M8 1.2v1.2',
      'M8 13.6v1.2',
      'M1.2 8h1.2',
      'M13.6 8h1.2',
    ],
    more: ['M4 8h.01', 'M8 8h.01', 'M12 8h.01'],
    x: ['M4.2 4.2l7.6 7.6', 'M11.8 4.2l-7.6 7.6'],
    check: ['M3.2 8.4l3.2 3.2 6.4-7.2'],
    minusbox: ['M3 3h10v10H3z', 'M5.6 8h4.8'],
    panel: ['M2.6 3h10.8v10H2.6z', 'M6.4 3v10'],
    immersive: ['M2.6 6V2.6H6', 'M13.4 6V2.6H10', 'M2.6 10v3.4H6', 'M13.4 10v3.4H10'],
    lock: ['M4.2 7.2h7.6v5.6H4.2z', 'M5.8 7.2V5.4a2.2 2.2 0 0 1 4.4 0v1.8'],
    unlock: ['M4.2 7.2h7.6v5.6H4.2z', 'M5.8 7.2V5.4a2.2 2.2 0 0 1 4.3-.6'],
    keyboard: ['M2.4 4.4h11.2v7.2H2.4z', 'M4.6 6.6h.01', 'M7 6.6h.01', 'M9.4 6.6h.01', 'M11.4 6.6h.01', 'M5.6 9.4h4.8'],

    // ---- transport ---------------------------------------------------------
    upload: ['M8 10.8V3.4', 'M5.2 6.2L8 3.4l2.8 2.8', 'M3.4 12.8h9.2'],
    download: ['M8 3.2v7.4', 'M5.2 7.8L8 10.6l2.8-2.8', 'M3.4 13.2h9.2'],
    refresh: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13.2 2.4v2.8h-2.8'],
    cloud: ['M4.6 12.4a2.8 2.8 0 0 1-.3-5.6 3.6 3.6 0 0 1 6.9-1 2.6 2.6 0 0 1 .8 5.1z'],
    folder: ['M2.4 4.2h4.2l1.4 1.8h5.6v6.6H2.4z'],

    // ---- writing tools -----------------------------------------------------
    proofread: ['M5.2 2.8l1.3 2.9 2.9 1.3-2.9 1.3-1.3 2.9-1.3-2.9L1.2 7l2.7-1.3z', 'M10.6 8.4l1 2.2 2.2.8-2.2.8-1 2.2-1-2.2-2.2-.8 2.2-.8z'],
    typeset: ['M9.6 2.4h4', 'M11.6 2.4v8.2', 'M5.4 8.2a2.6 2.6 0 0 1 2.6 2.6v2.6H5.4a2.6 2.6 0 0 1 0-5.2z', 'M2.4 2.4h4.4'],
    typewriter: ['M3.4 12.6V9.2l4.6-6.8 3.6 2.4-4.6 6.8z', 'M11.6 12.6H3.4'],
    send: ['M2.4 8l11.2-5.2L11.6 13 8 9.6z', 'M8 9.6l5.6-6.8'],
    mail: ['M2.4 4.2h11.2v7.6H2.4z', 'M2.4 4.6L8 8.8l5.6-4.2'],
    journal: ['M3.4 2.6h9.2v10.8H3.4z', 'M5.6 5.4h4.8', 'M5.6 8h4.8', 'M5.6 10.6h2.8'],
    eye: ['M1.6 8S4 4 8 4s6.4 4 6.4 4-2.4 4-6.4 4S1.6 8 1.6 8z', 'M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6'],
    clock: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4', 'M8 4.8V8l2.2 1.4'],
    star: ['M8 2.4l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.2l-3.5 1.9.8-3.9L2.4 6.5l3.9-.5z'],
    sparkle: ['M6.2 2.6l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9L5.1 7.7 2.2 6.6l2.9-1.1z', 'M11.4 9l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z'],

    // ---- state -------------------------------------------------------------
    info: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4', 'M8 7.2v3.6', 'M8 5.2h.01'],
    warn: ['M8 2.6l5.8 10.2H2.2z', 'M8 6.4v2.8', 'M8 11h.01'],
    success: ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4', 'M5.4 8.2l1.8 1.8 3.4-3.8'],
    moon: ['M12.4 9.6A5 5 0 0 1 6.4 3.6a5.2 5.2 0 1 0 6 6z'],
    sun: ['M8 4.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8', 'M8 1.6v1.4', 'M8 13v1.4', 'M1.6 8h1.4', 'M13 8h1.4', 'M3.5 3.5l1 1', 'M11.5 11.5l1 1', 'M12.5 3.5l-1 1', 'M4.5 11.5l-1 1'],
    list: ['M5.6 4.2h7.8', 'M5.6 8h7.8', 'M5.6 11.8h7.8', 'M2.8 4.2h.01', 'M2.8 8h.01', 'M2.8 11.8h.01'],
  };

  const EMPTY = [];

  /** Draw one icon. `opts` = `{size, weight, className, title, style}`. */
  function icon(name, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const paths = PATHS[name] || EMPTY;
    const size = Number(options.size) > 0 ? Number(options.size) : 16;
    const weight = Number(options.weight) > 0 ? Number(options.weight) : 1.5;
    const label = options.title ? String(options.title) : '';
    return NW.h(
      'svg',
      {
        viewBox: '0 0 16 16',
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
