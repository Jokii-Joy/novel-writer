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
    '一键排版': 'Typeset',
    '导入': 'Import',
    '导出': 'Export',
    '备份': 'Backup',
    '主题': 'Theme',
    'Harness 默认': 'Harness default',
    'Claude 暖纸': 'Claude paper',
    '护眼': 'Eye care',
    '黑夜': 'Night',
    '水墨': 'Ink wash',
    '极简卡片': 'Minimal card',
    '报纸': 'Newspaper',
    '杂志': 'Magazine',
    '国风': 'Guofeng',
    '浅色': 'Light',
    '深色': 'Dark',
    '羊皮纸': 'Parchment',
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
    '还没有回信': 'No replies yet',
    '启用收件箱': 'Enable inbox',
    '沿用发信账号': 'Reuse sending account',
    '测试收件箱': 'Test inbox',
    'IMAP 主机': 'IMAP host',
    '收件账号': 'Inbox account',
    // R10 ④ / R11 ③: 灵感便签 — now a plain solid-colour editing page
    '灵感': 'Ideas',
    '灵感便签': 'Idea notes',
    '展开灵感便签': 'Open idea notes',
    '收起灵感便签': 'Collapse idea notes',
    '随手记一句：一个画面、一句对白、一个转折…': 'Jot down an image, a line of dialogue, a turn…',
    // R10 ⑥: every inbox a journal registers, not just the matching one
    '本稿用这个': 'For this manuscript',
    '该刊登记的收稿邮箱': 'Inboxes on file for this journal',
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
