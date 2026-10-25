// 保存：ブラウザ内（localStorage）への記事の保存と、JSONバックアップ・復元
(function (root, factory) {
  const planner = typeof require === 'function' ? require('./planner.js') : root.NAS.planner;
  const mod = factory(planner);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).storage = mod;
})(typeof self !== 'undefined' ? self : this, function (planner) {
  'use strict';

  const KEY = 'note-article-studio.articles.v1';
  const BACKUP_APP = 'note-article-studio';
  const BACKUP_VERSION = 1;
  const RECOVERY_KEY = KEY + '.recovered';
  const MAX_BACKUP_CHARS = 10 * 1024 * 1024;

  // localStorage が使えない環境（プライベートブラウズ等）ではメモリに保存する
  function createStore(backend) {
    let persistent = true;
    let memory = {};
    if (!backend) {
      try {
        backend = root().localStorage;
        const probe = KEY + '.probe';
        backend.setItem(probe, '1');
        backend.removeItem(probe);
      } catch (e) {
        backend = null;
      }
    }
    if (!backend) {
      persistent = false;
      backend = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null; },
        setItem: function (k, v) { memory[k] = String(v); },
        removeItem: function (k) { delete memory[k]; },
      };
    }

    // 保存データが壊れていたとき、上書きする前に元の文字列を退避する。
    // 退避できなかった場合は書き込みを止め、元のデータを守る。
    let writeBlocked = false;
    let lastQuarantined = null;

    function quarantine(raw, reason) {
      if (raw === lastQuarantined) return;
      try {
        const existing = backend.getItem(RECOVERY_KEY);
        const prev = existing ? JSON.parse(existing) : null;
        if (!prev || prev.raw !== raw) {
          const slot = prev ? RECOVERY_KEY + '.' + Date.now() : RECOVERY_KEY;
          backend.setItem(slot, JSON.stringify({ savedAt: new Date().toISOString(), reason: reason, raw: raw }));
        }
        lastQuarantined = raw;
        writeBlocked = false;
      } catch (e) {
        writeBlocked = true;
      }
    }

    function readAll() {
      const raw = backend.getItem(KEY);
      if (!raw) return [];
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        quarantine(raw, '保存データをJSONとして読み込めませんでした');
        return [];
      }
      if (!Array.isArray(parsed)) {
        quarantine(raw, '保存データの形式が正しくありません');
        return [];
      }
      const out = [];
      const ids = new Set();
      let broken = false;
      parsed.forEach(function (item) {
        const r = planner.validateArticle(item);
        if (!r.article || ids.has(r.article.id)) { broken = true; return; }
        if (r.fixes.length) broken = true;
        ids.add(r.article.id);
        out.push(r.article);
      });
      if (broken) quarantine(raw, '保存データの一部に不正な値がありました');
      return out;
    }

    // JSON化してから1回で書き込む。失敗したときは以前のデータがそのまま残る。
    function writeAll(list) {
      if (writeBlocked) {
        throw new Error('保存データの一部が壊れていて退避もできなかったため、データを守るために保存を止めています。「データ」画面からバックアップを保存してください。');
      }
      const json = JSON.stringify(list);
      backend.setItem(KEY, json);
    }

    function recovered() {
      try {
        const v = backend.getItem(RECOVERY_KEY);
        return v ? JSON.parse(v) : null;
      } catch (e) {
        return null;
      }
    }

    function list() {
      return readAll().sort(function (a, b) {
        const x = String(a.updatedAt), y = String(b.updatedAt);
        return x < y ? 1 : x > y ? -1 : 0;
      });
    }

    function get(id) {
      return readAll().find(function (a) { return a.id === id; }) || null;
    }

    function save(article, now) {
      const all = readAll();
      const copy = planner.normalizeArticle(JSON.parse(JSON.stringify(article)));
      copy.updatedAt = (now || new Date()).toISOString();
      const idx = all.findIndex(function (a) { return a.id === copy.id; });
      if (idx === -1) all.push(copy); else all[idx] = copy;
      writeAll(all);
      return copy;
    }

    function remove(id) {
      const all = readAll();
      const next = all.filter(function (a) { return a.id !== id; });
      writeAll(next);
      return next.length !== all.length;
    }

    function duplicate(id, now) {
      const src = get(id);
      if (!src) return null;
      const ts = (now || new Date()).toISOString();
      const copy = Object.assign(JSON.parse(JSON.stringify(src)), {
        id: planner.uid(), createdAt: ts, updatedAt: ts, status: 'planning',
        title: src.title ? src.title + '（コピー）' : '',
      });
      return save(copy, now);
    }

    function exportBackup(now) {
      return {
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        exportedAt: (now || new Date()).toISOString(),
        articles: readAll(),
      };
    }

    // 復元前に「何件が新規で、何件が上書きになるか」を調べる
    function previewImport(data) {
      const current = readAll();
      const ids = new Set(current.map(function (a) { return a.id; }));
      const overwrite = data.articles.filter(function (a) { return ids.has(a.id); });
      return {
        total: data.articles.length,
        added: data.articles.length - overwrite.length,
        overwritten: overwrite.length,
        currentCount: current.length,
      };
    }

    // mode: 'merge'（同じIDは上書き、他は残す） / 'replace'（すべて置き換え）
    function importBackup(data, mode) {
      let all = mode === 'replace' ? [] : readAll();
      data.articles.forEach(function (a) {
        const idx = all.findIndex(function (x) { return x.id === a.id; });
        if (idx === -1) all.push(a); else all[idx] = a;
      });
      writeAll(all);
      return all.length;
    }

    return {
      persistent: persistent,
      isWriteBlocked: function () { return writeBlocked; },
      recovered: recovered,
      list: list, get: get, save: save, remove: remove, duplicate: duplicate,
      exportBackup: exportBackup, previewImport: previewImport, importBackup: importBackup,
    };
  }

  function root() {
    return typeof self !== 'undefined' ? self : {};
  }

  // バックアップJSONを検証して記事の配列にする。
  // ファイル全体が不正なら Error を投げる。記事単位の問題は rejected / fixes に入れて返す。
  function parseBackup(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('ファイルが空です。');
    }
    if (text.length > MAX_BACKUP_CHARS) {
      throw new Error('ファイルが大きすぎます（上限 10MB）。');
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSONとして読み込めませんでした。ファイルが壊れているか、バックアップファイルではありません。');
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data) || data.app !== BACKUP_APP) {
      throw new Error('Note Article Studio のバックアップファイルではありません。');
    }
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION) {
      throw new Error('このバージョンのアプリでは読み込めないバックアップです。');
    }
    if (!Array.isArray(data.articles)) {
      throw new Error('バックアップに記事の一覧がありません。');
    }
    if (!data.articles.length) {
      throw new Error('バックアップに記事が含まれていません。');
    }

    const articles = [];
    const rejected = [];
    const fixes = [];
    const ids = new Set();
    data.articles.forEach(function (raw, i) {
      const r = planner.validateArticle(raw, { limits: true });
      if (!r.article) { rejected.push({ index: i + 1, reason: r.error }); return; }
      if (ids.has(r.article.id)) { rejected.push({ index: i + 1, reason: '同じIDの記事がバックアップ内に重複しています' }); return; }
      ids.add(r.article.id);
      if (r.fixes.length) fixes.push({ index: i + 1, title: r.article.title || r.article.theme || '無題の記事', fields: r.fixes });
      articles.push(r.article);
    });
    if (!articles.length) {
      throw new Error('復元できる記事がありませんでした（' + rejected.length + '件すべてが不正）。例：' + rejected[0].reason);
    }
    const exportedAt = typeof data.exportedAt === 'string' && !isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : '';
    return { exportedAt: exportedAt, articles: articles, rejected: rejected, fixes: fixes };
  }

  function backupFileName(now) {
    const d = (now || new Date()).toISOString().replace(/[:T]/g, '-').slice(0, 16);
    return 'note-article-studio-backup_' + d + '.json';
  }

  return {
    createStore: createStore, parseBackup: parseBackup, backupFileName: backupFileName,
    KEY: KEY, RECOVERY_KEY: RECOVERY_KEY, MAX_BACKUP_CHARS: MAX_BACKUP_CHARS,
  };
});
