;(() => {
  'use strict';

  // ============================================================================
  // 精神空间 · 窗外 (NW.Scene)
  //
  // R164 / R165. The writer asked for a window, not a wallpaper:
  //   「玻璃要一整块，透明，能看到窗外的雨，树，风」 · 「背景不合格，要透明，
  //   光线不要太暗，树呢，风呢，要真实」
  //
  // Three decisions came out of that, and each one is why the previous pass
  // looked like a tinted panel instead of a window:
  //
  // 1. DEPTH BY CONTRAST, NOT BY FOG. The old frame put a wide grey mist over
  //    everything, which flattened far and near into one pale field. Now the
  //    distance is handled by desaturation and blur alone (far treeline sits at
  //    ~22% opacity and is blurred hard), and the near foliage is drawn almost
  //    black-green and sharp. Rain is then visible twice: bright against the
  //    sky, and as a lighter veil over the dark leaves. That double reading is
  //    what the eye uses to decide "it is raining outside", not "the wallpaper
  //    has lines on it".
  //
  // 2. THE TREES ARE BUILT, NOT BLURRED. A tree here is a tapered trunk, three
  //    or four branches, and a canopy of 40-90 small leaf ellipses whose sizes
  //    shrink toward the tips. Canopies are seeded once; a frame only moves each
  //    cluster as a whole plus a per-leaf flutter, so a gust reads as the same
  //    wind arriving on the tree from left to right rather than each leaf having
  //    its own private opinion.
  //
  // 3. ONE WIND. `gustAt(t)` — three sines at incommensurate rates — feeds the
  //    rain angle, the trunk bend, the canopy sway, the leaf flutter, the
  //    drifting glass streaks and the flying leaves. Two trees nodding at
  //    unrelated times is the single strongest "this is fake" cue available, so
  //    nothing in the frame is allowed to move on its own clock.
  //
  // Why canvas and not video: the plugin ships as one JS bundle and has no asset
  // pipeline (client/ holds client.js and src/), so a clip would have to be
  // inlined as base64 — heavier than this renderer for every single load. The
  // renderer is deliberately dumb: shapes are seeded once, a frame walks the
  // arrays and draws, nothing is measured from the DOM, and the loop stops when
  // the tab is hidden or the window is switched off in 设置.
  // ============================================================================

  // Overcast late afternoon. Bright enough to read as daylight through glass,
  // never so bright that the paper stops being the lightest thing on screen.
  const SKY_TOP = '#9db2bd';
  const SKY_HI = '#c8d6d8';
  const SKY_LOW = '#d3dbd5';
  const LEAF_DARK = [26, 46, 38];
  const LEAF_MID = [42, 68, 52];
  const LEAF_LIT = [78, 106, 74];

  /** deterministic 0..1 from an integer seed (no Math.random in draw code) */
  function rnd(i) {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /** one shared wind value, ~0..1, slow and slightly irregular */
  function gustAt(t) {
    return 0.44
      + 0.24 * Math.sin(t * 0.37)
      + 0.17 * Math.sin(t * 1.07 + 1.7)
      + 0.11 * Math.sin(t * 2.41 + 0.4);
  }

  /** A tree: trunk, branches, and a seeded canopy of leaves. */
  function makeTree(s, i, spec) {
    const leaves = [];
    const n = spec.leaves;
    for (let k = 0; k < n; k++) {
      // Two thirds of the leaves fill an ellipse around the crown, the rest
      // hang toward the tips where a canopy is thinnest and lets light through.
      const a = rnd(s + i * 131 + k * 7) * Math.PI * 2;
      const rr = Math.pow(rnd(s + i * 131 + k * 7 + 1), 0.62);
      const ox = Math.cos(a) * rr * spec.cw;
      const oy = Math.sin(a) * rr * spec.ch * (ox < 0 ? 0.86 : 1);
      leaves.push({
        ox: ox,
        oy: oy,
        r: spec.leaf * (0.55 + rnd(s + i * 131 + k * 7 + 2) * 0.85),
        tone: rnd(s + i * 131 + k * 7 + 3),
        ph: rnd(s + i * 131 + k * 7 + 4) * 6.283,
        rot: (rnd(s + i * 131 + k * 7 + 5) - 0.5) * 1.4,
      });
    }
    return {
      x: spec.x,
      y: spec.y,
      h: spec.h,
      trunk: spec.trunk,
      cw: spec.cw,
      ch: spec.ch,
      ph: rnd(s + i * 17) * 6.283,
      amp: spec.amp,
      blur: spec.blur || 0,
      alpha: spec.alpha == null ? 1 : spec.alpha,
      lit: spec.lit == null ? 1 : spec.lit,
      leaves: leaves,
    };
  }

  function build(w, h, seed) {
    const s = Math.round(seed * 977) | 0;
    const tree = (i, spec) => makeTree(s, i, spec);

    // The paper covers the middle of the glass, so the trees are placed where a
    // window still shows them: the two side strips and the corner above. A
    // treeline runs across the whole width underneath.
    const side = tree(1, {
      x: 0.135, y: 1.02, h: 0.92, trunk: 0.016,
      cw: 0.20, ch: 0.20, leaf: 0.030, leaves: 74, amp: 1.0,
    });
    const side2 = tree(2, {
      x: 0.925, y: 1.05, h: 0.78, trunk: 0.013,
      cw: 0.15, ch: 0.16, leaf: 0.024, leaves: 58, amp: 1.0,
    });
    // A near branch crossing the top-left corner: foreground, sharp, and the
    // closest thing to the glass, so it moves the most.
    const branch = tree(3, {
      x: 0.055, y: 0.36, h: 0.5, trunk: 0.010,
      cw: 0.13, ch: 0.11, leaf: 0.026, leaves: 46, amp: 1.9, blur: 0,
    });

    // Treeline across the frame: cheap silhouettes, hard blur, low alpha.
    const line = [];
    for (let i = 0; i < 26; i++) {
      line.push({
        x: (i / 25) * 1.08 - 0.04,
        y: 0.60 + rnd(s + i + 40) * 0.10,
        r: 0.05 + rnd(s + i + 90) * 0.09,
        tone: rnd(s + i + 130),
        ph: rnd(s + i + 170) * 6.283,
      });
    }

    const rain = [];
    for (let i = 0; i < 460; i++) {
      rain.push({
        x: rnd(s + i * 7 + 11),
        y: rnd(s + i * 7 + 12),
        z: rnd(s + i * 7 + 13),
        len: 0.008 + rnd(s + i * 7 + 14) * 0.026,
      });
    }

    // Water ON the glass: streaks that stick, crawl down under their own weight,
    // and leave the wet line behind them.
    const streaks = [];
    for (let i = 0; i < 22; i++) {
      streaks.push({
        x: rnd(s + i * 11 + 501),
        y: rnd(s + i * 11 + 502),
        v: 0.004 + rnd(s + i * 11 + 503) * 0.016,
        r: 0.8 + rnd(s + i * 11 + 504) * 1.9,
        wob: rnd(s + i * 11 + 505) * 6.283,
        trail: 12 + rnd(s + i * 11 + 506) * 70,
        pause: 0,
      });
    }

    // Drops that have not started to run yet: the beads that make a pane read as
    // glass rather than as air.
    const beads = [];
    for (let i = 0; i < 64; i++) {
      beads.push({
        x: rnd(s + i * 13 + 701),
        y: rnd(s + i * 13 + 702),
        r: 0.7 + rnd(s + i * 13 + 703) * 2.1,
        ph: rnd(s + i * 13 + 704) * 6.283,
      });
    }

    // A handful of leaves already off the branch, crossing the view.
    const blown = [];
    for (let i = 0; i < 7; i++) {
      blown.push({
        x: rnd(s + i * 19 + 901),
        y: 0.1 + rnd(s + i * 19 + 902) * 0.6,
        v: 0.02 + rnd(s + i * 19 + 903) * 0.05,
        ph: rnd(s + i * 19 + 904) * 6.283,
        r: 3 + rnd(s + i * 19 + 905) * 5,
      });
    }

    return { w, h, trees: [side, side2, branch], line, rain, streaks, beads, blown };
  }

  function leafColor(tone, lit) {
    const t = tone;
    const base = t < 0.45 ? LEAF_DARK : (t < 0.8 ? LEAF_MID : LEAF_LIT);
    const r = Math.round(base[0] * (0.82 + lit * 0.3));
    const g = Math.round(base[1] * (0.82 + lit * 0.3));
    const b = Math.round(base[2] * (0.82 + lit * 0.3));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /** One tree, drawn from its own seed. `sway` is the shared wind, 0..1. */
  function drawTree(ctx, tree, w, h, t, wind) {
    const bx = tree.x * w;
    const by = tree.y * h;
    const th = tree.h * h;
    const bend = Math.sin(t * 0.52 + tree.ph) * tree.amp * wind * w * 0.012
      + Math.sin(t * 1.31 + tree.ph * 1.4) * tree.amp * wind * w * 0.004;
    const topX = bx + bend;
    const topY = by - th;
    const trunkW = Math.max(2.2, tree.trunk * w);

    ctx.save();
    if (tree.blur) ctx.filter = 'blur(' + tree.blur.toFixed(1) + 'px)';
    ctx.globalAlpha = tree.alpha;

    // trunk: two edges that curve with the bend, so the whole tree leans
    ctx.fillStyle = 'rgb(38,40,34)';
    ctx.beginPath();
    ctx.moveTo(bx - trunkW, by);
    ctx.quadraticCurveTo(bx - trunkW * 0.5 + bend * 0.5, (by + topY) * 0.5, topX - trunkW * 0.35, topY + th * 0.34);
    ctx.lineTo(topX + trunkW * 0.35, topY + th * 0.34);
    ctx.quadraticCurveTo(bx + trunkW * 0.5 + bend * 0.5, (by + topY) * 0.5, bx + trunkW, by);
    ctx.closePath();
    ctx.fill();

    // three or four limbs, each carrying part of the canopy
    const limbs = 4;
    for (let i = 0; i < limbs; i++) {
      const f = (i + 1) / (limbs + 1);
      const ly = topY + th * 0.34 + (by - topY - th * 0.34) * f * 0.62;
      const dir = i % 2 === 0 ? -1 : 1;
      const reach = tree.cw * w * (0.7 + rnd(i + 31) * 0.5);
      ctx.strokeStyle = 'rgb(40,43,36)';
      ctx.lineWidth = Math.max(1.4, trunkW * (0.55 - f * 0.3));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + bend * (0.4 + f * 0.4), ly);
      ctx.quadraticCurveTo(
        bx + dir * reach * 0.55,
        ly - th * 0.05,
        bx + dir * reach + bend * 0.9,
        ly - th * (0.10 + rnd(i + 71) * 0.12),
      );
      ctx.stroke();
    }

    // canopy
    const cx = topX;
    const cy = topY + th * 0.16;
    for (let i = 0; i < tree.leaves.length; i++) {
      const leaf = tree.leaves[i];
      const flutter = Math.sin(t * 2.4 + leaf.ph) * wind * (2.2 * tree.amp)
        + Math.sin(t * 5.1 + leaf.ph * 1.7) * wind * 0.9;
      const lx = cx + leaf.ox * w + flutter;
      const ly = cy + leaf.oy * h + Math.cos(t * 1.9 + leaf.ph) * wind * 1.6 * tree.amp;
      const lr = leaf.r * w * (0.55 + tree.lit * 0.55);
      // Lit leaves live on the sky side of the crown, dark ones underneath.
      const upward = (cy - ly) / Math.max(1, tree.ch * h);
      const lit = Math.max(0, Math.min(1, 0.25 + upward * 0.85)) * tree.lit;
      ctx.fillStyle = leafColor(leaf.tone, lit);
      ctx.beginPath();
      ctx.ellipse(lx, ly, lr, lr * (0.5 + leaf.tone * 0.28), leaf.rot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function paint(ctx, st, t) {
    const w = st.w;
    const h = st.h;
    const g = gustAt(t);
    const lean = 0.14 + g * 0.34;

    // ---- sky ----------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, w * 0.15, h);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.42, SKY_HI);
    sky.addColorStop(0.78, SKY_LOW);
    sky.addColorStop(1, '#c9d2c9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // the bright break in the cloud the light comes through
    const sun = ctx.createRadialGradient(w * 0.63, h * 0.14, 0, w * 0.63, h * 0.14, Math.max(w, h) * 0.55);
    sun.addColorStop(0, 'rgba(255,252,240,0.55)');
    sun.addColorStop(0.45, 'rgba(246,246,236,0.18)');
    sun.addColorStop(1, 'rgba(246,246,236,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    // ---- far treeline (depth by desaturation + blur, never by fog) ----------
    ctx.save();
    ctx.filter = 'blur(' + Math.max(2.5, h * 0.008).toFixed(1) + 'px)';
    ctx.fillStyle = 'rgba(112,128,124,0.30)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.05, h);
    for (let i = 0; i < st.line.length; i++) {
      const c = st.line[i];
      const cx = c.x * w;
      const cy = c.y * h;
      const r = c.r * w;
      ctx.lineTo(cx - r, h);
      ctx.quadraticCurveTo(cx - r * 0.5, cy, cx, cy);
      ctx.quadraticCurveTo(cx + r * 0.5, cy, cx + r, h);
    }
    ctx.lineTo(w * 1.05, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ---- mid ground / hedge --------------------------------------------------
    const ground = ctx.createLinearGradient(0, h * 0.82, 0, h);
    ground.addColorStop(0, 'rgba(58,72,58,0)');
    ground.addColorStop(0.35, 'rgba(44,58,46,0.55)');
    ground.addColorStop(1, 'rgba(26,36,30,0.85)');
    ctx.fillStyle = ground;
    ctx.fillRect(0, h * 0.82, w, h * 0.18);

    // ---- trees --------------------------------------------------------------
    for (let i = 0; i < st.trees.length; i++) {
      drawTree(ctx, st.trees[i], w, h, t, g);
    }

    // ---- rain in the air ----------------------------------------------------
    // Two passes: the bright one that reads against the sky, and a softer, wider
    // one that reads against the dark leaves.
    for (let pass = 0; pass < 2; pass++) {
      const bright = pass === 0;
      ctx.lineCap = 'round';
      for (let i = 0; i < st.rain.length; i++) {
        const d = st.rain[i];
        if (bright !== d.z > 0.55) continue;
        d.y += (0.5 + d.z * 1.5) * 0.017;
        d.x += lean * 0.017 * (0.35 + d.z);
        if (d.y > 1.08) { d.y = -0.08; d.x = rnd(i * 3 + Math.floor(t * 2)) * 1.12 - 0.06; }
        if (d.x > 1.08) d.x -= 1.16;
        const len = d.len * h * (0.7 + d.z * 1.8);
        const px = d.x * w;
        const py = d.y * h;
        ctx.strokeStyle = bright
          ? 'rgba(238,246,250,' + (0.10 + d.z * 0.22).toFixed(3) + ')'
          : 'rgba(210,224,226,' + (0.05 + d.z * 0.10).toFixed(3) + ')';
        ctx.lineWidth = bright ? 0.8 + d.z * 1.2 : 1.6 + d.z * 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - lean * len * 1.6, py - len);
        ctx.stroke();
      }
    }

    // ---- leaves in the wind -------------------------------------------------
    for (let i = 0; i < st.blown.length; i++) {
      const b = st.blown[i];
      b.x += (0.004 + g * 0.010) * 0.9;
      b.y += Math.sin(t * 1.3 + b.ph) * 0.0016 - 0.0006;
      if (b.x > 1.08) { b.x = -0.08; b.y = 0.08 + rnd(i + Math.floor(t)) * 0.6; }
      ctx.save();
      ctx.translate(b.x * w, b.y * h);
      ctx.rotate(Math.sin(t * 2.1 + b.ph) * 0.9 + b.v * 8);
      ctx.fillStyle = 'rgba(38,56,40,0.75)';
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r, b.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- water on the glass -------------------------------------------------
    for (let i = 0; i < st.streaks.length; i++) {
      const s = st.streaks[i];
      // pause-and-go: a real run on glass stalls, then slides
      s.pause += 0.016;
      if (s.pause > 1.4 + rnd(i) * 2.6) s.pause = 0;
      if (s.pause < 0.5) {
        s.y += s.v * 0.016 * (0.4 + g);
        s.x += Math.sin(t * 0.9 + s.wob) * 0.00035;
      }
      if (s.y > 1.05) { s.y = -0.05; s.x = rnd(i * 7 + Math.floor(t)) * 0.98 + 0.01; }
      const px = s.x * w;
      const py = s.y * h;
      const tail = ctx.createLinearGradient(px, py - s.trail, px, py);
      tail.addColorStop(0, 'rgba(236,246,248,0)');
      tail.addColorStop(1, 'rgba(236,246,248,0.16)');
      ctx.strokeStyle = tail;
      ctx.lineWidth = Math.max(0.8, s.r * 0.7);
      ctx.beginPath();
      ctx.moveTo(px, py - s.trail);
      ctx.lineTo(px, py);
      ctx.stroke();
      // the head of the run: a bead with a highlight
      ctx.fillStyle = 'rgba(244,250,252,0.34)';
      ctx.beginPath();
      ctx.ellipse(px, py, s.r * 1.25, s.r * 1.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.arc(px - s.r * 0.3, py - s.r * 0.45, Math.max(0.5, s.r * 0.42), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < st.beads.length; i++) {
      const b = st.beads[i];
      const px = b.x * w;
      const py = b.y * h;
      const rr = b.r * (0.9 + Math.sin(t * 0.7 + b.ph) * 0.1);
      const dg = ctx.createRadialGradient(px, py, 0, px, py, rr * 2.4);
      dg.addColorStop(0, 'rgba(255,255,255,0.34)');
      dg.addColorStop(0.5, 'rgba(230,240,242,0.12)');
      dg.addColorStop(1, 'rgba(230,240,242,0)');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(px, py, rr * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(px - rr * 0.35, py - rr * 0.4, Math.max(0.5, rr * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- the pane itself ----------------------------------------------------
    // Two soft diagonal bands (glass catching the sky) and a very light edge
    // darkening. The middle is never dimmed: that was the "night behind a filter"
    // look the writer rejected.
    const gl1 = ctx.createLinearGradient(w * 0.05, 0, w * 0.58, h);
    gl1.addColorStop(0, 'rgba(255,255,255,0.12)');
    gl1.addColorStop(0.4, 'rgba(255,255,255,0.03)');
    gl1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl1;
    ctx.fillRect(0, 0, w, h);

    const gl2 = ctx.createLinearGradient(w, h * 0.1, w * 0.4, h * 0.9);
    gl2.addColorStop(0, 'rgba(240,248,252,0.10)');
    gl2.addColorStop(0.55, 'rgba(240,248,252,0)');
    ctx.fillStyle = gl2;
    ctx.fillRect(0, 0, w, h);

    const vig = ctx.createRadialGradient(
      w * 0.5, h * 0.5, Math.min(w, h) * 0.42,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.82,
    );
    vig.addColorStop(0, 'rgba(12,18,18,0)');
    vig.addColorStop(1, 'rgba(12,18,18,0.14)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // ---- the desk ------------------------------------------------------------
    // The sheet lies on a desk, and the desk is the one thing in the room the
    // writer touches, so the paper needs it under its front edge or the sheet
    // reads as floating on the weather. Drawn last: it is inside the room, so it
    // occludes the window, the rain and the glass water below the sill line.
    // Slate, not wood — 不要木头材质和颜色 — a dark grey surface with a cool
    // sheen from the pane and a warm shadow where the paper sits.
    const deskTop = h - Math.max(56, Math.min(104, h * 0.115));
    const desk = ctx.createLinearGradient(0, deskTop, 0, h);
    desk.addColorStop(0, '#4a4a45');
    desk.addColorStop(0.18, '#3e3e39');
    desk.addColorStop(0.62, '#31312d');
    desk.addColorStop(1, '#262624');
    ctx.fillStyle = desk;
    ctx.fillRect(0, deskTop, w, h - deskTop);

    // the sill line: a hairline of light where the desk catches the pane
    const sill = ctx.createLinearGradient(0, deskTop - 2, 0, deskTop + 6);
    sill.addColorStop(0, 'rgba(226,236,236,0)');
    sill.addColorStop(0.4, 'rgba(226,236,236,0.20)');
    sill.addColorStop(1, 'rgba(226,236,236,0)');
    ctx.fillStyle = sill;
    ctx.fillRect(0, deskTop - 2, w, 8);

    // cool daylight lying on the desk, brighter on the side the light comes from
    const sheen = ctx.createLinearGradient(0, deskTop, w, h);
    sheen.addColorStop(0, 'rgba(206,222,226,0.10)');
    sheen.addColorStop(0.45, 'rgba(206,222,226,0.03)');
    sheen.addColorStop(1, 'rgba(206,222,226,0.07)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, deskTop, w, h - deskTop);

    // and the shadow the sheet throws onto it (the sheet itself is DOM, above)
    const under = ctx.createRadialGradient(w * 0.5, deskTop + 4, w * 0.1, w * 0.5, deskTop + 4, w * 0.46);
    under.addColorStop(0, 'rgba(0,0,0,0.34)');
    under.addColorStop(0.6, 'rgba(0,0,0,0.16)');
    under.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = under;
    ctx.fillRect(0, deskTop, w, h - deskTop);
  }

  function create(canvas, seed) {
    return build(canvas.width, canvas.height, seed || 7);
  }

  /**
   * NW.Scene — the window behind the paper. Props:
   *   running: boolean   (false → nothing animates)
   *   seed?:   number   (canvas fallback only)
   *   video?:  boolean  (false → always use the canvas fallback)
   *
   * R165 (second pass): the writer said the built trees were 不像真实. A canvas
   * can fake weather, it cannot photograph it — so the window is now a real
   * clip: ten seconds of rain running down glass with green trees behind it,
   * ping-ponged so the loop has no cut, served by the host as
   * `assets/rain-window.mp4` (GET novel-writer/api/scene.video, byte ranges).
   * The canvas renderer survives as the fallback: a host without the asset, a
   * browser that refuses to decode H.264, or `settings.scene` on an older
   * profile all still get a window instead of a white hole.
   *
   * Brightness: the source is a rainy afternoon, not a night. A light lift
   * (`filter`) plus one soft sky highlight keeps the paper the brightest thing
   * on screen — 光线不要太暗 — while the glass stays readable as glass.
   */
  NW.Scene = function Scene(props) {
    const running = props && props.running !== false;
    const wantVideo = !(props && props.video === false);
    const farRef = React.useRef(null);
    const glassRef = React.useRef(null);
    const [failed, setFailed] = React.useState(!wantVideo);
    const [glassOn, setGlassOn] = React.useState(true);

    const urls = React.useMemo(() => {
      if (!wantVideo) return { far: '', glass: '' };
      try {
        const make = typeof NW.apiUrl === 'function' ? NW.apiUrl : () => '';
        return { far: make('scene.forest'), glass: make('scene.video') };
      } catch (error) {
        return { far: '', glass: '' };
      }
    }, [wantVideo]);

    React.useEffect(() => {
      if (!urls.far) {
        setFailed(true);
        return undefined;
      }
      const far = farRef.current;
      const glass = glassRef.current;
      if (!far) {
        setFailed(true);
        return undefined;
      }
      const cleanups = [];
      const play = (el, onFail) => {
        if (!el) return;
        // `muted` must already be a property before play() on every Chromium
        // build; the React prop alone can arrive one frame too late.
        el.muted = true;
        el.volume = 0;
        if (onFail) el.addEventListener('error', onFail);
        const attempt = el.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(onFail || (() => {}));
      };
      play(far, () => setFailed(true));
      play(glass, () => setGlassOn(false));
      const onHide = () => {
        const els = [far, glass].filter(Boolean);
        if (document.hidden) {
          els.forEach((el) => {
            try { el.pause(); } catch (error) { /* ignore */ }
          });
        } else if (running) {
          els.forEach((el) => {
            const again = el.play();
            if (again && typeof again.catch === 'function') again.catch(() => {});
          });
        }
      };
      document.addEventListener('visibilitychange', onHide);
      cleanups.push(() => document.removeEventListener('visibilitychange', onHide));
      return () => cleanups.forEach((fn) => fn());
    }, [urls.far, urls.glass, running]);

    if (failed) {
      return h(
        'div',
        { className: 'nw-scene', 'data-mode': 'canvas', 'aria-hidden': 'true' },
        h(SceneCanvas, { running: running, seed: props && props.seed }),
      );
    }

    return h(
      'div',
      { className: 'nw-scene', 'data-mode': 'video', 'aria-hidden': 'true' },
      h('video', {
        ref: farRef,
        className: 'nw-scene-far',
        src: urls.far || undefined,
        autoPlay: true,
        loop: true,
        muted: true,
        playsInline: true,
        preload: 'auto',
        tabIndex: -1,
        disablePictureInPicture: true,
        disableRemotePlayback: true,
      }),
      glassOn
        ? h('video', {
            ref: glassRef,
            className: 'nw-scene-glass',
            src: urls.glass || undefined,
            autoPlay: true,
            loop: true,
            muted: true,
            playsInline: true,
            preload: 'auto',
            tabIndex: -1,
            disablePictureInPicture: true,
            disableRemotePlayback: true,
          })
        : null,
      h('div', { className: 'nw-scene-air', 'aria-hidden': 'true' }),
      h('div', { className: 'nw-scene-desk', 'aria-hidden': 'true' }),
      h(SceneProps, null),
    );
  };

  /* ============================================================ the desk ====
     Everything that makes the grey band a desk instead of a gradient: a warm
     pool from the lamp that is off to the right, a pen lying where you put it
     down, a mug at the edge of the crop. Painted once into a small canvas —
     static by design, so it costs nothing per frame and never twitches. */
  function paintDesk(ctx, w, h) {
    if (!(w > 8) || !(h > 8)) return;

    // ---- lamp pool -------------------------------------------------------
    // Off-canvas lamp at the upper right: a wide, very soft warm blob that only
    // ever brightens; it must never add a visible edge of its own.
    // Kept deliberately weak and pushed off the corner: a lamp that lights the
    // whole sheet is just a yellow wash, and the words have to stay the darkest
    // thing on screen.
    const lamp = ctx.createRadialGradient(w * 0.95, -h * 0.75, 0, w * 0.95, -h * 0.75, Math.max(w * 0.44, h * 1.6));
    lamp.addColorStop(0, 'rgba(255,214,152,.17)');
    lamp.addColorStop(0.40, 'rgba(255,206,142,.07)');
    lamp.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, w, h);

    // ---- grain -----------------------------------------------------------
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = 'rgba(226,232,226,.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const y = h * (0.16 + (i / 26) * 0.78);
      const x0 = (i % 3) * 40;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(w - ((i * 37) % 120), y + (i % 2 ? 0.6 : -0.6));
      ctx.stroke();
    }
    ctx.restore();

    // ---- the mug, cropped by the right edge ------------------------------
    const mx = w - 26;
    const my = h - 26;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    const mug = ctx.createLinearGradient(mx - 46, 0, mx + 46, 0);
    mug.addColorStop(0, '#3a4340');
    mug.addColorStop(0.44, '#59635d');
    mug.addColorStop(0.72, '#46504b');
    mug.addColorStop(1, '#2c3331');
    ctx.fillStyle = mug;
    ctx.beginPath();
    ctx.ellipse(mx, my - 34, 48, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(mx - 48, my - 34, 96, 46);
    ctx.restore();
    // rim, and the tea line just under it
    ctx.strokeStyle = 'rgba(214,226,220,.42)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(mx, my - 34, 48, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(198,150,96,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(mx, my - 31, 42, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    // a thread of steam, because it is raining outside
    ctx.strokeStyle = 'rgba(232,238,234,.13)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - 8, my - 50);
    ctx.bezierCurveTo(mx - 16, my - 70, mx + 6, my - 84, mx - 2, my - 108);
    ctx.stroke();

    // ---- the pen ---------------------------------------------------------
    // Lying at a slight angle to the right of the sheet's foot, nib towards the
    // words: the one object that says "somebody just stopped writing here".
    const px = w - 250;
    const py = h - 44;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.12);
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    const body = ctx.createLinearGradient(0, -5, 0, 5);
    body.addColorStop(0, '#4b5450');
    body.addColorStop(0.35, '#232927');
    body.addColorStop(0.72, '#171b1a');
    body.addColorStop(1, '#3a423e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-78, -4.6);
    ctx.lineTo(52, -4.6);
    ctx.quadraticCurveTo(64, -4.6, 66, 0);
    ctx.quadraticCurveTo(64, 4.6, 52, 4.6);
    ctx.lineTo(-78, 4.6);
    ctx.quadraticCurveTo(-86, 4.6, -86, 0);
    ctx.quadraticCurveTo(-86, -4.6, -78, -4.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // brass band + clip (outside the shadow pass so they stay crisp)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.12);
    const brass = ctx.createLinearGradient(0, -4, 0, 4);
    brass.addColorStop(0, '#d8b26a');
    brass.addColorStop(0.5, '#9c7a34');
    brass.addColorStop(1, '#6d5220');
    ctx.fillStyle = brass;
    ctx.fillRect(30, -4.8, 7, 9.6);
    ctx.strokeStyle = 'rgba(216,180,110,.75)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(40, -4.2);
    ctx.lineTo(74, -4.2);
    ctx.quadraticCurveTo(80, -4.2, 80, -0.4);
    ctx.lineTo(80, -0.4);
    ctx.stroke();
    // one clean specular line along the barrel
    ctx.strokeStyle = 'rgba(255,255,255,.17)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-64, -2.1);
    ctx.lineTo(46, -2.1);
    ctx.stroke();
    ctx.restore();
  }

  /** Static desk props: lamp pool, mug, pen. Repaints only when resized. */
  function SceneProps() {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const canvas = ref.current;
      if (!canvas) return undefined;
      const paint = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        paintDesk(ctx, w, h);
      };
      paint();
      if (typeof ResizeObserver !== 'function') return undefined;
      const ro = new ResizeObserver(paint);
      ro.observe(canvas);
      return () => ro.disconnect();
    }, []);
    return h('canvas', { ref, className: 'nw-scene-props', 'aria-hidden': 'true' });
  }

  /**
   * NW.Scene fallback renderer — canvas + loop. Props:
   *   running: boolean   (false → the loop stops and the last frame stays)
   *   seed?:   number
   * The component owns its own sizing so a resize never needs a React re-render
   * of the editor's manuscript.
   */
  function SceneCanvas(props) {
    const canvasRef = React.useRef(null);
    const stateRef = React.useRef(null);
    const rafRef = React.useRef(0);
    const running = props && props.running !== false;
    const seed = (props && props.seed) || 7;

    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      const ctx = canvas.getContext('2d');
      const host = canvas.parentElement || canvas;
      let stopped = false;
      let last = 0;

      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = host.getBoundingClientRect();
        const w = Math.max(240, Math.round(rect.width));
        const h = Math.max(200, Math.round(rect.height));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        stateRef.current = create({ width: w, height: h }, seed);
      };

      resize();
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(host);

      const step = (now) => {
        if (stopped) return;
        rafRef.current = requestAnimationFrame(step);
        // ~30fps: rain does not need 60, and this loop shares a thread with the
        // textarea's own measurement passes.
        if (now - last < 32) return;
        last = now;
        const st = stateRef.current;
        if (!st) return;
        paint(ctx, st, now / 1000);
      };

      if (running) rafRef.current = requestAnimationFrame(step);

      const onHide = () => {
        if (document.hidden) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        } else if (running && !rafRef.current && !stopped) {
          last = 0;
          rafRef.current = requestAnimationFrame(step);
        }
      };
      document.addEventListener('visibilitychange', onHide);

      return () => {
        stopped = true;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        if (ro) ro.disconnect();
        document.removeEventListener('visibilitychange', onHide);
      };
    }, [running, seed]);

    return h('canvas', {
      ref: canvasRef,
      className: 'nw-scene-canvas',
      'aria-hidden': 'true',
    });
  }

  NW.CSS_PARTS.push(`
/* ================================================================ 窗外 ====
   One pane, no frame: the glass is the whole writing column, so the tree line
   and the rain are never interrupted by a mullion. The paper sits on top of it. */
.nw-scene{
  position:absolute;inset:0;width:100%;height:100%;
  display:block;z-index:0;pointer-events:none;overflow:hidden;
  background:#b9c9cd;
}
.nw-scene-far,
.nw-scene-glass,
.nw-scene-canvas{
  position:absolute;inset:0;display:block;width:100%;height:100%;
  object-fit:cover;pointer-events:none;
}
/* 窗外：真实的树，真实的风。A rainy afternoon, not a night: lift the clip
   toward the paper's own value so the glass reads as daylight behind it. */
.nw-scene-far{
  filter:brightness(1.06) saturate(1.1) contrast(1.03);
  transform:scale(1.04);
}
/* 玻璃：rain running down the pane, screened over the forest. Screen keeps the
   droplets (bright) and drops the clip's own背景, so the trees stay visible
   through the water instead of being covered by it. */
.nw-scene-glass{
  mix-blend-mode:screen;
  opacity:.66;
  filter:brightness(1.14) contrast(1.06);
  transform:scale(1.07);
}
/* One sky reflection on the glass and only a whisper of edge darkening: the
   pane must stay transparent, the paper must stay the brightest thing here. */
.nw-scene-air{
  position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(120% 90% at 16% 2%, rgba(255,255,255,.17) 0%, rgba(255,255,255,.05) 44%, rgba(255,255,255,0) 72%),
    linear-gradient(180deg, rgba(6,10,10,.09) 0%, rgba(6,10,10,0) 20%, rgba(6,10,10,0) 76%, rgba(6,10,10,.13) 100%);
}
/* The sill the paper stands on: slate, no wood, never lighter than the glass.
   It has to be nearly opaque, or the droplets keep showing through and the
   sheet reads as pasted onto the weather instead of lying on a desk. The far
   edge catches the window light; the near edge falls away into shadow. */
.nw-scene-desk{
  position:absolute;left:0;right:0;bottom:0;height:186px;pointer-events:none;
  background:
    linear-gradient(180deg, rgba(48,56,53,.62) 0%, rgba(33,37,35,.95) 12%, rgba(28,31,30,.99) 46%, rgba(19,22,21,1) 100%),
    radial-gradient(120% 60% at 50% 0%, rgba(196,212,206,.20), rgba(196,212,206,0) 62%);
}
.nw-scene-desk::before{
  content:'';position:absolute;left:0;right:0;top:0;height:1px;
  background:linear-gradient(90deg, rgba(214,226,220,0) 0%, rgba(214,226,220,.34) 18%, rgba(214,226,220,.42) 50%, rgba(214,226,220,.30) 82%, rgba(214,226,220,0) 100%);
}
.nw-scene-desk::after{
  content:'';position:absolute;left:0;right:0;top:1px;height:26px;
  background:linear-gradient(180deg, rgba(170,186,180,.10), rgba(170,186,180,0));
}
/* The desk props (lamp pool, mug, pen) are painted into this canvas, which sits
   above the desk band and below the sheet. */
.nw-scene-props{
  position:absolute;left:0;right:0;bottom:0;width:100%;height:214px;
  pointer-events:none;
}
/* With the window behind it the surface itself must stop painting a wall. */
.nw-surface[data-scene="1"]{background:transparent;}
.nw-surface[data-scene="1"] .nw-scroll{background:transparent;}
`);
})();
