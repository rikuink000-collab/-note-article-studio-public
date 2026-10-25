// 記事の企画：記事タイプ・構成テンプレート・記事データの初期値
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).planner = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUSES = [
    { value: 'planning', label: '企画中' },
    { value: 'writing', label: '執筆中' },
    { value: 'proofreading', label: '校正中' },
    { value: 'ready', label: '公開準備完了' },
    { value: 'published', label: '公開済み' },
  ];

  // 見出しごとのメモは「何を書くか」の指示。本文に挿入したあと書き換える前提。
  const ARTICLE_TYPES = {
    howto: {
      label: '手順・ハウツー',
      outline: [
        ['はじめに：この記事でわかること', '読者の悩みと、読み終えたときにできるようになることを1〜2文で書く'],
        ['こんな人におすすめ', '対象読者を箇条書きで3つ程度'],
        ['準備するもの', '必要なツール・アカウント・費用の有無を具体的に'],
        ['手順1', '最初の操作を、画面の名前やボタン名まで具体的に'],
        ['手順2', '次の操作。入力例や設定値を実際の例で示す'],
        ['手順3', '仕上げの操作と、うまくいったか確認する方法'],
        ['つまずきやすいポイント', '実際に起きたエラーや迷った点と、その解決方法'],
        ['まとめと次の一歩', '要点を3行で振り返り、読者が今日やることを1つ提案する'],
      ],
    },
    experience: {
      label: '体験記・振り返り',
      outline: [
        ['はじめに', '何に取り組んだかと、この記事で共有することを書く'],
        ['取り組んだきっかけ', 'そのときの悩みや状況を具体的なエピソードで'],
        ['実際にやったこと', '時系列で、使ったツールやかかった時間も含めて'],
        ['うまくいったこと', '結果を事実ベースで。数字は実測値のみ'],
        ['うまくいかなかったこと', '失敗した点と、その原因の考察'],
        ['学んだこと', '読者が真似できる形で、行動に落とし込んだ学び'],
        ['まとめ', '振り返りと、同じことに挑戦する人へのひとこと'],
      ],
    },
    tool: {
      label: 'ツール紹介・活用術',
      outline: [
        ['はじめに', 'どんな作業がどう楽になるのかを具体的な場面で示す'],
        ['このツールでできること', '機能を3つ程度。抽象的な説明ではなく使用例で'],
        ['料金と始め方', '無料で使える範囲、有料プランの有無（公式情報を確認して記載）'],
        ['基本の使い方', '最初に試す操作を手順で'],
        ['実際の活用例', '自分の仕事・制作での具体例。入力と出力の例を示す'],
        ['注意点と限界', '苦手なこと、情報の正確性、個人情報の扱いなど'],
        ['まとめ', '向いている人・向いていない人と、最初の一歩'],
      ],
    },
    gamedev: {
      label: 'AIで個人ゲーム制作',
      outline: [
        ['はじめに', '作ったゲームの一言紹介と、この記事で共有すること'],
        ['作ったゲームの概要', 'ジャンル、遊び方、プレイ時間、スクリーンショットの説明'],
        ['使ったAIとツール', 'エンジン・AIツール・素材の入手先とライセンス'],
        ['制作の流れ', '企画から公開までの手順と、それぞれにかかった時間'],
        ['AIに任せた部分・自分でやった部分', '具体的なプロンプト例や、AIの出力をどう直したか'],
        ['苦労した点と解決方法', '実際のエラーや詰まった点と、その解決手順'],
        ['これから作る人へのアドバイス', '最初に作るべき小さなゲームの例など、行動できる提案'],
        ['まとめ', '振り返りと今後の予定'],
      ],
    },
  };

  const PAID_SPLIT_DEFAULT = 0.5;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function createArticle(now) {
    const ts = (now || new Date()).toISOString();
    return {
      id: uid(),
      createdAt: ts,
      updatedAt: ts,
      status: 'planning',
      title: '',
      theme: '',
      audience: '',
      problems: '',
      goal: '',
      articleType: 'howto',
      pricing: 'free',
      price: '',
      outline: [],
      body: { free: '', paid: '' },
      titleCandidates: [],
      hashtags: [],
      imageMood: '',
      imagePrompt: '',
      checklist: {},
    };
  }

  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  const CHECK_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
  const EPOCH = new Date(0).toISOString();
  const TEXT_FIELDS = ['title', 'theme', 'audience', 'problems', 'goal', 'imageMood', 'imagePrompt'];
  // バックアップ復元時の上限（これを超える記事は復元しない）
  const LIMITS = { short: 2000, long: 500000, outline: 200, list: 100 };
  const LONG_FIELDS = { problems: true, goal: true, imagePrompt: true };

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  function validDate(v) {
    if (typeof v !== 'string') return null;
    const t = Date.parse(v);
    return isNaN(t) ? null : new Date(t).toISOString();
  }

  // 記事データの型を検証し、想定外の値は安全な初期値に補正する。
  // 元のオブジェクトはコピーせず、決められた項目だけを組み立てる（想定外の項目は捨てる）。
  // 戻り値: { article, fixes: 補正した項目名の配列, error: 復元できない理由（なければ null） }
  // opts.limits: 文字数などの上限を確認する（バックアップ復元時）
  function validateArticle(raw, opts) {
    const limits = !!(opts && opts.limits);
    const fixes = [];
    if (!isPlainObject(raw)) return { article: null, fixes: fixes, error: '記事データの形式が正しくありません' };
    const id = isValidId(raw.id) ? raw.id : opts && opts.fallbackId;
    if (!isValidId(id)) return { article: null, fixes: fixes, error: '記事IDが正しくありません' };

    const fix = function (name) { if (fixes.indexOf(name) === -1) fixes.push(name); };
    const text = function (name, value, max) {
      if (value === undefined) return '';
      if (typeof value !== 'string') { fix(name); return ''; }
      if (limits && value.length > max) throw new Error('「' + name + '」の文字数が上限（' + max + '文字）を超えています');
      return value;
    };
    const oneOf = function (name, value, allowed, fallback) {
      if (allowed.indexOf(value) !== -1) return value;
      if (value !== undefined) fix(name);
      return fallback;
    };
    const stringList = function (name, value) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) { fix(name); return []; }
      const out = value.filter(function (v) { return typeof v === 'string'; });
      if (out.length !== value.length) fix(name);
      if (limits && out.length > LIMITS.list) throw new Error('「' + name + '」の件数が上限（' + LIMITS.list + '件）を超えています');
      return out.map(function (v) { return text(name, v, LIMITS.short); });
    };

    try {
      const a = { id: id };
      const created = validDate(raw.createdAt);
      if (!created && raw.createdAt !== undefined) fix('createdAt');
      const updated = validDate(raw.updatedAt);
      if (!updated && raw.updatedAt !== undefined) fix('updatedAt');
      a.createdAt = created || updated || EPOCH;
      a.updatedAt = updated || a.createdAt;
      a.status = oneOf('status', raw.status, STATUSES.map(function (s) { return s.value; }), 'planning');
      TEXT_FIELDS.forEach(function (f) {
        a[f] = text(f, raw[f], LONG_FIELDS[f] ? LIMITS.long : LIMITS.short);
      });
      a.articleType = oneOf('articleType', raw.articleType, Object.keys(ARTICLE_TYPES), 'howto');
      a.pricing = oneOf('pricing', raw.pricing, ['free', 'paid'], 'free');
      a.price = '';
      if (typeof raw.price === 'number' && isFinite(raw.price) && raw.price >= 0) a.price = String(raw.price);
      else if (typeof raw.price === 'string' && /^[0-9]{0,9}$/.test(raw.price)) a.price = raw.price;
      else if (raw.price !== undefined) fix('price');

      const body = raw.body === undefined ? {} : raw.body;
      if (!isPlainObject(body)) fix('body');
      a.body = {
        free: text('body.free', isPlainObject(body) ? body.free : undefined, LIMITS.long),
        paid: text('body.paid', isPlainObject(body) ? body.paid : undefined, LIMITS.long),
      };

      a.outline = [];
      if (raw.outline !== undefined && !Array.isArray(raw.outline)) fix('outline');
      if (Array.isArray(raw.outline)) {
        if (limits && raw.outline.length > LIMITS.outline) throw new Error('構成の見出し数が上限（' + LIMITS.outline + '件）を超えています');
        raw.outline.forEach(function (o) {
          if (!isPlainObject(o)) { fix('outline'); return; }
          if (o.paid !== undefined && typeof o.paid !== 'boolean') fix('outline');
          a.outline.push({
            id: isValidId(o.id) ? o.id : uid(),
            heading: text('outline', o.heading, LIMITS.short),
            note: text('outline', o.note, LIMITS.short),
            paid: o.paid === true,
          });
        });
      }

      a.titleCandidates = stringList('titleCandidates', raw.titleCandidates);
      a.hashtags = stringList('hashtags', raw.hashtags);

      a.checklist = {};
      if (raw.checklist !== undefined && !isPlainObject(raw.checklist)) fix('checklist');
      if (isPlainObject(raw.checklist)) {
        Object.keys(raw.checklist).forEach(function (k) {
          if (CHECK_KEY_PATTERN.test(k) && typeof raw.checklist[k] === 'boolean') a.checklist[k] = raw.checklist[k];
          else fix('checklist');
        });
      }
      return { article: a, fixes: fixes, error: null };
    } catch (e) {
      return { article: null, fixes: fixes, error: e.message };
    }
  }

  // 古いデータや欠けたフィールドを補う。IDが不正なときは新しいIDを振る。
  function normalizeArticle(raw) {
    const r = validateArticle(isPlainObject(raw) ? raw : {}, { fallbackId: uid() });
    return r.article || createArticle();
  }

  // 記事タイプのテンプレートから構成を作る。有料記事は後半を有料部分にする。
  function buildOutline(articleType, pricing) {
    const type = ARTICLE_TYPES[articleType] || ARTICLE_TYPES.howto;
    const items = type.outline;
    const splitAt = Math.max(1, Math.round(items.length * PAID_SPLIT_DEFAULT));
    return items.map(function (pair, i) {
      return { id: uid(), heading: pair[0], note: pair[1], paid: pricing === 'paid' && i >= splitAt };
    });
  }

  const MEMO_OPEN = '（メモ：';

  // 構成を本文用のMarkdownにする。メモは書き換え前提で（メモ：…）として残す。
  function outlineToMarkdown(outline, part) {
    return outline
      .filter(function (o) { return part === 'paid' ? o.paid : !o.paid; })
      .map(function (o) {
        const lines = ['## ' + o.heading];
        if (o.note) lines.push(MEMO_OPEN + o.note + '）');
        return lines.join('\n');
      })
      .join('\n\n');
  }

  function statusLabel(value) {
    const s = STATUSES.find(function (x) { return x.value === value; });
    return s ? s.label : value;
  }

  return {
    STATUSES: STATUSES,
    ARTICLE_TYPES: ARTICLE_TYPES,
    MEMO_OPEN: MEMO_OPEN,
    uid: uid,
    createArticle: createArticle,
    normalizeArticle: normalizeArticle,
    validateArticle: validateArticle,
    buildOutline: buildOutline,
    outlineToMarkdown: outlineToMarkdown,
    statusLabel: statusLabel,
  };
});
