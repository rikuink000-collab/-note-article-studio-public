// 公開準備：タイトル候補・ハッシュタグ・見出し画像プロンプト・公開前チェックリスト
(function (root, factory) {
  const checker = typeof require === 'function' ? require('./checker.js') : root.NAS.checker;
  const mod = factory(checker);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).publish = mod;
})(typeof self !== 'undefined' ? self : this, function (checker) {
  'use strict';

  const TITLE_GUIDE_LENGTH = 40;
  const MAX_HASHTAGS = 10;

  function firstLine(text) {
    return String(text || '').split(/\n/).map(function (s) { return s.replace(/^[-・*\s]+/, '').trim(); }).filter(Boolean)[0] || '';
  }

  function trimEnd(s) {
    return s.replace(/[。．.、\s]+$/, '');
  }

  // 誇張せず、内容が伝わるタイトルをテンプレートで5つ作る
  function titleCandidates(article) {
    const theme = trimEnd(article.theme || '') || '（テーマ）';
    const audience = trimEnd(article.audience || '') || '初心者';
    const problem = trimEnd(firstLine(article.problems)).replace(/(という|との)?悩み$/, '');
    const goal = trimEnd(firstLine(article.goal));
    const steps = (article.outline || []).filter(function (o) { return /^手順/.test(o.heading); }).length;

    const list = [
      audience + 'のための' + theme + '入門',
      steps >= 2 ? '【' + steps + 'ステップ】' + theme + 'のやり方を実例つきで解説' : theme + 'のやり方を実例つきで解説',
      problem ? '「' + problem + '」を解決する' + theme + 'の進め方' : theme + 'で最初につまずくポイントと解決方法',
      theme + 'を実際に試してわかったこと',
      goal ? theme + 'で' + goal.replace(/^(読者が|読者に)/, '') + 'ための実践ガイド' : theme + 'の実践ガイド：今日からできること',
    ];
    if (article.articleType === 'gamedev') list[3] = 'AIを使って個人でゲームを作った記録：' + theme;
    if (article.articleType === 'experience') list[3] = theme + 'に取り組んだ振り返りと学んだこと';
    // 重複を除き、5つにそろえる
    const unique = Array.from(new Set(list));
    while (unique.length < 5) unique.push(theme + 'のまとめ（' + (unique.length + 1) + '）');
    return unique.slice(0, 5);
  }

  const HASHTAG_DICT = [
    [/AI|人工知能|生成AI/i, ['AI', '生成AI', 'AI活用']],
    [/ChatGPT|チャットGPT/i, ['ChatGPT']],
    [/Claude|クロード/i, ['Claude']],
    [/Gemini/i, ['Gemini']],
    [/仕事|業務|効率|時短|生産性/, ['仕事術', '業務効率化']],
    [/プロンプト/, ['プロンプト']],
    [/ゲーム/, ['ゲーム制作', '個人開発', 'インディーゲーム']],
    [/Unity/i, ['Unity']],
    [/Godot/i, ['Godot']],
    [/プログラミング|コード|開発/, ['プログラミング']],
    [/画像生成|イラスト/, ['画像生成AI']],
    [/副業/, ['副業']],
    [/note|ノート/i, ['note']],
    [/初心者|入門|はじめて|始め方/, ['初心者向け']],
    [/自動化/, ['自動化']],
    [/ブログ|文章|ライティング|執筆/, ['ライティング']],
  ];

  function suggestHashtags(article) {
    const text = [article.theme, article.audience, article.problems, article.goal, article.title,
      article.body && article.body.free, article.body && article.body.paid].join(' ');
    const tags = [];
    HASHTAG_DICT.forEach(function (entry) {
      if (entry[0].test(text)) entry[1].forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
    });
    if (article.articleType === 'experience' && tags.indexOf('振り返り') === -1) tags.push('振り返り');
    if (!tags.length) tags.push('やってみた');
    return tags.slice(0, MAX_HASHTAGS).map(function (t) { return '#' + t; });
  }

  const MOODS = {
    '': 'clean, friendly and modern',
    calm: 'calm, soft pastel colors, minimal',
    pop: 'bright, playful, vivid colors',
    tech: 'futuristic, blue and teal tones, subtle glow',
    warm: 'warm, cozy, hand-drawn feel',
    retro: 'retro pixel art style, 16-bit game aesthetic',
  };

  const SUBJECT_HINTS = [
    [/ゲーム/, 'a small indie game being created on a laptop, game characters and level sketches'],
    [/AI|ChatGPT|Claude|生成/i, 'a person working together with a friendly AI assistant'],
    [/仕事|業務|効率|時短/, 'a tidy desk with a laptop, checklist and coffee'],
    [/文章|執筆|ライティング|note/i, 'a notebook and laptop with writing in progress'],
  ];

  // note の見出し画像は横長（推奨 1280×670 px）
  function imagePrompt(article) {
    const text = [article.theme, article.title].join(' ');
    const subjects = SUBJECT_HINTS.filter(function (h) { return h[0].test(text); }).map(function (h) { return h[1]; });
    const subject = subjects.length ? subjects.slice(0, 2).join(', ') : 'a simple symbolic illustration of the article topic';
    const mood = MOODS[article.imageMood || ''] || MOODS[''];
    return [
      'Header image for a blog article about "' + (article.theme || 'the topic') + '".',
      'Scene: ' + subject + '.',
      'Style: flat illustration, ' + mood + '.',
      'Composition: wide landscape, main subject centered with empty space on the left and right.',
      'Aspect ratio: 1.91:1 (1280x670).',
      'No text, no letters, no logos, no watermarks.',
      '',
      '（日本語メモ）テーマ：' + (article.theme || '未設定') + '／文字は画像に入れず、noteのタイトルで伝える想定です。',
    ].join('\n');
  }

  // auto: 記事の内容から自動判定する項目 / manual: 自分で確認して印を付ける項目
  function checklist(article) {
    const issues = checker.checkArticle(article);
    const has = function (type) { return issues.some(function (i) { return i.type === type; }); };
    const free = String((article.body && article.body.free) || '').trim();
    const paid = String((article.body && article.body.paid) || '').trim();
    const title = String(article.title || '').trim();
    const items = [
      { key: 'title', kind: 'auto', label: 'タイトルを決めた', ok: !!title },
      { key: 'titleLength', kind: 'auto', label: 'タイトルが長すぎない（目安' + TITLE_GUIDE_LENGTH + '文字以内）', ok: !!title && title.length <= TITLE_GUIDE_LENGTH },
      { key: 'body', kind: 'auto', label: '本文がある', ok: !!free },
      { key: 'memo', kind: 'auto', label: '構成メモ（メモ：…）が残っていない', ok: !has('memo') },
      { key: 'hype', kind: 'auto', label: '誇張・根拠のない収益表現の指摘が0件', ok: !has('hype') },
      { key: 'dup', kind: 'auto', label: '同じ文の重複がない', ok: !has('duplicate') },
      { key: 'style', kind: 'auto', label: '文体（です・ます／だ・である）がそろっている', ok: !has('style') },
      { key: 'hashtags', kind: 'auto', label: 'ハッシュタグを設定した', ok: (article.hashtags || []).length > 0 },
    ];
    if (article.pricing === 'paid') {
      items.push({ key: 'paidParts', kind: 'auto', label: '無料部分と有料部分の両方に本文がある', ok: !!free && !!paid });
      items.push({ key: 'paidPreview', kind: 'manual', label: '無料部分だけで、有料部分で何が得られるか分かる' });
      items.push({ key: 'price', kind: 'manual', label: '価格を決めた（内容に見合う金額か見直した）' });
      items.push({ key: 'paidLine', kind: 'manual', label: 'noteの編集画面で有料ラインの位置を設定した' });
    }
    items.push(
      { key: 'typoReviewed', kind: 'manual', label: '誤字の候補を確認し、全文を一度声に出して読んだ' },
      { key: 'facts', kind: 'manual', label: '数字・料金・仕様は公式情報で確認し、必要な出典を書いた' },
      { key: 'rights', kind: 'manual', label: '画像・引用・素材の権利とライセンスを確認した' },
      { key: 'privacy', kind: 'manual', label: '個人情報や社外秘の情報が含まれていない' },
      { key: 'aiNote', kind: 'manual', label: 'AIの利用について必要に応じて記載した' },
      { key: 'headerImage', kind: 'manual', label: '見出し画像を用意した' },
      { key: 'preview', kind: 'manual', label: 'noteのプレビューでスマホ表示を確認した' }
    );
    return items.map(function (it) {
      if (it.kind === 'manual') it.ok = !!(article.checklist && article.checklist[it.key]);
      return it;
    });
  }

  return {
    titleCandidates: titleCandidates,
    suggestHashtags: suggestHashtags,
    imagePrompt: imagePrompt,
    checklist: checklist,
    MOODS: MOODS,
  };
});
