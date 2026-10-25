// Markdown出力：全文・無料部分・有料部分
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).exporter = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAID_MARKER = '<!-- ===== ここから有料 ===== -->';

  function header(article, partLabel) {
    const lines = ['# ' + (String(article.title || '').trim() || '無題の記事')];
    if (partLabel) lines.push('', '> ' + partLabel);
    if (article.hashtags && article.hashtags.length) lines.push('', article.hashtags.join(' '));
    return lines.join('\n');
  }

  function clean(text) {
    return String(text || '').replace(/\r\n/g, '\n').trim();
  }

  function toMarkdown(article, part) {
    const free = clean(article.body && article.body.free);
    const paid = clean(article.body && article.body.paid);
    const isPaid = article.pricing === 'paid';
    let out;
    if (part === 'free') {
      out = [header(article, isPaid ? '無料部分' : ''), free];
    } else if (part === 'paid') {
      out = [header(article, '有料部分'), paid];
    } else if (isPaid) {
      out = [header(article, ''), free, PAID_MARKER, paid];
    } else {
      out = [header(article, ''), free];
    }
    return out.filter(function (s) { return s !== ''; }).join('\n\n') + '\n';
  }

  // ファイル名に使えない文字を除き、日付を付ける
  function fileName(article, part, now) {
    const date = (now || new Date()).toISOString().slice(0, 10);
    const base = String(article.title || article.theme || 'article')
      .replace(/[\\/:*?"<>|#\s]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'article';
    const suffix = part === 'free' ? '_free' : part === 'paid' ? '_paid' : '';
    return date + '_' + base + suffix + '.md';
  }

  return { toMarkdown: toMarkdown, fileName: fileName, PAID_MARKER: PAID_MARKER };
});
