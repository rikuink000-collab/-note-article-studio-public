// 校正：ルールベースで「確認したほうがよい箇所」の候補を挙げる
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.NAS = root.NAS || {}).checker = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LONG_SENTENCE = 100;
  const MIN_DUP_LENGTH = 10;
  const SIMILAR_MIN_LENGTH = 15;
  const SIMILAR_THRESHOLD = 0.7;

  // 誇張・根拠のない収益表現
  const HYPE_RULES = [
    [/誰でも(簡単に)?(稼げ|儲か)/, '誰でも稼げるとは言い切れません。条件や個人差を書きましょう'],
    [/(必ず|絶対|確実に)(稼げ|儲か|成功|うまくいく|伸び)/, '結果を保証する表現です。実例と条件に置き換えましょう'],
    [/(月|年)(収|商)?\s*[0-9０-９]+\s*万円?(稼|達成|超え|以上)/, '収益の数字は根拠（実績・期間・条件）を添えるか削除しましょう'],
    [/不労所得|楽して(稼|儲)|放置で(稼|儲)|寝てるだけ/, '誤解を招きやすい収益表現です'],
    [/爆益|爆速で(稼|儲)|秒で(稼|儲)/, '誇張表現です'],
    [/[0-9０-９]+\s*[%％]\s*(成功|稼げ|保証|うまくいく)/, '割合の根拠を示すか削除しましょう'],
    [/再現性\s*[0-9０-９]+\s*[%％]|再現性(抜群|しかない)/, '再現性を断言する表現です'],
    [/(返金)?保証(します|付き)/, '保証をうたう場合は条件を明記しましょう'],
    [/最強|神ツール|革命的|人生が変わ/, '主観的な誇張表現です。具体的な効果に置き換えましょう'],
  ];

  // 出典が必要そうな表現
  const SOURCE_RULES = [
    [/と言われて(いる|います)|らしい(です)?[。、]|とされて(いる|います)/, '根拠が曖昧な伝聞表現です。出典を示すか自分の経験として書きましょう'],
    [/(研究|調査|データ)(で|によると|では)/, '研究・調査に触れる場合は出典（名称・リンク）を添えましょう'],
  ];

  // 抽象的な表現（具体例への置き換え候補）
  const ABSTRACT_WORDS = ['様々な', 'さまざまな', 'いろいろな', '色々な', 'ある程度', '適切に', 'うまく', 'しっかり', '効率的に', '何かと'];

  // 表記ゆれ（両方の書き方が出てきたら指摘）。配列は活用形などの語形グループ。
  const VARIANT_PAIRS = [
    [['出来る', '出来ま', '出来な', '出来た', '出来れ'], ['できる', 'できま', 'できな', 'できた', 'できれ']],
    ['下さい', 'ください'], [['頂く', '頂き', '頂け'], ['いただく', 'いただき', 'いただけ']],
    ['全て', 'すべて'], ['又は', 'または'], ['及び', 'および'],
    [['分かる', '分かり', '分から'], ['わかる', 'わかり', 'わから']], ['良い', 'よい'], ['スマホ', 'スマートフォン'],
    ['チャットGPT', 'ChatGPT'], ['クロード', 'Claude'], ['ユーザ', 'ユーザー'], ['サーバ', 'サーバー'],
  ];

  function stripMarkdown(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '\n')
      .replace(/`[^`]*`/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '');
  }

  // 日本語の文に分割（「。」「！」「？」と改行で区切る）
  function splitSentences(text) {
    const out = [];
    stripMarkdown(text).split(/\n+/).forEach(function (line) {
      const parts = line.match(/[^。！？!?]+[。！？!?]*/g) || [];
      parts.forEach(function (p) {
        const s = p.trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  function normalize(s) {
    return s.replace(/[\s、。，．,.！？!?「」『』（）()]/g, '');
  }

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    a.forEach(function (x) { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
  }

  function excerpt(s, max) {
    max = max || 40;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function findDuplicates(sentences) {
    const issues = [];
    const seen = new Map();
    const norms = sentences.map(normalize);
    norms.forEach(function (n, i) {
      if (n.length < MIN_DUP_LENGTH) return;
      if (seen.has(n)) {
        issues.push({ type: 'duplicate', severity: 'warn', message: '同じ文が繰り返されています', excerpt: excerpt(sentences[i]) });
      } else {
        seen.set(n, i);
      }
    });
    // 完全一致以外のよく似た文
    const grams = norms.map(bigrams);
    const reported = new Set();
    for (let i = 0; i < norms.length; i++) {
      if (norms[i].length < SIMILAR_MIN_LENGTH) continue;
      for (let j = i + 1; j < norms.length; j++) {
        if (norms[j].length < SIMILAR_MIN_LENGTH || norms[i] === norms[j] || reported.has(j)) continue;
        if (jaccard(grams[i], grams[j]) >= SIMILAR_THRESHOLD) {
          reported.add(j);
          issues.push({
            type: 'similar', severity: 'info',
            message: '内容がよく似た文があります（言い換えの繰り返しかも）',
            excerpt: excerpt(sentences[i], 25) + ' ／ ' + excerpt(sentences[j], 25),
          });
        }
      }
    }
    return issues;
  }

  function findTypos(text) {
    const issues = [];
    const rules = [
      [/(の|が|を|に|は|で)\1(?!し)/g, '助詞が重なっています'],
      [/([、。])\1+/g, '句読点が重なっています'],
      [/([一-鿿]{2,})\1/g, '同じ語が続いています'],
      [/[Ａ-Ｚａ-ｚ０-９]/g, '全角英数字があります（半角に統一を検討）'],
    ];
    const plain = stripMarkdown(text);
    rules.forEach(function (r) {
      const seen = new Set();
      let m;
      r[0].lastIndex = 0;
      while ((m = r[0].exec(plain))) {
        const start = Math.max(0, m.index - 8);
        const ctx = plain.slice(start, m.index + m[0].length + 8).replace(/\n/g, ' ');
        if (!seen.has(m[0])) {
          seen.add(m[0]);
          issues.push({ type: 'typo', severity: 'warn', message: r[1] + '：「' + m[0] + '」', excerpt: ctx });
        }
      }
    });
    return issues;
  }

  const POLITE_END = /(です|ます|でした|ました|ません|ましょう|ください|でしょう)[。！？!?]?$/;
  const PLAIN_END = /(だ|である|だった|ではない|だろう|なのだ)[。！？!?]?$/;

  function findStyleMix(sentences) {
    const polite = sentences.filter(function (s) { return POLITE_END.test(s); });
    const plain = sentences.filter(function (s) { return PLAIN_END.test(s); });
    if (!polite.length || !plain.length) return [];
    const minority = polite.length >= plain.length ? plain : polite;
    const label = polite.length >= plain.length ? '「だ・である」調' : '「です・ます」調';
    return minority.slice(0, 5).map(function (s) {
      return { type: 'style', severity: 'warn', message: '文体が混在しています（' + label + 'の文）', excerpt: excerpt(s) };
    });
  }

  function findVariants(text) {
    const issues = [];
    VARIANT_PAIRS.forEach(function (pair) {
      const used = pair.map(function (side) {
        return [].concat(side).find(function (w) {
          // 「ユーザ」と「ユーザー」のように一方が他方を含む場合は、長音が続かないものだけ数える
          let i = text.indexOf(w);
          while (i !== -1) {
            if (text.charAt(i + w.length) !== 'ー') return true;
            i = text.indexOf(w, i + 1);
          }
          return false;
        });
      });
      if (used[0] && used[1]) {
        issues.push({ type: 'variant', severity: 'info', message: '表記ゆれ：「' + used[0] + '」と「' + used[1] + '」が混在しています', excerpt: '' });
      }
    });
    return issues;
  }

  function findLong(sentences) {
    return sentences
      .filter(function (s) { return s.length > LONG_SENTENCE; })
      .map(function (s) {
        return { type: 'long', severity: 'info', message: '長い文です（' + s.length + '文字）。2文に分けると読みやすくなります', excerpt: excerpt(s) };
      });
  }

  function findByRules(sentences, rules, type, severity) {
    const issues = [];
    sentences.forEach(function (s) {
      rules.forEach(function (r) {
        if (r[0].test(s)) issues.push({ type: type, severity: severity, message: r[1], excerpt: excerpt(s) });
      });
    });
    return issues;
  }

  function findAbstract(sentences) {
    const issues = [];
    sentences.forEach(function (s) {
      const hit = ABSTRACT_WORDS.find(function (w) { return s.indexOf(w) !== -1; });
      if (hit) {
        issues.push({ type: 'abstract', severity: 'info', message: '「' + hit + '」は抽象的です。具体例や数値に置き換えられないか確認しましょう', excerpt: excerpt(s) });
      }
    });
    return issues;
  }

  function findMemos(text) {
    const count = (String(text).match(/（メモ：/g) || []).length;
    return count ? [{ type: 'memo', severity: 'warn', message: '構成メモ「（メモ：…）」が' + count + '件残っています', excerpt: '' }] : [];
  }

  function checkText(text) {
    const sentences = splitSentences(text);
    return [].concat(
      findByRules(sentences, HYPE_RULES, 'hype', 'error'),
      findByRules(sentences, SOURCE_RULES, 'source', 'warn'),
      findMemos(text),
      findTypos(text),
      findDuplicates(sentences),
      findStyleMix(sentences),
      findVariants(stripMarkdown(text)),
      findLong(sentences),
      findAbstract(sentences)
    );
  }

  // 記事全体をチェック。無料部分と有料部分にまたがる重複も見るため全文でも判定する。
  function checkArticle(article) {
    const free = article.body ? article.body.free : '';
    const paid = article.pricing === 'paid' && article.body ? article.body.paid : '';
    const full = [article.title || '', free, paid].join('\n');
    const issues = checkText(full);
    if (article.pricing === 'paid') {
      if (!String(free).trim()) issues.unshift({ type: 'structure', severity: 'error', message: '有料記事ですが無料部分が空です', excerpt: '' });
      if (!String(paid).trim()) issues.unshift({ type: 'structure', severity: 'error', message: '有料記事ですが有料部分が空です', excerpt: '' });
    }
    return issues;
  }

  function countChars(text) {
    return stripMarkdown(text).replace(/\s/g, '').length;
  }

  const TYPE_LABELS = {
    structure: '構成', hype: '誇張表現', source: '根拠', memo: '未記入', typo: '誤字の候補',
    duplicate: '重複', similar: '類似文', style: '文体', variant: '表記ゆれ', long: '長文', abstract: '抽象表現',
  };

  return {
    splitSentences: splitSentences,
    stripMarkdown: stripMarkdown,
    checkText: checkText,
    checkArticle: checkArticle,
    countChars: countChars,
    TYPE_LABELS: TYPE_LABELS,
  };
});
