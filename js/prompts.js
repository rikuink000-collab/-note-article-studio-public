// AI用プロンプト：各段階の指示文を作る（APIには送らず、コピーしてAIアプリに貼り付ける）
(function (root, factory) {
  const planner = typeof require === 'function' ? require('./planner.js') : root.NAS.planner;
  const mod = factory(planner);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).prompts = mod;
})(typeof self !== 'undefined' ? self : this, function (planner) {
  'use strict';

  const COMMON_RULES = [
    '初心者にも分かる言葉で書き、専門用語には短い説明を添える',
    '抽象的な説明は、具体的な場面・入力例・操作手順に置き換える',
    '同じ内容の繰り返しを避ける',
    '読者が実際に行動できる手順（番号付き）を入れる',
    '誇張した収益表現（「誰でも稼げる」「必ず」「月◯万円」など）や根拠のない情報は書かない',
    '数字・料金・仕様など確認が必要な情報は【要確認】と明記し、推測で断定しない',
    '文体は「です・ます」調にそろえる',
  ];

  function val(s, fallback) {
    s = String(s || '').trim();
    return s || (fallback || '（未設定）');
  }

  function profile(article) {
    const type = planner.ARTICLE_TYPES[article.articleType];
    const lines = [
      '- テーマ：' + val(article.theme),
      '- 対象読者：' + val(article.audience),
      '- 読者の悩み：' + val(article.problems).replace(/\n/g, ' / '),
      '- 記事の目的：' + val(article.goal).replace(/\n/g, ' / '),
      '- 記事タイプ：' + (type ? type.label : val(article.articleType)),
      '- 形式：' + (article.pricing === 'paid' ? '有料記事' + (article.price ? '（' + article.price + '円予定）' : '') : '無料記事'),
    ];
    if (article.title) lines.unshift('- タイトル：' + article.title);
    return lines.join('\n');
  }

  function outlineText(article) {
    if (!article.outline || !article.outline.length) return '（構成は未作成）';
    return article.outline.map(function (o, i) {
      const mark = article.pricing === 'paid' ? (o.paid ? '［有料］' : '［無料］') : '';
      return (i + 1) + '. ' + mark + o.heading + (o.note ? ' — ' + o.note : '');
    }).join('\n');
  }

  function bodyText(article) {
    const free = String((article.body && article.body.free) || '').trim();
    const paid = String((article.body && article.body.paid) || '').trim();
    if (article.pricing !== 'paid') return free || '（本文なし）';
    return '=== 無料部分 ===\n' + (free || '（なし）') + '\n\n=== 有料部分 ===\n' + (paid || '（なし）');
  }

  function rules(extra) {
    return COMMON_RULES.concat(extra || []).map(function (r) { return '- ' + r; }).join('\n');
  }

  function planPrompt(article) {
    return [
      'あなたはnote記事の編集者です。次の情報をもとに記事を企画してください。',
      '',
      '## 記事の情報',
      profile(article),
      '',
      '## 現在の構成案',
      outlineText(article),
      '',
      '## 依頼',
      '1. 対象読者の悩みを3〜5個、具体的な場面とともに整理してください',
      '2. 読み終えた読者ができるようになることを1文で定義してください',
      '3. 記事の構成（見出しと、各見出しで書く内容の要点）を提案してください',
      article.pricing === 'paid'
        ? '4. 有料記事として、無料部分と有料部分の区切り位置と、それぞれに入れる内容を提案してください。無料部分だけでも読者が得るものがあるようにしてください'
        : '4. 無料記事として、最後まで読みたくなる流れになっているか確認してください',
      '',
      '## 守ること',
      rules(),
    ].join('\n');
  }

  function writePrompt(article) {
    return [
      'あなたはnote記事のライターです。次の構成に沿って本文をMarkdownで書いてください。',
      '',
      '## 記事の情報',
      profile(article),
      '',
      '## 構成',
      outlineText(article),
      '',
      '## 現在の下書き（あれば活かしてください）',
      bodyText(article),
      '',
      '## 書き方',
      rules(article.pricing === 'paid'
        ? ['無料部分と有料部分をはっきり分け、間に「=== ここから有料 ===」と1行入れる',
           '無料部分では、有料部分で何が得られるかを具体的に予告する（煽らない）']
        : []),
      '- 見出しは「## 」で始める',
      '- 文中の（メモ：…）は執筆指示なので、内容に置き換えて削除する',
    ].join('\n');
  }

  function proofreadPrompt(article, issues) {
    const found = (issues || []).slice(0, 30).map(function (i) {
      return '- ' + i.message + (i.excerpt ? '：' + i.excerpt : '');
    });
    return [
      'あなたはnote記事の校正者です。次の記事を校正してください。',
      '',
      '## 記事の情報',
      profile(article),
      '',
      '## 本文',
      bodyText(article),
      '',
      '## 自動チェックで見つかった候補',
      found.length ? found.join('\n') : '（なし）',
      '',
      '## 依頼',
      '1. 誤字脱字、文法の誤り、表記ゆれを「修正前 → 修正後」の一覧で示してください',
      '2. 同じ内容の繰り返しや冗長な部分を指摘し、削り方を提案してください',
      '3. 抽象的な説明を、具体例に置き換える案を出してください',
      '4. 誇張表現や根拠が不足している記述を指摘してください',
      article.pricing === 'paid' ? '5. 無料部分と有料部分の分け方が適切か確認してください' : '5. 読者が行動できる手順が足りているか確認してください',
      '',
      '本文の全文書き直しはせず、指摘と修正案を出してください。',
    ].join('\n');
  }

  function publishPrompt(article) {
    return [
      'あなたはnote記事の編集者です。公開準備を手伝ってください。',
      '',
      '## 記事の情報',
      profile(article),
      '',
      '## 本文（冒頭）',
      bodyText(article).slice(0, 3000),
      '',
      '## 依頼',
      '1. タイトル候補を5つ（それぞれ40文字以内、誇張表現なし、内容が具体的に伝わるもの）',
      '2. noteのハッシュタグを5〜10個',
      '3. 見出し画像の画像生成プロンプト（英語、横長1280×670、画像内に文字を入れない）',
      '4. 記事の紹介文（SNS告知用、120文字以内）',
      '5. 公開前に確認すべき点（事実確認が必要な記述など）',
      '',
      '## 守ること',
      '- 「誰でも稼げる」「必ず」などの誇張表現を使わない',
      '- 本文にない内容を付け加えない',
    ].join('\n');
  }

  return {
    COMMON_RULES: COMMON_RULES,
    planPrompt: planPrompt,
    writePrompt: writePrompt,
    proofreadPrompt: proofreadPrompt,
    publishPrompt: publishPrompt,
  };
});
