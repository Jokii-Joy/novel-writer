;(() => {
  'use strict';

  /**
   * R43 ①: this plugin ships Chinese only.
   *
   * R41 shipped an EN dictionary of Chinese key → English value. The host
   * locale service falls back along `[activeLocale, en]`, so on a Chinese
   * browser every key that HAD an English row rendered in English while the
   * remaining keys stayed Chinese — the mixed UI the user reported.
   *
   * Registering two empty dictionaries pins the lookup to a miss, and
   * `NW.t` then returns the key itself, which is already the Chinese copy.
   * That is the whole mechanism: one language, no mixing, no dead strings.
   */
  const DICT = { zh: {}, en: {} };

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
    // R43 ①: `register` throws when the same namespace+locale is registered
    // twice, which happens when the host re-activates the client without a full
    // page reload. A throw here used to take the whole panel down with it, and
    // the dictionary no longer matters (it is empty), so swallow it and keep the
    // binding — worst case the translator stays whatever it was.
    let off = () => {};
    try {
      off = locale.register(NS, DICT);
    } catch (err) {
      off = () => {};
    }
    try {
      translate = locale.bind(NS);
    } catch (err) {
      translate = null;
    }
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
