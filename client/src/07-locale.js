;(() => {
  'use strict';

  /** Chinese key → English value. Chinese stays the fallback so a missing row never blanks the UI. */
  const EN = {
    '精神空间': 'Mindspace',
    '新建小说': 'New novel',
    '新建章节': 'New chapter',
    '新建子章节': 'New sub-chapter',
    '无标题': 'Untitled',
    '未命名章节': 'Untitled chapter',
    '章节': 'Chapter',
    '小说': 'Novel',
    '搜索': 'Search',
    '搜索章节…': 'Search chapters…',
    '重命名': 'Rename',
    '删除': 'Delete',
    '回收站': 'Trash',
    '设置': 'Settings',
    '保存': 'Save',
    '自动保存': 'Auto-saved',
    '已保存': 'Saved',
    '保存中…': 'Saving…',
    '未保存': 'Unsaved',
    '字数': 'Words',
    '时': '',
    '确认删除': 'Confirm delete',
    '取消': 'Cancel',
    '确定': 'OK',
    '完成': 'Done',
    '预览': 'Preview',
    '应用': 'Apply',
    '关闭': 'Close',
    '全部接受': 'Accept all',
    '全部拒绝': 'Reject all',
    '接受': 'Accept',
    '拒绝': 'Reject',
    'AI 校对': 'AI proofreading',
    'AI 校对模型': 'Proofreading model',
    'AI 校对要求': 'Proofreading brief',
    'AI 投稿模型': 'Submission model',
    'AI 修改建议模型': 'Advice model',
    '只做错别字与标点这类机械校对，可以选便宜快的模型。': 'Mechanical fixes only — a cheap, fast model is fine.',
    '生成投稿邮件正文与按期刊要求排版时使用。': 'Drafts the submission mail and typesets it to the journal rules.',
    '通读全章给出修改建议，建议用能力更强的模型。': 'Reads the whole chapter for editorial advice — a stronger model helps.',
    '会拼在校对提示词后面。留空就用内置默认：': 'Appended to the proofreading prompt. Empty keeps the built-in default: ',
    '例如：人名统一用「林深」，不要改成「林深先生」；保留作者刻意使用的短句。': 'e.g. keep the name as 林深, never 林深先生; keep the author deliberate short sentences.',
    '一键排版': 'Typeset',
    '导入': 'Import',
    '导出': 'Export',
    '备份': 'Backup',
    '主题': 'Theme',
    '护眼': 'Eye care',
    '黑夜': 'Night',
    '报纸': 'Newspaper',
    '杂志': 'Magazine',
    '调整建议栏宽度': 'Resize the advice column',
    '拖拽调整建议栏宽度': 'Drag to resize the advice column',
    '拖拽调整建议栏宽度（双击回到自动）': 'Drag to resize (double-click for auto)',
    '浅色': 'Light',
    '深色': 'Dark',
    '打字机模式': 'Typewriter mode',
    '字体': 'Font',
    '字号': 'Size',
    '行距': 'Line height',
    '页宽': 'Page width',
    '快捷键': 'Shortcuts',
    '查找替换': 'Find & replace',
    '查找': 'Find',
    '替换为': 'Replace with',
    '替换': 'Replace',
    '全部替换': 'Replace all',
    '上一个': 'Previous',
    '下一个': 'Next',
    '锁定': 'Lock',
    '解锁': 'Unlock',
    '密码': 'Password',
    '设置密码': 'Set password',
    '输入密码': 'Enter password',
    '密码错误': 'Wrong password',
    '自动锁定': 'Auto-lock',
    '登录': 'Sign in',
    '退出登录': 'Sign out',
    '同步': 'Sync',
    '同步中…': 'Syncing…',
    '已同步': 'Synced',
    '本地优先': 'Local first',
    '版本历史': 'Version history',
    '恢复': 'Restore',
    '清空回收站': 'Empty trash',
    '新章节': 'New chapter',
    '校对': 'Proofread',
    '正文': 'Body',
    '无匹配': 'No matches',
    '还没有小说': 'No novels yet',
    '小说目录': 'Novels',
    '目录操作': 'Shelf actions',
    '展开': 'Expand',
    '折叠': 'Collapse',
    '清除': 'Clear',
    '搜索结果': 'Search results',
    '没有匹配的章节': 'No matching chapters',
    '字': 'words',
    '{0} 章': '{0} chapters',
    '新建第一部小说，把灵感变成故事。': 'Create your first novel and turn ideas into a story.',
    '试试更短的关键词，标题和正文都会匹配。': 'Try a shorter keyword — titles and body text both match.',
    '从上方选择一部小说查看目录。': 'Pick a novel above to browse its contents.',
    '这部小说还没有章节，点页脚的 新建章节 开始。':
      'This novel has no chapters yet — use New chapter in the footer to begin.',
    '回收站入口尚未接入': 'Trash entry is not wired up yet',
    '从左侧选择或新建一个章节开始写作': 'Select or create a chapter on the left to start writing',
    'Ctrl+F 查找 · Ctrl+S 保存 · Tab 缩进': 'Ctrl+F find · Ctrl+S save · Tab indent',
    '已替换 {0} 处': 'Replaced {0} occurrence(s)',
    '沉浸模式': 'Immersive',
    '按 Esc 退出沉浸模式': 'Press Esc to leave immersive mode',
    '隐藏目录': 'Hide contents',
    '显示目录': 'Show contents',
    '目录': 'Contents',
    '收起/展开宿主侧栏': 'Toggle host sidebar',
    '展开写作工具': 'Open writing tools',
    '收起写作工具': 'Close writing tools',
    '投稿': 'Submit',
    '投稿助手': 'Submission assistant',
    '期刊': 'Journal',
    /* R16 ⑩: 期刊水平等级 — the codes live in the host, these are the labels. */
    '期刊等级': 'Tier',
    '国家级': 'National',
    '省级': 'Provincial',
    '市级': 'Municipal',
    '其他': 'Other',
    '体裁': 'Genre',
    '微小说': 'Micro fiction',
    '短篇': 'Short story',
    '中篇': 'Novella',
    '长篇': 'Novel',
    '稿件': 'Manuscript',
    '收件邮箱': 'Recipient email',
    '投稿邮箱': 'Submission email',
    '投稿要求': 'Submission guidelines',
    '一键投稿': 'Submit now',
    '预览邮件': 'Preview email',
    '邮件主题': 'Subject',
    '邮件正文': 'Body',
    '格式检查': 'Format check',
    '自动调整': 'Auto-fix',
    '保存目录': 'Library folder',
    '小说保存目录': 'Library folder',
    '选择…': 'Choose…',
    '立即同步': 'Sync now',
    '自动同步': 'Auto-sync',
    '导出与文件': 'Export & files',
    '外观': 'Appearance',
    '写作': 'Writing',
    '隐私与锁定': 'Privacy & lock',
    '结尾追加内容': 'Closing note',
    '追加到导出文件末尾': 'Append to the end of exported files',
    '署名': 'Pen name',
    '联系方式': 'Contact',
    '包括书名与作者信息': 'Include title and author',
    '本地加密存储': 'Encrypt local files',
    '高级': 'Advanced',
    '自备应用': 'Bring your own app',
    '简单模式': 'Simple mode',
    '保存并连接': 'Save and connect',
    '连接成功': 'Connected',
    '未配置': 'Not configured',
    '测试连接': 'Test connection',
    '邮件服务器': 'Mail server',
    '发件邮箱': 'Sender email',
    '授权码': 'App password',
    '版本': 'Version',
    '立即快照': 'Snapshot now',
    '滚动到光标处': 'Scroll to caret',
    // R11 ④: caret appearance is user-settable
    '光标粗细': 'Caret width',
    '光标颜色': 'Caret colour',
    '光标闪烁': 'Caret blink',
    '跟随主题': 'Follow theme',
    '留空表示跟随主题。': 'Leave empty to follow the theme.',
    '下一步': 'Next',
    '上一步': 'Back',
    '确认投稿': 'Send submission',
    '全文查看': 'Full text',
    '收件箱': 'Inbox',
    '编辑部回信': 'Replies from journals',
    '未读': 'Unread',
    '刷新': 'Refresh',
    '刷新收件箱': 'Refresh inbox',
    '删除这封邮件': 'Delete this mail',
    '还没有回信': 'No replies yet',
    '启用收件箱': 'Enable inbox',
    '沿用发信账号': 'Reuse sending account',
    '测试收件箱': 'Test inbox',
    'IMAP 主机': 'IMAP host',
    '收件账号': 'Inbox account',
    // R10 ④ / R11 ③ / R13 ②: 灵感便签 — a floating card over the manuscript
    '灵感': 'Ideas',
    '灵感便签': 'Idea notes',
    '展开灵感便签': 'Open idea notes',
    '收起灵感便签': 'Collapse idea notes',
    '空白': 'Empty',
    'Esc 收起': 'Esc to close',
    '随手记一句：一个画面、一句对白、一个转折…': 'Jot down an image, a line of dialogue, a turn…',
    // R10 ⑥: every inbox a journal registers, not just the matching one
    '本稿用这个': 'For this manuscript',
    '该刊登记的收稿邮箱': 'Inboxes on file for this journal',
    // R12 ①: the manuscript's own home button (the shelf header is hidden in
    // immersive mode, so the paper needs its own exit).
    '首页': 'Home',
    '回到首页': 'Back to home',
    // R12 ②: the critique column beside the manuscript
    '补充要求': 'Extra instructions',
    '补充要求，例如：只看结尾三段 / 别动对话 / 主角口吻再冷一点': 'Extra instructions, e.g. only the last three paragraphs / leave dialogue alone / colder voice',
    'Enter 按这个要求重来': 'Enter to re-run with this',
    '清空': 'Clear',
    '重要': 'Important',
    '可改可不改': 'Optional',
    '结构': 'Structure',
    '人物': 'Character',
    '逻辑': 'Logic',
    '情绪': 'Emotion',
    '冗余': 'Redundancy',
    '修改建议': 'Suggestions',
    '关闭建议': 'Close suggestions',
    '建议重点': 'Focus',
    '正在读这一章…': 'Reading this chapter…',
    '开始审读': 'Review this chapter',
    '重新审读': 'Review again',
    '取消高亮': 'Clear highlights',
    '节奏': 'Pacing',
    '用词': 'Diction',
    '画面': 'Imagery',
    '对话': 'Dialogue',
    '视角': 'Point of view',
    // R12 ④: the inbox reader
    '邮件': 'Mail',
    '去投稿': 'Go to submissions',
    '正在从服务器读取这封邮件…': 'Fetching this message from the server…',
    '这封邮件没有编号，无法读取': 'This message has no id and cannot be read',
    '服务器没有返回正文': 'The server returned no body',
    '（这封邮件没有可显示的正文）': '(this message has no displayable body)',
    '（无主题）': '(no subject)',
    // R12 ②: the critique column's empty and boundary states
    '这一章还没有正文': 'This chapter has no text yet',
    '获取修改建议失败': 'Could not get suggestions',
    '模型要通读全文，通常十几秒。': 'The model reads the whole chapter — usually ten seconds or so.',
    '让模型通读这一章，指出最值得改的地方。': 'Let the model read this chapter and point out what is worth changing.',
    '建议是意见，不是自动替换；点一条会把原文滚到那一段。':
      'Suggestions are opinions, not replacements — clicking one scrolls to that passage.',
    '这一章没有被标出的明显问题。': 'Nothing obvious was flagged in this chapter.',
    '换个重点再看看，或写下去。': 'Try another focus, or keep writing.',
    '原文已改动，定位不到': 'Text changed — cannot locate',
    '表达': 'Expression',
    // Shared verbs and labels the shelf and empty states already use.
    '重试': 'Retry',
    '全部': 'All',
    '书架': 'Shelf',
    '从书架里选一部小说开始写作。': 'Pick a novel from the shelf to start writing.',
    '{0} 本': '{0} in all',
    '书架里只有这一本。': 'This is the only book so far.',
    '导入小说': 'Import novels',
    '更多操作': 'More actions',
    '收起侧栏': 'Collapse sidebar',
    '侧栏操作': 'Sidebar actions',
    '创作台首页': 'Studio home',
    '导出入口尚未接入': 'Export is not wired up yet',
    '导入入口尚未接入': 'Import is not wired up yet',
    '收起侧栏尚未接入': 'Sidebar collapse is not wired up yet',
    // R27 ③: the model's journal verdict, shown as a chip on the reco row.
    '大模型读过开头，按契合度与水准推荐': 'The model read the opening — ranked by fit and quality',
    '为你推荐（按字数、体裁与题材匹配）': 'Recommended by length, genre and subject',
    '够格': 'Ready',
    '略欠': 'Not quite',
    '尚不足': 'Not yet',
    '收起': 'Collapse',
  };

  const DICT = { zh: {}, en: EN };

  let translate = null;

  NW.t = function t(key, ...args) {
    let out = key;
    if (translate) {
      try {
        const hit = translate(key);
        if (hit !== undefined && hit !== null && hit !== '') out = hit;
      } catch (err) {
        out = key;
      }
    }
    if (args.length > 0) {
      for (let i = 0; i < args.length; i += 1) {
        out = String(out).replace(new RegExp('\\{' + i + '\\}', 'g'), String(args[i]));
      }
    }
    return out;
  };

  /** Registers our dictionary on the host locale service and binds the translator. */
  NW.bindLocale = function bindLocale(ctx) {
    const NS = 'novel-writer';
    const locale = ctx.get('locale');
    if (!locale) return () => {};
    const off = locale.register(NS, DICT);
    translate = locale.bind(NS);
    NW.locale = locale;
    NW.localeNs = NS;
    return typeof off === 'function' ? off : () => {};
  };

  const LOCALE_ZH = {
    '新章节': '新章节',
    '恢复本章历史版本': '恢复本章历史版本',
  };
  NW.LOCALE_ZH = LOCALE_ZH;

  /** Date formatting shared by shelf rows and status bar. */
  NW.fmtDate = function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  NW.fmtWords = function fmtWords(n) {
    const value = Number(n) || 0;
    if (value < 1000) return String(value);
    if (value < 10000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return (value / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  };
})();
