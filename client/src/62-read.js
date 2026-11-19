;(() => {
  'use strict';

  // ============================================================== 读一遍 =====
  //
  // 写作的时候人是贴着字看的，所以只看得见句子；只有把整篇拉远、变成书页、
  // 一页一页翻过去，才看得见「这是一篇小说」。
  //
  // 这个视图就是那段距离：整本书铺成纸，没有光标、没有工具栏、没有章节树，
  // 只有正文、页码和翻页。
  //
  // 实现要点
  //   * 分页用 CSS 多栏（`column-width` + `column-fill:auto`）在固定高度的
  //     滚动容器里横向溢出，翻页只是改 `scrollLeft` —— 不引入任何排版依赖，
  //     也不预先把正文切成「页」，所以窗口一改宽度就自然重排。
  //   * 栏宽与字号沿用写作设置（settings.pageWidth 之外的 fontSize/lineHeight）
  //     ，读的时候行宽与写作时一致，不会突然变成另一种版面。
  //   * 打开时先跳到当前章节所在的那一页；Esc / 关闭按钮回到写作，编辑器的
  //     选区与滚动位置原封不动（这是一个覆盖层，编辑器从未被卸载）。
  // ========================================================================

  const THEME_KEYS = { claude: 1, eye: 1, night: 1, newspaper: 1, magazine: 1 };

  // 与 60-editor.js 的占位判定保持一致：占位标题不进书页，否则每章顶上都会
  // 出现一行「新章节」。
  const PLACEHOLDER_TITLES = { 新章节: 1, 未命名: 1, 未命名章节: 1, 正文: 1, 无题: 1, 内容: 1 };
  const PLACEHOLDER_RE = /^(?:新章节|未命名章节?)\s*\d*$|^第\s*[0-9零一二三四五六七八九十百]+\s*[章节回卷幕]$/;

  function isPlaceholderTitle(title) {
    const raw = String(title == null ? '' : title).trim();
    if (!raw) return true;
    if (PLACEHOLDER_TITLES[raw]) return true;
    return PLACEHOLDER_RE.test(raw);
  }

  function numOf(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clampNum(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /**
   * 正文 → 段落。
   *
   * 作者用换行分段，所以一行一段。行首的手工缩进（含全角空格）去掉，缩进改由
   * CSS 的 `text-indent` 统一给 —— 否则排版过的稿子会缩进两次。
   *
   * 空行不当段落（段距由段落 margin 负责，留着空行会把段距翻倍），但也不能
   * 直接丢掉：中文长篇里空行常常就是「场景换了」的唯一标记，抹掉它整章会塌成
   * 一片。所以空行只转成下一段的 `gap`，由 CSS 加一份额外段距。
   *
   * 每段还带 `start`：这段第一个字在章节全文里的字符下标。标注是按全文
   * 下标存的，所以读视图要知道每段从哪儿开始，才能把标注画到对的地方。
   */
  function paragraphsOf(text) {
    const out = [];
    const raw = String(text == null ? '' : text);
    const lines = raw.split(/\r\n|\r|\n/);
    let blank = 0;
    let pos = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      // R81: advance by the *actual* delimiter. The old `+ 1` assumed LF, so a
      // chapter imported with CRLF pushed every following paragraph one character
      // too far and took its annotations with it.
      const nextChar = raw[pos + line.length];
      const delimiter = nextChar === '\r' && raw[pos + line.length + 1] === '\n' ? 2 : nextChar ? 1 : 0;
      const after = pos + line.length + delimiter;
      if (!trimmed) {
        blank += 1;
        pos = after;
        continue;
      }
      // 第一段前面的空行没有意义（正文开头本来就留白）。
      out.push({
        text: trimmed,
        gap: out.length > 0 && blank > 0,
        start: pos + (line.length - line.trimStart().length),
      });
      blank = 0;
      pos = after;
    }
    return out;
  }

  /**
   * 把一段文字按标注切开。
   *
   * 标注只能画在字的下面，不能改字，所以这里只负责把段落拆成「普通文本 +
   * 带 class 的 span」，段落的文字内容一个字都不少。
   */
  function splitByMarks(para, marks) {
    const start = para.start;
    const end = start + para.text.length;
    const hits = [];
    for (let i = 0; i < marks.length; i += 1) {
      const m = marks[i];
      const s = Math.max(start, Number(m.start) || 0);
      const e = Math.min(end, Number(m.end) || 0);
      // A mark may cross a paragraph break; each paragraph then gets its own
      // piece. R53: the little comment badge no longer lives inside the text —
      // it moved to the page margin (`paintGutter`), so a paragraph is only cut
      // into plain runs of marked / unmarked words here.
      if (e > s) {
        hits.push({
          s: s - start,
          e: e - start,
          kind: m.kind,
          id: m.id,
        });
      }
    }
    if (!hits.length) return para.text;
    hits.sort((a, b) => a.s - b.s || a.e - b.e);
    const out = [];
    let pos = 0;
    for (let i = 0; i < hits.length; i += 1) {
      const m = hits[i];
      const s = Math.max(pos, m.s);
      if (m.e <= s) continue;
      if (s > pos) out.push(para.text.slice(pos, s));
      out.push(
        h(
          'span',
          {
            className: 'nw-mark nw-mark-' + String(m.kind || 'underline'),
            key: 'm' + i + '-' + String(m.id),
            'data-mark': String(m.id),
          },
          para.text.slice(s, m.e),
        ),
      );
      pos = m.e;
    }
    if (pos < para.text.length) out.push(para.text.slice(pos));
    return out.length === 1 ? out[0] : out;
  }

  NW.CSS_PARTS.push(`
/* ---- 读一遍 -------------------------------------------------------------
   A printed journal, not a web reader. The reading view is a sheet of paper
   lying on a darker desk: a running head over each column, page numbers at the
   outer feet, and — only when the pane is wide enough to open like a book — a
   hairline crease down the middle. The manuscript is still paged by scrollLeft
   inside .nw-read-flow; measure() decides how wide a page is and everything
   below only draws around that box. Nothing here changes the manuscript. */
.nw-read{
  /* Paper and desk are both derived from the ink so every palette keeps the
     same reading: light themes put the page on a darker desk, night lifts the
     paper a hair instead of painting a white sheet into a dark room. */
  --nw-read-serif:"Songti SC","Noto Serif SC","Source Han Serif SC","Source Han Serif CN",STSong,SimSun,Georgia,"Times New Roman",serif;
  --nw-read-desk:color-mix(in srgb, var(--nw-fg) 11%, var(--nw-bg));
  --nw-read-paper:color-mix(in srgb, var(--nw-fg) 1.5%, var(--nw-bg));
  --nw-read-edge:color-mix(in srgb, var(--nw-fg) 10%, transparent);
  --nw-read-rule:color-mix(in srgb, var(--nw-fg) 22%, transparent);
  --nw-read-rule-soft:color-mix(in srgb, var(--nw-fg) 12%, transparent);
  --nw-read-muted:color-mix(in srgb, var(--nw-fg) 46%, var(--nw-read-paper));
  --nw-read-faint:color-mix(in srgb, var(--nw-fg) 68%, var(--nw-read-paper));
  --nw-read-spine:color-mix(in srgb, var(--nw-fg) 9%, transparent);
  /* The face of the leaf under the copy it carries: the paper seen in its
     own shadow, a hair lighter than the sheet so the lifted page reads as a
     separate sheet even before the shading goes on. */
  --nw-read-flip:color-mix(in srgb, var(--nw-fg) 3%, var(--nw-read-paper));
  --nw-read-sheet-pad:30px;
  --nw-read-gap:48px;
  /* R141：桌面的空气。纸的上下不再顶到视口边缘——一张摊在桌上的书，上边
     和左边右边一样，都该看得见桌面。这个值同时是纸的上下缩进、眉题与页脚
     的落位基准，所以只需改这一处。 */
  --nw-read-air:18px;
  /* The band the text columns live in: the stage pads the paper by these,
     and the turning leaf copies its columns in exactly this box.
     R141：加了 air 之后，版心要相应往下/往上让出天头地脚（纸顶到首行约 46px，
     纸底到末行约 40px），否则纸缩进多少，天头就薄多少，读起来像便签纸。 */
  --nw-read-band-top:64px;
  --nw-read-band-bottom:58px;
  position:absolute;inset:0;z-index:30;
  display:flex;flex-direction:column;
  /* R139：书桌不该有自己的滚动条。翻页流是「一列列排开、靠 scrollLeft 换页」，
     任何一级祖先露出滚动条都会把「这是网页」写在书页下面。 */
  overflow:hidden;
  /* R141：桌面不是一块平涂。一盏灯从上头打下来，桌子中间亮、四角暗；纸摊在
     这团光里，桌面才成为「桌子」而不是「背景色」。两层：一层从上方来的暖光，
     一层四角的压暗。都很轻（8% 以内），只在纸离开视口边之后才读得出来。 */
  /* R143：灯挪到了左上。原来那盏是正顶光（50% -14%），桌面各向等亮，于是纸
     摆在哪里都像悬在同一块背景色上，桌面没有「离灯多远」这件事。
     现在有一盏明确的灯：左上一小片暖亮，越往右下越沉，四角最先黑。纸的落影
     也随之偏右下——光和影必须同向，否则纸读成浮在图上，不读成压在桌上。 */
  background-color:var(--nw-read-desk);
  background-image:
    radial-gradient(76% 56% at 32% 4%, color-mix(in srgb, #fff 14%, transparent) 0, transparent 64%),
    radial-gradient(132% 112% at 42% 26%, transparent 28%, color-mix(in srgb, var(--nw-fg) 16%, transparent) 100%);
  color:var(--nw-fg);
  font-family:var(--nw-read-serif);
  font-size:var(--nw-fs-second);line-height:var(--nw-lh-base);
  animation:nw-fade-in var(--nw-dur, .18s) var(--nw-ease, cubic-bezier(.2,.7,.2,1)) both;
}
/* R137: 阅读是「把书摊在桌上」，桌子就是整块屏幕。
   .nw-root 带 container-type:inline-size（也就是布局隔离），布局隔离会让它
   成为 fixed 后代的包含块——所以只看下面 .nw-read 的 position:absolute 的话，
   书最多铺满插件那一列。开卷时把 .nw-root 自己提到 fixed inset:0，面板即
   视口，absolute 那层覆盖就正好铺满整屏。关闭阅读时这个类随 readOpen 一起
   撤掉，整个面板回到宿主给它分配的那一列，布局分毫不动。
   z-index 抬到 1000：宿主外壳的侧栏、工具条都在同一个视口里，书要压在最上面。 */
.nw-root.nw-reading{position:fixed;inset:0;z-index:1000;}
/* A dark room reads the other way round: the desk goes *below* the page. */
.nw-read[data-theme="night"]{
  --nw-read-desk:color-mix(in srgb, #000 46%, var(--nw-bg));
  --nw-read-paper:color-mix(in srgb, var(--nw-fg) 2.5%, var(--nw-bg));
  --nw-read-flip:color-mix(in srgb, var(--nw-fg) 7%, var(--nw-read-paper));
}
/* R144：夜里没有窗光，纸边不能变成发光包边。纸垛与两侧书口共用这四个
   变量；夜盘只换材料，不改几何——亮线压到 5%，缝与底面继续沉下去。 */
.nw-read[data-theme="night"] .nw-read-block{
  --nw-read-cut:color-mix(in srgb, var(--nw-read-paper) 58%, #000);
  --nw-read-cut-line:color-mix(in srgb, #000 34%, transparent);
  --nw-read-cut-light:color-mix(in srgb, #fff 5%, transparent);
  --nw-read-cut-shade:color-mix(in srgb, #000 46%, transparent);
  /* R148：夜里的沓沟不提亮——沟是压出来的，越压越沉。 */
  --nw-read-cut-deep:color-mix(in srgb, #000 40%, transparent);
}
.nw-read-bar{
  flex:0 0 auto;display:flex;align-items:center;gap:var(--nw-sp-3);
  padding:14px clamp(30px,7vw,84px) 0;
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  letter-spacing:.12em;color:var(--nw-read-muted);
}
.nw-read-bar-name{
  flex:1 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.nw-read-bar-close{
  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:var(--nw-h-iconbtn);height:var(--nw-h-iconbtn);
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-read-muted);cursor:pointer;padding:0;
}
.nw-read-bar-close:hover{color:var(--nw-fg);background:var(--nw-btn-hover);border-color:var(--nw-line-soft);}
/* R130：朗读。喇叭与它的设置是同一组，所以用一条 .nw-read-speakbar 包起来，
   设置浮层就挂在它下面——弹层贴着按钮，而不是贴着屏幕边。 */
.nw-read-speakbar{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;}
.nw-read-bar-btn{
  display:inline-flex;align-items:center;justify-content:center;
  width:var(--nw-h-iconbtn);height:var(--nw-h-iconbtn);
  border:1px solid transparent;border-radius:var(--nw-r-control);
  background:transparent;color:var(--nw-read-muted);cursor:pointer;padding:0;
}
.nw-read-bar-btn:hover{color:var(--nw-fg);background:var(--nw-btn-hover);border-color:var(--nw-line-soft);}
.nw-read-bar-btn[data-on="1"]{
  color:var(--nw-accent);background:color-mix(in srgb, var(--nw-accent) 10%, transparent);
  border-color:color-mix(in srgb, var(--nw-accent) 34%, transparent);
}
.nw-read-bar-btn[data-narrow="1"]{width:22px;}
.nw-read-speakmenu{
  position:absolute;top:calc(100% + 8px);right:0;z-index:9;
  width:268px;padding:12px;display:flex;flex-direction:column;gap:10px;
  background:var(--nw-read-paper);color:var(--nw-fg);
  border:1px solid var(--nw-read-rule-soft);border-radius:var(--nw-r-control);
  box-shadow:0 18px 40px -20px color-mix(in srgb, var(--nw-fg) 55%, transparent);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);letter-spacing:normal;
}
.nw-read-speakmenu-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.nw-read-speakmenu-label{flex:0 0 auto;color:var(--nw-read-muted);letter-spacing:.08em;}
.nw-read-speakmenu-chip{
  border:1px solid var(--nw-read-rule-soft);border-radius:999px;background:transparent;
  color:var(--nw-read-muted);font:inherit;font-size:11px;line-height:1;padding:5px 9px;cursor:pointer;
}
.nw-read-speakmenu-chip[data-on="1"]{
  color:var(--nw-accent);border-color:color-mix(in srgb, var(--nw-accent) 40%, transparent);
  background:color-mix(in srgb, var(--nw-accent) 10%, transparent);
}
.nw-read-speakmenu select{
  flex:1 1 auto;min-width:0;max-width:100%;
  font:inherit;font-size:11px;color:var(--nw-fg);
  background:var(--nw-read-paper);border:1px solid var(--nw-read-rule-soft);
  border-radius:var(--nw-r-control);padding:5px 6px;
}
.nw-read-speakmenu-note{color:var(--nw-read-faint);line-height:1.6;}
.nw-read-speakmenu-error{color:var(--nw-danger, #b3261e);}
/* 正在念的那一段：左侧一根短线把视线钉住，底色只到「能看出这一块是活的」为止。
   5% 是试出来的：8% 在正文里像被选中，2% 在夜theme下看不见。 */
.nw-read-p.is-speaking{
  background:color-mix(in srgb, var(--nw-accent) 5%, transparent);
  box-shadow:inset 2px 0 0 color-mix(in srgb, var(--nw-accent) 42%, transparent);
  border-radius:1px;
}
/* The stage is the desk. Its padding is the air above/below the paper — the
   running head and the feet live in it, so the text column starts below the
   rule and ends above the page number, and measure() only ever sees the flow. */
.nw-read-stage{
  position:relative;flex:1 1 auto;min-height:0;
  display:flex;justify-content:center;
  padding:var(--nw-read-band-top) clamp(30px,7vw,84px) var(--nw-read-band-bottom);
}
/* R144：一摞有体积的纸，而不是底下一条阴影。
   顶纸下面还有几百张纸：底缘露出 13px，左右书口各探出 8px。书口不是把底缘
   的密横纹绕一圈（窄条 + 高亮密线会读成金属包边），而是宽一点、线稀一点、
   对比低一点的弧面。外轮廓用很大的纵向椭圆半径收进去：两端贴着顶纸，中段
   才微微鼓出，像真书被摊开后页叠在书口形成的弧。
   底缘中央另压一团装订暗，左右有切面受光；接触影短而实，远影宽而淡。整摞
   不动、不进 measure()，两个伪元素也不接指针，翻页仍只动那张顶纸。 */
.nw-read-block{
  --nw-read-cut:color-mix(in srgb, var(--nw-read-paper) 95%, var(--nw-read-desk));
  --nw-read-cut-line:color-mix(in srgb, var(--nw-fg) 8%, transparent);
  --nw-read-cut-light:color-mix(in srgb, #fff 16%, transparent);
  --nw-read-cut-shade:color-mix(in srgb, #000 18%, transparent);
  /* R148：纸沓沟。均匀的 3.4px 横纹读成一把尺子；每隔十几张要有一条压得更实的
     深沟 + 一线受光，纸垛才是「一沓一沓」叠出来的，不是梳齿。 */
  --nw-read-cut-deep:color-mix(in srgb, var(--nw-fg) 13%, transparent);
  position:absolute;left:50%;
  top:calc(var(--nw-read-air, 18px) + 4px);
  bottom:calc(var(--nw-read-air, 18px) - 13px);
  width:calc(var(--nw-read-box, 680px) + var(--nw-read-sheet-pad) * 2);
  transform:translateX(-50%);
  border-radius:6px 6px 12px 12px / 4px 4px 8px 8px;
  background-color:var(--nw-read-cut);
  background-image:
    repeating-linear-gradient(to bottom,
      var(--nw-read-cut-light) 0 .7px,
      var(--nw-read-cut-line) .7px 1.4px,
      transparent 1.4px 3.4px),
    /* R148：一沓纸压出一条深沟，沟底补一线受光；每 13.4px 一组，叠在细纹之上。
       没有这层，几百张纸读不出「层」，只有均匀条纹。 */
    repeating-linear-gradient(to bottom,
      transparent 0 9.6px,
      var(--nw-read-cut-deep) 9.6px 11px,
      var(--nw-read-cut-light) 11px 11.7px,
      transparent 11.7px 13.4px),
    /* 装订线一直压到纸垛底面；不是浮在纸面上的一道装饰线。 */
    radial-gradient(18% 70px at 50% 100%,
      var(--nw-read-cut-shade) 0,
      transparent 76%),
    linear-gradient(to right,
      var(--nw-read-cut-shade) 0,
      transparent 2.2%, transparent 97.8%,
      var(--nw-read-cut-shade) 100%),
    linear-gradient(to bottom,
      transparent 58%,
      var(--nw-read-cut-shade) 100%);
  /* R148：厚度要读得出「层」。顶纸下面先给两道错层台阶——一沓比一沓暗一点、
     缩进一点，底缘才像逐沓垫起来的纸，而不是一块梯形色块。 */
  box-shadow:
    0 3px 0 -1px color-mix(in srgb, var(--nw-read-cut) 94%, #000),
    0 6px 0 -2px color-mix(in srgb, var(--nw-read-cut) 86%, #000),
    0 2px 1px color-mix(in srgb, #000 22%, transparent),
    0 10px 16px -8px color-mix(in srgb, #000 46%, transparent),
    0 28px 46px -22px color-mix(in srgb, #000 36%, transparent);
  pointer-events:none;z-index:0;
}
.nw-read-block::before,
.nw-read-block::after{
  content:'';position:absolute;top:2px;bottom:2px;width:11px;
  background-color:var(--nw-read-cut);
  box-shadow:
    inset 0 1px 1px var(--nw-read-cut-light),
    inset 0 -2px 3px var(--nw-read-cut-shade),
    0 5px 7px -6px color-mix(in srgb, #000 45%, transparent);
}
.nw-read-block::before{
  left:-8px;
  border-radius:64% 3px 6px 64% / 40% 7px 9px 40%;
  background-image:
    /* 左书口迎光，靠顶纸的那一指背光。亮面很宽，不做白色细边。 */
    linear-gradient(to right,
      var(--nw-read-cut-light) 0,
      transparent 44%,
      color-mix(in srgb, var(--nw-fg) 12%, transparent) 100%),
    /* R148：书口的沓沟比底缘稀一倍：每 22px 一组深沟+受光。 */
    repeating-linear-gradient(to bottom,
      transparent 0 16px,
      var(--nw-read-cut-deep) 16px 17.2px,
      var(--nw-read-cut-light) 17.2px 17.9px,
      transparent 17.9px 22px),
    repeating-linear-gradient(to bottom,
      transparent 0 3px,
      var(--nw-read-cut-line) 3px 3.65px,
      transparent 3.65px 5.8px),
    linear-gradient(to bottom,
      var(--nw-read-cut-shade) 0,
      transparent 4%, transparent 94%,
      var(--nw-read-cut-shade) 100%);
}
.nw-read-block::after{
  right:-8px;
  border-radius:3px 64% 64% 6px / 7px 40% 40% 9px;
  background-image:
    /* 右侧离灯远，外缘更暗；与左侧不是一张镜像贴纸。 */
    linear-gradient(to right,
      color-mix(in srgb, var(--nw-fg) 7%, transparent) 0,
      transparent 42%,
      color-mix(in srgb, var(--nw-fg) 16%, transparent) 100%),
    /* R148：书口的沓沟比底缘稀一倍：每 22px 一组深沟+受光。 */
    repeating-linear-gradient(to bottom,
      transparent 0 16px,
      var(--nw-read-cut-deep) 16px 17.2px,
      var(--nw-read-cut-light) 17.2px 17.9px,
      transparent 17.9px 22px),
    repeating-linear-gradient(to bottom,
      transparent 0 3px,
      var(--nw-read-cut-line) 3px 3.65px,
      transparent 3.65px 5.8px),
    linear-gradient(to bottom,
      var(--nw-read-cut-shade) 0,
      transparent 4%, transparent 94%,
      var(--nw-read-cut-shade) 100%);
}
/* The sheet of paper. Width follows the page box (one column, or two columns
   plus the gutter) and is written by measure() as --nw-read-box on the stage. */
.nw-read-sheet{
  /* R141：纸不再从视口顶边拉到视口底边。这里原来是 top:0;bottom:0，而
     absolute 的 0 对齐的是 stage 的 padding box，于是纸的上下沿正好压在视口
     边上，只有左右两侧看得见桌面——一张四周没有桌面的纸不像书，像网页的一
     块背景色。上下留出 --nw-read-air 之后，纸成了桌上的一个物件。 */
  position:absolute;top:var(--nw-read-air, 18px);bottom:var(--nw-read-air, 18px);
  left:50%;
  width:calc(var(--nw-read-box, 680px) + var(--nw-read-sheet-pad) * 2);
  transform:translateX(-50%);
  background-color:var(--nw-read-paper);
  /* R141：纸面终于有了材质。编辑页的 .nw-page 一直在用 --nw-texture（120px
     噪点），阅读页因为被 .nw-surface:not(.nw-read) 排除在外，纸是纯色的——
     一块干干净净的矩形。同一个变量接到纸上，两处纸张才是同一种纸。
     R143：纸面会弯。摊开的纸不是一块平板：它从书脊那侧被抬起来，鼓成一道
     极浅的弧，所以中间亮、贴装订线和贴外边的一指暗，上下两条边也各压一点。
     这四层很轻（2%~6%），轻到说不清画了什么，只说得出「这张纸不是平的」。
     弧度只能靠明暗说——轮廓一动就得 clip-path，而 clip-path 会把接触影连同
     纸的边一起裁掉（R140 的教训）。 */
  background-image:
    var(--nw-texture, none),
    linear-gradient(to right,
      color-mix(in srgb, var(--nw-fg) 8%, transparent) 0,
      color-mix(in srgb, #fff 3%, transparent) 2.4%,
      transparent 7%, transparent 94%,
      color-mix(in srgb, var(--nw-fg) 7%, transparent) 100%),
    linear-gradient(to bottom,
      color-mix(in srgb, var(--nw-fg) 5%, transparent) 0,
      transparent 2.4%, transparent 97.4%,
      color-mix(in srgb, var(--nw-fg) 4%, transparent) 100%),
    radial-gradient(58% 46% at 38% 30%,
      color-mix(in srgb, #fff 3.8%, transparent) 0,
      transparent 70%),
    /* R143：纸不是均匀受光的。灯在左上，纸的右下角离灯最远、又正被自己压出的
       影子扫到，那里再沉一点点。有了这一层，四角不再是四个一模一样的直角。 */
    radial-gradient(74% 62% at 86% 88%,
      transparent 44%,
      color-mix(in srgb, var(--nw-fg) 4%, transparent) 100%),
    /* R143：纸上有波。一张纸压在桌上不会完全平——靠书脊那条被缝线拽着，靠书
       口那条自己翘起一点点。落在明暗上就是一道很宽的亮带横在上三分之一，一
       道更宽的暗带压在下三分之一。两带都只有 2%，说不出画了什么，只说得出
       「这不是一块板」。 */
    linear-gradient(to bottom,
      transparent 6%,
      color-mix(in srgb, #fff 2.4%, transparent) 28%,
      transparent 44%,
      color-mix(in srgb, var(--nw-fg) 2.2%, transparent) 76%,
      transparent 95%);
  /* R148：纸不该有描边。这圈 1px 的 border 加上 crisp 内光把纸勾成了一张
     「卡片」——纸的边缘信息已经全在落影里（外缘接触影 + 纸垛错层），再描一圈
     实线只会把纸从书上「剪」下来。去掉 border，上下两条 1px 内光也一并撤掉，
     纸与纸垛由同一套明暗接在一起。 */
  border-radius:5px 5px 9px 9px / 3px 3px 6px 6px;
  /* 落影分三层：贴边的一道受光（纸的厚度）、纸垛与纸之间那道咬合的硬缝、以及
     投在桌面上的大而软的一团。底下那几页的错层已经交给 .nw-read-block 去画了
     —— 一圈 1px 的实色影撑不起几百张纸，只会让纸看着像叠了三张卡片。
     inset 的左右两道是纸枕下去的暗：纸一弯，贴桌的那两指就照不到灯。 */
  box-shadow:
    inset 9px 0 18px -12px color-mix(in srgb, var(--nw-fg) 20%, transparent),
    inset -9px 0 18px -12px color-mix(in srgb, var(--nw-fg) 20%, transparent),
    0 1px 0 color-mix(in srgb, #000 16%, transparent),
    7px 30px 66px -26px color-mix(in srgb, #000 42%, transparent);
  pointer-events:none;z-index:0;
}
/* The crease. No hairline: a printed 1px line down the middle of a book is the
   single thing that made the spread read as a table rather than as paper. What
   a real gutter does is darken — two leaves curving away from each other — so
   the crease is only the spine shadow below, with a very faint centre. */
/* R143：中缝不再是「一条影」，是两道坡。
   真书摊开时，两张纸在装订线那里一起往下塌，形成一个 V：紧贴装订线的两三
   毫米最暗，然后各自往外迅速爬升回纸面。原来一层 96px 的对称渐变把整条缝
   画成了一条匀称的暗带，看着像有人拿喷枪在纸上喷了一道。
   R150：中间那条 1px 亮线去掉了。真书的缝是暗的——两张纸在最低处一起塌下
   去，光进不来；那条白线是「画上去的一条线」，也正是用户说的「这条缝不真
   实」。现在只剩一道塌陷：6px 的锐核 + 220px 的柔坡，两侧纸面再靠 sheet 自
   己那两道内阴影压住，缝是「塌出来的」，不是「画出来的」。 */
.nw-read-spine{
  position:absolute;left:50%;top:var(--nw-read-air, 18px);bottom:var(--nw-read-air, 18px);
  width:170px;z-index:2;transform:translateX(-50%);pointer-events:none;
  /* R154：这道缝原来画在纸的 ::after 上——纸在 z-index 0、正文流在 1，
     于是它一直被正文盖着，屏幕上根本没有缝，只剩封面裁边的一道 1px 硬线。
     现在缝是舞台里一个真实的元素：压在正文之上（2）、纸之下（3），
     一定看得见，也一定不会被纸的滚动内容吃掉。 */
  background:
    radial-gradient(52% 100% at 50% 50%,
      color-mix(in srgb, #000 26%, transparent) 0,
      color-mix(in srgb, #000 15%, transparent) 26%,
      color-mix(in srgb, #000 5%, transparent) 62%,
      transparent 100%);
  -webkit-mask-image:linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent);
  mask-image:linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent);
}
/* The edge of the sheet, hung on the spine. z-index 3, not 2: the running heads
   and folios sit at 2 and later in the DOM, and a sheet that lets the page
   number print on top of it reads as a decal rather than as paper. */
.nw-read-flip{
  position:absolute;top:0;bottom:0;left:50%;z-index:3;
  width:calc(var(--nw-read-box, 680px) + var(--nw-read-sheet-pad) * 2);
  transform:translateX(-50%);
  /* R156: turn.js 的模型。整张纸是一个刚体平面，只绕书脊走完 180 度；纸的
     弧度和折线全靠纸面上的渐变画出来，不再用分段关节去拼。正交投影让纸
     转到哪儿都不变大变小，落点与书页严丝合缝。 */
  perspective:none;
  /* R156: 翻页层裁在书框里——turn.js 同样把纸放在 overflow:hidden 的书框
     内，所以纸永远不会越出书沿。裁剪必须在这一层：.nw-read-leaf 要保留
     preserve-3d，overflow 会把它压平，纸背就不见了。 */
  overflow:hidden;
  pointer-events:none;visibility:hidden;
}
.nw-read-flip[data-live="1"]{visibility:visible;}
/* R156: 一张真正的纸。整片只绕书脊转一个角度，正反两面各印一页；折线与
   纸背的明暗交给 .nw-read-shade。 */
.nw-read-leaf{
  position:absolute;width:calc(50% - .5px);z-index:2;
  /* 掀起来的是一整张纸，不是一条正文带：上下一直长到纸边，页脚就在纸的
     下边距里，跟着纸一起翻。 */
  top:var(--nw-read-air, 18px);bottom:var(--nw-read-air, 18px);
  background:transparent;
  transform-style:preserve-3d;
  backface-visibility:visible;
  will-change:transform;
  /* R156: 这里不能 overflow:hidden。overflow 会把 preserve-3d 压平，正反
     两面叠在一起，纸背就翻不出来；裁剪由外层的 .nw-read-flip 负责。 */
  transform:rotateY(0deg);
}
/* R156: 没有关节了。原来这里叠着十段 .nw-read-joint，每段一个转角伪造
   弧度；turn.js 的做法是整片刚体平面 + 一条渐变，段落全部删除。 */
/* 纸的两面：正面印着被掀走的那一页，背面印着翻到的那一页；各自 backface
   hidden，所以任何时刻只看得到朝向读者的那一面。
   面自己 overflow:hidden 同时裁掉副本：副本的宽度是整整一个对开，比这张
   半页纸宽得多——不裁的话，抬手时那半页字会悬在纸外面。 */
.nw-read-face{
  position:absolute;inset:0;overflow:hidden;
  backface-visibility:hidden;
  background-color:var(--nw-read-flip);
  background-image:
    var(--nw-texture, none),
    radial-gradient(90% 62% at 50% 46%,
      color-mix(in srgb, #fff 5%, transparent) 0,
      transparent 72%);
  box-shadow:none;
}
.nw-read-face[data-face="back"]{transform:rotateY(180deg);}
/* R159: 纸的自由边。两面同色同纹理，纸在空中原本只剩「字被压扁」这一条
   线索，看过去像整页在滑而不是一张纸在翻。真纸的切口会压出一道极窄的暗
   边：这里沿自由边画 1px 实线 + 24px 收进去的软影。自由边永远在折线的对
   侧，所以镜像规则与 .nw-read-shade 同源（回翻的正面、前翻与单栏的背面
   折线在右，暗边就翻到左边）。 */
.nw-read-face::after{
  content:'';position:absolute;top:0;bottom:0;right:0;width:24px;
  pointer-events:none;
  background:linear-gradient(to left,
    rgba(0,0,0,0.085) 0,
    rgba(0,0,0,0.085) 1px,
    rgba(0,0,0,0.032) 2px,
    rgba(0,0,0,0.012) 10px,
    rgba(0,0,0,0) 24px);
}
.nw-read-flip[data-dir="back"] .nw-read-face[data-face="front"]::after,
.nw-read-flip[data-dir="fwd"] .nw-read-face[data-face="back"]::after,
.nw-read-flip[data-single="1"] .nw-read-face[data-face="back"]::after{
  right:auto;left:0;
  background:linear-gradient(to right,
    rgba(0,0,0,0.085) 0,
    rgba(0,0,0,0.085) 1px,
    rgba(0,0,0,0.032) 2px,
    rgba(0,0,0,0.012) 10px,
    rgba(0,0,0,0) 24px);
}
/* 这一页自己的字：一份只读副本，栏宽/行高/字号与正文完全一致。
   R147：纸长到整页高了，副本仍只占正文带——上下按带的偏移内缩，分栏高度
   与舞台上的正文一字不差，否则列会被重新断开。 */
.nw-read-face .nw-read-copy{
  /* R158: 副本必须与 .nw-read-flow 用同一套字体度量。少任何一项，同一个字在
     纸上和纸下就会粗细、字距不同——用户一眼就看出来「字体不一样」。 */
  font-family:inherit;font-size:inherit;line-height:inherit;
  letter-spacing:inherit;word-spacing:inherit;font-weight:inherit;
  text-align:inherit;text-indent:inherit;
  position:absolute;
  top:calc(var(--nw-read-band-top, 64px) - var(--nw-read-air, 18px));
  bottom:calc(var(--nw-read-band-bottom, 58px) - var(--nw-read-air, 18px));
  width:var(--nw-read-box, 680px);
  height:auto; /* R156：全局 .nw-read-copy 是 height:100%，这里必须收回；否则副本比半页纸还高，底边被裁的行会画两遍。 */
}
/* 纸的下边距里印着这一页自己的页码与书名/章名。它和副本用同一个横向原点
   （--nw-foot-front / --nw-foot-back 由 armFlip 按这一趟翻页的方向写一次），
   纸在空中的时候，页码跟着纸走，不会再「消失」。 */
.nw-read-face-foot{
  position:absolute;bottom:16px;
  left:var(--nw-foot-front, 0);
  width:var(--nw-read-box, 680px);
  display:flex;align-items:baseline;gap:var(--nw-read-gap);
  color:var(--nw-read-muted);pointer-events:none;
}
.nw-read-face[data-face="back"] .nw-read-face-foot{left:var(--nw-foot-back, 0);}
/* R159：这里原本有一对 [data-dir="back"] 背面行内倒序（row-reverse），注释的
   理由是「背面横向镜像，两槽顺序要跟着镜像」。实测不是：纸背的可见窗口是靠
   拷贝的 left 位移选出来的（背面回翻时 --nw-foot-back 把行左移一个书脊），
   窗口本来就落在行的右段、自然取到右槽——再倒序一次反而让右页印出左槽的
   号码：回翻落到右半的第 2 页，纸上印的是 1。删掉倒序，四个朝向（前进正/背、
   回翻正/背）印出的都是纸带过来的那一页。 */
/* 单栏时只有右页那一个槽：把槽推到整页的右缘，和舞台上的页脚对齐。 */
.nw-read-face-foot[data-single="1"]{justify-content:flex-end;}
/* 天头的眉题也一样：纸现在是整张纸，眉毛落在纸的天头里；不复刻的话，纸一
   抬起来，原先画在舞台上、正被纸盖住的那条章名就跟着没了。 */
.nw-read-face-head{
  position:absolute;top:13px;
  left:var(--nw-foot-front, 0);
  width:var(--nw-read-box, 680px);height:22px;
  display:flex;gap:var(--nw-read-gap);
  pointer-events:none;
}
.nw-read-face[data-face="back"] .nw-read-face-head{left:var(--nw-foot-back, 0);}
/* R156: 纸的弧度。turn.js 不用分段几何，它把整张纸当一个平面，弧度靠一条
   贴在折线上的渐变画出来：正面从折线往里先是一道很窄的纸边亮光，紧挨着一
   道暗，再向自由边化开；背面只从折线往里压暗。渐变带宽度 = 纸宽 * sin(转角)，
   和 turn.js 的 gradientSize 同一个算法——纸越立起来，这条带越宽；贴平或
   完全落定（sin=0）时消失。颜色取 turn.js 的 stop 值：正面黑 0.2、白 0.2，
   背面黑 0.3。 */
.nw-read-shade{
  position:absolute;top:0;bottom:0;left:0;
  width:100%;transform-origin:left center;transform:scaleX(0);
  pointer-events:none;opacity:0;
  background-repeat:no-repeat;
}
.nw-read-face[data-face="front"] .nw-read-shade{
  background-image:linear-gradient(to right,
    rgba(255,255,255,0.2) 0,
    rgba(0,0,0,0.2) 24%,
    rgba(0,0,0,0) 100%);
}
.nw-read-face[data-face="back"] .nw-read-shade{
  background-image:linear-gradient(to right,
    rgba(0,0,0,0.3) 0,
    rgba(0,0,0,0) 100%);
}
/* 反面在纸上转了 180 度，折线落在它的右边；回翻时正面的折线也在右边。
   这两种情况把渐变条锚在右边，渐变方向也反过来，亮/暗的先后顺序与折线
   对齐，不靠再写一套 stop。R159：镜像交给 transform 的符号（poseFlip 每帧
   写 scaleX(±sin)），这里只定锚点和静止姿态。 */
.nw-read-flip[data-dir="back"] .nw-read-face[data-face="front"] .nw-read-shade,
.nw-read-flip[data-dir="fwd"] .nw-read-face[data-face="back"] .nw-read-shade,
.nw-read-flip[data-single="1"] .nw-read-face[data-face="back"] .nw-read-shade{
  left:auto;right:0;transform-origin:right center;transform:scaleX(0);
}
/* R157: 纸的厚度。零厚度的平面转到与视线共面（90 度）时投影面积为零，纸会
   凭空消失——真纸在那一刻看到的是切口。这道 2px 的竖线正对书脊，只在纸侧
   过来的那一段角度里浮现，颜色是纸白夹两道浅灰，就是纸被看成一条线的那一瞬。 */
.nw-read-edge{
  position:absolute;left:50%;top:var(--nw-read-air, 18px);bottom:var(--nw-read-air, 18px);
  width:2px;margin-left:-1px;z-index:2;pointer-events:none;opacity:0;
  background:linear-gradient(to right,
    color-mix(in srgb, var(--nw-fg) 16%, transparent) 0,
    var(--nw-read-flip) 34%,
    var(--nw-read-flip) 66%,
    color-mix(in srgb, var(--nw-fg) 20%, transparent) 100%);
  box-shadow:0 0 5px color-mix(in srgb, var(--nw-fg) 14%, transparent);
}
/* Forwards: the leaf covers the right page and hinges on the spine. */
.nw-read-flip[data-dir="fwd"] .nw-read-leaf{
  left:50%;transform-origin:left center;
}
/* Backwards: the leaf is the left page and hinges on the spine, its right edge. */
.nw-read-flip[data-dir="back"] .nw-read-leaf{
  left:0;transform-origin:right center;
}
/* One column: one page, hinged on its left edge like a book being opened. */
.nw-read-flip[data-single="1"] .nw-read-leaf{
  left:0;width:100%;transform-origin:left center;
}
/* The page still on the table. While the leaf is in the air, the half it has
   not covered yet keeps showing the page being left — in a real book nothing on
   that side has moved yet. R142：它一直不透明，直到纸真的落上来把它盖住
   （stopFlip 撤 data-on 的那一帧纸已经严丝合缝在上面）；原来让它在 52% 处
   淡出，纸还没到、旧页先没了，翻页就少了「盖住」这个动作。 */
.nw-read-cover{
  /* 纸色不透明：它盖在已经翻到的新页上，只需要露出还没被掀走的半边旧页。 */
  background:var(--nw-read-paper);
/* R150：盖住的那半页必须和纸面一模一样。原来 cover 只有正文带那么高、
     一个 box 那么宽，纸色是平涂的——翻页一开始，被压住的那半页就从「纸垛的
     渐变 + 两侧内阴影 + 波带」变成一块平色，颜色当场变一次，纸落下再变回来。
     现在 cover 与 .nw-read-sheet 同框（同样的 air 上下边、box + 两侧页边距、
     同样的圆角），并且抄下同一套背景层与那两道内阴影，盖上去看不出接缝。 */
  background-image:
    var(--nw-texture, none),
    linear-gradient(to right,
      color-mix(in srgb, var(--nw-fg) 8%, transparent) 0,
      color-mix(in srgb, #fff 3%, transparent) 2.4%,
      transparent 7%, transparent 94%,
      color-mix(in srgb, var(--nw-fg) 7%, transparent) 100%),
    linear-gradient(to bottom,
      color-mix(in srgb, var(--nw-fg) 5%, transparent) 0,
      transparent 2.4%, transparent 97.4%,
      color-mix(in srgb, var(--nw-fg) 4%, transparent) 100%),
    radial-gradient(58% 46% at 38% 30%,
      color-mix(in srgb, #fff 3.8%, transparent) 0,
      transparent 70%),
    radial-gradient(74% 62% at 86% 88%,
      transparent 44%,
      color-mix(in srgb, var(--nw-fg) 4%, transparent) 100%),
    linear-gradient(to bottom,
      transparent 6%,
      color-mix(in srgb, #fff 2.4%, transparent) 28%,
      transparent 44%,
      color-mix(in srgb, var(--nw-fg) 2.2%, transparent) 76%,
      transparent 95%);
  position:absolute;left:50%;
  top:var(--nw-read-air, 18px);bottom:var(--nw-read-air, 18px);
  width:calc(var(--nw-read-box, 680px) + var(--nw-read-sheet-pad) * 2);
  transform:translateX(-50%);
  border-radius:5px 5px 9px 9px / 3px 3px 6px 6px;
  box-shadow:
    inset 9px 0 18px -12px color-mix(in srgb, var(--nw-fg) 20%, transparent),
    inset -9px 0 18px -12px color-mix(in srgb, var(--nw-fg) 20%, transparent);
  overflow:hidden;z-index:1;contain:paint;
  visibility:hidden;pointer-events:none;
}
/* 被压住那半页的正文要和 flow 落在同一个位置：cover 比 flow 宽出两侧页边距，
   所以副本让开一个 pad，再缩回正文带。 */
.nw-read-cover .nw-read-copy{
  position:absolute;
  left:var(--nw-read-sheet-pad, 30px);
  right:var(--nw-read-sheet-pad, 30px);
  top:calc(var(--nw-read-band-top, 54px) - var(--nw-read-air, 18px));
  bottom:calc(var(--nw-read-band-bottom, 52px) - var(--nw-read-air, 18px));
  width:auto;height:auto;
}
.nw-read-cover[data-on="1"]{visibility:visible;}
.nw-read-cover[data-half="left"]{clip-path:inset(0 50% 0 0);}
.nw-read-cover[data-half="right"]{clip-path:inset(0 0 0 50%);}
/* A sheet lifting off a book presses a shadow into the spread below it: darkest
   at the fold, gone before the outer edge. It rises and settles with the leaf,
   so "something is leaving this book" does not have to be explained by the leaf
   alone. */
.nw-read-cast{
  position:absolute;left:50%;
  top:var(--nw-read-band-top, 54px);bottom:var(--nw-read-band-bottom, 52px);
  width:var(--nw-read-box, 680px);transform:translateX(-50%);
  pointer-events:none;z-index:2;opacity:0;contain:paint;
  background-image:radial-gradient(ellipse at center,
    color-mix(in srgb, var(--nw-fg) 30%, transparent) 0,
    color-mix(in srgb, var(--nw-fg) 13%, transparent) 42%,
    transparent 72%);
  filter:blur(7px);transform-origin:center;will-change:transform,opacity;
}
/* One paged copy of the manuscript, used only by the leaf and the cover. It has
   to break its columns exactly like .nw-read-flow or the leaf would not line up
   with the page it is lifting. */
.nw-read-copy{
  position:relative;width:100%;height:100%;
  column-width:var(--nw-read-col, 680px);
  column-gap:var(--nw-read-gap);
  column-fill:auto;
  overflow:hidden;
  color:var(--nw-fg);
  font-family:var(--nw-read-serif);
  user-select:none;
  scrollbar-width:none;-ms-overflow-style:none;
  touch-action:none;
}
/* Running head. One slot per visible column, each slot exactly one text column
   wide, with its own hairline — the rule under the book title ends where the
   left column ends, not in the gutter. It is painted above the flow, so it
   never scrolls away and never enters measure(). */
.nw-read-head{
  position:absolute;left:50%;
  /* R148：眉题原来距纸顶 20px，底部离正文只有 4px，贴得像贴上去的标签。
     抬到 13px，让眉线下方的空气到 11px 左右——书页的天头才读得出来。 */
  top:calc(var(--nw-read-air, 18px) + 13px);
  transform:translateX(-50%);
  width:var(--nw-read-box, 680px);
  display:flex;gap:var(--nw-read-gap);
  z-index:2;pointer-events:none;
}
.nw-read-head-slot{
  position:relative;
  flex:1 1 0;min-width:0;height:22px;
  display:flex;align-items:flex-end;justify-content:flex-start;
  padding:0 14px 6px;
  font-size:11px;line-height:1;letter-spacing:.16em;
  color:var(--nw-read-muted);white-space:nowrap;
  /* R139：眉题下面那条线曾经是一条贯穿整栏的 border，四栏摊开时就成了表格。
     书里的眉线本来就该淡：只在外侧收笔，越往书脊越淡。
     R148：线从纸缘让进来 6px，外端落一枚小菱形——眉题有了起笔的「点」，
     线是从点里长出来的，不再是一条光秃秃的尺。 */
  background-image:linear-gradient(to right,
    color-mix(in srgb, var(--nw-read-rule-soft) 90%, transparent),
    transparent 78%);
  background-repeat:no-repeat;
  background-position:6px 100%;
  background-size:calc(62% - 6px) 1px;
}
.nw-read-head-slot::before{
  content:'';position:absolute;bottom:3px;width:4px;height:4px;
  border:1px solid var(--nw-read-rule);
  transform:rotate(45deg);
}
.nw-read-head-slot[data-side="left"]::before{left:0;}
.nw-read-head-slot[data-side="right"]::before{right:0;}
.nw-read-head-slot > span{overflow:hidden;text-overflow:ellipsis;min-width:0;}
.nw-read-head-slot[data-side="right"]{
  justify-content:flex-end;
  background-image:linear-gradient(to left,
    color-mix(in srgb, var(--nw-read-rule-soft) 90%, transparent),
    transparent 78%);
  background-position:calc(100% - 6px) 100%;
}
/* R139：栏缝不发丝线。原来每一页内部的栏缝上各压一条全高 1px 竖线，对开四栏
   时读起来是一张网格表，而不是一本摊开的书——书里栏与栏之间只有空白。中缝
   的暗影已经由 .nw-read-sheet 的 ::after 负责，这里不再补线。 */
.nw-read-crules{display:none;}
/* Feet. Numbers in the serif, one size up from the name beside them, always on
   the outer edge of the page that owns them. */
.nw-read-foot{
  position:absolute;left:50%;
  bottom:calc(var(--nw-read-air, 18px) + 16px);
  transform:translateX(-50%);
  width:var(--nw-read-box, 680px);
  display:flex;align-items:baseline;gap:var(--nw-read-gap);
  z-index:2;pointer-events:none;color:var(--nw-read-muted);
}
.nw-read-foot-slot{flex:1 1 0;min-width:0;display:flex;align-items:baseline;gap:10px;}
.nw-read-foot-slot[data-side="right"]{justify-content:flex-end;}
.nw-read-foot-name{
  font-size:10.5px;letter-spacing:.12em;color:var(--nw-read-muted);
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.nw-read-count{
  font-family:var(--nw-read-serif);font-size:14px;line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:.02em;color:var(--nw-read-faint);
}
.nw-read-hint{
  font-size:10.5px;letter-spacing:.06em;color:var(--nw-read-muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
  transition:opacity .7s var(--nw-ease, ease);
}
.nw-read-hint[data-fade="1"]{opacity:0;}
/* In a spread the hint sits under the crease for the first few seconds, then
   leaves; the feet keep the numbers. One footer, not two stacks of chrome. */
.nw-read-foot[data-spread="1"] .nw-read-hint{
  position:absolute;left:50%;bottom:0;transform:translateX(-50%);max-width:52%;
}
/* The paged column. --nw-read-col is one text column, --nw-read-box is the
   page (one column, or two plus the gutter); both are written by measure(). */
.nw-read-flow{
  position:relative;z-index:1;
  width:var(--nw-read-box, 680px);height:100%;
  column-width:var(--nw-read-col, 680px);
  column-gap:var(--nw-read-gap);
  column-fill:auto;
  overflow-x:auto;overflow-y:hidden;
  overscroll-behavior-x:contain;
  /* No native horizontal panning on the prose: a finger that drags across the
     page must not slide the columns out of the sheet. Vertical panning stays
     with the browser (there is nothing to scroll, but selection handles etc.). */
  touch-action:pan-y;
  scrollbar-width:none;-ms-overflow-style:none;
  /* A page turn is one assignment to scrollLeft; a browser-side smooth scroll
     would animate that assignment and drag the columns across the sheet. */
  scroll-behavior:auto;
  color:var(--nw-fg);
  font-family:var(--nw-read-serif);
  /* The pane is a scroller, not a control: the generic focus ring would flash a
     red frame on every page turn. */
  outline:none;
}
.nw-read-stage .nw-read-flow:focus,
.nw-read-stage .nw-read-flow:focus-visible{outline:none;box-shadow:none;}
.nw-read-flow::-webkit-scrollbar{width:0;height:0;}
.nw-read-stage[data-drag="1"] .nw-read-flow{cursor:grabbing;}
/* Page edge notes fade while a page is in motion (they are pinned to a line,
   and that line is moving); they are re-painted once, after the turn ends. */
.nw-read-gutter{transition:opacity .14s linear;}
.nw-read-stage[data-turn="1"] .nw-read-gutter{opacity:0;}
/* R159: 翻页进行中把居中那句提示淡掉。纸的 z-index 比页脚高，扫过来时正好从
   「← → 翻页 · 选字可以标注」中间切过去，一行字被削掉半截——淡出比切一半好看。 */
.nw-read-hint{transition:opacity .12s linear;}
.nw-read-stage[data-turn="1"] .nw-read-hint{opacity:0;}
/* A spread keeps the two text columns apart; the crease itself is drawn on the
   sheet above, so no column-rule here. */
.nw-read-chapter{margin:0;}
/* R128：换章不再强制跳到新一栏。原来每章都 break-before:column，一章若只剩
   一两行没排完，那一栏就空出一大片，看上去像漏排。现在让它接着排，靠留白、
   眉标与标题装饰交代换章；万一标题正落在栏底，break-after:avoid 会把它连同
   开头几行一起挪到下一栏，不会出现「标题单独挂在栏末」。 */
/* 注意：这个文件里的 CSS 都写在模板字面量里，注释中不能出现反引号。 */
.nw-read-chapter + .nw-read-chapter{
  break-before:auto;
  /* R148：2.6em 的章间距在 1.9 行高的正文里只有一指宽，上一章的句号几乎
     压着下一章的章标。开到 3.4em——一章结束的沉吟，才放得下一章的开头。 */
  margin-top:3.4em;
}
/* Chapter opening: kicker, serif title, short rule and a diamond — all CSS,
   no icons and no shadows. */
.nw-read-kicker{
  /* R148：章标离正文太近（上 .18em 下 1.1em），读成「紧贴着的一行小字」。
     上下各放大留白，让「第 N 章」先站定，标题再落。 */
  margin:.55em 0 1.35em;font-family:var(--nw-read-serif);
  font-size:10.5px;line-height:1;letter-spacing:.3em;
  color:var(--nw-read-muted);break-after:avoid;
}
.nw-read-title{
  margin:0;
  font-family:var(--nw-read-serif);
  font-size:1.45em;font-weight:600;line-height:1.32;
  letter-spacing:.03em;color:var(--nw-fg);text-align:left;
  break-after:avoid;
}
.nw-read-orn{
  position:relative;display:block;width:96px;height:10px;
  /* R148：章标装饰放长到 96px、下方留白翻倍——装饰与正文之间的空隙
     和装饰本身的形一样重要。 */
  margin:1.3em 0 2.3em;break-after:avoid;
}
.nw-read-orn::before{
  /* R148：一段实线、一枚菱形、一段渐弱的虚影——像雕版书页里
     「线 ◇ 线」的章标花饰，而不是一条光秃的短尺。 */
  content:'';position:absolute;left:0;top:4.5px;
  width:96px;height:1px;
  background:linear-gradient(to right,
    var(--nw-read-rule) 0, var(--nw-read-rule) 36.5px,
    transparent 36.5px, transparent 41.5px,
    color-mix(in srgb, var(--nw-read-rule) 46%, transparent) 41.5px,
    color-mix(in srgb, var(--nw-read-rule) 30%, transparent) 70px,
    transparent 96px);
}
.nw-read-orn::after{
  content:'';position:absolute;left:35px;top:1px;
  width:6px;height:6px;border:1px solid var(--nw-read-rule);
  transform:rotate(45deg);
}
/* Body text. Justified to the column edge, hanging punctuation off, last line
   left — a stretched last line is the one thing that reads as "web page". */
/* 章末的「压角」：杂志里收故事用的小方块，摆在最后一段的行末，
   读者一眼就知道这一段是这一章的句号，不必等下一章的标题出现。 */
.nw-read-end{
  display:inline-block;width:.46em;height:.46em;margin-left:.62em;
  transform:rotate(45deg);
  background:color-mix(in srgb, var(--nw-accent) 62%, transparent);
  vertical-align:.04em;
}
.nw-read-p{
  margin:0 0 .3em;text-indent:2em;
  white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;
  text-align:justify;text-justify:inter-ideograph;text-align-last:left;
  font-family:var(--nw-read-serif);
  orphans:2;widows:2;
}
/* An empty line in the manuscript is a scene break, not a typo: it earns an
   extra line of air instead of being flattened into the paragraph wall. */
.nw-read-p[data-gap="1"]{margin-top:1.05em;}
.nw-read-p:last-child{margin-bottom:0;}
/* The opening paragraph of a chapter loses its indent and starts with a
   three-line initial. */
.nw-read-chapter > .nw-read-p:first-of-type{text-indent:0;break-inside:avoid;}
.nw-read-chapter > .nw-read-p:first-of-type::first-letter{
  float:left;font-size:3.1em;line-height:1;font-weight:600;
  margin:.04em .1em 0 0;color:var(--nw-fg);
}
/* ---- 标注（读视图）------------------------------------------------------
   Marks are drawn under the words, never over them: an underline sits below the
   glyphs, a strike-through is a line through the middle of the em box, and a
   comment is a wash of colour plus a rule. Nothing here can change the words
   or the pagination. */
.nw-mark{border-radius:var(--nw-r-hair);}
.nw-mark-underline{
  /* 一条 1.5px 的细线贴着行底（inset 阴影），比 text-decoration 更贴纸面，
     换行处也不会断成几截。 */
  box-shadow:inset 0 -1.5px 0 color-mix(in srgb, var(--nw-mark-underline, var(--nw-brand)) 72%, transparent);
}
.nw-mark-strike{
  text-decoration-line:line-through;
  text-decoration-color:color-mix(in srgb, var(--nw-mark-strike, var(--nw-danger)) 78%, transparent);
  text-decoration-thickness:1.5px;
}
/* 批注只加底色，不补底边——否则读起来和「下划线」一模一样。 */
.nw-mark-comment{
  background-color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 17%, transparent);
  box-shadow:none;
}
.nw-mark[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 22%, transparent);
}
.nw-mark-underline[data-active="1"]{box-shadow:inset 0 -1.5px 0 var(--nw-brand);}
.nw-mark-comment[data-active="1"]{
  background-color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 34%, transparent);
  box-shadow:none;
}
.nw-mark-strike[data-active="1"]{box-shadow:none;}
/* 选中的标注：外描边，正文颜色始终是作者的字色。 */
.nw-mark[data-selected="1"]{outline:1px solid color-mix(in srgb, var(--nw-brand) 55%, transparent);outline-offset:1px;}
/* 页边批注签：一小片标签纸，细边、浅底、没有重阴影。序号仍然章内唯一，用来
   分辨同一行上的两条批注。 */
.nw-read-gutter{
  position:absolute;inset:0;z-index:2;
  pointer-events:none;overflow:hidden;
}
.nw-mark-side{
  position:absolute;box-sizing:border-box;
  min-width:17px;height:17px;padding:0 3px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 52%, transparent);
  border-radius:2px;
  background:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 11%, var(--nw-read-paper));
  color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 76%, var(--nw-fg));
  pointer-events:auto;cursor:pointer;
  font-family:var(--nw-read-serif);font-size:9.5px;line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:0;
  box-shadow:0 1px 0 color-mix(in srgb, var(--nw-fg) 6%, transparent);
  transition:border-color .12s var(--nw-ease, ease), background-color .12s var(--nw-ease, ease);
}
.nw-mark-side:hover{border-color:var(--nw-mark-comment, var(--nw-brand));}
.nw-mark-side[data-active="1"]{
  background:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 24%, var(--nw-read-paper));
  border-color:var(--nw-mark-comment, var(--nw-brand));
}
.nw-mark-side:focus-visible{outline:2px solid var(--nw-brand);outline-offset:1px;}
/* 鼠标停在签上、或点开一条批注时，那句话亮起来。 */
.nw-mark[data-hover="1"]{
  background-color:color-mix(in srgb, var(--nw-brand) 20%, transparent);
}
.nw-mark-underline[data-hover="1"]{box-shadow:inset 0 -2px 0 var(--nw-brand);}
.nw-mark-comment[data-hover="1"]{
  background-color:color-mix(in srgb, var(--nw-mark-comment, var(--nw-brand)) 30%, transparent);
  box-shadow:none;
}
.nw-mark-strike[data-hover="1"]{box-shadow:none;}
.nw-read-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:var(--nw-sp-2);height:100%;
  color:var(--nw-read-muted);font-family:var(--nw-read-serif);font-size:var(--nw-fs-second);
}
/* ---- 标注工具条 / 标注详情 ----------------------------------------------
   Both float inside .nw-read-stage, so they travel with the page rather than
   the window. */
.nw-mark-bar{
  position:fixed;z-index:34;
  display:inline-flex;align-items:center;gap:2px;
  padding:3px;border-radius:var(--nw-r-pill);
  border:1px solid var(--nw-line-strong);
  background:var(--nw-panel);box-shadow:var(--nw-shadow-2);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  transform:translateX(-50%);
}
.nw-mark-bar-btn{
  display:inline-flex;align-items:center;justify-content:center;
  height:28px;padding:0 10px;border:0;border-radius:var(--nw-r-pill);
  background:transparent;color:var(--nw-fg);cursor:pointer;white-space:nowrap;
}
.nw-mark-bar-btn:hover{background:var(--nw-btn-hover);}
/* R50：点开一条标注后浮出来的小窗。位置由组件按点击处算好写进 style，所以这里
   只负责「长什么样」：一小片面板，刚好放得下一句批注——不是屏幕底下那块大白板。 */
.nw-mark-pop{
  position:fixed;left:0;top:0;transform:translateX(-50%);
  z-index:35;width:min(208px,calc(100vw - 16px));
  display:flex;flex-direction:column;gap:4px;
  padding:5px;border-radius:var(--nw-r-control);
  border:1px solid var(--nw-line);background:var(--nw-panel);box-shadow:var(--nw-shadow-3);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);
  animation:nw-fade-in var(--nw-dur, .18s) var(--nw-ease, ease) both;
}
/* 两个并列的小按钮：删除 / 批注。一行放得下，不用点开第二层。 */
.nw-mark-pop-acts{display:flex;gap:4px;}
.nw-mark-pop-btn{
  flex:1 1 auto;
  height:24px;padding:0 8px;
  border-radius:var(--nw-r-control);border:1px solid var(--nw-line-strong);
  background:var(--nw-btn-bg);color:var(--nw-fg);cursor:pointer;
  font-family:inherit;font-size:var(--nw-fs-tiny);white-space:nowrap;
}
.nw-mark-pop-btn:hover{background:var(--nw-btn-hover);}
.nw-mark-pop-btn[data-danger="1"]{color:var(--nw-danger);}
.nw-mark-pop-btn[data-primary="1"]{background:var(--nw-brand);border-color:var(--nw-brand);color:var(--nw-panel);}
/* 两个按钮那一版只是个小条，不该占满正文宽度。 */
.nw-mark-pop.nw-mark-pick{width:auto;padding:4px;}
/* R52：写批注那一版再窄一点、再矮一点——它是一张便条，不是一块面板。 */
.nw-mark-pop.nw-mark-edit{width:min(196px,calc(100vw - 16px));padding:5px;gap:3px;}
.nw-mark-pop-note{
  box-sizing:border-box;width:100%;min-height:24px;max-height:64px;
  padding:2px 5px;
  border-radius:var(--nw-r-hair);border:1px solid var(--nw-line);
  background:var(--nw-bg);color:var(--nw-fg);
  font-family:var(--nw-ui-font);font-size:var(--nw-fs-tiny);line-height:1.45;
  resize:none;overflow-y:auto;
}
.nw-mark-pop-note:focus{outline:none;border-color:var(--nw-brand);}
.nw-mark-pop-hint{
  color:var(--nw-soft);font-size:calc(var(--nw-fs-tiny) - 1px);
  line-height:1.35;padding:0 2px;
}
.nw-mark-pop-btn[data-danger="1"]{color:var(--nw-danger);border-color:color-mix(in srgb, var(--nw-danger) 45%, var(--nw-line-strong));}
@media (prefers-reduced-motion: reduce){
  .nw-read{animation:none;}
  .nw-read-flow{scroll-behavior:auto;}
  .nw-read-gutter{transition:none;}
  .nw-mark-pop{animation:none;}
  .nw-mark-side{transition:none;}
}
`);

  /**
   * 阅读视图。
   *
   * props:
   *   novel       — 当前这本书（只用来显示书名，可为 null）
   *   chapters    — 这本书的所有章节（已按文档顺序、含 content）
   *   currentId   — 编辑器当前那一章（决定哪一章读实时文本）
   *   startId     — 打开时想停在哪一章（R129：目录里点「读这一章」/「读整本」）；
   *                 省略时等同 currentId
   *   currentText — 当前章节编辑器里的**实时**文本（含尚未保存的字）
   *   settings    — 用来沿用字号/行高/主题
   *   marks       — 整本书的标注（`{id, chapterId, kind, start, end, note}`）
   *   onMark      — `(draft) => void`，把新标注交给上层去存
   *   onUnmark    — `(id) => void`，删掉一条标注
   *   onNote      — `(id, note) => void`，改批注正文
   *   onClose     — 退出
   */
  // R130: 朗读的两个偏好（语速 / 音色）只影响听感，不写进 settings —— 换台机器
  // 听同一本书时，用那台机器自己的声音更合理。
  function readSpeakPref(key) {
    try {
      return window.localStorage.getItem('nw.tts.' + key) || '';
    } catch (err) {
      return '';
    }
  }
  function writeSpeakPref(key, value) {
    try {
      window.localStorage.setItem('nw.tts.' + key, String(value));
    } catch (err) {
      /* 隐私模式下写不进去，本次会话仍然是生效的 */
    }
  }

  NW.ReadView = function ReadView(props) {
    const p = props || {};
    const settings = p.settings || {};

    const fontSize = clampNum(numOf(settings.fontSize, 20), 11, 42);
    const lineHeight = clampNum(numOf(settings.lineHeight, 2), 1.1, 3.4);
    // R125: 一页正文分几栏。1 = 单栏，2 = 双栏；测量时还会被「一栏至少 22
    // 个字」这条底线再压回去，所以这个值只是偏好，不是命令。
    const readColumns = clampNum(numOf(settings.readColumns, 2), 1, 2) >= 2 ? 2 : 1;
    const themeKey = THEME_KEYS[String(settings.theme || '')] ? String(settings.theme) : 'claude';
    // R159：字形原来写死在 CSS 里（--nw-read-serif 是一串宋体），用户在设置里挑的
    // 字体只影响编辑器，读书时永远是宋体——「字体不生效」的根就是这个。
    // 这里把同一份偏好抬成 --nw-read-serif：正文、纸上副本、页码、眉题全都吃这个
    // 变量，一处赋值全身生效。写法跟编辑器的 fontStackOf 一致：已经是字体栈
    // （带逗号或引号）就原样用，只写了一个族名就补一层兜底。
    const readerFont = (() => {
      const raw = String(settings.fontFamily || '').trim();
      if (!raw) return '';
      if (/[,"']/.test(raw)) return raw;
      return '"' + raw.replace(/"/g, '') + '","Songti SC","SimSun",serif';
    })();
    const novelTitle = p.novel && p.novel.title ? String(p.novel.title) : '';
    const currentId = p.currentId == null ? null : String(p.currentId);
    // R129：开场停在哪一章。目录里的「读这一章」传这一章的 id，「读整本」传第一章；
    // 都不传时沿用编辑器当前章（dock 上的「读一遍」）。
    const startId = p.startId == null ? currentId : String(p.startId);
    const currentText = typeof p.currentText === 'string' ? p.currentText : null;
    // 这两个数组每次渲染都会被重建，而「翻页」恰好就是一次渲染。正文的 useMemo
    // 靠它们的**引用**判断要不要把整本书重新拆段——不缓存的话，按一下方向键
    // 就要拆两万行，那才是翻页卡顿的真正来源（动画本身几乎不花时间）。
    const chapters = React.useMemo(
      () => (Array.isArray(p.chapters) ? p.chapters : []).filter(Boolean),
      [p.chapters],
    );
    const marks = React.useMemo(
      () => (Array.isArray(p.marks) ? p.marks : []).filter(Boolean),
      [p.marks],
    );

    const stageRef = React.useRef(null);
    const flowRef = React.useRef(null);
    const gutterRef = React.useRef(null);
    const paintGutterRef = React.useRef(null);
    // 当前打开的那条标注：页边签是命令式重画的，重画后要把「选中」那枚重新点亮。
    const activeRef = React.useRef('');
    const noteRef = React.useRef(null);
    const composerRef = React.useRef(null);
    // 正在跑的翻页动画（一次一帧，翻页/卸载时取消）。
    const slideRef = React.useRef(0);
    // 拖拽翻页：松手时要看起手时的 scrollLeft 和最后几帧的速度，决定翻过去还是弹回。
    const dragRef = React.useRef(null);
    const marksRef = React.useRef({});
    const jumpedRef = React.useRef(false);
    const pageRef = React.useRef(0);
    const scrollRafRef = React.useRef(0);
    const pointerRef = React.useRef(null);
    // 程序自己滚动时（翻页 / 重排后回位）暂停「滚动 → 页码」的同步：平滑滚动
    // 中途会经过中间位置，不听会让页码在跳页时闪一下。
    const quietRef = React.useRef(0);
    const wheelRef = React.useRef({ acc: 0, at: 0 });

    // w = 栏宽（= 行宽），gap = 栏间距，total = 总页数。三者都来自真实布局测量。
    const [layout, setLayout] = React.useState({
      w: 0, gap: 0, total: 1, cols: 1, textCols: 1, colW: 0, step: 0, starts: [],
    });
    const [page, setPage] = React.useState(0);
    // R148：页码/眉题印的是「纸面上此刻该有的那页」，不是正文书页。翻页是正文
    // 先跳、纸后落：数字若跟着正文一起跳，就会在纸还没翻过去时先变（页码抢跑）。
    // R149：而且对开的两半**不是同时换的**——被掀起的那一半从第一帧起露出的
    // 就是新页，被纸压着的那一半要等纸落上来才轮到。所以台面页码按「半」取：
    // shownPage 记台面这一跨页，halfOverride 记翻页期间先换掉的那一半。
    const [shownPage, setShownPage] = React.useState(0);
    const shownPageRef = React.useRef(0);
    const setShown = React.useCallback((idx) => {
      if (shownPageRef.current === idx) return;
      shownPageRef.current = idx;
      setShownPage(idx);
    }, []);
    // 翻页途中先换码的那一半：{ side: 'left' | 'right', page } | null。
    // 它只在纸飞着的时候存在，stopFlip 一撤，两半重新跟 shownPage。
    const [halfOverride, setHalfOverride] = React.useState(null);
    // 正在飞的这一页：to = 纸要落到的那一页；live = 纸真的在飞（armFlip 成功）。
    const turnPagesRef = React.useRef({ to: 0, live: false });
    const [hintOn, setHintOn] = React.useState(true);

    // R159：能停的最大页号还要受「正文真的能滚到哪」限制。total 是页数，最后一页
    // 的落点是 (total - 1) * step，而正文最多只滚到 scrollWidth - box。对开时最后
    // 那一跨页是 (total-2, total-1)，两者正好相等。旧代码只按 total - 1 夹，End 键
    // 会把 page 记成滚不到的那一页——正文被浏览器夹回一页，数字却按后一页印，
    // 于是书末印出「25 | 26」这种对不上的号。
    const fitPage = layout.fit == null ? layout.total - 1 : layout.fit;
    const maxPage = Math.max(0, Math.min(layout.total - 1, fitPage));
    // R55：一页有多宽（单页 = 一栏 + 栏距，对开 = 两栏 + 两个栏距里的一整段）。
    // 由 measure() 算好后放进 layout，凡是「翻一页」都读它，别再各自拼 w+gap。
    const step = layout.step || (layout.w + layout.gap);

    const close = React.useCallback(() => {
      if (typeof p.onClose === 'function') p.onClose();
    }, [p.onClose]);

    // Esc 走弹层自己的栈（40-ui 的 useEscapeOwner）：一次 Esc 只关一层，
    // 也不会被沉浸模式的 Esc 抢先退出全屏。
    // R50：批注小窗开着时，Esc 先收小窗，再按一次才离开「读一遍」。
    // R53：新批注的便签也算一层。
    NW.useModalEscape(true, () => {
      if (composer) {
        closeComposer();
        return;
      }
      if (editing || picked) {
        closeMark();
        return;
      }
      close();
    });

    // 焦点必须离开 textarea，否则翻页的方向键会直接打进正文里。焦点落在
    // 分页容器上（tabIndex=-1），滚动容器自己也能收到方向键。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (flow && typeof flow.focus === 'function') {
        try {
          flow.focus({ preventScroll: true });
        } catch (err) {
          flow.focus();
        }
      }
    }, []);

    // ---- 翻页：落位一次 + 掀一张带字的纸 -------------------------------------
    //
    // 正文（多栏流）**永不横移**：`flow.scrollLeft` 只在换页那一刻被赋值一次，
    // 直接落到整页。看上去在动的是 `.nw-read-flip` 里那张纸，而且纸上印着**被
    // 掀走的那一页**的字：舞台上另有一份同样的多栏副本（.nw-read-copy），只装
    // 当前章附近几章，用同样的栏宽、栏距、行高排好；翻页时只把它的 scrollLeft
    // 指到旧页。所以动画路径里没有 measure、没有 getBoundingClientRect、没有
    // querySelectorAll，只有 transform / opacity 交给合成器。
    const flipWrapRef = React.useRef(null);
    const leafRef = React.useRef(null);
    const castRef = React.useRef(null);
    // R156: 一张纸，两面。正面副本印离开的那页，背面副本印翻到的那页；
    // 每面各有一道贴在折线上的渐变，弧度不再由几何产生。
    const frontCopyRef = React.useRef(null);
    const backCopyRef = React.useRef(null);
    const frontShadeRef = React.useRef(null);
    const edgeRef = React.useRef(null);
    const backShadeRef = React.useRef(null);
    // R156: 两面在 180 度附近共面，浏览器会把正面的背面对着人画出来（纸背上
    // 透出上一层字）。过了 90 度就按朝向明开关一面，和 turn.js 换 fpage 一样。
    const frontFaceRef = React.useRef(null);
    const backFaceRef = React.useRef(null);
    // 摆纸那一刻量出来的几何（纸宽 / 每条宽 / 朝哪个方向），掀页时只用来算角度。
    const poseGeomRef = React.useRef(null);
    const rafRef = React.useRef(0);
    const coverRef = React.useRef(null);
    const coverCopyRef = React.useRef(null);
    const flipAnimRef = React.useRef(null);
    const coverAnimRef = React.useRef(null);
    const castAnimRef = React.useRef(null);
    // The leaf is laid out against the geometry of this moment. When the panel
    // crosses the spread threshold the column count changes and the copy printed
    // on the leaf reflows with it, so remember what it was laid out for: a new
    // geometry is a reason to take the sheet down (see abortTurn).
    const armColsRef = React.useRef(0);
    const geometryRef = React.useRef('');
    const flipTimerRef = React.useRef(0);
    const flipGenRef = React.useRef(0);
    const mirrorOriginRef = React.useRef(0);
    const fadeRef = React.useRef(null);
    // 掀页途中不能换副本里的那几章：换一次就要重排那几章，纸上正在飞的字会
    // 跳。所以窗口的移动推迟到落定之后（turnEpoch 只是把它叫醒）。
    const turningRef = React.useRef(false);
    const [turnEpoch, setTurnEpoch] = React.useState(0);

    // 纸上两面各自的字，各自指到自己的那一页：正面印离开的那页，背面印翻到的
    // 那页。副本只装了几章，所以要减掉它第一章在正文里的左边距——两个数都是量
    // 好的（layout.starts 里的 left），这里只做减法。
    const syncCopies = React.useCallback((frontAt, backAt) => {
      const s = step;
      if (!(s > 0)) return;
      const origin = mirrorOriginRef.current;
      const front = Math.max(0, Math.round(frontAt * s) - origin);
      const back = Math.max(0, Math.round(backAt * s) - origin);
      const fc = frontCopyRef.current;
      if (fc) fc.scrollLeft = front;
      const bc = backCopyRef.current;
      if (bc) bc.scrollLeft = back;
      const c = coverCopyRef.current;
      if (c) c.scrollLeft = Math.max(0, Math.round(frontAt * s) - origin);
    }, [step]);

    const stopFlip = React.useCallback(() => {
      flipGenRef.current += 1;
      if (flipTimerRef.current) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = 0;
      }
      const anim = flipAnimRef.current;
      flipAnimRef.current = null;
      if (anim) {
        try {
          anim.cancel();
        } catch (err) {
          /* 老浏览器没有 WAAPI：纸面已经收回去了，无所谓 */
        }
      }
      const coverAnim = coverAnimRef.current;
      coverAnimRef.current = null;
      if (coverAnim) {
        try {
          coverAnim.cancel();
        } catch (err) {
          /* ignore */
        }
      }
      const castAnim = castAnimRef.current;
      castAnimRef.current = null;
      if (castAnim) {
        try {
          castAnim.cancel();
        } catch (err) {
          /* ignore */
        }
      }
      turningRef.current = false;
      // R149：纸收走了（落定、被打断或卸载清理），台面两半一起对回正文书页：
      // 先撤掉翻页期间那半边的覆盖，再对齐 shownPage。没飞完就被收走的翻页，
      // 数字不会停在半空。setShown 里有同值守卫，卸载清理也不会 setState。
      turnPagesRef.current.live = false;
      setHalfOverride(null);
      setShown(pageRef.current);
      const wrap = flipWrapRef.current;
      if (wrap) {
        wrap.removeAttribute('data-live');
        // R158: poseFlip 为了换面会在两面写 inline visibility:visible。
        // visibility 是继承的，但子元素把 visible 写回去就会盖掉父层的 hidden——
        // 于是一次翻页之后，那张纸就永远留在屏幕上，副本停在页首，右半页变成
        // 左半页的复制品。这里必须把 inline 值清掉，让父层的 hidden 生效。
        if (frontFaceRef.current) frontFaceRef.current.style.visibility = '';
        if (backFaceRef.current) backFaceRef.current.style.visibility = '';
        wrap.removeAttribute('data-dir');
        wrap.removeAttribute('data-single');
      }
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const leaf = leafRef.current;
      if (leaf) {
        leaf.style.transform = 'rotateY(0deg)';
        if (edgeRef.current) edgeRef.current.style.opacity = '0';
      }
      const fs = frontShadeRef.current;
      if (fs) {
        fs.style.opacity = '0';
        fs.style.transform = 'scaleX(0)';
      }
      const bs = backShadeRef.current;
      if (bs) {
        bs.style.opacity = '0';
        bs.style.transform = 'scaleX(0)';
      }
      const ff = frontFaceRef.current;
      if (ff) ff.style.visibility = 'visible';
      const bf = backFaceRef.current;
      if (bf) bf.style.visibility = 'hidden';
      const cover = coverRef.current;
      if (cover) {
        cover.removeAttribute('data-on');
        cover.style.opacity = '';
      }
      const cast = castRef.current;
      if (cast) cast.style.opacity = '0';
    }, []);

    // The geometry changed (single page became a spread, or the column width
    // changed): the copy printed on the leaf was laid out for the old geometry,
    // so leaving that sheet in the air stacks it on the new layout -- which is
    // exactly the third column of text that shows up when a single page widens
    // into a spread. Take the sheet down before anything is re-measured.
    const abortTurn = React.useCallback(() => {
      const wasTurning = turningRef.current;
      stopFlip();
      if (!wasTurning) return;
      const st = stageRef.current;
      if (st) st.removeAttribute('data-turn');
      setTurnEpoch((n) => n + 1);
    }, [stopFlip]);

    const clearTurns = React.useCallback(() => {
      stopFlip();
      if (fadeRef.current) {
        try {
          fadeRef.current.cancel();
        } catch (err) {
          /* ignore */
        }
        fadeRef.current = null;
      }
      const stage = stageRef.current;
      if (stage) stage.removeAttribute('data-turn');
    }, [stopFlip]);

    // 页边签是命令式画的：翻页落位后补一次，滚动过程中一次都不画——原来每
    // 90ms 扫一遍整页 `.nw-mark`（还连着 getClientRects），掉帧就是它。
    const repaintGutter = React.useCallback(() => {
      const fn = paintGutterRef.current;
      if (typeof fn === 'function') fn();
    }, []);

    // 摆好那张纸（不带动画）：方向、单/双栏、正反两面的字各指到自己的那一页。
    // 单栏时整页都在纸上，所以不需要底下的那一塊；对开时底下那一半由 turnTo 打开。
    // R142：`frontAt` 是正面印的那页（离开的那页），`backAt` 是背面印的那页
    // （翻到的那页）——纸要转到 180°，所以两面都得先印好。
    const armFlip = React.useCallback((dir, frontAt, backAt) => {
      const wrap = flipWrapRef.current;
      if (!wrap || !leafRef.current) return false;
      wrap.setAttribute('data-dir', dir > 0 ? 'fwd' : 'back');
      const single = layout.cols < 2;
      if (single) wrap.setAttribute('data-single', '1');
      else wrap.removeAttribute('data-single');
      wrap.setAttribute('data-live', '1');
      const ff = frontFaceRef.current;
      if (ff) ff.style.visibility = 'visible';
      const bf = backFaceRef.current;
      if (bf) bf.style.visibility = 'hidden';
      armColsRef.current = layout.cols;
      // 纸宽全部由量好的栏宽推出来，不去读 DOM：对开时是一半书页，单栏时是整页。
      const box = layout.w * layout.cols + layout.gap * (layout.cols - 1);
      const pad = 30;
      const sheet = box + pad * 2;
      const leafW = single ? sheet : (sheet - 1) / 2;
      // 对开前翻时纸的左边就是书缝，反翻和单栏时纸的左边在整页左缘外面
      // 那圈页边距上。
      const spreadFwd = !single && dir > 0;
      const side = dir > 0 ? 1 : -1;
      // R159：明暗带的方向（贴折线那一道在左还是在右）。正面在回翻时、背面在
      // 前翻时，画在纸上的折线落在右边；这两个情况要靠 scaleX 取负来镜像。
      // 这里一次算好存进 geom，每帧只写 transform / opacity，不再改宽度——
      // 改宽度会让浏览器重排纸里的整份正文（两列排版），一帧能卡 200ms。
      poseGeomRef.current = {
        dir: side,
        leafW: leafW,
        mirrorFront: side < 0,
        mirrorBack: spreadFwd || single,
      };
      // 半个对开：书缝在正文第 w+gap/2 列（w 已是「一页两栏 + 页内一缝」）。
      const spineAt = layout.w + layout.gap / 2;
      // 正面：纸的左边对上「离开的那一页」。
      const frontLeft = spreadFwd ? -spineAt : pad;
      // 背面在纸上已经转了 180 度，横向坐标是镜像的。对开前翻落到左页，
      // 副本让开一个页边距；回翻落到右页，副本要向左让出书缝那一半；单栏的
      // 背面已经翻到书外，只需保证那一瞬的字不反。
      const backLeft = spreadFwd ? pad : (single ? pad : -spineAt);
      const fc = frontCopyRef.current;
      if (fc) fc.style.left = (frontLeft + 0.35).toFixed(3) + 'px';
      const bc = backCopyRef.current;
      if (bc) bc.style.left = (backLeft + 0.35).toFixed(3) + 'px';
      // 页脚和副本共用同一个横向原点；整张纸只写一次。
      leafRef.current.style.setProperty('--nw-foot-front', (frontLeft + 0.35).toFixed(3) + 'px');
      leafRef.current.style.setProperty('--nw-foot-back', (backLeft + 0.35).toFixed(3) + 'px');
      syncCopies(frontAt, backAt);
      return true;
    }, [layout.cols, layout.w, layout.gap, syncCopies]);

    // ---- turn.js 的一张纸 --------------------------------------------
    // 纸是刚体平面，只绕书脊转；弧度不靠分段，靠叠加在纸面上的两道渐变
    // （正面贴折线一道暗、紧贴折线一道亮，背面贴折线更暗）画出来。所有节点与
    // 几何都在 armFlip 里准备好，这里不读布局、不查询 DOM。
    const poseFlip = React.useCallback((angleDeg) => {
      const leaf = leafRef.current;
      if (!leaf) return;
      const abs = Math.min(200, Math.abs(angleDeg));
      const rise = Math.min(1, abs / 180);
      const swing = Math.sin(Math.PI * rise);
      const g = poseGeomRef.current;
      const side = g && g.dir ? g.dir : 1;
      const leafW = g && g.leafW ? g.leafW : 500;
      leaf.style.transform = 'rotateY(' + angleDeg.toFixed(2) + 'deg)';
      // turn.js 的 gradientSize：纸越侧过去，折线旁的明暗带越宽；贴平或落定
      // 时 sin=0，带子消失。R159：宽度不用改——两道渐变条铺满整面，用
      // scaleX 压出来。改宽度会重排纸里的正文（两列排版），那是翻页中途卡
      // 200ms 的原因；scaleX 只重投影，不碰布局。
      const gmirrorF = g && g.mirrorFront ? -1 : 1;
      const gmirrorB = g && g.mirrorBack ? -1 : 1;
      const frontShade = frontShadeRef.current;
      if (frontShade) {
        frontShade.style.transform = 'scaleX(' + (gmirrorF * swing).toFixed(4) + ')';
        frontShade.style.opacity = swing.toFixed(3);
      }
      const backShade = backShadeRef.current;
      if (backShade) {
        backShade.style.transform = 'scaleX(' + (gmirrorB * swing).toFixed(4) + ')';
        backShade.style.opacity = swing.toFixed(3);
      }
      // R157: 90 度附近纸是侧着的，投影为零。这道切口只在这个角度窗口里浮现，
      // 越接近正侧越实（rise=0.5），离开 ±22 度就完全隐去。
      const edge = edgeRef.current;
      if (edge) edge.style.opacity = Math.max(0, 1 - Math.abs(rise - 0.5) * 8).toFixed(3);
      // 纸过 90 度翻到背面。浏览器在两面共面时偶尔会把背面的正面也画出来，
      // 形成重影；这里像 turn.js 换 fpage 一样，按朝向把另一面关掉。
      const over = abs > 90;
      const ff = frontFaceRef.current;
      if (ff) ff.style.visibility = over ? 'hidden' : 'visible';
      const bf = backFaceRef.current;
      if (bf) bf.style.visibility = over ? 'visible' : 'hidden';

      // R149：页码不在这里换。对开的两半不是同时露出来的——被掀起的那一半从
      // 第一帧起就该是新页（turnTo 用 halfOverride 一次登记），被压住的那一半
      // 等纸落地（stopFlip）才换。R148 在这里按 90° 整体换码，结果外缘的页码
      // 与它旁边真正印着的内容对不上：前半程新右页配旧页码，后半程旧左页配新页码。

      // 落影是一道随自由边横跨书页的椭圆。纸越竖直，投影越窄；纸越高，
      // 影子越柔、越明显。它和 turn.js 的 bshadow 是同一个意思：让底下那张
      // 纸知道有一页正从它上面过去。
      const cast = castRef.current;
      if (cast) {
        const base = angleDeg * Math.PI / 180;
        const flat = Math.abs(Math.cos(base));
        const shift = Math.cos(base) * side * leafW * 0.34;
        cast.style.opacity = (0.62 * swing).toFixed(3);
        cast.style.transform = 'translateX(-50%) translateX(' + shift.toFixed(2)
          + 'px) scaleX(' + (0.42 + 0.58 * flat).toFixed(3) + ')';
      }
    }, []);

    // R149：纸的转速。旧曲线起手先甩出 7%、再按 2.35 次幂一路减速——一半的
    // 时间就走完 85% 的角度，剩下的四成时间全耗在最后 28° 上，读起来是「甩开
    // 又悬住」；末尾 1.035 的回摆还让纸越过 180° 往书里扎 6°，落页那一下像被
    // 弹回来。
    // R159：余弦曲线（0.5-0.5cos）两端速度都是 0，起手 90ms 里纸只走 3.7°，
    // 读起来是「先愣一下再甩出去」——而按方向键后第一帧总要等 React 提交和
    // 正文重绘（实测 30~70ms），两段延迟叠在一起就是用户说的"卡"。
    // 改成 1-(1-t)^1.8：起手不留白，前 100ms 就走掉六分之一的角度，末尾仍然
    // 速度归零、不越界，落页是收住而不是撞住。
    const turnCurve = (t) => 1 - Math.pow(1 - Math.min(1, t), 1.8);

    const turnTo = React.useCallback((index, fromAngle) => {
      const flow = flowRef.current;
      const s = step;
      if (!flow || !(s > 0)) return;
      const cur = pageRef.current;
      const next = Math.max(0, Math.min(maxPage, index));
      if (next === cur) return;
      const dir = next > cur ? 1 : -1;
      const still = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const stage = stageRef.current;

      // R142：真书翻页永远是**半圈**——一页纸从这一侧平放，经竖直，落到另一
      // 侧平放，正好 180°。原来只转到 ±90° 就停、再靠底下一层淡出收尾，所以
      // 看着像「纸抬起来就没了」。现在两个方向走同一条路：
      //   向后翻：右页绕书脊 0 → -180，落在左页上，把它盖住
      //   向前翻：左页绕书脊 0 → +180，落在右页上，把它盖住
      // 过 90° 之后读者看到的是纸背，纸背上印的是翻到的那一页（backCopyRef）。

      // 0) 把纸摆好。正面印**离开的那一页**，背面印**翻到的那一页**。
      //    这一步只有三次 scrollLeft 赋值，不排一次版。
      stopFlip();
      // R159：纸背印的是**落下来之后那一侧的那一页**，两侧的窗口公式不一样，
      // 所以 backAt 不能两向都取 next：向前翻，纸落到左半，左半露出的是
      // next + 1（拷贝窗口的左半边）；向后翻，纸落到右半，右半露出的是
      // next + 2，也就是拷贝窗口右半边要挪到 next + 1 这一页上。原来两向都用
      // next，向后翻时纸背一直印着前一页（第 2 页的位置上是第 1 页的字），
      // 落定的那一帧才跳回来——这就是向后翻「最后一下字会闪」的来源。
      const backAt = dir > 0 ? next : Math.min(layout.total - 1, next + 1);
      const armed = !still && armFlip(dir, cur, backAt);
      turningRef.current = armed;
      // R149：登记这一趟翻页。纸背的页码读 to（翻到的那页）；台面上被掀起的
      // 那一半（向前翻是右半，向后翻是左半）从这一帧起就换成新页——它从第一
      // 帧起就在露出新内容，只有被纸完全盖住的那几帧看不见。另一半留在旧页，
      // 等纸落上来由 stopFlip 一起对齐。没有纸可翻时下面 !armed 分支直接换。
      turnPagesRef.current = { to: next, live: armed };
      setHalfOverride(armed ? { side: dir > 0 ? 'right' : 'left', page: next } : null);
      const cover = coverRef.current;
      if (armed && cover && layout.cols > 1) {
        // 还没被纸盖住的那一半仍然是旧页（真书上那一侧还没动）：向后翻时旧的
        // 左页要一直留到纸落上来，向前翻时旧的右页同理。
        cover.setAttribute('data-half', dir > 0 ? 'left' : 'right');
        cover.setAttribute('data-on', '1');
        cover.style.opacity = '1';
      }

      // 1) 落位：整页瞬跳。**这是整个翻页过程中唯一一次写正文的 scrollLeft。**
      //    R142：两个方向都在开头落位。真书上，纸一被挑起，底下那一半立刻就是
      //    新页；不该露的那一半由上面的 cover 顶着。原来回翻要等纸落下来才跳，
      //    是因为那时纸只转到竖直、必须靠旧页兜住，现在纸会自己盖住那一半。
      const drop = () => {
        pageRef.current = next;
        setPage(next);
        quietRef.current = Date.now() + 720;
        const at = Math.round(next * s);
        if (Math.abs(flow.scrollLeft - at) > 1) flow.scrollLeft = at;
      };

      // 2) 新页很轻地淡进来（0.82 → 1，只在前 200ms）：压住瞬跳的突兀，
      //    但不是把整页压暗，也不做任何位移。prefers-reduced-motion 下连这一下
      //    也不要——整页直接换掉。
      const fadeIn = () => {
        if (still) return;
        try {
          if (fadeRef.current) fadeRef.current.cancel();
          fadeRef.current = flow.animate(
            [{ opacity: 0.82 }, { opacity: 1 }],
            { duration: 200, easing: 'cubic-bezier(.3,0,.2,1)' },
          );
        } catch (err) {
          /* 没有 WAAPI 就干脆不淡，翻页照样是对的 */
        }
      };

      drop();
      // R159：有纸在翻的时候不做这层整页淡入。掀页那一瞬间两半都被纸和压页
      // 盖着，新页本来就不露面；淡入真正起作用的是「没有纸」的直接换页。
      // 而这层 opacity 动画铺在大半屏正文上，会多开一个合成层，和纸抢第一帧。
      if (!armed) fadeIn();

      // `data-turn` 现在只剩一个语义：把页边签淡掉（它们钉在上一页的行上）。
      // 重画本身要扫整页标注、读矩形，所以**不**放在这里——放到纸落定之后。
      if (stage) stage.setAttribute('data-turn', '1');

      if (!armed) {
        // 没有纸可翻（reduced-motion，或者纸还没量好）：直接换页，页码同帧换。
        if (stage) stage.removeAttribute('data-turn');
        setShown(next);
        repaintGutter();
        return;
      }

      // 3) 掀页：一整页手翻大约半秒（拖拽续翻按剩余角度折算）。只写 transform
      //    与 opacity，一帧一次，没有布局读取。
      const from = Number(fromAngle) || 0;
      // 向后翻转到 -180（右页落到左页），向前翻转到 +180（左页落到右页）。
      const to = dir > 0 ? -180 : 180;
      const span = Math.max(1, Math.abs(to - from));
      // R136: 660 → 880ms。660 的纸翻起来像被谁推了一把，太快、太薄；真实的
      // 纸页要等空气托一下再落。880 仍在「不拖沓」的一侧（一页翻完不到一秒），
      // 但每一帧的角度变化小了三分之一，光才有时间走完它那段路。
      // R142：改成一整圈 180° 之后按 180 折算，仍是约 880ms 翻完一页。
      // R149：880 → 620ms。整页翻要 880ms 太黏了：手翻一页大约半秒多一点，
      // 超过 0.8s 就开始像慢动作，纸的「轻」先没了。
      // R159：620 → 560ms。曲线改成起手就动的形状（见 turnCurve）之后，前
      // 三分之一的时间已经走完一半以上的角度，再去掉末尾那截拖尾就是 560。
      const dur = Math.max(240, Math.round(560 * (span / 180)));

      // R142：cover 整段保持不透明——它盖着的那一半要等到纸真的落上来才交给
      // 纸背，所以不需要渐变淡出（原来 52% 就淡完，纸还没到，旧页先没了）。
      // 落定时 stopFlip 会把 data-on 一并撤掉，那一帧纸已经严丝合缝盖在上面。

      // 连按两次时同一张纸会被重新摆一遍：上一段的收尾必须失效，否则它会在半路
      // 把这张还在转的纸收走（画面一闪）。用代号认领。
      const gen = (flipGenRef.current += 1);
      const land = () => {
        if (flipGenRef.current !== gen) return;
        // The sheet was printed for one geometry; if the columns changed while
        // it was in the air, it is a leaf from a different book -- take it down
        // and let measure() re-align instead of dropping a stale page on top.
        if (armColsRef.current !== layout.cols) {
          stopFlip();
          setTurnEpoch((n) => n + 1);
          const st2 = stageRef.current;
          if (st2) st2.removeAttribute('data-turn');
          return;
        }
        stopFlip();
        setTurnEpoch((n) => n + 1);
        const st = stageRef.current;
        if (st) st.removeAttribute('data-turn');
        // 纸落定，才是重画页边签的那一次（每翻一页一次，滚动里一次都不画）。
        repaintGutter();
      };
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const t0 = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const frame = (now) => {
        rafRef.current = 0;
        if (flipGenRef.current !== gen) return;
        const t = Math.min(1, (now - t0) / dur);
        // R142：两个方向都是同一张纸走完半圈，所以走同一条手感曲线——黏一下、
        // 放开、越过竖直再回摆。原来回翻单独用减速曲线（纸落下来），那是「只
        // 转 90°」时代的补丁，现在不需要了。
        const k = turnCurve(t);
        poseFlip(from + (to - from) * k);
        if (t < 1) {
          rafRef.current = window.requestAnimationFrame(frame);
          return;
        }
        land();
      };
      poseFlip(from);
      rafRef.current = window.requestAnimationFrame(frame);
      // 兜底：后台标签页里 rAF 会被冻住，时长 + 240ms 后一定收。
      flipTimerRef.current = window.setTimeout(land, dur + 240);
    }, [step, maxPage, armFlip, stopFlip, repaintGutter, layout.cols, poseFlip]);

    // 瞬间落到某一页：开场定位、窗口重排后的回位、TTS 念到下一页走这里。不翻纸。
    // R148：它原来只挪 scrollLeft 不写 pageRef/setPage——正文已经在那一页，
    // 舞台页码却还停在上一页，页码从 TTS 第一跳起就一直是错的。现在和滚轮
    // 监听一样：pageRef、page、shownPage 三处一起对齐。
    const scrollToPage = React.useCallback((index) => {
      const flow = flowRef.current;
      const s = step;
      if (!flow || !(s > 0)) return;
      const at = Math.max(0, Math.min(maxPage, index));
      pageRef.current = at;
      setPage(at);
      stopFlip();
      setShown(at);
      quietRef.current = Date.now() + 200;
      flow.scrollLeft = Math.round(at * s);
      const stage = stageRef.current;
      if (stage) stage.removeAttribute('data-turn');
      repaintGutter();
    }, [step, maxPage, stopFlip, repaintGutter]);

    // 所有入口（点击半页、滚轮、键盘、拖拽松手）都只走这一个函数。
    const go = React.useCallback((delta) => {
      // pageRef 是唯一真相：它只在落位时被写，所以连按也永远从屏幕上的那页起算。
      const cur = pageRef.current;
      const next = Math.max(0, Math.min(maxPage, cur + delta));
      if (next === cur) return;
      turnTo(next);
    }, [maxPage, turnTo]);

    React.useEffect(() => () => clearTurns(), [clearTurns]);

    // ---- R130：念给我听 ------------------------------------------------------
    //
    // 为什么用系统语音：这个插件是本地优先的，正文不为了「听一遍」先上传。
    // `speechSynthesis` 零依赖、离线可用，音色没有云端那种「像真人」的水平，
    // 但它是此刻就能用的那一档（更高真度的引擎见 README 的说明）。
    //
    // 一次只念一段，不是整章一个大 utterance：Chrome 对十几秒以上的长句子会
    // 在中间自己停住；分段还顺便给了「念到哪段亮哪段」「念到下一页自动翻页」。
    // 在线引擎的声音：Edge 读声那几个中文自然音，写死一份，免得每次拉列表。
    const EDGE_VOICES = [
      ['zh-CN-XiaoxiaoNeural', '晓晓 · 女声（最像真人）'],
      ['zh-CN-XiaoyiNeural', '晓伊 · 女声'],
      ['zh-CN-YunxiNeural', '云希 · 男声'],
      ['zh-CN-YunjianNeural', '云健 · 男声（讲故事）'],
      ['zh-CN-YunyangNeural', '云扬 · 男声（播报）'],
      ['zh-CN-YunxiaNeural', '云夏 · 少年'],
      ['zh-CN-liaoning-XiaobeiNeural', '晓北 · 东北腔'],
      ['zh-CN-shaanxi-XiaoniNeural', '晓妮 · 陕西腔'],
      ['zh-TW-HsiaoChenNeural', '晓臻 · 台湾'],
      ['zh-HK-HiuGaaiNeural', '晓佳 · 粤语'],
    ];
    const engineOf = (value) =>
      value === 'edge' || value === 'api' || value === 'baidu' ? value : 'system';
    const [speakEngine, setSpeakEngine] = React.useState(() => engineOf(readSpeakPref('engine')));
    const cfgRef = React.useRef({});
    cfgRef.current = {
      engine: speakEngine,
      edgeVoice: String(p.settings.ttsEdgeVoice || 'zh-CN-XiaoxiaoNeural'),
      api: {
        url: String(p.settings.ttsApiUrl || ''),
        key: String(p.settings.ttsApiKey || ''),
        model: String(p.settings.ttsApiModel || 'tts-1'),
        voice: String(p.settings.ttsApiVoice || 'alloy'),
      },
    };

    // R131：三种引擎。系统语音在渲染进程里念（离线、不出本机）；在线（Edge 的
    // 自然音）和自定义（任何 OpenAI /v1/audio/speech 兼容接口）都走宿主的那条
    // 路由——浏览器自己发不出去：Edge 会拒掉不是扩展 Origin 的 websocket，
    // 自定义接口多半要带密钥，跨域也过不去。
    const [speaking, setSpeaking] = React.useState(false);
    const [speakError, setSpeakError] = React.useState('');
    const [speakMenu, setSpeakMenu] = React.useState(false);
    const [speakVoices, setSpeakVoices] = React.useState([]);
    const [speakRate, setSpeakRate] = React.useState(() => {
      const raw = Number(readSpeakPref('rate'));
      return Number.isFinite(raw) && raw >= 0.5 && raw <= 2 ? raw : 1;
    });
    const [speakVoice, setSpeakVoice] = React.useState(() => String(readSpeakPref('voice') || ''));
    const speakRef = React.useRef({ gen: 0, list: [] });

    // 关掉阅读页（Esc / 关闭按钮 / 换书）时一定把声音停掉：组件卸载后
    // speechSynthesis 仍然会把队列念完，那就会在写作页里突然有人开口。
    React.useEffect(() => () => {
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (synth) {
        try { synth.cancel(); } catch (err) { /* 已经停了 */ }
      }
    }, []);

    // 浮层收起的两种手势：点别处、按 Esc。Esc 要在读页的关闭逻辑之前吃掉，
    // 否则「关掉朗读设置」会连带把整本书关掉。
    React.useEffect(() => {
      if (!speakMenu) return undefined;
      const onDown = (ev) => {
        const bar = ev.target && ev.target.closest ? ev.target.closest('.nw-read-speakbar') : null;
        if (!bar) setSpeakMenu(false);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          setSpeakMenu(false);
        }
      };
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      return () => {
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
      };
    }, [speakMenu]);

    React.useEffect(() => {
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      if (!synth || typeof synth.getVoices !== 'function') return undefined;
      const read = () => {
        try {
          const all = synth.getVoices() || [];
          const zh = all.filter((v) => /^zh/i.test(String(v.lang || '')));
          setSpeakVoices(zh.length ? zh : all);
        } catch (err) {
          /* 有些实现会在这里抛，朗读本身仍然能用 */
        }
      };
      read();
      try { synth.addEventListener('voiceschanged', read); } catch (err) { synth.onvoiceschanged = read; }
      return () => {
        try { synth.removeEventListener('voiceschanged', read); } catch (err) { synth.onvoiceschanged = null; }
      };
    }, []);

    const markSpeaking = React.useCallback((el) => {
      const flow = flowRef.current;
      if (!flow) return;
      const prev = flow.querySelector('.nw-read-p.is-speaking');
      if (prev && prev !== el) prev.classList.remove('is-speaking');
      if (el && el.classList) el.classList.add('is-speaking');
    }, []);

    /** 收掉在线/自定义引擎那一层：一个复用的 Audio 元素 + 一个 object URL。 */
    const dropAudio = React.useCallback(() => {
      const el = speakRef.current.audio;
      if (el) {
        try { el.pause(); } catch (err) { /* 已经停了 */ }
        try { el.removeAttribute('src'); el.load(); } catch (err) { /* 同上 */ }
      }
      const url = speakRef.current.url;
      if (url) {
        try { URL.revokeObjectURL(url); } catch (err) { /* 同上 */ }
      }
      speakRef.current.url = '';
    }, []);

    const stopSpeak = React.useCallback(() => {
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      speakRef.current.gen += 1;
      speakRef.current.list = [];
      if (synth) {
        try { synth.cancel(); } catch (err) { /* 已经停了 */ }
      }
      dropAudio();
      const flow = flowRef.current;
      if (flow) {
        const cur = flow.querySelector('.nw-read-p.is-speaking');
        if (cur) cur.classList.remove('is-speaking');
      }
      setSpeaking(false);
    }, [dropAudio]);

    /** base64 → Blob（宿主把音频放在 JSON 信封里，省一条裸字节路由）。 */
    const audioBlob = React.useCallback((payload) => {
      const raw = String((payload && payload.audio) || '');
      if (!raw) throw new Error('朗读接口没有返回音频');
      const bin = typeof atob === 'function' ? atob(raw) : Buffer.from(raw, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: String((payload && payload.mime) || 'audio/mpeg') });
    }, []);

    /**
     * 在线 / 自定义引擎：一段一段问宿主要音频，播完再要下一段。
     *
     * 复用同一个 Audio 元素（不是每段 new 一个）：Chromium 只在用户点过之后
     * 允许自动播放，同一个元素一路 play 下去还算「这次交互里」，换新元素就容易
     * 被拦。下一段在第一段还在响的时候就开始取，中间不留空档。
     */
    const speakRemote = React.useCallback((startIndex) => {
      const flow = flowRef.current;
      if (!flow || !NW.io || !NW.io.tts) return;
      const all = Array.prototype.slice.call(flow.querySelectorAll('p.nw-read-p'));
      const list = all.filter((el) => String(el.textContent || '').trim().length > 1);
      if (!list.length) return;

      const gen = speakRef.current.gen + 1;
      speakRef.current.gen = gen;
      speakRef.current.list = list;
      setSpeakError('');
      setSpeaking(true);

      const el = speakRef.current.audio || (typeof Audio === 'function' ? new Audio() : null);
      if (!el) {
        stopSpeak();
        return;
      }
      el.preload = 'auto';
      speakRef.current.audio = el;

      const stepNow = step > 0 ? step : 1;
      const pageOf = (node) => Math.max(0, Math.floor((node.offsetLeft || 0) / stepNow));
      const textOf = (node) => String(node.textContent || '').replace(/\s+/g, ' ').trim();

      // 每一段的请求都缓存起来：预取的那一段在真正播的时候直接复用，不再问一次。
      const pending = [];
      const want = (at) => {
        if (at >= list.length) return null;
        if (pending[at]) return pending[at];
        const cfg = cfgRef.current;
        const text = textOf(list[at]);
        if (!text) return null;
        const job = NW.io.tts
          .speak({
            engine: cfg.engine,
            text,
            rate: speakRate,
            voice: cfg.engine === 'edge' ? cfg.edgeVoice : cfg.api.voice,
            edgeVoice: cfg.edgeVoice,
            api: cfg.api,
          })
          .then((payload) => audioBlob(payload));
        pending[at] = job;
        return job;
      };

      const fail = (err) => {
        if (speakRef.current.gen !== gen) return;
        setSpeakError(err && err.message ? err.message : String(err || '朗读失败'));
        stopSpeak();
      };

      const play = (at) => {
        if (speakRef.current.gen !== gen) return;
        if (at >= list.length) {
          stopSpeak();
          return;
        }
        const node = list[at];
        const page = pageOf(node);
        if (page !== pageRef.current) scrollToPage(Math.max(0, Math.min(maxPage, page)));
        markSpeaking(node);
        // 预取下一段：这一段还在响的时候就把下一段的请求发出去。
        if (at + 1 < list.length) want(at + 1);
        const job = want(at);
        if (!job) {
          window.setTimeout(() => { if (speakRef.current.gen === gen) play(at + 1); }, 0);
          return;
        }
        job.then((blob) => {
          if (speakRef.current.gen !== gen) return;
          dropAudio();
          const url = URL.createObjectURL(blob);
          speakRef.current.url = url;
          el.onended = () => {
            if (speakRef.current.gen === gen) play(at + 1);
          };
          el.onerror = () => {
            if (speakRef.current.gen === gen) fail(new Error('音频播放失败'));
          };
          el.src = url;
          const started = el.play();
          if (started && typeof started.catch === 'function') {
            started.catch((err) => fail(err));
          }
        }).catch(fail);
      };

      play(Math.max(0, Math.min(list.length - 1, startIndex)));
    }, [audioBlob, dropAudio, markSpeaking, maxPage, scrollToPage, speakRate, stopSpeak]);

    // 句子在纸上换页时把纸翻过去：念到一半跳页很刺眼，所以只在「下一段不在
    // 当前这一页」时瞬移，和手动翻页走同一个落位函数（quietRef 会挡住回弹）。
    const speakFrom = React.useCallback((startIndex) => {
      // 在线/自定义引擎不需要 speechSynthesis；系统语音那条路继续往下走。
      if (cfgRef.current.engine !== 'system') {
        speakRemote(startIndex);
        return;
      }
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
      const flow = flowRef.current;
      // 没有引擎就静静地不开始：朗读是锦上添花，不该弹一个错误框打断阅读。
      if (!synth || !flow) return;
      const all = Array.prototype.slice.call(flow.querySelectorAll('p.nw-read-p'));
      const list = all.filter((el) => String(el.textContent || '').trim().length > 1);
      if (!list.length) return;
      const gen = speakRef.current.gen + 1;
      speakRef.current.gen = gen;
      speakRef.current.list = list;
      setSpeaking(true);

      const stepNow = step > 0 ? step : 1;
      const pageOf = (el) => Math.max(0, Math.floor((el.offsetLeft || 0) / stepNow));

      const voice = (() => {
        let voices = [];
        try { voices = synth.getVoices() || []; } catch (err) { voices = []; }
        if (speakVoice) {
          const hit = voices.find((v) => v.voiceURI === speakVoice || v.name === speakVoice);
          if (hit) return hit;
        }
        const zh = voices.filter((v) => /^zh/i.test(String(v.lang || '')));
        const pool = zh.length ? zh : voices;
        const prefer = ['Xiaoxiao', 'Xiaoyi', 'Yunxi', 'Yunyang', 'Yunjian', 'Huihui', 'Yaoyao', 'Kangkang', 'Tingting', 'Meijia', 'Sinji'];
        for (let i = 0; i < prefer.length; i += 1) {
          const hit = pool.find((v) => String(v.name || '').indexOf(prefer[i]) >= 0);
          if (hit) return hit;
        }
        return pool[0] || null;
      })();

      const say = (at) => {
        if (speakRef.current.gen !== gen) return;
        if (at >= list.length) {
          stopSpeak();
          return;
        }
        const el = list[at];
        const page = pageOf(el);
        if (page !== pageRef.current) scrollToPage(Math.max(0, Math.min(maxPage, page)));
        markSpeaking(el);
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) {
          say(at + 1);
          return;
        }
        let u = null;
        try {
          u = new window.SpeechSynthesisUtterance(text);
        } catch (err) {
          stopSpeak();
          return;
        }
        u.lang = (voice && voice.lang) || 'zh-CN';
        u.rate = speakRate;
        u.pitch = 1;
        if (voice) u.voice = voice;
        u.onend = () => {
          if (speakRef.current.gen === gen) say(at + 1);
        };
        u.onerror = () => {
          if (speakRef.current.gen === gen) stopSpeak();
        };
        try {
          synth.speak(u);
        } catch (err) {
          stopSpeak();
        }
      };

      say(Math.max(0, Math.min(list.length - 1, startIndex)));
    }, [markSpeaking, maxPage, scrollToPage, speakRate, speakRemote, speakVoice, step, stopSpeak]);

    const startSpeakHere = React.useCallback(() => {
      if (speaking) {
        stopSpeak();
        return;
      }
      const flow = flowRef.current;
      if (!flow) return;
      const stepNow = step > 0 ? step : 1;
      const all = Array.prototype.slice.call(flow.querySelectorAll('p.nw-read-p'));
      const now = pageRef.current;
      // 从「当前这一页的第一段」念起，而不是从全书第一段。
      let start = all.findIndex((el) => Math.max(0, Math.floor((el.offsetLeft || 0) / stepNow)) === now);
      if (start < 0) start = Math.max(0, all.findIndex((el) => Math.floor((el.offsetLeft || 0) / stepNow) > now));
      speakFrom(start < 0 ? 0 : start);
    }, [speakFrom, speaking, step, stopSpeak]);

    /** 语速只对「下一段」生效，所以换档时把正在念的那一段重念一遍。 */
    const restartAt = React.useCallback(() => {
      const flow = flowRef.current;
      const cur = flow ? flow.querySelector('.nw-read-p.is-speaking') : null;
      const all = flow ? Array.prototype.slice.call(flow.querySelectorAll('p.nw-read-p')) : [];
      const at = cur ? all.indexOf(cur) : -1;
      stopSpeak();
      if (at >= 0) {
        window.setTimeout(() => { speakFrom(at); }, 30);
      }
    }, [speakFrom, stopSpeak]);

    const changeRate = React.useCallback((next) => {
      const value = Number(next);
      if (!Number.isFinite(value)) return;
      setSpeakRate(value);
      writeSpeakPref('rate', value);
      if (speaking) restartAt();
    }, [restartAt, speaking]);

    const changeEngine = React.useCallback((next) => {
      const value = engineOf(next);
      if (value === speakEngine) return;
      setSpeakEngine(value);
      writeSpeakPref('engine', value);
      setSpeakError('');
      if (speaking) stopSpeak();
    }, [speakEngine, speaking, stopSpeak]);


    // ---- 选字 → 标注 --------------------------------------------------------
    //
    // 每一段都带着自己在章节全文里的起点（`data-start`），所以一次选区可以翻
    // 译成「哪一章、第几个字到第几个字」——标注就是用这组下标存的，跟界面上
    // 怎么分段、怎么分页都无关。
    const [sel, setSel] = React.useState(null);
    // R50: 点一条标注之后先浮出一个两个按钮的小菜单（删除 / 批注）；批注正文则在
    // 一个贴着点击处的小编辑框里改，不再占用屏幕底下那块大白板。
    const [picked, setPicked] = React.useState(null);
    const [editing, setEditing] = React.useState(null);
    const [noteDraft, setNoteDraft] = React.useState('');
    // R53：新写一条批注不再弹 `NW.ui.prompt` 那块大对话框——就在选中的字旁边
    // 展开一张便签，写完按保存才落库，按取消就当没发生过。
    const [composer, setComposer] = React.useState(null);
    const [composerNote, setComposerNote] = React.useState('');

    // ---- 自动保存（R53g）----------------------------------------------------
    // 批注框不再有「保存 / 取消」。字打进去就存，停下来 700ms 落一次库；关掉框
    // （点别处、Esc、滚动、翻页）时立刻把还没落的那一次补上。
    //
    // 为什么不是每个按键都存：`onNote` 背后是 db.updateMark → notify → 应用层
    // refreshMarks → marks 换新 → 本组件的 body 重新把整本书拆一遍段落。一本
    // 二十万字的稿子两万行，每按一个字拆一次会当场卡住。合并成一次写，既保住
    // 「不用点保存」，也不让打字变成重活。
    const noteSaveRef = React.useRef({ id: '', timer: 0, body: '', saved: '', dirty: false });
    const composerSaveRef = React.useRef({ id: '', timer: 0, body: '', saved: '', draft: null });
    // 这一下 pointerdown 是不是「把浮层点掉」的。pointerup 里据此跳过翻页。
    // 存时间戳而不是布尔：点在正文外时 flow 收不到 pointerup，布尔会一直挂着，
    // 把下一次正常的翻页吞掉。
    const dismissedRef = React.useRef(0);

    const flushNote = React.useCallback(() => {
      const st = noteSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      if (!st.dirty || !st.id) return;
      st.dirty = false;
      const body = String(st.body || '').trim();
      if (body === st.saved) return;
      st.saved = body;
      if (typeof p.onNote === 'function') p.onNote(st.id, body);
    }, [p.onNote]);

    const scheduleNote = React.useCallback((id, body) => {
      const st = noteSaveRef.current;
      st.id = String(id);
      st.body = body;
      st.dirty = true;
      if (st.timer) window.clearTimeout(st.timer);
      st.timer = window.setTimeout(() => {
        st.timer = 0;
        flushNote();
      }, 700);
    }, [flushNote]);

    // 删掉一条批注前先把待写的这一次作废：先存再删是白跑一趟，而且万一删除先
    // 落库、保存后落库，还会留下一条「刚删掉又冒出来」的行。
    const dropNote = React.useCallback(() => {
      const st = noteSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      st.dirty = false;
    }, []);

    // 新写的那条批注：第一次出现非空文字时才真正建行（否则「写批注」点开又
    // 什么都不写，会留下一条有批注底色却没有签的空批注——三种状态里最说不清的
    // 一种）。建好之后就是普通的改批注。
    const commitComposer = React.useCallback(() => {
      const st = composerSaveRef.current;
      if (st.timer) {
        window.clearTimeout(st.timer);
        st.timer = 0;
      }
      const body = String(st.body || '').trim();
      if (st.id) {
        if (body === st.saved) return;
        st.saved = body;
        if (typeof p.onNote === 'function') p.onNote(st.id, body);
        return;
      }
      if (!body || !st.draft) return;
      // 第一次落库是异步的（`p.onMark` 走 db 再回来才有 id）。这期间用户还在打字，
      // 700ms 的下一拍会再进来一次——那时 `st.id` 还是空的，会再建一条。db 层按
      // 「同章 + 同起止」会合并，但这里也没必要让它白跑一趟，用一个 pending 挡住。
      //
      // R81: 这里**不能**把新文字写进 `st.saved`。写进去就等于告诉后续提交
      // 「这一版已经存过了」，而真正落库的是第一次那版；用户在这几十毫秒里补的
      // 最后一句就永远丢了。保持 dirty，等 id 回来再补写一次。
      if (st.pending) return;
      st.saved = body;
      st.pending = true;
      const draft = st.draft;
      if (typeof p.onMark === 'function') {
        Promise.resolve(p.onMark({
          chapterId: draft.chapterId,
          kind: 'comment',
          start: draft.start,
          end: draft.end,
          quote: draft.quote,
          note: body,
        })).then((created) => {
          st.pending = false;
          if (created && created.id != null) {
            st.id = String(created.id);
            // 建行期间又打的字：现在有 id 了，补一次真正的写入。
            const latest = String(st.body || '').trim();
            if (latest && latest !== st.saved) {
              st.saved = latest;
              if (typeof p.onNote === 'function') p.onNote(st.id, latest);
            }
          }
          // 关闭批注框时请求还在飞：等 id 落地后再丢弃这个会话，否则 id 会写进
          // 一个已经被换掉的对象，下一次同段批注会重复建行。
          if (st.closed && composerSaveRef.current === st) {
            composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
          }
        }).catch(() => {
          st.pending = false;
          if (st.closed && composerSaveRef.current === st) {
            composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
          }
        });
      } else {
        st.pending = false;
      }
    }, [p.onMark, p.onNote]);

    const scheduleComposer = React.useCallback((body) => {
      const st = composerSaveRef.current;
      st.body = body;
      if (st.timer) window.clearTimeout(st.timer);
      st.timer = window.setTimeout(() => {
        st.timer = 0;
        commitComposer();
      }, 700);
    }, [commitComposer]);

    // 关掉整个「读一遍」时别把最后一句丢了。
    React.useEffect(() => () => {
      flushNote();
      commitComposer();
    }, [flushNote, commitComposer]);

    // ---- 点别处收起（R53g）--------------------------------------------------
    // 用户要的是「鼠标点击其他任何地方，批注输入框收起来」。只在 flow 里监听不够：
    // 顶栏、页脚、页边签、甚至窗口外框都算「其他地方」。所以在 document 上做捕获，
    // 命中就收——但落在 `.nw-mark-pop`（也就是输入框自己）和正在编辑的那条标注
    // 上时不收，否则点一下输入框里的字就把它关了。
    //
    // 用 pointerdown 而不是 click：点击的顺序是 pointerdown → blur → click，若等到
    // click，textarea 的 blur 已经先触发过一次保存，框也会在按下与松开之间闪一下。
    // 捕获阶段先处理，一次点击只收一次。
    React.useEffect(() => {
      const onDown = (ev) => {
        const node = ev && ev.target;
        if (!node || typeof node.closest !== 'function') return;
        // 点在输入框里（含删除按钮）：不关。
        if (node.closest('.nw-mark-pop')) return;
        // 点在「正在编辑的那条批注」上：也不关，那是它的锚点。
        if (node.closest('.nw-mark[data-mark]')) return;
        if (node.closest('.nw-mark-side')) return;
        if (composerRef.current && composerRef.current.contains && composerRef.current.contains(node)) return;
        if (noteRef.current && noteRef.current.contains && noteRef.current.contains(node)) return;
        // 这一下如果是「把框点掉」，就不要再当成翻页：一次 pointerdown 既收框又
        // 翻页，等于点一下同时做了两件事，用户只会觉得「手一抖书就翻了」。
        if (picked || editing || composer) dismissedRef.current = Date.now();
        // 收起之前先把字存掉——收起 = 保存。
        if (noteSaveRef.current.dirty || noteSaveRef.current.timer) flushNote();
        if (composerSaveRef.current.timer || composerSaveRef.current.body) {
          commitComposer();
          const st = composerSaveRef.current;
          if (st.pending) {
            // R81: keep the in-flight object so its id (and the last sentence)
            // can land; the `.then` resets the ref once it is done.
            st.closed = true;
            st.timer = 0;
          } else {
            composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
          }
        }
        setPicked(null);
        setEditing(null);
        setComposer(null);
        setComposerNote('');
        activeRef.current = '';
        const flow = flowRef.current;
        if (flow) {
          const spans = flow.querySelectorAll('.nw-mark[data-mark][data-active]');
          for (let i = 0; i < spans.length; i += 1) spans[i].removeAttribute('data-active');
        }
        const layer = gutterRef.current;
        if (layer) {
          const signs = layer.querySelectorAll('.nw-mark-side[data-active]');
          for (let i = 0; i < signs.length; i += 1) signs[i].removeAttribute('data-active');
        }
      };
      document.addEventListener('pointerdown', onDown, true);
      return () => document.removeEventListener('pointerdown', onDown, true);
    }, [flushNote, commitComposer, picked, editing, composer]);

    function locateNode(node) {
      let el = node;
      if (el && el.nodeType === 3) el = el.parentNode;
      if (!el || typeof el.closest !== 'function') return null;
      const para = el.closest('p[data-start]');
      if (!para) return null;
      const section = para.closest('[data-chapter-id]');
      if (!section) return null;
      return {
        para: para,
        chapterId: String(section.getAttribute('data-chapter-id') || ''),
        base: Number(para.getAttribute('data-start')) || 0,
      };
    }

    function offsetIn(node, offset) {
      const hit = locateNode(node);
      if (!hit) return null;
      try {
        const r = document.createRange();
        r.setStart(hit.para, 0);
        r.setEnd(node, offset);
        return {
          chapterId: hit.chapterId,
          at: hit.base + String(r.toString() || '').length,
        };
      } catch (err) {
        return null;
      }
    }

    // Selection 变化时算出「原文区间」。跨章、跨段的选区都支持：两端各翻译一次。
    const readSelection = React.useCallback(() => {
      const sel0 = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (!sel0 || !sel0.rangeCount) return null;
      const text = String(sel0.toString() || '');
      if (!text.trim()) return null;
      const range = sel0.getRangeAt(0);
      const a = offsetIn(range.startContainer, range.startOffset);
      const b = offsetIn(range.endContainer, range.endOffset);
      if (!a || !b) return null;
      if (a.chapterId !== b.chapterId) return null;
      const start = Math.min(a.at, b.at);
      const end = Math.max(a.at, b.at);
      if (end <= start) return null;
      let rect = null;
      try {
        rect = range.getBoundingClientRect();
      } catch (err) {
        rect = null;
      }
      return {
        chapterId: a.chapterId,
        start: start,
        end: end,
        text: text.replace(/\s+\n/g, '\n'),
        x: rect ? rect.left + rect.width / 2 : 0,
        y: rect ? rect.top : 0,
      };
    }, []);

    const addMark = React.useCallback((kind) => {
      const cur = sel;
      if (!cur) return;
      // 同一条线重复画：db 层会把「同章 + 同起止」并成一条，所以这里照常提交，
      // 画第二遍只会把这条线换成新类型，不会多出一条删不掉的影子。
      if (typeof p.onMark === 'function') {
        p.onMark({
          chapterId: cur.chapterId,
          kind: kind,
          start: cur.start,
          end: cur.end,
          quote: cur.text.slice(0, 240),
          note: '',
        });
      }
      clearSelection();
    }, [sel, p.onMark]);

    const clearSelection = () => {
      setSel(null);
      const s = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s) s.removeAllRanges();
    };

    // R53：原来这里调 `NW.ui.prompt`，弹的是屏幕正中一块大白板，跟选中的字
    // 完全脱开；用户说「输入框太大」。现在只记下选区，让渲染层在选区旁边画
    // 一张一行高的便签。R53g：便签上没有保存键——字打进去就存（停 700ms 落库，
    // 收起来时补最后一次）。
    const openComposer = React.useCallback(() => {
      const cur = sel;
      if (!cur) return;
      setPicked(null);
      setEditing(null);
      setComposerNote('');
      const st = composerSaveRef.current;
      if (st.timer) window.clearTimeout(st.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer({
        chapterId: cur.chapterId,
        start: cur.start,
        end: cur.end,
        quote: cur.text.slice(0, 240),
        x: cur.x,
        y: cur.y + 18,
      });
    }, [sel]);

    const closeComposer = React.useCallback(() => {
      // 收起来之前把没落库的那一次补上——「点别处收起」不等于「放弃」。
      commitComposer();
      const st = composerSaveRef.current;
      if (st.timer) window.clearTimeout(st.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer(null);
      setComposerNote('');
      clearSelection();
    }, [commitComposer]);

    // 讲清楚「点一下标注会发生什么」：就在点的位置浮出两个小按钮——删除 / 批注。
    // 点亮那几个 `<span>` 用 DOM 直接改属性，不把 picked 塞进正文的 useMemo
    // 依赖——否则每点一次标注就要把全书重新拆一遍段（正是 R44 修掉的卡顿）。
    const openMark = React.useCallback((id, ev) => {
      const list = marks.filter((m) => String(m.id) === String(id));
      const mark = list[0];
      if (!mark) return;
      // R53：弹层贴着**点击处**张开。R50 时是贴着「离点击最近的那一行字」的
      // 右下角，点在句子中间时框会飘到行尾十几厘米外，用户还得回手去够它。
      // 现在只在拿不到点击坐标时（键盘/程序触发）才退回行盒定位。
      const flow = flowRef.current;
      let clickX = ev && typeof ev.clientX === 'number' ? ev.clientX : NaN;
      let clickY = ev && typeof ev.clientY === 'number' ? ev.clientY : NaN;
      let best = null;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark="' + String(id) + '"]');
        let bestDist = Infinity;
        for (let i = 0; i < spans.length; i += 1) {
          const rects = spans[i].getClientRects ? spans[i].getClientRects() : [];
          for (let k = 0; k < rects.length; k += 1) {
            const r = rects[k];
            if (!r || (!r.width && !r.height)) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dist = Math.abs(cx - (Number.isFinite(clickX) ? clickX : cx))
              + Math.abs(cy - (Number.isFinite(clickY) ? clickY : cy));
            if (dist < bestDist) { bestDist = dist; best = r; }
          }
        }
        for (let i = 0; i < spans.length; i += 1) {
          spans[i].setAttribute('data-active', spans[i].getAttribute('data-mark') === String(id) ? '1' : '0');
        }
      }
      activeRef.current = String(id);
      const layer = gutterRef.current;
      if (layer) {
        const signs = layer.querySelectorAll('.nw-mark-side');
        for (let i = 0; i < signs.length; i += 1) {
          if (signs[i].getAttribute('data-mark') === String(id)) signs[i].setAttribute('data-active', '1');
          else signs[i].removeAttribute('data-active');
        }
      }
      if (!Number.isFinite(clickX) || !Number.isFinite(clickY)) {
        if (!best) return;
        clickX = best.left + Math.min(best.width, 120) * 0.4;
        clickY = best.top + best.height / 2;
      }
      // 打开一张新面板就把便签收起来，同时只留一个浮层。R53g：收之前先把便签里
      // 还没落库的字存掉——「换看另一条」不是「把刚写的扔掉」。
      commitComposer();
      const cst = composerSaveRef.current;
      if (cst.timer) window.clearTimeout(cst.timer);
      composerSaveRef.current = { id: '', timer: 0, body: '', saved: '', draft: null };
      setComposer(null);
      setComposerNote('');
      // R53e：文字只属于批注，所以「是不是批注」直接看有没有文字——一条带字的
      // 线就是批注，点它就开编辑框。下划线和删除线（没有字）则先问「删了它，还是
      // 给它写一句」，因为这两件事对一条线都说得通，而线本身并不暗示哪一个。
      if (String(mark.kind) === 'comment' || String(mark.note || '').trim()) {
        setPicked(null);
        // 换到另一条批注之前，把上一条还没落库的字补上。
        flushNote();
        const st = noteSaveRef.current;
        st.id = String(mark.id);
        st.body = String(mark.note || '');
        st.saved = String(mark.note || '').trim();
        st.dirty = false;
        setNoteDraft(String(mark.note || ''));
        setEditing({ mark: mark, x: clickX, y: clickY });
        return;
      }
      flushNote();
      setEditing(null);
      setPicked({ mark: mark, x: clickX, y: clickY });
    }, [marks, commitComposer, flushNote]);

    const closeMark = React.useCallback(() => {
      // R53g：收起批注框 = 保存，不是放弃。没有保存键，那一下必须在这里补。
      flushNote();
      setPicked(null);
      setEditing(null);
      activeRef.current = '';
      const flow = flowRef.current;
      if (flow) {
        const spans = flow.querySelectorAll('.nw-mark[data-mark]');
        for (let i = 0; i < spans.length; i += 1) spans[i].setAttribute('data-active', '0');
      }
      const layer = gutterRef.current;
      if (layer) {
        const signs = layer.querySelectorAll('.nw-mark-side[data-active]');
        for (let i = 0; i < signs.length; i += 1) signs[i].removeAttribute('data-active');
      }
    }, [flushNote]);

    // ---- 页边批注签（R53）---------------------------------------------------
    // 一条带批注的标注，在这一页的右侧页边留一个小签，和它指向的那一行齐平。
    // 只在当前页上画：翻过去之后下一页的签会由 scroll/重排重新算出来。
    // 正文里不再有任何角标节点，所以「遮挡字体」从结构上就不可能再发生。
    const paintGutter = React.useCallback(() => {
      const layer = gutterRef.current;
      const stage = stageRef.current;
      const flow = flowRef.current;
      if (!layer) return;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      // 重画时把上一轮的悬停点亮清掉：签是新建的，正文上的 data-hover 却留在旧
      // 节点上——不扫一遍的话，改完字之后会有一句话一直亮着，像被选中了一样。
      const stale = flow ? flow.querySelectorAll('.nw-mark[data-hover]') : [];
      for (let i = 0; i < stale.length; i += 1) stale[i].removeAttribute('data-hover');
      if (!stage || !flow) return;
      const w = layout.w;
      if (!w) return;
      const cols = layout.cols || 1;
      const gap = layout.gap || 0;
      // R55：一页现在可能是两栏。判定「这句在不在这页上」要用**页宽**（两栏加
      // 中间的空档），不是一栏的宽——否则右半页的批注全都不出签。
      const pageW = w * cols + gap * (cols - 1);
      const stageRect = stage.getBoundingClientRect();
      const flowRect = flow.getBoundingClientRect();
      // R56：对开时签要分左右。
      // 用户说「批注左页的在左侧，右页在右侧，变回单页时再回到右侧」——对开是
      // 摊开的书，视线落在哪一页，那页的话就在哪一页的**外缘**；两页的签都挤在
      // 书缝右边的话，左页的签会在右页的正文旁边，指认起来是错的。
      // 所以 x 不再是常量：左栏的签落在整本书的左外侧，右栏的签落在右外侧，
      // 单页（cols === 1）时所有签都回到右侧，和 R53 一样。
      const PAD = 3;
      const SIDE_W = 16;
      // 左缘可能不够宽（stage 的左右 padding 是 clamp(20px,6vw,64px)，最窄 20px
      // 而那正好是签要占的 16+3=19px）。gutter 是 overflow:hidden，所以夹一下，
      // 不够就退回书内侧，宁可挤一点也不能让签整枚消失。
      const leftOuter = Math.max(
        0,
        Math.round(flowRect.left - stageRect.left - SIDE_W - PAD),
      );
      const rightOuter = Math.round(flowRect.right - stageRect.left + PAD);
      const notes = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        if (!m || m.id == null) continue;
        const body = String(m.note || '').trim();
        // R53e：签只属于**有字**的批注。以前这里放行 `kind==='comment'` 的空批注，
        // 结果会有一枚签指着一句没有任何话的话；现在批注必须有文字，没字就没有签。
        if (!body) continue;
        notes[String(m.id)] = body;
      }
      // 序号：同一章里所有带批注的标注按 start 排，1、2、3……章内唯一。
      // 读者看到的是「第 3 条批注」，而不是一枚和隔壁一模一样的点。
      const seq = {};
      const byChapter = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        if (!m || m.id == null) continue;
        if (!Object.prototype.hasOwnProperty.call(notes, String(m.id))) continue;
        const ck = String(m.chapterId || '');
        if (!byChapter[ck]) byChapter[ck] = [];
        byChapter[ck].push(m);
      }
      const chapterKeys = Object.keys(byChapter);
      for (let i = 0; i < chapterKeys.length; i += 1) {
        const list = byChapter[chapterKeys[i]].slice().sort(
          (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0),
        );
        for (let k = 0; k < list.length; k += 1) seq[String(list[k].id)] = k + 1;
      }
      const spans = flow.querySelectorAll('.nw-mark[data-mark]');
      const tops = {};
      for (let i = 0; i < spans.length; i += 1) {
        const id = spans[i].getAttribute('data-mark') || '';
        if (!Object.prototype.hasOwnProperty.call(notes, id)) continue;
        if (tops[id] != null) continue;
        const rects = spans[i].getClientRects ? spans[i].getClientRects() : [];
        for (let k = 0; k < rects.length; k += 1) {
          const r = rects[k];
          if (!r || (!r.width && !r.height)) continue;
          // 只给当前页上的片段配签：下一页的等翻过去再说。对开时一页横跨两栏，
          // 所以这里用 pageW。
          if (r.left < flowRect.left - 1 || r.left > flowRect.left + pageW - 2) continue;
          // R56：这句落在哪一栏？左栏的签去左边，右栏的签去右边。用片段的中心点
          // 判，而不是左边缘——一个长句可能跨过栏界（虽然多栏布局通常不会让一行
          // 跨栏，但取中心的容错更好）。
          const cx = r.left + r.width / 2;
          // column 0 = 本页左栏。一栏宽 w、栏距 gap，所以第 n 栏的左边界是
          // flowRect.left + n * (w + gap)。
          const colAt = Math.max(0, Math.min(cols - 1, Math.floor((cx - flowRect.left) / (w + gap))));
          const onLeft = cols > 1 && colAt === 0;
          tops[id] = {
            y: r.top + Math.min(r.height, 30) / 2 - stageRect.top,
            onLeft: onLeft,
          };
          break;
        }
      }
      const rows = Object.keys(tops)
        .map((id) => ({ id: id, y: tops[id].y, onLeft: tops[id].onLeft, note: notes[id] }))
        .sort((a, b) => a.y - b.y);
      const used = [];
      const usedL = [];
      const SIDE_H = 16;
      // 同一行挂了多条批注时，签会往下错开一格，免得两枚叠成一个。错开之后
      // 靠什么分辨？R53c 的答案不再是引线（用户说那条细线看不出来），而是
      // **句子自己变色**：鼠标停在签上、或点开一条批注时，它指的那句亮起来，
      // 签上的序号说「第几条」。一冷一热两个信号，比在页边画线清楚得多。
      // R56：左右两边的签各自排自己的队——它们在书的两侧，本就不会相撞，
      // 混在一个 used 里会让右边的签因为左边的位置而无谓地下移。
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const lane = row.onLeft ? usedL : used;
        let y = row.y - SIDE_H / 2;
        // 同一行挂了两条批注：第二个签往下让一格，别叠成一个。
        while (lane.some((u) => Math.abs(u - y) < SIDE_H + 2)) y += SIDE_H + 2;
        lane.push(y);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nw-mark-side';
        btn.setAttribute('data-mark', row.id);
        if (row.onLeft) btn.setAttribute('data-side', 'left');
        btn.setAttribute('aria-label', NW.t('第') + (seq[row.id] || '') + NW.t('条批注'));
        btn.title = (seq[row.id] ? '#' + seq[row.id] + ' ' : '') + (row.note || NW.t('批注')).slice(0, 80);
        btn.textContent = String(seq[row.id] || '');
        if (activeRef.current && activeRef.current === String(row.id)) btn.setAttribute('data-active', '1');
        // R53c：不再画引线（用户说看不出来）。同一行第二条批注靠「悬停/点开时
        // 句子变色」来指认——签上的序号说第几条，句子亮起来说哪一行。
        // R56：左页的签贴左外缘，右页的签贴右外缘；单页时 onLeft 恒为 false，
        // 于是所有签都在右侧，与之前完全一致。
        btn.style.left = (row.onLeft ? leftOuter : rightOuter) + 'px';
        btn.style.top = Math.round(y) + 'px';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openMark(row.id, ev);
        });
        // 悬停：把签指的那句点亮。同一行有两条批注时，靠这个一眼分清谁是谁。
        btn.addEventListener('mouseenter', () => {
          const own = flow.querySelectorAll('.nw-mark[data-mark="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].setAttribute('data-hover', '1');
        });
        btn.addEventListener('mouseleave', () => {
          const own = flow.querySelectorAll('.nw-mark[data-mark="' + row.id + '"]');
          for (let k = 0; k < own.length; k += 1) own[k].removeAttribute('data-hover');
        });
        layer.appendChild(btn);
      }
    }, [layout.w, layout.cols, layout.gap, marks, openMark]);

    // 滚动停下来之后重算一次：手指拖到半页时，签要跟着字走，不能停在旧行上。

    // ---- 量一次版面：定栏宽 → 读 scrollWidth → 得到页数 ----------------------
    //
    // R55: 分两页。用户的要求是「阅读页面如果是全屏模式下，请分两页」。
    //
    // 这里刻意**没有**去读某个「沉浸模式」标志：读一遍本身就是全屏的（它是
    // `.nw-read` 绝对定位铺满的浮层），没有一个单独的 immersive 开关可读；真正
    // 决定能不能并排放下两栏的，是**可用的宽度**。所以判据是宽度：一栏最多
    // 34 个汉字，两栏加中间的空档放得下就开对开，放不下就还是单页。窄面板（手机、
    // 侧栏挤出来的半屏）自动退回单页，不需要另一套逻辑。
    //
    // 三处步长都必须跟着页宽走，否则翻页会翻半页：
    //   - measure() 里的 total 和起始页偏移
    //   - scrollToPage() / turnTo() 里的 s
    //   - 滚动监听里换算页码的 s
    // 三者统一读 layout.step（= 一页有多宽，含中间的空档）。
    const measure = React.useCallback(() => {
      const stage = stageRef.current;
      const flow = flowRef.current;
      if (!stage || !flow) return;
      const cs = window.getComputedStyle(stage);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      // The geometry last measured (columns : page step). If it turns out to be
      // different, the copy on the sheet and the prose below no longer share a
      // pagination -- take the sheet down first, then measure the new one.
      const before = geometryRef.current;
      const avail = Math.max(240, stage.clientWidth - padX);
      const gap = parseFloat(window.getComputedStyle(flow).columnGap) || 0;
      // R125: 一行多少字最舒服。中文书 26–30 字读着最稳；双栏时再宽就成碎片
      // 句子，再窄就换行太勤（一行十来字，眼睛一直在跳）。
      const maxCol = Math.round(30 * fontSize);
      const minCol = Math.round(22 * fontSize);
      // R128：双栏的字数下限单开一条。22 字是「一行读起来最稳」的门槛，但双栏
      // 的价值在于「一眼看见两个栏位」，17 字（约 340px）依然成立，只有窄到
      // 连 17 字都放不下时才退回单栏——否则一千出头的面板会突兀地变成一整行
      // 三十多字，读起来反而累。
      // R136：门槛从 17 字降到 15 字（约 300px）。原来的 17 在常见面板宽度上
      // 恰好卡死：760 面板去掉 7vw 页边只剩 ≈654px，两栏各 303px 差一点够不到
      // 340px，于是用户明明选了双栏，看到的却是一页一栏。15 字仍是「一行十
      // 来个字」可读的门槛，换来的是双栏设置真的生效。
      const minCol2 = Math.round(15 * fontSize);
      // R138：四栏对开单开一条**更低**的线——十二字（约 240px）。用户的验收
      // 标准是「点阅读就整屏、一个屏幕两页、四栏」，1440/1512 这类屏幕整屏
      // 可用宽度约 1272，四栏各 282px（十四字）——按单页双栏那条十五字线永远
      // 差十几像素，于是整屏开着却只见一页两栏。四栏是「摊开的书」，每栏短一点
      // 反而像书页边注；真排不下十二字（窄屏、分屏）才老实退回单页双栏。
      const minColWide = Math.round(12 * fontSize);
      // R136：对开门槛 900 → 840。对开是「两页并排」，它的价值与双栏无关，
      // 840px 上一页只需 396px（约 20 字）就能成立，960 面板从此也能翻开对开。
      // 每页几栏、一屏几页：按「舒服」优先排，而不是先把宽度填满。
      //   ① 对开四栏（超宽屏才可能，而且每栏仍要有 22 字）
      //   ② 单页两栏（常规窗口里双栏排版的主场）
      //   ③ 对开每页一栏（双栏放不下时的传统书页）
      //   ④ 单页一栏（窄面板）
      const fitCol = (pages, texts) => {
        const total = pages * texts;
        return Math.floor((avail - gap * (total - 1)) / total);
      };
      const plan = readColumns >= 2
        ? [[2, 2], [1, 2], [2, 1], [1, 1]]
        : [[2, 1], [1, 1]];
      let cols = 1; // 一屏几页
      let textCols = 1; // 一页几栏
      let colW = 0; // 一栏的宽度
      for (let k = 0; k < plan.length; k += 1) {
        const pages = plan[k][0];
        const texts = plan[k][1];
        if (pages === 2 && avail < 840) continue;
        const candidate = fitCol(pages, texts);
        // 宽屏对开（一张纸四栏）要求每栏仍能排 18 字（R137 从 22 降到 18）：
        // 整屏 1920 去掉页边只剩 1752，四栏各 402px，22 字要 440px 差 38px，
        // 「一屏两页、一页两栏」在常见的大屏上根本开不出来。18 字（360px）
        // 仍是舒服的一行，换来整屏被真正用满。单页对开沿用 22 字，单页双栏
        // 用 15 字，窄面板才降到 22 字以下。
        const floor = texts >= 2
          ? (pages === 2 ? minColWide : minCol2)
          : minCol;
        if (candidate < floor) continue;
        cols = pages;
        textCols = texts;
        colW = Math.min(candidate, texts >= 2 ? maxCol : Math.round(34 * fontSize));
        break;
      }
      if (!colW) {
        // 面板窄到连 22 字都放不下：一页一栏，能吃多宽吃多宽。
        cols = 1;
        textCols = 1;
        colW = Math.max(160, Math.floor(Math.min(34 * fontSize, avail)));
      }
      // 一页 = textCols 栏正文 + 栏与栏之间那道空档；翻一页跨一整页，所以步长
      // 是「页宽 + 页与页之间的空档」。
      const w = colW * textCols + gap * (textCols - 1);
      const step = w + gap;
      const box = w * cols + gap * (cols - 1);
      stage.style.setProperty('--nw-read-col', colW + 'px');
      stage.style.setProperty('--nw-read-box', box + 'px');
      stage.style.setProperty('--nw-read-gap', gap + 'px');
      flow.style.setProperty('--nw-read-col', colW + 'px');
      flow.style.setProperty('--nw-read-box', box + 'px');
      if (cols > 1) flow.setAttribute('data-spread', '1');
      else flow.removeAttribute('data-spread');
      // R159：`total` 是「页」数，不是「栏」数。一页 = textCols 栏，所以先把
      // scrollWidth 折算成栏数，再除以每页的栏数。旧公式 (scrollWidth + gap) / step
      // 只在「每页两栏 + 对开」这一种尺寸下碰巧对——单栏、或一页一栏的对开都会算错，
      // 书末的页码跟着错。
      const span = flow.scrollWidth;
      const unitW = colW + gap;
      const columns = unitW > 0 ? Math.max(1, Math.round((span + gap) / unitW)) : 1;
      const total = Math.max(1, Math.ceil(columns / Math.max(1, textCols)));
      // 正文最多滚到 span - box，所以能整页停下的最后一页是 floor((span - box) / step)。
      // 半页的尾巴（栏数是奇数）滚不满一整步，这里必须取整，否则 End 会停在
      // 「正文被夹回一页、页码却按后一页印」的状态。
      const fit = step > 0
        ? Math.max(0, Math.min(total - 1, Math.floor((span - box) / step + 0.02)))
        : Math.max(0, total - 1);
      // 每一章从第几页开始：眉题要跟着当前页换章名，而翻页时绝不能去 DOM 里
      // 找——那是一个动画帧里最不该出现的事。这里量一次，翻页只查这个数组。
      const starts = [];
      for (let i = 0; i < chapters.length; i += 1) {
        const row = chapters[i];
        const key = row && row.id != null ? String(row.id) : '';
        const el = key ? marksRef.current[key] : null;
        if (!el) continue;
        const at = step > 0 ? Math.round(el.offsetLeft / step) : 0;
        starts.push({
          id: key,
          page: Math.max(0, Math.min(at, total - 1)),
          // 一章的左边界（px）：翻页时纸上那份副本要用它把 scrollLeft
          // 换算成「副本里的偏移」——读一次量好，翻页就不用再碰 DOM。
          left: el.offsetLeft || 0,
          // R128：章可以在栏中间开头（换章不再另起一栏），只记 left 的话
          // 「这一章从哪一行开始」就丢了——同一栏里的两章 left 完全一样，
          // 眉题会把整栏都算给后来那一章。多记一个 offsetTop（在栏内的纵向
          // 位置），查表时用它区分「栏首」和「栏中间」。
          top: el.offsetTop || 0,
          title: isPlaceholderTitle(row.title) ? '' : String(row.title || ''),
        });
      }
      starts.sort((a, b) => a.page - b.page);
      const geo = cols + ':' + textCols + ':' + colW + ':' + step + ':' + gap;
      if (before && before !== geo) abortTurn();
      geometryRef.current = geo;
      setLayout({ w, gap, total, fit, cols, textCols, colW, step, starts: starts });

      if (!jumpedRef.current) {
        jumpedRef.current = true;
        const mark = marksRef.current[startId];
        let start = 0;
        if (mark && typeof mark.offsetLeft === 'number' && step > 0) {
          start = Math.round(mark.offsetLeft / step);
        }
        start = Math.max(0, Math.min(start, fit));
        pageRef.current = start;
        setPage(start);
        setShown(start);
        // 开场这一跳必须瞬间到位：`scroll-behavior:smooth` 会让书从第一页
        // 滑到一半，看起来像是自己翻了几页。
        const wasBehavior = flow.style.scrollBehavior;
        flow.style.scrollBehavior = 'auto';
        flow.scrollLeft = Math.round(start * step);
        flow.style.scrollBehavior = wasBehavior;
      } else {
        setPage((cur) => {
          const next = Math.max(0, Math.min(cur, fit));
          pageRef.current = next;
          return next;
        });
        // R148：重排后正文书页被 clamp 了，舞台页码也一起 clamp，别让数字
        // 停在一页已经不存在的页上。
        setShown(Math.max(0, Math.min(shownPageRef.current, fit)));
        // R120: put the prose back on a page boundary. The step just changed
        // (a single page became a spread, or the panel was resized), while
        // scrollLeft still holds the old pixel offset -- off by part of a page,
        // which shows up as a slice of the NEXT column along the right edge,
        // i.e. three columns of text where the book claims to have two.
        const landed = Math.round(Math.max(0, Math.min(pageRef.current, fit)) * step);
        if (Math.abs(flow.scrollLeft - landed) > 1) {
          quietRef.current = Date.now() + 220;
          const wasBehavior = flow.style.scrollBehavior;
          flow.style.scrollBehavior = 'auto';
          flow.scrollLeft = landed;
          flow.style.scrollBehavior = wasBehavior;
        }
      }
      // lineHeight 不进 `--nw-read-col` 的算法，但它决定一栏能装多少行：
      // 行高变了 scrollWidth 就变，不重算 total 会把页码停在旧的总页数上。
    }, [fontSize, lineHeight, readColumns, currentId, startId, chapters, abortTurn]);

    React.useLayoutEffect(() => {
      measure();
      // 首帧之后再量一次：字体还没落地的面板里，第一次测量可能偏小。
      const raf = window.requestAnimationFrame(() => {
        const flow = flowRef.current;
        if (!flow) return;
        if (flow.scrollWidth <= flow.clientWidth + 4) measure();
      });
      const stage = stageRef.current;
      // 尺寸一变，栏宽、页边签的位置就全变了：量一次，再重画一次页边签
      // （下一页 rAF 里做，免得跟这次重排挤在同一帧）。
      const relayout = () => {
        measure();
        window.requestAnimationFrame(() => {
          const fn = paintGutterRef.current;
          if (typeof fn === 'function') fn();
        });
      };
      let ro = null;
      if (stage && typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => relayout());
        try {
          ro.observe(stage);
        } catch (err) {
          /* ignore */
        }
      }
      const onResize = () => relayout();
      window.addEventListener('resize', onResize);
      return () => {
        if (raf) window.cancelAnimationFrame(raf);
        if (ro) {
          try {
            ro.disconnect();
          } catch (err) {
            /* ignore */
          }
        }
        window.removeEventListener('resize', onResize);
      };
    }, [measure]);

    // 手指 / 触控板横向滚（触控板横滑、手机横拖）也要让页码跟上，停下来再对齐
    // 到整页。这里只做两件事：换页码、记一个「停下」的定时器——页边签一律不碰。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return undefined;
      let snapTimer = 0;
      const onScroll = () => {
        if (scrollRafRef.current) return;
        scrollRafRef.current = window.requestAnimationFrame(() => {
          scrollRafRef.current = 0;
          const s = step;
          if (!s) return;
          // 自己滚的那一段不参与：页码已经由 go() 定好了。
          if (Date.now() < quietRef.current) return;
          const index = Math.round(flow.scrollLeft / s);
          if (index !== pageRef.current) {
            pageRef.current = index;
            setPage(index);
            // R148：手动拖动是瞬时的正文移动，纸不在飞——页码跟着正文一起换。
            setShown(index);
          }
          // 手指/触控板停下 80ms 后回位到整页边界：**一次赋值，没有动画**。
          // 原来的「停 170ms 再花 110ms 吸过去」就是手感发滞的根源——那两段
          // 加起来快 300ms，期间用户已经开始下一次操作了。
          window.clearTimeout(snapTimer);
          snapTimer = window.setTimeout(() => {
            if (Date.now() < quietRef.current) return;
            const target = pageRef.current * s;
            if (Math.abs(flow.scrollLeft - target) <= 1) return;
            quietRef.current = Date.now() + 90;
            flow.scrollLeft = target;
          }, 80);
        });
      };
      flow.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        window.clearTimeout(snapTimer);
        if (scrollRafRef.current) {
          window.cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = 0;
        }
        flow.removeEventListener('scroll', onScroll);
      };
    }, [step]);

    // 滚轮 / 触控板：竖着滚也要翻页。横向滚动容器对竖向滚轮没有反应，
    // 而看书的人不会先想一想该往哪个方向滚。
    React.useEffect(() => {
      const flow = flowRef.current;
      if (!flow) return undefined;
      const onWheel = (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const dx = ev.deltaX || 0;
        const dy = ev.deltaY || 0;
        // 横滚、竖滚都翻页，按当次的主轴取方向。横滚**也**要拦下来：正文容器
        // 绝不能被浏览器自己横着滚出去（一滚就从装订线上穿过去了）。
        const main = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (!main) return;
        ev.preventDefault();
        const acc = wheelRef.current;
        const now = Date.now();
        if (now - acc.at > 160) acc.acc = 0;
        acc.at = now;
        acc.acc += main;
        const threshold = 40;
        if (Math.abs(acc.acc) < threshold) return;
        const delta = acc.acc > 0 ? 1 : -1;
        acc.acc = 0;
        go(delta);
      };
      flow.addEventListener('wheel', onWheel, { passive: false });
      return () => flow.removeEventListener('wheel', onWheel);
    }, [go]);

    // 键盘：方向键翻页，Home/End 到首尾。Esc 由 useModalEscape 负责。
    React.useEffect(() => {
      const onKey = (ev) => {
        if (ev.defaultPrevented) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        // 焦点在按钮/输入框上时，空格与方向键是那个控件的，不是翻页的。
        const node = ev.target;
        if (node && typeof node.closest === 'function' && node.closest('button, input, textarea, select')) return;
        const key = ev.key;
        if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
          ev.preventDefault();
          go(1);
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
          ev.preventDefault();
          go(-1);
          return;
        }
        if (key === 'Home') {
          ev.preventDefault();
          go(-maxPage - 1);
          return;
        }
        if (key === 'End') {
          ev.preventDefault();
          go(maxPage + 1);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [go, maxPage]);

    // 角落的提示会自己走开：留下来的是书，不是说明书。
    React.useEffect(() => {
      const timer = window.setTimeout(() => setHintOn(false), 5200);
      return () => window.clearTimeout(timer);
    }, []);

    // 指针三件事：点左半页回一页、点右半页翻一页、在纸面上按住横向拖跟手翻页。
    // 拖拽只从「不是正文」的地方起手（纸边、栏间空档、页眉页脚），正文上起手
    // 一定是想选字标注——那条路留给 readSelection。
    const onPointerDown = (ev) => {
      const node = ev.target;
      // 点在标注、工具条或批注面板上时，这一下是给它们的，不是翻页的。
      // 记下来在 pointerup 里用：一次点击会先 pointerup 再 click，如果 up 里
      // 就翻了页，等 click 打开批注时书已经跳到下一页了。
      const onSomething = !!(node && typeof node.closest === 'function'
        && node.closest('.nw-mark[data-mark], .nw-mark-bar, .nw-mark-pop, .nw-mark-side, .nw-read-gutter'));
      // 指针监听挂在整个舞台上（纸边、栏间空档也能起手拖），所以一切按钮
      // 和输入框都得先摘出去，否则点工具条/便签会连带翻一页。
      const onChrome = !!(node && typeof node.closest === 'function'
        && node.closest('button, a, input, textarea, select'));
      pointerRef.current = { x: ev.clientX, y: ev.clientY, onSomething: onSomething || onChrome };
      dragRef.current = null;
      if (onSomething || onChrome) return;
      if (ev.pointerType === 'touch' || ev.button !== 0) return;
      if (node && typeof node.closest === 'function'
        && node.closest('p[data-start], h2, .nw-mark, button, a, input, textarea, select')) return;
      const flow = flowRef.current;
      if (!flow) return;
      const now = Date.now();
      dragRef.current = {
        id: ev.pointerId,
        x: ev.clientX,
        lastX: ev.clientX,
        lastAt: now,
        v: 0,
        angle: 0,
        dir: 0,
        moved: false,
      };
      const stage = stageRef.current;
      try {
        (stage || flow).setPointerCapture(ev.pointerId);
      } catch (err) {
        /* ignore */
      }
    };

    const onPointerMove = (ev) => {
      const d = dragRef.current;
      if (!d || d.id !== ev.pointerId) return;
      const dx = ev.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 8) return;
      d.moved = true;
      const now = Date.now();
      const dt = now - d.lastAt;
      if (dt > 0) d.v = (ev.clientX - d.lastX) / dt;
      d.lastX = ev.clientX;
      d.lastAt = now;
      // 正文一步都不动：跟着手走的只有那张「纸」的角度。这个函数里没有布局
      // 读取、没有 measure、没有 querySelectorAll，只有一次 style 写入。
      const dir = dx < 0 ? 1 : -1;
      if (d.dir !== dir) {
        d.dir = dir;
        d.angle = 0;
        // R142：纸有两个面，所以摆纸时要把「翻到哪一页」一起交进去。
        // R159：同 turnTo，纸背取的那一页两向不同（见那里的注释）。
        const cur = pageRef.current;
        const nextAt = Math.max(0, Math.min(maxPage, cur + dir));
        armFlip(dir, cur, dir > 0 ? nextAt : Math.min(layout.total - 1, nextAt + 1));
      }
      const span = step > 0 ? step : 600;
      // 拖拽是最多掀 26° 的预演：正面那一层先跟着手指走，纸还没真正翻过去，
      // 底下那一半仍是旧页（与 cover 的作用一致）。松手后 turnTo 从这把角度
      // 接着转完剩下的半圈（R142：一整圈 180°，所以是「剩下的 154°」）。
      const angle = Math.max(-26, Math.min(26, (dx / span) * 90));
      d.angle = angle;
      poseFlip(angle);
      const stage = stageRef.current;
      if (stage && stage.getAttribute('data-drag') !== '1') stage.setAttribute('data-drag', '1');
    };

    // 松开：过了页宽 15%，或者甩得够快（>0.45px/ms），就顺势翻过去——纸从
    // 手停下的那个角度接着转完剩下的大半圈；否则纸直接收掉（正文原地不动，
    // 没有任何回弹动画）。没有「等一会儿再慢慢吸附」那一段。
    const endDrag = (ev) => {
      const d = dragRef.current;
      if (!d || d.id !== ev.pointerId) return false;
      dragRef.current = null;
      const flow = flowRef.current;
      const stage = stageRef.current;
      if (stage) {
        try {
          stage.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* ignore */
        }
        stage.removeAttribute('data-drag');
      }
      const s = step;
      if (!d.moved || !(s > 0)) return false;
      const dx = ev.clientX - d.x;
      const delta = dx !== 0 ? dx : d.v;
      if (Math.abs(dx) > s * 0.15 || Math.abs(d.v) > 0.45) {
        const before = pageRef.current;
        turnTo(before + (delta < 0 ? 1 : -1), d.angle);
        if (pageRef.current === before) stopFlip();
      } else {
        stopFlip();
      }
      return true;
    };

    const onPointerUp = (ev) => {
      const down = pointerRef.current;
      pointerRef.current = null;
      // R53g：这一下按下时收掉了某个面板，那它到此为止——不再翻页。只认紧跟着
      // 的那一次（600ms 内），否则点在正文外没收到 pointerup 时会一直吞翻页。
      if (dismissedRef.current && Date.now() - dismissedRef.current < 600) {
        dismissedRef.current = 0;
        dragRef.current = null;
        return;
      }
      dismissedRef.current = 0;
      if (ev.type === 'pointercancel') {
        // 指针被系统收走了（来电、系统手势接管）：纸收回来、光标复原，别把
        // 一张掀到一半的纸留在屏幕上。
        const drag = dragRef.current;
        if (drag && drag.moved) stopFlip();
        dragRef.current = null;
        const st = stageRef.current;
        if (st) {
          st.removeAttribute('data-drag');
          try {
            st.releasePointerCapture(ev.pointerId);
          } catch (err) {
            /* ignore */
          }
        }
        return;
      }
      // 拖动过的话，翻页/回弹都在 endDrag 里处理完了。
      if (endDrag(ev)) return;
      if (!down) return;
      if (Math.abs(ev.clientX - down.x) > 8 || Math.abs(ev.clientY - down.y) > 8) {
        // 拖了一下 = 想标注这段字，不是想翻页。从已有标注上起手也一样：
        // 谁都会从一条下划线中间开始往外拖。
        const hit = readSelection();
        if (hit) {
          // R53：又划了一段新字，默认是要处理新选区——便签里那条草稿收起来，
          // 免得「框还停在上一句旁边」。
          if (composer) {
            setComposer(null);
            setComposerNote('');
          }
          setSel(hit);
        }
        return;
      }
      // 没动 = 一次点击。点在标注、工具条或批注面板上时这一下是给它们的，
      // 不是翻页的：一次点击会先 pointerup 再 click，若在 up 里就翻了页，
      // 等 click 打开批注时书已经跳到下一页了。
      if (down.onSomething) return;
      const s0 = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (s0 && String(s0.toString() || '').length > 0) return;
      // 便签还开着时点正文这一下已经在 pointerdown 里收起（并保存）了，不再翻页。
      setSel(null);
      const flow = flowRef.current;
      if (!flow) return;
      const rect = flow.getBoundingClientRect();
      if (ev.clientX >= rect.left + rect.width * 0.5) go(1);
      else go(-1);
    };

    // 整本书拆段是这里唯一的重活：一本二十万字的稿子要走两万行。翻页只改
    // `page`、提示五秒后只改 `hintOn`，两者都会重渲染本组件——所以正文必须
    // 缓存住，否则每翻一页都要把全书重新拆一遍。
    //
    // 同一个拆段函数也给纸上那份副本用（只装当前章附近几章）：`register`
    // 为 false 时不往 marksRef 里挂节点——那张表是 measure() 量尺寸用的真正的流。
    const renderChapters = React.useCallback((rows, base, register) => {
      const byChapter = {};
      for (let i = 0; i < marks.length; i += 1) {
        const m = marks[i];
        const key = String(m.chapterId || '');
        if (!key) continue;
        if (!byChapter[key]) byChapter[key] = [];
        byChapter[key].push(m);
      }
      return rows.map((row, offset) => {
        const index = base + offset;
        const key = String(row.id);
        const own = byChapter[key] || [];
        return h(
          'section',
          {
            className: 'nw-read-chapter',
            key: key,
            'data-chapter-id': key,
            'data-first': index === 0 ? '1' : '0',
          ref: register
            ? (el) => {
              if (el) marksRef.current[key] = el;
              else delete marksRef.current[key];
            }
            : undefined,
          },
          isPlaceholderTitle(row.title)
            ? null
            : [
              // 标题本身已经写了「第 X 章」就不再重复一遍，换三个点当眉标。
              h(
                'div',
                { className: 'nw-read-kicker', key: 'kicker' },
                /第\s*[0-9零一二三四五六七八九十百千]+\s*[章节回卷篇]/.test(String(row.title))
                  ? '· · ·'
                  : '第 ' + (index + 1) + ' 章',
              ),
              h('h2', { className: 'nw-read-title', key: 'title' }, String(row.title)),
              h('div', { className: 'nw-read-orn', key: 'orn', 'aria-hidden': 'true' }),
            ],
          (() => {
            const paras = paragraphsOf(
              currentId != null && key === currentId && currentText != null
                ? currentText
                : row.content,
            );
            return paras.map((para, i) =>
              h(
                'p',
                {
                  className: 'nw-read-p',
                  key: String(i),
                  // 原文里的空行在这里变成「这段之前空了一行」，读起来才是作者
                  // 写作时划分的场景，而不是被压平的段落墙。
                  'data-gap': para.gap ? '1' : '0',
                  // 这段第一个字在章节全文里的下标：选区要靠它反推成标注区间。
                  'data-start': String(para.start),
                },
                own.length ? splitByMarks(para, own) : para.text,
                // 章末小方块跟着最后一段走，所以它永远落在这一章最后一个字后面。
                i === paras.length - 1
                  ? h('span', { className: 'nw-read-end', key: 'end', 'aria-hidden': 'true' })
                  : null,
              ),
            );
          })(),
        );
      });
    }, [currentId, currentText, marks]);

    const body = React.useMemo(() => {
      if (!chapters.length) {
        return h('div', { className: 'nw-read-empty' }, h('span', null, NW.t('这本书还没有正文')));
      }
      return renderChapters(chapters, 0, true);
    }, [chapters, renderChapters]);

    // ---- 纸上那份副本 --------------------------------------------------------
    // 只装当前页所在章前后几章：整本书排两遍太贵，而一章总从新的一栏开始
    // （.nw-read-chapter + .nw-read-chapter{break-before:column}），所以副本里的分栏和正文
    // 里那几章一模一样，只差一个「章首在正文里的左边距」。
    const mirrorWindow = React.useMemo(() => {
      const starts = layout.starts || [];
      if (!starts.length || !chapters.length) return 0;
      let at = null;
      for (let i = 0; i < starts.length; i += 1) {
        if (starts[i].page <= page) at = starts[i];
        else break;
      }
      if (!at) return 0;
      let idx = 0;
      for (let i = 0; i < chapters.length; i += 1) {
        if (String(chapters[i].id) === String(at.id)) { idx = i; break; }
      }
      return Math.max(0, idx - 2);
    }, [chapters, layout.starts, page]);

    // 窗口只在读者走出去时才换：换一次就要重排那几章，不能每翻一页都重排。
    const [mirrorFrom, setMirrorFrom] = React.useState(0);
    React.useEffect(() => {
      if (turningRef.current) return;
      if (mirrorFrom !== mirrorWindow) setMirrorFrom(mirrorWindow);
    }, [mirrorFrom, mirrorWindow, turnEpoch]);

    const mirrorRows = React.useMemo(
      () => (chapters.length ? chapters.slice(mirrorFrom, mirrorFrom + 5) : []),
      [chapters, mirrorFrom],
    );

    // 副本第一章在正文里的左边界：翻页时 scrollLeft 要减掉它。
    const mirrorOrigin = React.useMemo(() => {
      const first = mirrorRows[0];
      const starts = layout.starts || [];
      if (!first) return 0;
      for (let i = 0; i < starts.length; i += 1) {
        if (String(starts[i].id) === String(first.id)) return starts[i].left || 0;
      }
      return 0;
    }, [mirrorRows, layout.starts]);

    React.useLayoutEffect(() => {
      mirrorOriginRef.current = mirrorOrigin;
    }, [mirrorOrigin]);

    const mirrorBody = React.useMemo(
      () => (mirrorRows.length ? renderChapters(mirrorRows, mirrorFrom, false) : null),
      [mirrorRows, mirrorFrom, renderChapters],
    );

    // 正文重建后立刻重算页边批注签；`body` 变了说明分段/换页规则也可能变了。
    React.useLayoutEffect(() => {
      paintGutterRef.current = paintGutter;
      paintGutter();
    }, [paintGutter, body]);

    // 页边签只在三件事之后重画：翻页落位（turnTo/scrollToPage 里的 repaintGutter）、
    // 尺寸变化（上面的 relayout）、批注数据或正文变化（上面这个 effect）。
    // 滚动与拖拽过程中一律不碰——那正是原来卡顿的第二个来源。

    const flowStyle = {
      fontSize: fontSize + 'px',
      lineHeight: String(lineHeight),
    };

    // 纸下边距里的页脚。两面各印一份：正面是掀走的那页，背面是落下的那页。
    // 两槽都画出来，纸只露出一页宽，自然只看见自己那一侧的槽。
    const faceFoot = (key, folio) => h(
      'div',
      {
        className: 'nw-read-face-foot',
        key: key,
        'data-single': spread ? '0' : '1',
        'aria-hidden': 'true',
      },
      spread
        ? [
          h(
            'div',
            { className: 'nw-read-foot-slot', key: 'l', 'data-side': 'left' },
            h('span', { className: 'nw-read-count' }, String(folio.left)),
            h('span', { className: 'nw-read-foot-name' }, bookName),
          ),
          h(
            'div',
            { className: 'nw-read-foot-slot', key: 'r', 'data-side': 'right' },
            h('span', { className: 'nw-read-foot-name' }, folio.rightChapter),
            h('span', { className: 'nw-read-count' }, folio.right == null ? '' : String(folio.right)),
          ),
        ]
        : h(
          'div',
          { className: 'nw-read-foot-slot', key: 'r', 'data-side': 'right' },
          h('span', { className: 'nw-read-foot-name' }, bookName),
          h('span', { className: 'nw-read-count' }, folio.right == null ? '' : String(folio.right)),
        ),
    );

    // 天头的眉题。纸现在是整张纸，天头也在纸上；不复刻的话，纸一抬起来，
    // 原先画在舞台上、正被纸盖住的那条章名就跟着没了。
    const faceHead = (key, folio) => h(
      'div',
      {
        className: 'nw-read-face-head',
        key: key,
        'aria-hidden': 'true',
      },
      spread || textCols > 1
        ? [
          h(
            'div',
            { className: 'nw-read-head-slot', key: 'l', 'data-side': 'left' },
            h('span', null, '《' + bookName + '》'),
          ),
          h(
            'div',
            { className: 'nw-read-head-slot', key: 'r', 'data-side': 'right' },
            h('span', null, folio.rightChapter),
          ),
        ]
        : h(
          'div',
          { className: 'nw-read-head-slot', key: 'one', 'data-side': 'left' },
          h('span', null, folio.chapter),
        ),
    );

    // R156: 一张纸只有两面。正面印离开的那页，背面印翻到的那页；每面都是
    // 一份整页副本 + 一道贴在折线上的渐变，浏览器负责 3D 旋转与背面裁剪。
    const renderLeafFace = (face, folio, key, copyRef, shadeRef, faceRef) => h(
      'div',
      { className: 'nw-read-face', 'data-face': face, key: key, ref: (el) => { faceRef.current = el; } },
      h('div', {
        className: 'nw-read-copy',
        ref: (el) => { copyRef.current = el; },
        style: flowStyle,
      }, mirrorBody),
      h('span', {
        className: 'nw-read-shade',
        ref: (el) => { shadeRef.current = el; },
        'aria-hidden': 'true',
      }),
      faceFoot(face + '-foot', folio),
      faceHead(face + '-head', folio),
    );

    // —— 眉题与页脚 ---------------------------------------------------------
    // 对开时一次翻过去就是两页：`layout.starts` 里记的是「第几个跨页」，
    // 这里只查数组，翻页过程不碰 DOM。章名取当前页之前最后一个有名字的章。
    const spread = layout.cols === 2;
    // R125: 一页分成几栏。栏线、眉题、页脚都跟着它走，别再假设「一页 = 一栏」。
    const textCols = layout.textCols || 1;
    const bookName = novelTitle || NW.t('读一遍');
    // 章按**栏的偏移量**查，而不是按「第几个跨页」取整：一章要是从半页中间
    // 开始（双栏时很常见），取整会把整页都算成新章，右页就会顶着下一章的名字。
    // R128：换章可以发生在栏中间，所以「哪一章」要按 (栏, 行) 两个坐标查：
    // 栏首算给「在本栏顶开始的章」，栏中间那一章不算在这一栏的头上。
    const chapterAtX = (x) => {
      const starts = layout.starts || [];
      let name = '';
      for (let i = 0; i < starts.length; i += 1) {
        const at = starts[i];
        const sLeft = at.left || 0;
        const sTop = at.top || 0;
        // 左边界在这栏之前，或者就在这栏但确实从栏顶起头。
        if (sLeft < x - 1 || (Math.abs(sLeft - x) <= 1 && sTop <= 2)) name = at.title || name;
        else if (sLeft > x + 1) break;
      }
      return name;
    };
    const pageStep = layout.step || 0;
    // R148: 台面上的页码与眉题跟「看起来的那页」（shownPage）走，不再跟数据页
    // page 抢跑。纸自己的正面印旧页 folio、背面印要落下的新页 folio，与切片选
    // 出的正文窗口一致。
    // R149: 台面改成按「半」取：翻页途中被掀起的那一半先换（halfOverride），
    // 另一半等纸落地。整幅一份 folio 会让外缘的页码与它旁边的内容对不上。
    // R159: 编号口径改成「一次翻页推进一页」。正文的 scrollLeft = page * step，
    // 而 step 正好是一页宽（w + gap），所以停在 page = i 时，台面上左右两页就是
    // i 与 i+1，印出来必须是 i+1 / i+2。旧代码 `idx * (spread ? 2 : 1)` 把每一趟
    // 翻页都当成翻了两页，于是第一下之后所有页码都比正文多 1，越往后差得越多
    // （正文第 20 页印成 24）——这就是「页码不对」的根。
    const folioAt = (idx) => {
      const startX = idx * pageStep;
      // 对开时右页就是紧挨着的下一张书页；单页两栏时右栏与左页同一页，取页首。
      const rightX = spread ? startX + pageStep : startX;
      const rightIdx = spread ? idx + 1 : idx;
      return {
        left: idx + 1,
        // 越界的右页没有号：书正好在两跨页中间结束时，右半是空白的，
        // 宁可不印，也不要印一个不存在的页码。注意右页只要「存在」就能印，
        // 不必是可停留的左页（书末那一跨页的右页正是这种情况）。
        right: rightIdx <= layout.total - 1 ? rightIdx + 1 : null,
        chapter: chapterAtX(startX) || bookName,
        rightChapter: chapterAtX(rightX) || bookName,
      };
    };
    const stageFolio = folioAt(shownPage);
    // 翻页途中先换码的那一半；不在翻页时 halfOverride 是 null，两半都跟台面。
    const halfFolio = halfOverride ? folioAt(halfOverride.page) : null;
    const leftFolio = halfFolio && halfOverride.side === 'left' ? halfFolio : stageFolio;
    const rightFolio = halfFolio && halfOverride.side === 'right' ? halfFolio : stageFolio;
    // R159：纸的一面只印一个号。这一页模型里，纸的两面本来印的就是同一页：
    // 向前翻时正面压旧右页（i+1）、背面是新左页（next+1 = i+1）；向后翻时
    // 正面压旧左页（i）、背面是新右页（next+2 = i+1）。所以两面各印一个号，
    // 3D 镜像露出哪一半都不会错位（[data-dir="back"] 的 row-reverse 正好把
    // 背面那半拉回外侧）。
    const frontFolio = stageFolio;
    const backFolio = turnPagesRef.current.live ? folioAt(turnPagesRef.current.to) : stageFolio;
    // 单栏时整页就是那张纸，没有「另一半」：纸一抬起来它就是新页了。
    const shownFolio = halfFolio || stageFolio;
    const runningChapter = spread ? leftFolio.chapter : shownFolio.chapter;
    const runningRightChapter = spread ? rightFolio.rightChapter : shownFolio.rightChapter;
    // 页码按「书上印的那一页」算：对开是 n+1 / n+2，单栏就是 n+1。
    const pageLeft = spread ? leftFolio.left : shownFolio.left;
    const pageRight = spread ? rightFolio.right : shownFolio.right;

    // 选中一段字之后浮出来的小工具条：就四个动作，不下拉、不弹窗。
    // 便签开着的时候收起来：那一版的选区已经交给便签了，再叠一个条子只是噪音。
    const toolbar = sel && !composer
      ? h(
        'div',
        {
          className: 'nw-mark-bar',
          role: 'toolbar',
          'aria-label': NW.t('标注'),
          style: {
            left: Math.round(Math.max(12, sel.x)) + 'px',
            top: Math.round(Math.max(8, sel.y - 44)) + 'px',
          },
        },
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: () => addMark('underline'),
          title: NW.t('下划线'),
        }, NW.t('下划线')),
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: () => addMark('strike'),
          title: NW.t('删除线'),
        }, h('span', { style: { textDecoration: 'line-through' } }, NW.t('删除线'))),
        h('button', {
          type: 'button',
          className: 'nw-mark-bar-btn',
          onClick: openComposer,
          title: NW.t('写批注'),
        }, NW.t('批注')),
      )
      : null;

    // R53：浮层一律贴着点击处，而不是贴着那一行的下沿。
    // 横向：先试点击处**右边**一拳的地方（不盖住刚点的那几个字），右边放不下
    // 就翻到左边；`translateX(-50%)` 在 CSS 里，所以这里算的是中心点。
    // 纵向：和点击处大致齐平，底边放不下就整体上提，永远夹在视口里。
    const placeNear = (at, w, h) => {
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
      const x = at && Number.isFinite(at.x) ? at.x : vw / 2;
      const y = at && Number.isFinite(at.y) ? at.y : vh / 2;
      const side = 14;
      let center = x + side + w / 2;
      if (center + w / 2 > vw - 8) center = x - side - w / 2;
      const left = Math.min(Math.max(center, w / 2 + 8), vw - w / 2 - 8);
      let top = y - 12;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 10);
      if (top < 8) top = 8;
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' };
    };

    const picker = picked
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-pick',
          role: 'toolbar',
          'aria-label': NW.t('这条标注'),
          style: placeNear(picked, 140, 34),
        },
        h(
          'div',
          { className: 'nw-mark-pop-acts' },
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-danger': '1',
            onClick: () => {
              const id = picked.mark.id;
              closeMark();
              if (typeof p.onUnmark === 'function') p.onUnmark(id);
            },
          }, NW.t('删除')),
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            onClick: () => {
              // 不调 closeMark()：那会顺手把刚刚点亮的标注也熄灭，而编辑框还开着，
              // 亮着才对得上「我在改这一条」。
              const at = picked;
              setPicked(null);
              setNoteDraft(String(at.mark.note || ''));
              setEditing({ mark: at.mark, x: at.x, y: at.y });
            },
          }, NW.t('写批注')),
        ),
      )
      : null;

    const editor = editing
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-edit',
          role: 'dialog',
          'aria-label': NW.t('批注'),
          style: placeNear(editing, 196, 96),
        },
        h('textarea', {
          ref: noteRef,
          className: 'nw-mark-pop-note',
          value: noteDraft,
          rows: 1,
          placeholder: NW.t('这条批注写给自己看'),
          'aria-label': NW.t('批注'),
          autoFocus: true,
          // R53g：没有保存键。打字即存（700ms 合并一次），收起时补最后一次。
          onChange: (ev) => {
            const body = ev.target.value;
            setNoteDraft(body);
            scheduleNote(editing.mark.id, body);
          },
          onBlur: () => flushNote(),
          onKeyDown: (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              // 收起就是保存：先补最后一次，再关。
              flushNote();
              closeMark();
            }
          },
        }),
        h(
          'div',
          { className: 'nw-mark-pop-acts' },
          // R51：批注窗里也能删。R53g 之后这里是唯一一颗按钮——保存和取消都没了。
          h('button', {
            type: 'button',
            className: 'nw-mark-pop-btn',
            'data-danger': '1',
            title: NW.t('删掉这条标注'),
            onClick: () => {
              const id = editing.mark.id;
              // 先作废待写的这一次，否则「存完再删」会把刚删的行又写回来。
              dropNote();
              closeMark();
              if (typeof p.onUnmark === 'function') p.onUnmark(id);
            },
          }, NW.t('删除')),
        ),
        // R53e：文字只属于批注。这句话在这里被写成批注，就等于它从「一条下划线」
        // 变成「一条批注」——同一句话不可能同时是两样东西。所以窗里说清楚这件事，
        // 而不是让作者以为自己在一条下划线上贴了一张便签。本来已经是批注的不必说。
        String(editing.mark.kind) === 'comment'
          ? null
          : h(
            'div',
            { className: 'nw-mark-pop-hint' },
            NW.t('写下字，这句话就是一条批注'),
          ),
      )
      : null;

    // R53：新批注的便签。一行高起步，随字长高（最多三行半），位置贴着选区
    // ——不是屏幕正中那块大面板。R53g：同样没有保存键，第一次出现非空文字时
    // 才建行（空着关掉就当没写过，不留一条没有话的批注）。
    const composerBox = composer
      ? h(
        'div',
        {
          className: 'nw-mark-pop nw-mark-edit',
          role: 'dialog',
          'aria-label': NW.t('批注'),
          style: placeNear(composer, 196, 96),
        },
        h('textarea', {
          ref: composerRef,
          className: 'nw-mark-pop-note',
          value: composerNote,
          rows: 1,
          placeholder: NW.t('这条批注写给自己看'),
          'aria-label': NW.t('批注'),
          autoFocus: true,
          onChange: (ev) => {
            const body = ev.target.value;
            setComposerNote(body);
            const st = composerSaveRef.current;
            st.draft = {
              chapterId: composer.chapterId,
              start: composer.start,
              end: composer.end,
              quote: composer.quote,
            };
            st.body = body;
            scheduleComposer(body);
          },
          onBlur: () => commitComposer(),
          onKeyDown: (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              commitComposer();
              closeComposer();
            }
          },
        }),
      )
      : null;

    // 两个批注输入框都随内容长高：先复位成 auto 再读 scrollHeight，否则只增不减。
    React.useLayoutEffect(() => {
      const grow = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(64, Math.max(24, el.scrollHeight)) + 'px';
      };
      grow(noteRef.current);
      grow(composerRef.current);
    }, [noteDraft, composerNote, editing, composer]);

    return h(
      'div',
      {
        className: 'nw-read nw-surface',
        'data-theme': themeKey,
        'data-read': '1',
        style: readerFont ? { '--nw-read-serif': readerFont } : undefined,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': NW.t('读一遍'),
      },
      h(
        'div',
        { className: 'nw-read-bar' },
        h('span', { className: 'nw-read-bar-name' }, novelTitle || NW.t('读一遍')),
        // R130：念给我听。一只手就能按到：左边喇叭是开关，右边小三角是设置。
        h(
          'div',
          { className: 'nw-read-speakbar' },
          h(
            'button',
            {
              type: 'button',
              className: 'nw-read-bar-btn',
              'data-on': speaking ? '1' : '0',
              'aria-pressed': speaking ? 'true' : 'false',
              'aria-label': speaking ? NW.t('停止朗读') : NW.t('念给我听'),
              title: speaking ? NW.t('停止朗读') + '（再点一下）' : NW.t('念给我听'),
              onClick: startSpeakHere,
            },
            NW.icon(speaking ? 'volumeoff' : 'volume', { size: 16 }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'nw-read-bar-btn',
              'data-narrow': '1',
              'aria-label': NW.t('朗读设置'),
              title: NW.t('朗读设置'),
              onClick: () => setSpeakMenu((v) => !v),
            },
            NW.icon('caret', { size: 13 }),
          ),
          speakMenu
            ? h(
                'div',
                { className: 'nw-read-speakmenu', role: 'dialog', 'aria-label': NW.t('朗读设置') },
                h(
                  'div',
                  { className: 'nw-read-speakmenu-row' },
                  h('span', { className: 'nw-read-speakmenu-label' }, NW.t('引擎')),
                  [
                    ['system', NW.t('系统')],
                    ['edge', NW.t('微软')],
                    ['baidu', NW.t('百度')],
                    ['api', NW.t('自定义')],
                  ].map(([value, label]) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: value,
                        className: 'nw-read-speakmenu-chip',
                        'data-on': speakEngine === value ? '1' : '0',
                        onClick: () => changeEngine(value),
                      },
                      label,
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'nw-read-speakmenu-row' },
                  h('span', { className: 'nw-read-speakmenu-label' }, NW.t('语速')),
                  [0.8, 1, 1.2, 1.5].map((r) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: String(r),
                        className: 'nw-read-speakmenu-chip',
                        'data-on': Math.abs(speakRate - r) < 0.01 ? '1' : '0',
                        onClick: () => changeRate(r),
                      },
                      r.toFixed(r === 1 ? 0 : 1) + '×',
                    ),
                  ),
                ),
                speakEngine === 'api' || speakEngine === 'baidu'
                  ? h(
                      'div',
                      { className: 'nw-read-speakmenu-row' },
                      h('span', { className: 'nw-read-speakmenu-label' }, NW.t('声音')),
                      h(
                        'span',
                        { className: 'nw-read-speakmenu-note' },
                        speakEngine === 'baidu'
                          ? NW.t('百度只有这一个女声')
                          : String(p.settings.ttsApiVoice || 'alloy') + ' · ' + NW.t('在设置里改'),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'nw-read-speakmenu-row' },
                      h('span', { className: 'nw-read-speakmenu-label' }, NW.t('声音')),
                      h(
                        'select',
                        {
                          value: speakEngine === 'edge' ? String(p.settings.ttsEdgeVoice || EDGE_VOICES[0][0]) : speakVoice,
                          'aria-label': NW.t('声音'),
                          onChange: (ev) => {
                            const next = String(ev.target.value || '');
                            if (speakEngine === 'edge') {
                              if (typeof p.onReadSetting === 'function') p.onReadSetting({ ttsEdgeVoice: next });
                              if (speaking) restartAt();
                              return;
                            }
                            setSpeakVoice(next);
                            writeSpeakPref('voice', next);
                            if (speaking) restartAt();
                          },
                        },
                        speakEngine === 'edge'
                          ? EDGE_VOICES.map(([value, label]) => h('option', { value: value, key: value }, label))
                          : [
                              h('option', { value: '' }, NW.t('系统默认')),
                              speakVoices.map((v) =>
                                h('option', { value: v.voiceURI || v.name, key: v.voiceURI || v.name }, v.name + ' · ' + v.lang),
                              ),
                            ],
                      ),
                    ),
                speakError
                  ? h('div', { className: 'nw-read-speakmenu-note nw-read-speakmenu-error' }, speakError)
                  : null,
                h(
                  'div',
                  { className: 'nw-read-speakmenu-note' },
                  speakEngine === 'edge'
                    ? NW.t('微软的在线自然音，免费、不用密钥，但这一段正文会联网发给微软。有些网络会被它拒掉（403），那就换百度或自定义 API。')
                    : speakEngine === 'baidu'
                      ? NW.t('百度的免费朗读，不用密钥，国内连得通；音色只有一个女声，比系统语音清楚但不带感情。这一段正文会联网发给百度。')
                      : speakEngine === 'api'
                      ? NW.t('任何 OpenAI /v1/audio/speech 兼容的接口都可以：地址、密钥、模型在 设置 → 阅读 里填。本地跑的 GPT-SoVITS、CosyVoice、Kokoro 也走这条。')
                      : speakVoices.length
                        ? NW.t('本机自带的声音，离线可用，正文不出本机。')
                        : NW.t('这台机器没有报出中文声音，朗读可能用英文音色念中文。'),
                ),
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'nw-read-bar-close',
            'aria-label': NW.t('回到写作') + '（Esc）',
            title: NW.t('回到写作') + '（Esc）',
            onClick: close,
          },
          NW.icon('x', { size: 16 }),
        ),
      ),
      h(
        'div',
        { className: 'nw-read-stage', ref: stageRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
        // R143：纸下面那一摞。它比纸宽 4px、往下多露 9px，露出来的那条缝才是
        // 「厚度」；纸面、翻页、正文都不碰它，没有它纸就是浮在桌上的一张。
        h('div', { className: 'nw-read-block', 'aria-hidden': 'true' }),
        // 纸：桌面上的那一张，压在多栏流下面。折痕只在真正对开时才画。
        h('div', {
          className: 'nw-read-sheet',
          'data-spread': spread ? '1' : '0',
          'aria-hidden': 'true',
        }),
        // R154：中缝是真实的一层。画在纸上时它永远被正文盖住——纸在 0、正文在 1。
        spread
          ? h('div', { className: 'nw-read-spine', 'aria-hidden': 'true' })
          : null,
        // R139：栏与栏之间不再画线（书里栏间就是空白）。中缝的暗影由纸面
        // .nw-read-sheet 的 ::after 负责，所以这个装饰层整个撤掉了。
        // 眉题：左页书名、右页当前章；单栏只放章名。画在流上面，正文滚动
        // 它不动，也不进 measure() 的分页计算。
        h(
          'div',
          { className: 'nw-read-head', 'aria-hidden': 'true' },
          spread || textCols > 1
            ? [
              h(
                'div',
                { className: 'nw-read-head-slot', key: 'left', 'data-side': 'left' },
                h('span', null, '《' + bookName + '》'),
              ),
              h(
                'div',
                { className: 'nw-read-head-slot', key: 'right', 'data-side': 'right' },
                h('span', null, runningRightChapter),
              ),
            ]
            : h(
              'div',
              { className: 'nw-read-head-slot', key: 'one', 'data-side': 'left' },
              h('span', null, runningChapter),
            ),
        ),
        h(
          'div',
          {
            className: 'nw-read-flow',
            ref: flowRef,
            style: flowStyle,
            tabIndex: -1,
            onClick: (ev) => {
              const node = ev.target;
              if (node && typeof node.closest === 'function') {
                const span = node.closest('.nw-mark[data-mark]');
                if (span) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  openMark(span.getAttribute('data-mark'), ev);
                  return;
                }
              }
              // 点空白处收起面板这件事已经由 document 上的 pointerdown 统一处理
              // （R53g：要覆盖顶栏、页脚、页边签在内的「任何地方」），这里只负责
              // 「点在标注上就打开它」。
            },
          },
          body,
        ),
        // 纸上的字：被掀走的那一页的副本。它按同样的栏宽排一遍，翻页时只改
        // scrollLeft，所以动画里没有任何布局（CSS 见 .nw-read-cover / .nw-read-flip）。
        mirrorBody
          ? h(
            'div',
            { className: 'nw-read-cover', ref: coverRef, 'data-half': 'left', 'aria-hidden': 'true' },
            h('div', { className: 'nw-read-copy', ref: coverCopyRef, style: flowStyle }, mirrorBody),
          )
          : null,
        h('div', { className: 'nw-read-cast', ref: castRef, 'aria-hidden': 'true' }),
        h(
          'div',
          { className: 'nw-read-flip', ref: flipWrapRef, 'aria-hidden': 'true' },
          h(
            'i',
            { className: 'nw-read-leaf', ref: leafRef },
            // R156: 一张纸，两面。正面印离开的那页，背面印翻到的那页；
            // 弧度不再由几何产生，而是每面一道贴在折线上的渐变。
            mirrorBody
              ? [
                renderLeafFace('front', frontFolio, 'front', frontCopyRef, frontShadeRef, frontFaceRef),
                renderLeafFace('back', backFolio, 'back', backCopyRef, backShadeRef, backFaceRef),
              ]
              : null,
          ),
          // R157: 纸的切口。它不在 .nw-read-leaf 里面——跟着纸转的元素在
          // 90 度时投影同样是零，只有留在外面、不参与旋转的这一道才能被看见。
          h('div', { className: 'nw-read-edge', ref: edgeRef, 'aria-hidden': 'true' }),
        ),
        h('div', { className: 'nw-read-gutter', ref: gutterRef }),
        // 页脚只有一套：外侧页码 + 一行小字书名/章名，提示条只占折痕下面的
        // 一小块、几秒后淡出——不再在书下面堆第二条 chrome。
        h(
          'div',
          { className: 'nw-read-foot', 'data-spread': spread ? '1' : '0' },
          spread
            ? [
              h(
                'div',
                { className: 'nw-read-foot-slot', key: 'left', 'data-side': 'left' },
                h('span', { className: 'nw-read-count' }, String(pageLeft)),
                h('span', { className: 'nw-read-foot-name' }, bookName),
              ),
              h(
                'div',
                { className: 'nw-read-foot-slot', key: 'right', 'data-side': 'right' },
                // 右页的章名要跟右页自己的眉题一致（一章可能从右页才开头）
                h('span', { className: 'nw-read-foot-name' }, runningRightChapter),
                h('span', { className: 'nw-read-count' }, pageRight == null ? '' : String(pageRight)),
              ),
              h(
                'span',
                { className: 'nw-read-hint', key: 'hint', 'data-fade': hintOn ? '0' : '1' },
                '← → 翻页 · 选字可以标注 · Esc 回到写作',
              ),
            ]
            : [
              h(
                'div',
                { className: 'nw-read-foot-slot', key: 'left', 'data-side': 'left' },
                h(
                  'span',
                  { className: 'nw-read-hint', 'data-fade': hintOn ? '0' : '1' },
                  '← → 翻页 · 选字可以标注 · Esc 回到写作',
                ),
              ),
              h(
                'div',
                { className: 'nw-read-foot-slot', key: 'right', 'data-side': 'right' },
                h('span', { className: 'nw-read-foot-name' }, bookName),
                h('span', { className: 'nw-read-count' }, pageRight == null ? '' : String(pageRight)),
              ),
            ],
        ),
        toolbar,
        picker,
        composerBox,
        editor,
      ),
    );
  };
})();
