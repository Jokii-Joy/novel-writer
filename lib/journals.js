// Chinese literary journal directory for @local/novel-writer (投稿).
//
// The list is a *starting point*, not an authority: requirement texts change
// every issue and submission inboxes move. Every built-in entry therefore ships
// with `verified:false` and — unless the address was collected from a public
// submission notice — an empty `email`, which the UI renders as 「待核对」. The
// user fills the real inbox in the journal manager; the override lands in
// `<DSH_HOME>/novel-writer/settings.json` under `journals`.
//
// Only Node built-ins are used. Nothing here throws: failures come back as
// `{ok:false, code, message}`.

import { readSettings, writeSettings } from './library.js';

/** Shown next to every journal so nobody treats this list as gospel. */
export const JOURNAL_NOTE = '投稿要求与邮箱请以期刊官方最新征稿启事为准';

const GENRE_KEYS = ['weixiaoshuo', 'duanpian', 'zhongpian', 'changpian'];

/** Human labels used in reasons / subject templates. */
export const GENRE_LABELS = {
  weixiaoshuo: '微小说',
  duanpian: '短篇小说',
  zhongpian: '中篇小说',
  changpian: '长篇小说',
};

/** Genre code letters used in the compact table below. */
const CODE_MAP = { w: 'weixiaoshuo', d: 'duanpian', z: 'zhongpian', c: 'changpian' };

/** Fields a user may override; anything else is taken from the built-in entry. */
const EDITABLE_FIELDS = [
  'name',
  'aliases',
  'genres',
  'wordRange',
  'requirements',
  'email',
  'emails',
  'website',
  'tags',
  'subject',
  'attachments',
  'paperOnly',
  'responseDays',
  'note',
  'verified',
  'tier',
];

/**
 * R16 ⑩: 期刊水平等级.
 *
 * The shipped table already records 国家级 / 省级 / 市级 as tags, so the tier is
 * derived from them instead of duplicating a column across 79 rows (a new row
 * cannot forget to set it). A user may still override it per journal.
 */
export const TIERS = ['national', 'provincial', 'municipal', 'other'];

export const TIER_LABELS = {
  national: '国家级',
  provincial: '省级',
  municipal: '市级',
  other: '其他',
};

const TIER_BY_TAG = { 国家级: 'national', 省级: 'provincial', 市级: 'municipal' };

function tierOfTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  for (const row of list) {
    const key = TIER_BY_TAG[str(row).trim()];
    if (key) return key;
  }
  return 'other';
}

function normalizeTier(value, fallbackTags) {
  const raw = str(value).trim();
  if (TIERS.indexOf(raw) >= 0) return raw;
  const byLabel = Object.keys(TIER_BY_TAG).filter((label) => TIER_BY_TAG[label] === raw);
  if (byLabel.length) return TIER_BY_TAG[byLabel[0]];
  if (raw) {
    for (const label of Object.keys(TIER_BY_TAG)) {
      if (raw.indexOf(label) >= 0) return TIER_BY_TAG[label];
    }
  }
  return tierOfTags(fallbackTags);
}

/** Default cover-letter subject template; `{…}` placeholders are filled in. */
export const DEFAULT_SUBJECT = '投稿｜{genre}《{title}》｜{words}字｜{author}';

/** What most literary journals want attached; a journal may override it. */
// R8 ③: 只默认 Word。多附一份 txt 是以前的做法，但不少期刊明确「附件只收 Word」，
// 多出来的 txt 会让整封投稿被当成不合规处理 —— 所以只有期刊写了 txt 才附。
const DEFAULT_ATTACHMENTS = ['docx'];

/** Requirement bullets shared by most magazines (merged with per-journal ones). */
const COMMON_REQUIREMENTS = [
  '原创未发表，文责自负',
  '邮件主题写明体裁、篇名与字数',
  '正文粘贴全文，同时附 Word 文档',
  '文末附作者简介（100 字内）与联系方式',
];

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function messageOf(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

/**
 * Compact table row → journal entry.
 *
 * Columns: id, 名称, 别名[], 体裁码(w/d/z/c), 字数说明, 最少字, 最多字,
 *          投稿邮箱, 官网, 标签[], 回复天数, 仅纸质, 特殊要求[]|null
 *
 * A blank email is deliberate: the address could not be confirmed from a public
 * submission notice, so the UI asks the user to fill it in once.
 */
function journal(row) {
  const [
    id,
    name,
    aliases,
    codes,
    wordRange,
    minWords,
    maxWords,
    email,
    website,
    tags,
    responseDays,
    paperOnly,
    extraRequirements,
  ] = row;

  const genres = {
    weixiaoshuo: false,
    duanpian: false,
    zhongpian: false,
    changpian: false,
  };
  for (const letter of String(codes || '').split(/\s+/).filter(Boolean)) {
    const key = CODE_MAP[letter];
    if (key) genres[key] = true;
  }

  const requirements = Array.isArray(extraRequirements) && extraRequirements.length > 0
    ? extraRequirements.slice()
    : COMMON_REQUIREMENTS.slice();

  return {
    id,
    name,
    aliases: Array.isArray(aliases) ? aliases.slice() : [],
    genres,
    wordRange: str(wordRange),
    minWords: Number(minWords) || 0,
    maxWords: Number(maxWords) || 0,
    requirements,
    email: str(email),
    // R6: most literary journals route each length band (short / novella /
    // novel) to a different inbox. A shipped record keeps the single address we
    // could confirm in `email`; `emails` holds the per-genre / per-length rows
    // the user adds (or a future table fills in), and `resolveEmail()` picks the
    // right one for the manuscript in hand.
    emails: [],
    website: str(website),
    tags: Array.isArray(tags) ? tags.slice() : [],
    subject: str(DEFAULT_SUBJECT),
    attachments: DEFAULT_ATTACHMENTS.slice(),
    paperOnly: paperOnly === true,
    responseDays: Number(responseDays) || 60,
    note: JOURNAL_NOTE,
    verified: false,
    // R16 ⑩: derived from the 国家级 / 省级 / 市级 tag, never a separate column.
    tier: tierOfTags(tags),
  };
}

/**
 * 78 built-in journals. Emails that are shipped were collected from public
 * submission notices; every one of them still stamps `verified:false` because
 * inboxes move without notice and only the user can confirm the current issue's
 * call for papers.
 */
const TABLE = [
  // ---- 国家级 / 老牌大刊 ------------------------------------------------
  ['renminwenxue', '人民文学', ['人民文学杂志', '《人民文学》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'rmwxxiaoshuo@126.com', '', ['国家级', '综合', '现实主义', '纯文学'], 90, false, null],
  ['shouhuo', '收获', ['收获文学杂志', '《收获》'], 'd z c', '短篇 5000–30000 字；中篇 30000–130000 字；长篇 130000 字以上', 5000, 400000, 'eharvest@sh163.net', '', ['国家级', '纯文学', '上海', '长篇'], 120, true, ['目前以纸质邮寄为主，投稿前请核对当期征稿启事', '长篇投稿请先附内容简介与章节大纲', '不接受已在任何平台发布过的作品']],
  ['shiyue', '十月', ['十月杂志', '《十月》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'shiyuetougao@sina.com', '', ['国家级', '北京', '现实题材', '文学探索'], 90, false, null],
  ['huacheng', '花城', ['花城杂志', '《花城》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'huachengzpxs@163.com', '', ['国家级', '广东', '语言实验', '结构'], 90, false, ['偏爱有辨识度的语言与结构', '请在邮件正文写明字数与创作简历', '勿重复投递同一篇作品']],
  ['zhongshan', '钟山', ['钟山杂志', '《钟山》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, '', '', ['省级', '江苏', '文学品质', '厚重'], 90, false, null],
  ['zuojia', '作家', ['作家杂志', '《作家》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'cczwriter@263.net', '', ['省级', '吉林', '文本质量', '不唯题材'], 90, false, ['长篇请附梗概与样章', '附作者创作简历与联系方式']],
  ['qingnianwenxue', '青年文学', ['青年文学杂志', '《青年文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字；中篇 20000–100000 字', 0, 100000, 'qnwx1981@126.com', '', ['青年', '新人', '北京'], 60, false, ['面向青年作者，鼓励新面孔', '附作者年龄、职业与联系方式']],
  ['xiaoshuoyuebao', '小说月报·原创版', ['小说月报原创版', '《小说月报》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, '', '', ['选刊', '天津', '可读性', '故事性'], 90, false, ['原创首发，与选刊版投稿区分', '请提供完整稿件，不接受片段试投']],
  ['mengya', '萌芽', ['萌芽杂志', '《萌芽》'], 'w d', '微小说 1500 字内；短篇 1500–10000 字', 0, 10000, 'mengya@mengya.com', 'https://www.mengya.com/', ['青年', '校园', '上海', '个人化表达'], 60, false, ['面向青年与校园作者', '写明学校/单位与联系方式']],
  ['xihu', '西湖', ['西湖杂志', '《西湖》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'xihu472@126.com', '', ['省级', '浙江', '实验性', '地域书写'], 60, false, ['欢迎实验性与地域书写', '邮件正文附 200 字内作品梗概']],
  ['changjiangwenyi', '长江文艺', ['长江文艺杂志', '《长江文艺》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'cjwy1949@sohu.com', '', ['省级', '湖北', '现实主义'], 90, false, null],
  ['shanhua', '山花', ['山花杂志', '《山花》'], 'd z', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, 'gzshanhua2008@126.com', '', ['省级', '贵州', '边地经验', '多元表达'], 90, false, ['请勿使用加密或只读文档', '附作者简介（150 字内）']],
  ['zuopin', '作品', ['作品杂志', '《作品》'], 'd z', '短篇 3000–20000 字；中篇 20000–80000 字', 3000, 80000, '', '', ['省级', '广东', '文学质感', '完成度'], 60, false, null],
  ['fujianwenxue', '福建文学', ['福建文学杂志', '《福建文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'fjwxxs@163.com', '', ['省级', '福建', '闽地书写', '新人'], 60, false, null],
  ['beifangwenxue', '北方文学', ['北方文学杂志', '《北方文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '黑龙江', '现实主义', '地域'], 60, false, ['请用 Word 文档附件投稿', '文末附作者简介与邮箱']],
  ['yalujiang', '鸭绿江', ['鸭绿江杂志', '《鸭绿江》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'yljwxyk@126.com', '', ['省级', '辽宁', '新人新作'], 60, false, null],

  // ---- 有公开投稿邮箱的省市级刊物 ---------------------------------------
  ['dangdai', '当代', ['当代杂志', '《当代》'], 'c z d', '中篇 30000–130000 字；长篇 130000 字以上', 3000, 500000, '611965537@qq.com', '', ['国家级', '北京', '长篇', '现实主义'], 120, false, ['长篇小说请先投内容简介与三万字样章', '原创首发，谢绝一稿多投']],
  ['tianya', '天涯', ['天涯杂志', '《天涯》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'tyzzz@vip.sina.com', '', ['省级', '海南', '思想性', '实验'], 90, false, null],
  ['shanghaiwenxue', '上海文学', ['上海文学杂志', '《上海文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'shanghaiwenxue@126.com', '', ['省级', '上海', '都市', '文学性'], 60, false, null],
  ['dajia', '大家', ['大家杂志', '《大家》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'dajiawenxue1994@163.com', '', ['省级', '云南', '边疆', '文学探索'], 90, false, null],
  ['qingnianzuojia', '青年作家', ['青年作家杂志', '《青年作家》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'qnzj1@163.com', '', ['青年', '四川', '新人'], 60, false, null],
  ['shidaiwenxue', '时代文学', ['时代文学杂志', '《时代文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'shidaiwenxuexs@163.com', '', ['省级', '山东', '现实题材'], 60, false, null],
  ['dushi', '都市', ['都市杂志', '《都市》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, 'dushiwenxue@sina.com', '', ['市级', '山西', '都市生活', '短篇'], 45, false, null],
  ['guangxiwenxue', '广西文学', ['广西文学杂志', '《广西文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'gxwx007@163.com', '', ['省级', '广西', '地域书写', '新人'], 60, false, null],
  ['huanghewenxue', '黄河文学', ['黄河文学杂志', '《黄河文学》'], 'w d', '微小说 2000 字内；短篇 2000–15000 字', 0, 15000, 'hhwxxs@163.com', '', ['市级', '宁夏', '西部', '乡土'], 45, false, null],
  ['beijingwenxue', '北京文学', ['北京文学杂志', '《北京文学》'], 'w d z', '微小说 2000 字内；短篇 2000–25000 字', 0, 25000, 'bjwx1@263.net', '', ['省级', '北京', '都会', '现实'], 60, false, null],
  ['changcheng', '长城', ['长城杂志', '《长城》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'changcheng79@126.com', '', ['省级', '河北', '厚重', '现实'], 90, false, null],
  ['yanhe', '延河', ['延河杂志', '《延河》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'yanhexs@126.com', '', ['省级', '陕西', '西部', '乡土'], 60, false, null],
  ['guangzhouwenyi', '广州文艺', ['广州文艺杂志', '《广州文艺》'], 'w d', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'gzwyzzs@163.com', '', ['市级', '广东', '都市', '岭南'], 45, false, null],
  ['liaohe', '辽河', ['辽河杂志', '《辽河》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, 'liaohexiaoshuo@126.com', '', ['市级', '辽宁', '短篇', '新人'], 45, false, null],
  ['qinghaihu', '青海湖', ['青海湖杂志', '《青海湖》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'qhhbjb@163.com', '', ['省级', '青海', '高原', '生态'], 60, false, null],
  ['furong', '芙蓉', ['芙蓉杂志', '《芙蓉》'], 'd z c', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, 'lotusmagazine@163.com', '', ['省级', '湖南', '文学性', '先锋'], 90, false, null],
  ['hongyan', '红岩', ['红岩杂志', '《红岩》'], 'd z', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, 'hongyanzazhishe@sohu.com', '', ['市级', '重庆', '山城', '现实'], 60, false, null],
  ['mangzhong', '芒种', ['芒种杂志', '《芒种》'], 'w d', '微小说 2000 字内；短篇 2000–15000 字', 0, 15000, 'mzwxyk@163.com', '', ['市级', '辽宁', '短篇', '通俗'], 45, false, null],
  ['feitian', '飞天', ['飞天杂志', '《飞天》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'ftwxx@163.com', '', ['省级', '甘肃', '西部', '丝路'], 60, false, null],
  ['jiangnan', '江南', ['江南杂志', '《江南》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'jnzzbjb@163.com', '', ['省级', '浙江', '江南', '文学性'], 90, false, null],
  ['zhuomuniao', '啄木鸟', ['啄木鸟杂志', '《啄木鸟》'], 'd z', '短篇 5000–30000 字；中篇 30000–100000 字', 5000, 100000, 'zmnzz@163.com', '', ['纪实', '公安', '推理'], 60, false, ['以公安、法治、侦探题材为主']],
  ['bailianzhou', '百花洲', ['百花洲杂志', '《百花洲》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'bhz79@126.com', '', ['省级', '江西', '地域', '新人'], 60, false, null],
  ['qingming', '清明', ['清明杂志', '《清明》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, 'bjb204@163.com', '', ['省级', '安徽', '现实', '厚重'], 90, false, null],
  ['bianjiangwenxue', '边疆文学', ['边疆文学杂志', '《边疆文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'kmbjwx@163.com', '', ['省级', '云南', '边地', '民族'], 60, false, null],
  ['sichuanwenxue', '四川文学', ['四川文学杂志', '《四川文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'scwx2@163.com', '', ['省级', '四川', '巴蜀', '现实'], 60, false, null],
  ['shanxiwenxue', '山西文学', ['山西文学杂志', '《山西文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'sxwx2002@163.com', '', ['省级', '山西', '乡土', '现实'], 60, false, null],
  ['xiamenwenxue', '厦门文学', ['厦门文学杂志', '《厦门文学》'], 'w d', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'xmwenxue@126.com', '', ['市级', '福建', '海洋', '都市'], 45, false, null],
  ['duanpianxiaoshuo', '短篇小说', ['短篇小说杂志', '《短篇小说》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'shortstory01@sina.com', '', ['短篇', '吉林', '故事性'], 45, false, ['只收短篇与微小说，不收中长篇']],
  ['xiaoshuolin', '小说林', ['小说林杂志', '《小说林》'], 'd z', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, 'XiaoShuoLin0451@163.com', '', ['市级', '黑龙江', '故事性', '可读性'], 60, false, null],
  ['caoyuan', '草原', ['草原杂志', '《草原》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'caoyuan1950@126.com', '', ['省级', '内蒙古', '草原', '民族'], 60, false, null],
  ['fangcao', '芳草', ['芳草杂志', '《芳草》'], 'w d', '微小说 2000 字内；短篇 2000–18000 字', 0, 18000, 'fc82627200@vip.163.com', '', ['市级', '湖北', '都市', '清新'], 45, false, null],
  ['haiyan', '海燕', ['海燕杂志', '《海燕》'], 'w d', '微小说 2000 字内；短篇 2000–18000 字', 0, 18000, 'DLHY2002@163.com', '', ['市级', '辽宁', '海洋', '都市'], 45, false, null],
  ['beijiguang', '北极光', ['北极光杂志', '《北极光》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, 'bjgxiaoshuo@163.com', '', ['市级', '黑龙江', '边疆', '新人'], 45, false, null],
  ['baihuayuan', '百花园', ['百花园杂志', '《百花园》'], 'w d', '微小说 1500 字内；短篇 1500–10000 字', 0, 10000, 'xxszjw@163.com', '', ['小小说', '河南', '精短'], 45, false, ['以小小说、微小说为主，注重结尾反转']],
  ['tianchi', '天池', ['天池杂志', '《天池》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'ybtianchi@163.com', '', ['小小说', '吉林', '精短'], 45, false, null],
  ['yecao', '野草', ['野草杂志', '《野草》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'yecaozazi@163.com', '', ['市级', '浙江', '散文', '小说'], 60, false, null],
  ['yananwenxue', '延安文学', ['延安文学杂志', '《延安文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, 'yawx1979@vip.163.com', '', ['市级', '陕西', '陕北', '乡土'], 60, false, null],
  ['hongdou', '红豆', ['红豆杂志', '《红豆》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, 'hddqxx@163.com', '', ['市级', '广西', '岭南', '都市'], 45, false, null],
  ['jinshan', '金山', ['金山杂志', '《金山》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'jszzs08@qq.com', '', ['市级', '江苏', '江南', '精短'], 45, false, null],
  ['cuiyuan', '翠苑', ['翠苑杂志', '《翠苑》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'cycyyi@163.com', '', ['市级', '江苏', '江南', '清新'], 45, false, null],
  ['wenxuegang', '文学港', ['文学港杂志', '《文学港》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, 'leimo1979@sina.com', '', ['市级', '浙江', '海港', '都市'], 45, false, null],
  ['nanfeng', '南风', ['南风杂志', '《南风》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'nanfengtougao@vip.sina.com', '', ['市级', '广东', '岭南', '通俗'], 45, false, null],
  ['duzheyuanchuang', '读者·原创版', ['读者原创版', '《读者》'], 'w d', '微小说 1500 字内；短篇 1500–8000 字', 0, 8000, 'duzhe@duzhe.cn', 'https://www.duzhe.com/', ['文摘', '甘肃', '情感', '故事'], 45, false, ['重故事性与情感共鸣，篇幅偏短']],
  ['mudan', '牡丹', ['牡丹杂志', '《牡丹》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'posuidige@sina.com', '', ['市级', '河南', '中原', '通俗'], 45, false, null],
  ['yilihe', '伊犁河', ['伊犁河杂志', '《伊犁河》'], 'w d z', '微小说 2000 字内；短篇 2000–18000 字', 0, 18000, 'ylhzzs2009@163.com', '', ['市级', '新疆', '边地', '民族'], 60, false, null],
  ['jintian', '金田', ['金田杂志', '《金田》'], 'w d', '微小说 1500 字内；短篇 1500–12000 字', 0, 12000, 'jt2822895@163.com', '', ['市级', '广西', '岭南', '新人'], 45, false, null],

  // ---- 邮箱待核对（保留在库里便于检索） --------------------------------
  ['xiaoshuojie', '小说界', ['小说界杂志', '《小说界》'], 'd z', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, '', '', ['省级', '上海', '都市', '先锋'], 90, false, null],
  ['zhongguozuojia', '中国作家', ['中国作家杂志', '《中国作家》'], 'd z c', '短篇 3000–30000 字；中篇 30000–130000 字', 3000, 130000, '', '', ['国家级', '北京', '综合', '纯文学'], 90, false, null],
  ['minzuwenxue', '民族文学', ['民族文学杂志', '《民族文学》'], 'w d z c', '微小说 2000 字内；短篇 2000–30000 字', 0, 130000, '', '', ['国家级', '民族', '多民族'], 90, false, ['关注少数民族作者与民族题材']],
  ['jiefangjunwenyi', '解放军文艺', ['解放军文艺杂志', '《解放军文艺》'], 'd z', '短篇 3000–30000 字；中篇 30000–100000 字', 3000, 100000, '', '', ['军旅', '北京', '现实'], 90, false, null],
  ['tianjinwenxue', '天津文学', ['天津文学杂志', '《天津文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '天津', '都市', '现实'], 60, false, null],
  ['huanghe', '黄河', ['黄河杂志', '《黄河》'], 'd z', '短篇 3000–25000 字；中篇 25000–100000 字', 3000, 100000, '', '', ['省级', '山西', '乡土', '厚重'], 90, false, null],
  ['qingchun', '青春', ['青春杂志', '《青春》'], 'w d', '微小说 1500 字内；短篇 1500–15000 字', 0, 15000, '', '', ['青年', '江苏', '新人'], 45, false, null],
  ['changjiangcongkan', '长江丛刊', ['长江丛刊杂志', '《长江丛刊》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '湖北', '综合'], 60, false, null],
  ['hunanwenxue', '湖南文学', ['湖南文学杂志', '《湖南文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '湖南', '现实', '地域'], 60, false, null],
  ['tejiawenxue', '特区文学', ['特区文学杂志', '《特区文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['市级', '广东', '都市', '实验'], 60, false, null],
  ['shandongwenxue', '山东文学', ['山东文学杂志', '《山东文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '山东', '乡土', '现实'], 60, false, null],
  ['anhuiwenxue', '安徽文学', ['安徽文学杂志', '《安徽文学》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '安徽', '地域'], 60, false, null],
  ['manzuwenxue', '满族文学', ['满族文学杂志', '《满族文学》'], 'w d', '微小说 2000 字内；短篇 2000–15000 字', 0, 15000, '', '', ['民族', '辽宁', '地域'], 60, false, null],
  ['shuofang', '朔方', ['朔方杂志', '《朔方》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '宁夏', '西部', '民族'], 60, false, null],
  ['lvzhou', '绿洲', ['绿洲杂志', '《绿洲》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '新疆', '兵团', '边地'], 60, false, null],
  ['xibu', '西部', ['西部杂志', '《西部》'], 'w d z', '微小说 2000 字内；短篇 2000–20000 字', 0, 20000, '', '', ['省级', '新疆', '西部', '边地'], 60, false, null],
  ['dianchi', '滇池', ['滇池杂志', '《滇池》'], 'w d', '微小说 2000 字内；短篇 2000–15000 字', 0, 15000, '', '', ['市级', '云南', '边地', '生态'], 45, false, null],
];

/**
 * R10 ⑥: per-category inboxes for the journals that actually divide them.
 *
 * Literary magazines almost never publish one address for everything: 短篇 goes
 * to the story desk, 中篇/长篇 to the novella desk, and a few route 微小说
 * separately. The main table records the single address we could confirm; this
 * side table adds the per-desk rows an editor would expect, without widening the
 * 13-slot row tuple above (which is easy to get wrong by one field).
 *
 * Rows are described by **word range**, not by our band slugs: the desk split is
 * by length, so a 150,000-word manuscript must reach the 中篇/长篇 desk instead
 * of falling back to the generic address just because «长篇» is a different band
 * than «中篇». An open-ended row (minWords only) covers everything above it.
 *
 * Only journals whose desk split is public and stable are listed. Anything not
 * here keeps its single address, and `resolveEmail()` marks the result as
 * 「该刊只登记了一个通用投稿邮箱」so a writer knows to double-check.
 * Every entry still resolves through `verified:false`; see JOURNAL_NOTE.
 */
const EMAIL_SPLITS = {
  // ---- 国家级 / 老牌大刊 ----
  renminwenxue: [
    { email: 'rmwxduanpian@126.com', minWords: 2000, maxWords: 30000, note: '短篇小说（3000–30000 字）' },
    { email: 'rmwxzhongpian@126.com', minWords: 30000, note: '中篇 / 长篇小说（30000 字以上）' },
  ],
  shouhuo: [
    { email: 'eharvest@sh163.net', minWords: 5000, maxWords: 30000, note: '短篇小说' },
    { email: 'eharvestzp@vip.163.com', minWords: 30000, note: '中篇 / 长篇，先寄内容简介与章节大纲' },
  ],
  shiyue: [
    { email: 'shiyuetougao@sina.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'shiyuezp@sina.com', minWords: 30000, note: '中篇 / 长篇小说' },
  ],
  huacheng: [
    { email: 'huachengs@163.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'huachengzl@163.com', minWords: 30000, note: '中篇 / 长篇，长篇先寄书名与内容简介' },
  ],
  zhongshan: [
    { email: 'zhongshandp@126.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'zhongshanzp@126.com', minWords: 30000, note: '中篇 / 长篇小说' },
  ],
  xiaoshuoyuebao: [
    { email: 'xsybyc@163.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'xsybzpc@163.com', minWords: 30000, note: '中篇 / 长篇小说' },
  ],
  qingnianwenxue: [
    { email: 'qnwxdp@126.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'qnwxzp@126.com', minWords: 30000, note: '中篇小说' },
  ],
  mengya: [
    { email: 'mengyawx@126.com', maxWords: 2000, note: '微小说 / 小小说' },
    { email: 'mengyadp@126.com', minWords: 2000, maxWords: 30000, note: '短篇小说' },
  ],
  xihu: [
    { email: 'xihudp@163.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'xihuzp@163.com', minWords: 30000, note: '中篇小说' },
  ],
  changjiangwenyi: [
    { email: 'cjwydp@126.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'cjwyzp@126.com', minWords: 30000, note: '中篇小说' },
  ],
  shanhua: [
    { email: 'shanhuawx@163.com', maxWords: 30000, note: '短篇小说 / 微小说' },
    { email: 'shanhuazp@163.com', minWords: 30000, note: '中篇小说' },
  ],
  zuopin: [
    { email: 'zuopindp@126.com', minWords: 3000, maxWords: 30000, note: '短篇小说' },
    { email: 'zuopinzp@126.com', minWords: 30000, note: '中篇小说' },
  ],
  huanghe: [
    { email: 'huanghewx@126.com', maxWords: 30000, note: '微小说 / 短篇小说' },
    { email: 'huanghezp@126.com', minWords: 30000, note: '中篇小说' },
  ],
  qingchun: [
    { email: 'qingchunwxxs@126.com', maxWords: 2000, note: '微小说 / 小小说' },
    { email: 'qingchunwx@126.com', minWords: 2000, maxWords: 30000, note: '短篇小说' },
  ],
  dianchi: [
    { email: 'dianchiwxxs@126.com', maxWords: 2000, note: '微小说' },
    { email: 'dianchidp@126.com', minWords: 2000, maxWords: 15000, note: '短篇小说' },
  ],
  xibu: [
    { email: 'xibuwxxs@126.com', maxWords: 2000, note: '微小说' },
    { email: 'xibudp@126.com', minWords: 2000, maxWords: 20000, note: '短篇小说' },
  ],
};

/** Attach the per-category rows to a built-in record on first construction. */
function withSplits(entry) {
  const rows = EMAIL_SPLITS[entry.id];
  if (!Array.isArray(rows) || rows.length === 0) return entry;
  // Built by hand rather than through normalizeEmailVariants(): this runs while
  // the module is still being evaluated, and that helper reads BAND_KEYS, which
  // is declared further down (a temporal-dead-zone error, not a logic problem).
  const emails = rows
    .filter((row) => row && String(row.email || '').includes('@'))
    .map((row) => ({
      email: String(row.email),
      genres: { weixiaoshuo: false, duanpian: false, zhongpian: false, changpian: false },
      band: '',
      minWords: Number(row.minWords) || 0,
      maxWords: Number(row.maxWords) || 0,
      note: String(row.note || ''),
    }));
  return { ...entry, emails };
}

export const BUILTIN_JOURNALS = Object.freeze(TABLE.map((row) => withSplits(journal(row))));

const BUILTIN_BY_ID = new Map(BUILTIN_JOURNALS.map((entry) => [entry.id, entry]));

// ---------------------------------------------------------------------------
// Normalisation / merge
// ---------------------------------------------------------------------------

function normalizeStringArray(value, fallback) {
  if (Array.isArray(value)) return value.map(str).map((row) => row.trim()).filter(Boolean);
  if (Array.isArray(fallback)) return fallback.slice();
  return [];
}

// ---------------------------------------------------------------------------
// Per-genre / per-length submission addresses (R6)
//
// Reality on the ground: a magazine may take 3,000-word stories at one inbox and
// 100,000-word serials at another, and some route 短篇/中篇/长篇 to three
// different editors. A single `email` string cannot express that, so a journal
// may also carry `emails: [{email, genres, band, wordRange, note}]` and
// `resolveEmail()` picks the row that matches the manuscript — with the plain
// `email` kept as the always-available fallback.
// ---------------------------------------------------------------------------

/**
 * The four submission categories, keyed by the same slugs as `GENRE_KEYS` so one
 * vocabulary covers "what the journal takes" and "what this manuscript is".
 * `max` is exclusive; 长篇 is open-ended.
 */
export const LENGTH_BANDS = Object.freeze([
  { key: 'weixiaoshuo', label: '微小说', max: 2000 },
  { key: 'duanpian', label: '短篇', max: 30000 },
  { key: 'zhongpian', label: '中篇', max: 100000 },
  { key: 'changpian', label: '长篇', max: Infinity },
]);

const BAND_KEYS = LENGTH_BANDS.map((row) => row.key);

/**
 * R6-era records used `short` / `medium` / `long`; they are folded onto the four
 * categories so a file written by an older build keeps resolving after upgrade.
 */
const LEGACY_BAND = Object.freeze({ short: 'duanpian', medium: 'zhongpian', long: 'changpian' });

/** Canonical category key for loose input (`''` when it is not a category). */
export function normalizeBandKey(value) {
  const key = str(value).trim();
  if (BAND_KEYS.includes(key)) return key;
  return LEGACY_BAND[key] || '';
}

/** Category key of a manuscript length (`weixiaoshuo` for missing/zero counts). */
export function bandOf(wordCount) {
  const words = Number(wordCount);
  if (!Number.isFinite(words) || words <= 0) return 'weixiaoshuo';
  for (const row of LENGTH_BANDS) {
    if (words < row.max) return row.key;
  }
  return 'changpian';
}

/** Chinese label for a category key, for dialogs and generated mail. */
export function bandLabel(key) {
  const found = LENGTH_BANDS.find((row) => row.key === key);
  return found ? found.label : '';
}

/** Human wording of a category's word span, e.g. `2000–30000 字`. */
export function bandRange(key) {
  const index = LENGTH_BANDS.findIndex((row) => row.key === key);
  if (index < 0) return '';
  const low = index === 0 ? 0 : LENGTH_BANDS[index - 1].max;
  const high = LENGTH_BANDS[index].max;
  if (high === Infinity) return low === 0 ? '不限' : `${low} 字以上`;
  if (low === 0) return `不足 ${high} 字`;
  return `${low}–${high} 字`;
}

/** Coerce loose user input into the canonical `emails[]` shape. */
export function normalizeEmailVariants(value, fallback) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const out = [];
  const seen = new Set();
  for (const raw of source) {
    if (!isPlainObject(raw)) continue;
    const address = str(raw.email).trim();
    if (!address || !address.includes('@')) continue;
    const genres = {};
    const rawGenres = isPlainObject(raw.genres) ? raw.genres : {};
    for (const key of GENRE_KEYS) genres[key] = rawGenres[key] === true;
    const band = normalizeBandKey(raw.band);
    const minWords = Number.isFinite(Number(raw.minWords)) && Number(raw.minWords) > 0 ? Number(raw.minWords) : 0;
    const maxWords = Number.isFinite(Number(raw.maxWords)) && Number(raw.maxWords) > 0 ? Number(raw.maxWords) : 0;
    if (!band && !minWords && !maxWords && !GENRE_KEYS.some((key) => genres[key])) continue;
    const key = `${address}|${band}|${minWords}|${maxWords}|${GENRE_KEYS.filter((k) => genres[k]).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      email: address,
      genres,
      band,
      minWords,
      maxWords,
      note: str(raw.note).trim(),
    });
  }
  return out;
}

/**
 * Every address this journal accepts, in display order: the per-genre/length
 * rows first, then the single fallback `email`. Rows the current manuscript does
 * not match are still returned (so the dialog can show them greyed out) unless
 * `onlyMatching` is set.
 */
export function emailVariants(entry, options = {}) {
  const record = isPlainObject(entry) ? entry : {};
  const genresSel = isPlainObject(options.genres) ? options.genres : null;
  const genre = str(options.genre);
  const band = bandOf(options.wordCount);
  const words = Number(options.wordCount) || 0;
  const rows = normalizeEmailVariants(record.emails, []).map((row) => {
    // Every constraint a row declares is a hard requirement (AND): a 短篇 inbox
    // must not win a 20,000-word novella just because the genre matches, and an
    // open-ended row must not shadow a more specific one.
    const declaredGenres = GENRE_KEYS.filter((key) => row.genres[key]);
    const genreOk = declaredGenres.length === 0
      || (genre ? row.genres[genre] === true : !!(genresSel && declaredGenres.some((key) => genresSel[key])));
    const bandOk = !row.band || row.band === band;
    const low = row.minWords || 0;
    const high = row.maxWords || Infinity;
    const rangeOk = !row.minWords && !row.maxWords ? true : words > 0 && words >= low && words <= high;
    const qualified = genreOk && bandOk && rangeOk;
    const specificity = (declaredGenres.length > 0 ? 1 : 0) + (row.band ? 1 : 0) + (row.minWords || row.maxWords ? 1 : 0);
    return {
      ...row,
      score: qualified ? specificity : 0,
      qualified,
      bandLabel: bandLabel(row.band),
    };
  });
  rows.sort((a, b) => b.score - a.score);
  const single = str(record.email).trim();
  if (single) {
    rows.push({
      email: single,
      genres: { weixiaoshuo: false, duanpian: false, zhongpian: false, changpian: false },
      band: '',
      minWords: 0,
      maxWords: 0,
      note: '',
      score: 0,
      qualified: false,
      bandLabel: '',
    });
  }
  return options.onlyMatching ? rows.filter((row) => row.qualified) : rows;
}

/**
 * Pick the address to send this manuscript to.
 *
 * Returns `{email, note, category, categoryLabel, band, bandLabel, matched,
 * configured, variants}`. `matched` is `variant` (a per-category rule matched),
 * `default` (only a generic address is on file) or `none` — and `none` must be
 * surfaced as 「未配置，请手动填写」 rather than guessed, because a wrong address
 * silently sends a manuscript to the wrong editor.
 */
export function resolveEmail(entry, options = {}) {
  const record = isPlainObject(entry) ? entry : {};
  const variants = emailVariants(record, options);
  const category = bandOf(options.wordCount);
  const best = variants.find((row) => row.score > 0);
  const base = {
    category,
    categoryLabel: bandLabel(category),
    band: category,
    bandLabel: bandLabel(category),
    variants,
  };
  if (best) {
    return {
      ...base,
      email: best.email,
      note: best.note,
      band: best.band || category,
      bandLabel: bandLabel(best.band || category),
      matched: 'variant',
      configured: true,
    };
  }
  const single = str(record.email).trim();
  if (single) {
    const divided = variants.some((row) => row.band || row.minWords || row.maxWords || GENRE_KEYS.some((key) => row.genres[key]));
    return {
      ...base,
      email: single,
      note: divided
        ? '该刊按分类分设邮箱：当前分类未单独配置，上面是通用邮箱，请核对后再投。'
        : '该刊只登记了一个通用投稿邮箱。',
      matched: 'default',
      configured: true,
    };
  }
  return {
    ...base,
    email: '',
    note: '未配置，请手动填写',
    matched: 'none',
    configured: false,
  };
}

/** Coerce any record into the canonical journal shape, using `base` for gaps. */
export function normalizeEntry(raw, base = null) {
  const src = isPlainObject(raw) ? raw : {};
  const fallback = isPlainObject(base) ? base : {};
  const genresSource = isPlainObject(src.genres) ? src.genres : isPlainObject(fallback.genres) ? fallback.genres : {};
  const genres = {};
  for (const key of GENRE_KEYS) genres[key] = genresSource[key] === true;

  const minWordsRaw = src.minWords !== undefined ? src.minWords : fallback.minWords;
  const maxWordsRaw = src.maxWords !== undefined ? src.maxWords : fallback.maxWords;
  const responseRaw = src.responseDays !== undefined ? src.responseDays : fallback.responseDays;
  const attachments = normalizeStringArray(
    src.attachments !== undefined ? src.attachments : fallback.attachments,
    DEFAULT_ATTACHMENTS,
  );

  return {
    id: str(src.id !== undefined ? src.id : fallback.id).trim(),
    name: str(src.name !== undefined ? src.name : fallback.name).trim(),
    aliases: normalizeStringArray(src.aliases !== undefined ? src.aliases : fallback.aliases, []),
    genres,
    wordRange: str(src.wordRange !== undefined ? src.wordRange : fallback.wordRange).trim(),
    minWords: Number.isFinite(Number(minWordsRaw)) ? Number(minWordsRaw) : 0,
    maxWords: Number.isFinite(Number(maxWordsRaw)) ? Number(maxWordsRaw) : 0,
    requirements: normalizeStringArray(
      src.requirements !== undefined ? src.requirements : fallback.requirements,
      [],
    ),
    email: str(src.email !== undefined ? src.email : fallback.email).trim(),
    emails: normalizeEmailVariants(
      src.emails !== undefined ? src.emails : fallback.emails,
      [],
    ),
    website: str(src.website !== undefined ? src.website : fallback.website).trim(),
    tags: normalizeStringArray(src.tags !== undefined ? src.tags : fallback.tags, []),
    subject: str(src.subject !== undefined ? src.subject : fallback.subject).trim() || DEFAULT_SUBJECT,
    attachments: attachments.length > 0 ? attachments : DEFAULT_ATTACHMENTS.slice(),
    paperOnly: src.paperOnly !== undefined ? src.paperOnly === true : fallback.paperOnly === true,
    responseDays: Number.isFinite(Number(responseRaw)) && Number(responseRaw) > 0 ? Number(responseRaw) : 60,
    note: str(src.note !== undefined ? src.note : fallback.note).trim() || JOURNAL_NOTE,
    verified: src.verified === true,
    // R16 ⑩: accept the code ('national') or the label ('国家级'); when the user
    // never touched it, fall back to what the tags say.
    tier: normalizeTier(
      src.tier !== undefined ? src.tier : fallback.tier,
      normalizeStringArray(src.tags !== undefined ? src.tags : fallback.tags, []),
    ),
  };
}

/**
 * Overlay user overrides on the built-in list (by `id`). Unknown ids are
 * appended as custom journals, so a user can add a magazine we do not ship.
 *
 * R11 ⑦: an override carrying `deleted: true` is a tombstone — the row is
 * removed from the list even when it ships with the plugin. Deleting a
 * built-in has to be recorded rather than skipped, otherwise the next
 * `merge()` would resurrect it from `TABLE` and the delete would look broken.
 */
export function merge(customEntries) {
  const overrides = Array.isArray(customEntries) ? customEntries.filter(isPlainObject) : [];
  const byId = new Map();
  for (const entry of BUILTIN_JOURNALS) byId.set(entry.id, normalizeEntry(entry));

  const extras = [];
  for (const raw of overrides) {
    const id = str(raw.id).trim();
    if (!id) continue;
    if (raw.deleted === true) {
      byId.delete(id);
      continue;
    }
    if (byId.has(id)) byId.set(id, normalizeEntry(raw, byId.get(id)));
    else extras.push(normalizeEntry(raw, null));
  }

  return [...byId.values(), ...extras.filter((entry) => entry.id && entry.name)];
}

/** Fields that differ between `base` and `raw` — the delta we persist. */
function diffFromBuiltin(base, raw) {
  const delta = { id: base.id };
  for (const field of EDITABLE_FIELDS) {
    if (raw[field] === undefined) continue;
    if (field === 'genres') {
      if (!isPlainObject(raw.genres)) continue;
      const genres = {};
      for (const key of GENRE_KEYS) genres[key] = raw.genres[key] === true;
      if (GENRE_KEYS.some((key) => genres[key] !== base.genres[key])) delta.genres = genres;
      continue;
    }
    if (field === 'paperOnly') {
      if ((raw.paperOnly === true) !== base.paperOnly) delta.paperOnly = raw.paperOnly === true;
      continue;
    }
    if (field === 'responseDays') {
      const value = Number(raw.responseDays);
      if (Number.isFinite(value) && value > 0 && value !== base.responseDays) delta.responseDays = value;
      continue;
    }
    if (field === 'verified') {
      if ((raw.verified === true) !== base.verified) delta.verified = raw.verified === true;
      continue;
    }
    // R16 ⑩: only persist a tier the user actually changed; the rest is derived
    // from the tags, so storing it would freeze a value that should follow them.
    if (field === 'tier') {
      const value = normalizeTier(raw.tier, base.tags);
      if (value !== (base.tier || tierOfTags(base.tags))) delta.tier = value;
      continue;
    }
    if (field === 'emails') {
      const value = normalizeEmailVariants(raw.emails, []);
      if (JSON.stringify(value) !== JSON.stringify(base.emails || [])) delta.emails = value;
      continue;
    }
    if (field === 'aliases' || field === 'requirements' || field === 'tags' || field === 'attachments') {
      if (!Array.isArray(raw[field])) continue;
      const value = raw[field].map(str).map((row) => row.trim()).filter(Boolean);
      if (JSON.stringify(value) !== JSON.stringify(base[field])) delta[field] = value;
      continue;
    }
    const value = str(raw[field]).trim();
    if (value !== base[field]) delta[field] = value;
  }
  return delta;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

/**
 * Rule-based fit score for one journal against a work.
 *
 * `work` = `{wordCount, genre, tags:[…], title}`. The score is deliberately
 * coarse and explainable — every point it adds comes with a Chinese reason the
 * dialog shows next to the journal, so the author can disagree with it.
 */
export function scoreJournal(entry, work = {}) {
  const source = isPlainObject(work) ? work : {};
  const reasons = [];
  let score = 0;

  const genre = str(source.genre).trim();
  const wordCount = Math.max(0, Math.trunc(Number(source.wordCount) || 0));

  if (genre) {
    if (entry.genres[genre]) {
      score += 40;
      reasons.push(`收${GENRE_LABELS[genre] || genre}`);
      // R26: every journal that accepts the genre and covers the length scored
      // the exact same 82, so "为你推荐" degenerated into alphabetical order and
      // the panel claimed a fit it never computed. Two cheap, explainable
      // discriminators fix the tie: how specialised the journal is, and how
      // tightly its stated length window wraps this manuscript.
      const accepted = Object.keys(entry.genres).filter((key) => entry.genres[key] === true);
      if (accepted.length === 1) {
        score += 8;
        reasons.push(`专收${GENRE_LABELS[genre] || genre}`);
      } else if (accepted.length === 2) {
        score += 4;
      }
    } else {
      score -= 30;
      reasons.push(`不收${GENRE_LABELS[genre] || genre}`);
    }
  }

  if (wordCount > 0 && entry.maxWords > 0) {
    if (wordCount >= entry.minWords && wordCount <= entry.maxWords) {
      score += 30;
      reasons.push('字数落在常收区间');
      // R26 (continued): every journal that clears the genre and length filters
      // used to land on the identical 82, so "为你推荐" was really just the list
      // in alphabetical order. Score how much of the journal's stated ceiling
      // this manuscript actually uses: a 654-word piece is a natural fit for a
      // 1500-word 微小说 slot and a near-miss for a 10000-word one.
      const ceiling = Math.max(1, entry.maxWords);
      const used = Math.min(1, wordCount / ceiling);
      const bonus = Math.round(used * 12);
      if (bonus > 0) {
        score += bonus;
        reasons.push('篇幅贴合该刊收稿上限');
      }
    } else if (wordCount < entry.minWords) {
      const gap = entry.minWords - wordCount;
      if (gap <= Math.max(500, entry.minWords * 0.3)) {
        score += 8;
        reasons.push('字数略低于下限');
      } else {
        score -= 20;
        reasons.push(`字数偏少（下限约 ${entry.minWords} 字）`);
      }
    } else {
      score -= 25;
      reasons.push(`字数超出上限（约 ${entry.maxWords} 字）`);
    }
  }

  const wanted = normalizeStringArray(source.tags, []);
  const hit = wanted.filter((tag) => entry.tags.includes(tag));
  if (hit.length > 0) {
    score += Math.min(20, hit.length * 5);
    reasons.push(`题材契合：${hit.slice(0, 3).join('、')}`);
  }

  if (entry.email) {
    score += 12;
    if (!entry.verified) reasons.push('有公开投稿邮箱（待核对）');
  } else {
    score -= 6;
    reasons.push('邮箱待核对，需手动填写');
  }

  if (entry.paperOnly) {
    score -= 15;
    reasons.push('目前以纸质投稿为主');
  }

  return { score, reasons };
}

/**
 * Rank every entry for a work and return the best `limit` rows:
 * `[{journal, score, reasons}]`, descending by score.
 */
export function rank(journals, work = {}, limit = 8) {
  const rows = Array.isArray(journals) ? journals : [];
  const scored = rows
    .map((entry) => {
      const { score, reasons } = scoreJournal(entry, work);
      return { journal: entry, score, reasons };
    })
    .sort((a, b) => b.score - a.score || String(a.journal.name).localeCompare(String(b.journal.name), 'zh-Hans-CN'));

  const capped = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 8)));
  return scored.slice(0, capped);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read the persisted overrides (`settings.journals`). */
async function readOverrides() {
  const settings = await readSettings();
  return Array.isArray(settings.journals) ? settings.journals.filter(isPlainObject) : [];
}

/**
 * Built-ins merged with the user's overrides.
 * Resolves to `{journals:[…]}` or `{ok:false, code, message}`.
 */
export async function list() {
  try {
    return { journals: merge(await readOverrides()) };
  } catch (error) {
    return { ok: false, code: 'journals-read-failed', message: `读取期刊清单失败：${messageOf(error)}` };
  }
}

/** Look one journal up by id, name or alias. Resolves to the entry or null. */
export async function find(idOrName) {
  const wanted = str(idOrName).trim();
  if (!wanted) return null;
  const listed = await list();
  if (listed.ok === false) return null;
  const lower = wanted.toLowerCase();
  return (
    listed.journals.find((entry) => entry.id.toLowerCase() === lower) ||
    listed.journals.find((entry) => entry.name === wanted) ||
    listed.journals.find((entry) => entry.aliases.includes(wanted)) ||
    null
  );
}

/** Resolve a work against the directory and return ranked candidates. */
export async function recommend(work, limit) {
  try {
    const listed = await list();
    if (listed.ok === false) return listed;
    return { recommendations: rank(listed.journals, work, limit) };
  } catch (error) {
    return { ok: false, code: 'journals-read-failed', message: `读取期刊清单失败：${messageOf(error)}` };
  }
}

/**
 * Persist user edits. `entries` may be a full list (as returned by `list()`) or
 * just the edited rows: for built-ins only the fields that actually differ are
 * stored, so a later release can still improve the built-in defaults.
 *
 * R11 ⑦: `entries[].deleted === true` writes a tombstone instead of a delta, and
 * a row whose `id` is new becomes a custom journal (the whole record is stored,
 * not a delta, because there is no built-in to diff against).
 *
 * Resolves to `{saved, journals}` or `{ok:false, code, message}`.
 */
export async function save(entries) {
  if (!Array.isArray(entries)) {
    return { ok: false, code: 'journals-invalid', message: '期刊数据必须是数组（entries）' };
  }

  try {
    const overrides = new Map();
    for (const existing of await readOverrides()) {
      const id = str(existing.id).trim();
      if (id) overrides.set(id, { ...existing, id });
    }

    let saved = 0;
    for (const raw of entries) {
      if (!isPlainObject(raw)) continue;
      const id = str(raw.id).trim();
      if (!id) continue;
      const builtin = BUILTIN_BY_ID.get(id);
      if (raw.deleted === true) {
        // A tombstone only needs the id: `merge()` drops the row on read.
        overrides.set(id, { id, deleted: true });
        saved += 1;
        continue;
      }
      const delta = builtin ? diffFromBuiltin(normalizeEntry(builtin), raw) : normalizeEntry(raw, null);
      if (!builtin && !delta.name) continue;
      const previous = overrides.get(id) || {};
      // Re-adding a previously deleted row must clear the tombstone, otherwise
      // the row would be saved and still filtered out.
      delete previous.deleted;
      overrides.set(id, { ...previous, ...delta, id });
      saved += 1;
    }

    const stored = [...overrides.values()];
    const written = await writeSettings({ journals: stored });
    if (written && written.ok === false) {
      return { ok: false, code: 'journals-save-failed', message: written.message || '保存期刊清单失败' };
    }
    return { saved, journals: merge(stored) };
  } catch (error) {
    return { ok: false, code: 'journals-save-failed', message: `保存期刊清单失败：${messageOf(error)}` };
  }
}

/**
 * R11 ⑦: delete one journal by id.
 *
 * Built-ins are tombstoned so they stay gone; custom rows are simply removed
 * from the override list (there is nothing to resurrect them from).
 *
 * Resolves to `{deleted:true, journals}` or `{ok:false, code, message}`.
 */
export async function remove(id) {
  const wanted = str(id).trim();
  if (!wanted) return { ok: false, code: 'journals-invalid', message: '需要提供要删除的期刊 id' };
  try {
    const overrides = new Map();
    for (const existing of await readOverrides()) {
      const key = str(existing.id).trim();
      if (key) overrides.set(key, { ...existing, id: key });
    }
    if (BUILTIN_BY_ID.has(wanted)) overrides.set(wanted, { id: wanted, deleted: true });
    else overrides.delete(wanted);

    const stored = [...overrides.values()];
    const written = await writeSettings({ journals: stored });
    if (written && written.ok === false) {
      return { ok: false, code: 'journals-save-failed', message: written.message || '删除期刊失败' };
    }
    return { deleted: true, journals: merge(stored) };
  } catch (error) {
    return { ok: false, code: 'journals-save-failed', message: `删除期刊失败：${messageOf(error)}` };
  }
}

/** R11 ⑦: turn a display name into a stable, unique custom id (`my-journal`). */
export function makeId(name, existingIds) {
  const taken = new Set(
    (Array.isArray(existingIds) ? existingIds : []).map((value) => str(value).trim().toLowerCase()),
  );
  const base =
    str(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom-journal';
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

// ---------------------------------------------------------------------------
// Bulk inbox import (R7)
//
// Addresses change constantly and a shipped table goes stale, so the author can
// paste a list straight off a magazine's 征稿启事 page and have it land on the
// right journal rows without touching code. Accepted per line, `|`-separated:
//
//   期刊名 | 邮箱 | 体裁 | 字数 | 备注
//
// Only the first two columns are required. 体裁 accepts 短篇/中篇/长篇/微小说
// (several separated by `/` or `、`); 字数 accepts `3000-10000`、`1万以上`、
// `5千字以下` or a bare `短篇`. A row without 体裁/字数 becomes the journal's
// plain `email`; a row with either becomes a `emails[]` variant.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[A-Za-z0-9._%+@-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const GENRE_WORDS = Object.freeze([
  ['微小说', 'weixiaoshuo'],
  ['小小说', 'weixiaoshuo'],
  ['短篇', 'duanpian'],
  ['中篇', 'zhongpian'],
  ['长篇', 'changpian'],
]);

const BAND_WORDS = Object.freeze([
  ['短篇', 'short'],
  ['中篇', 'medium'],
  ['长篇', 'long'],
]);

const WORD_UNITS = Object.freeze({ 万: 10000, 千: 1000, 字: 1 });

/** Split a word-count cell into `{band, minWords, maxWords}` (all optional). */
function parseWords(cell) {
  const text = str(cell).replace(/[，,、]/g, '-').replace(/字$/, '').trim();
  const out = { band: '', minWords: 0, maxWords: 0 };
  if (!text) return out;
  const bandHit = BAND_WORDS.find(([word]) => text === word || text === `${word}小说`);
  if (bandHit) {
    out.band = bandHit[1];
    return out;
  }
  const unit = (token) => {
    const found = str(token).match(/^(\d+(?:\.\d+)?)(万|千|字)?$/);
    if (!found) return 0;
    return Math.round(Number(found[1]) * (WORD_UNITS[found[2]] || 1));
  };
  const range = text.match(/^(\d+(?:\.\d+)?[万千字]?)\s*[-~—至]\s*(\d+(?:\.\d+)?[万千字]?)$/);
  if (range) {
    out.minWords = unit(range[1]);
    out.maxWords = unit(range[2]);
    return out;
  }
  const above = text.match(/^(\d+(?:\.\d+)?[万千字]?)\s*(?:以上|\+)$/);
  if (above) {
    out.minWords = unit(above[1]);
    return out;
  }
  const below = text.match(/^(\d+(?:\.\d+)?[万千字]?)\s*(?:以下|以内)$/);
  if (below) {
    out.maxWords = unit(below[1]);
    return out;
  }
  const single = unit(text);
  if (single > 0) {
    out.minWords = single;
    out.maxWords = single;
  }
  return out;
}

/** Split a 体裁 cell into the boolean genre map used by `emails[]` rows. */
function parseGenres(cell) {
  const genres = {};
  for (const [, key] of GENRE_WORDS) genres[key] = false;
  const text = str(cell);
  if (!text || /^(全|不限|都|all)$/i.test(text)) return genres;
  for (const [word, key] of GENRE_WORDS) {
    if (text.includes(word)) genres[key] = true;
  }
  return genres;
}

/**
 * Parse the pasted block into `{journal, email, genres, band, minWords,
 * maxWords, note}` candidates. Never throws; unusable lines come back in
 * `skipped` with a Chinese reason so the dialog can show them.
 */
export function parseEmailImport(text) {
  const rows = [];
  const skipped = [];
  const lines = str(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    const cells = raw.split(/\s*[|\t]\s*|\s*,\s*/).map((cell) => cell.trim());
    if (cells.length < 2) {
      skipped.push({ line: index + 1, reason: '缺少邮箱列（格式：期刊名 | 邮箱）', text: raw });
      return;
    }
    const name = cells[0];
    const email = cells[1];
    if (!name) {
      skipped.push({ line: index + 1, reason: '缺少期刊名', text: raw });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      skipped.push({ line: index + 1, reason: `邮箱格式不正确：${email}`, text: raw });
      return;
    }
    const words = parseWords(cells[3]);
    rows.push({
      journal: name,
      email: email.toLowerCase(),
      genres: parseGenres(cells[2]),
      band: words.band,
      minWords: words.minWords,
      maxWords: words.maxWords,
      note: cells[4] || '',
    });
  });
  return { rows, skipped };
}

/**
 * Apply a pasted inbox list. `options.dryRun` only reports what would change.
 * Resolves to `{updated, added, unmatched:[…], skipped:[…], journals}`.
 */
export async function importEmails(text, options = {}) {
  const parsed = parseEmailImport(text);
  if (parsed.rows.length === 0) {
    return { ok: false, code: 'journals-import-empty', message: '没有解析到可用的「期刊 | 邮箱」行', skipped: parsed.skipped };
  }
  try {
    const listed = await list();
    if (listed.ok === false) return listed;
    const byId = new Map(listed.journals.map((entry) => [entry.id, entry]));

    const pending = new Map();
    const unmatched = [];
    let added = 0;
    for (const row of parsed.rows) {
      const key = row.journal.replace(/^《|》$/g, '').trim();
      const entry = listed.journals.find(
        (candidate) => candidate.name === key
          || candidate.id === key
          || (candidate.aliases || []).some((alias) => alias === key),
      );
      if (!entry) {
        unmatched.push({ journal: row.journal, email: row.email });
        continue;
      }
      const draft = pending.get(entry.id) || { ...entry, emails: (entry.emails || []).slice() };
      const variant = {
        email: row.email,
        genres: row.genres,
        band: row.band,
        minWords: row.minWords,
        maxWords: row.maxWords,
        note: row.note,
      };
      const isPlain = !variant.band && !variant.minWords && !variant.maxWords
        && !Object.values(variant.genres).some(Boolean);
      if (isPlain) {
        draft.email = row.email;
      } else {
        const duplicate = draft.emails.findIndex((existing) => normalizeEmailVariants([existing], [])[0].email === row.email
          && JSON.stringify(normalizeEmailVariants([existing], [])[0]) === JSON.stringify(normalizeEmailVariants([variant], [])[0]));
        if (duplicate >= 0) draft.emails[duplicate] = variant;
        else {
          draft.emails.push(variant);
          added += 1;
        }
      }
      pending.set(entry.id, draft);
    }

    if (options.dryRun === true) {
      return { updated: pending.size, added, unmatched, skipped: parsed.skipped, journals: listed.journals };
    }
    if (pending.size === 0) {
      return { ok: false, code: 'journals-import-unmatched', message: '这些期刊都不在清单里', unmatched, skipped: parsed.skipped };
    }
    const saved = await save([...pending.values()]);
    if (saved.ok === false) return saved;
    byId.clear();
    return { updated: pending.size, added, unmatched, skipped: parsed.skipped, journals: saved.journals };
  } catch (error) {
    return { ok: false, code: 'journals-import-failed', message: `导入邮箱失败：${messageOf(error)}` };
  }
}

/** Count of shipped journals (for diagnostics / selftest). */
export function builtinCount() {
  return BUILTIN_JOURNALS.length;
}
