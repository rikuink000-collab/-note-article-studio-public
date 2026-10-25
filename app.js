// 画面制御
(function () {
  'use strict';

  const NAS = window.NAS;
  const planner = NAS.planner;
  const checker = NAS.checker;
  const publish = NAS.publish;
  const prompts = NAS.prompts;
  const exporter = NAS.exporter;
  const storage = NAS.storage;

  const store = storage.createStore();
  const LAST_BACKUP_KEY = 'note-article-studio.lastBackup';
  const CURRENT_KEY = 'note-article-studio.current';
  const BACKUP_REMIND_DAYS = 7;
  const SAVE_DELAY = 600;

  const state = {
    view: 'list',
    article: null,
    saveTimer: null,
    pendingRestore: null,
  };

  const $ = function (sel, rootEl) { return (rootEl || document).querySelector(sel); };
  const $$ = function (sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'className') node.className = attrs[k];
      else if (k === 'value') node.value = attrs[k];
      else if (k in node && typeof attrs[k] !== 'string') node[k] = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 保存できない環境では無視 */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ---------- 保存 ----------

  function setSaveState(text) {
    $('#save-state').textContent = text;
  }

  function scheduleSave() {
    setSaveState('編集中…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, SAVE_DELAY);
  }

  function flushSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.article) return;
    try {
      state.article = Object.assign(state.article, { updatedAt: store.save(state.article).updatedAt });
      setSaveState(store.persistent ? '保存済み' : '保存済み（一時）');
    } catch (e) {
      setSaveState('保存できませんでした');
      toast('保存に失敗しました。容量不足の可能性があります。バックアップを保存してください。');
    }
  }

  // ---------- 画面切り替え ----------

  function go(view) {
    if (state.saveTimer) flushSave();
    state.view = view;
    const needsArticle = view === 'plan' || view === 'write' || view === 'publish';
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== view || (needsArticle && !state.article); });
    $('#no-article').hidden = !(needsArticle && !state.article);
    $$('.tabbar button').forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    render();
    window.scrollTo(0, 0);
  }

  function openArticle(id, view) {
    const a = store.get(id);
    if (!a) { toast('記事が見つかりません'); return; }
    state.article = a;
    safeSet(CURRENT_KEY, id);
    fillForm();
    go(view || 'plan');
  }

  function newArticle() {
    if (state.saveTimer) flushSave();
    state.article = store.save(planner.createArticle());
    safeSet(CURRENT_KEY, state.article.id);
    fillForm();
    go('plan');
    toast('新しい記事を作りました');
  }

  // ---------- フォームと記事データ ----------

  function getField(path) {
    const parts = path.split('.');
    let v = state.article;
    parts.forEach(function (p) { v = v == null ? '' : v[p]; });
    return v == null ? '' : v;
  }

  function setField(path, value) {
    const parts = path.split('.');
    let obj = state.article;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  // 記事を開いたときに入力欄へ値を入れる（入力中は再描画しない）
  function fillForm() {
    if (!state.article) return;
    $$('[data-field]').forEach(function (input) {
      const v = getField(input.dataset.field);
      if (input.type === 'radio') input.checked = input.value === v;
      else input.value = v;
    });
    $('#hashtags-input').value = state.article.hashtags.join(' ');
    $('#title-candidates').textContent = '';
    renderOutline();
  }

  function onFieldInput(e) {
    const input = e.target;
    if (!state.article || !input.dataset || !input.dataset.field) return;
    if (input.type === 'radio' && !input.checked) return;
    setField(input.dataset.field, input.value);
    if (input.dataset.field === 'pricing') {
      // 有料→無料に切り替えても有料部分の本文は消さずに残す
      renderOutline();
    }
    scheduleSave();
    renderLight();
  }

  // ---------- 描画 ----------

  // 入力のたびに呼ぶ軽い更新（入力欄そのものは触らない）
  function renderLight() {
    const a = state.article;
    document.body.classList.toggle('is-paid', !!a && a.pricing === 'paid');
    $('#current-title').textContent = a ? (a.title || a.theme || '無題の記事') : '';
    if (!a) return;
    $('[data-count="free"]').textContent = checker.countChars(a.body.free) + '文字';
    $('[data-count="paid"]').textContent = checker.countChars(a.body.paid) + '文字';
    const tl = String(a.title || '').length;
    $('#title-count').textContent = tl ? tl + '文字' + (tl > 40 ? '（40文字を超えています）' : '') : '';
    $('.free-label').textContent = a.pricing === 'paid' ? '無料部分（Markdown）' : '本文（Markdown）';
    refreshPrompts();
    if (state.view === 'publish') renderChecklist();
  }

  function render() {
    renderLight();
    if (state.view === 'list') renderList();
    if (state.view === 'publish' && state.article) { renderChecks(); renderChecklist(); }
    if (state.view === 'data') renderData();
  }

  function renderList() {
    const q = $('#list-search').value.trim().toLowerCase();
    const status = $('#list-status').value;
    const all = store.list();
    const items = all.filter(function (a) {
      if (status && a.status !== status) return false;
      if (!q) return true;
      return [a.title, a.theme, a.audience].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    const counts = {};
    all.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    $('#list-summary').textContent = all.length
      ? '全' + all.length + '件　' + planner.STATUSES.filter(function (s) { return counts[s.value]; })
          .map(function (s) { return s.label + ' ' + counts[s.value]; }).join(' / ')
      : 'まだ記事がありません。「新しい記事を作る」から始めましょう。';

    const ul = $('#article-list');
    ul.textContent = '';
    let failed = 0;
    items.forEach(function (a) {
      try {
        ul.appendChild(articleCard(a));
      } catch (e) {
        failed++;
      }
    });
    if (failed) ul.appendChild(el('li', { className: 'notice error', text: failed + '件の記事を表示できませんでした。「データ」画面からバックアップを保存してください。' }));
    if (all.length && !items.length) ul.appendChild(el('li', { className: 'muted small', text: '条件に合う記事がありません。' }));
  }

  function articleCard(a) {
    const chars = checker.countChars(a.body.free) + (a.pricing === 'paid' ? checker.countChars(a.body.paid) : 0);
    const open = el('button', { type: 'button', className: 'article-open', 'data-action': 'open', 'data-id': a.id }, [
      el('span', { className: 't', text: a.title || a.theme || '無題の記事' }),
      el('span', { className: 'meta' }, [
        el('span', { className: 'badge s-' + a.status, text: planner.statusLabel(a.status) }),
        a.pricing === 'paid' ? el('span', { className: 'badge paid', text: '有料' + (a.price ? ' ' + a.price + '円' : '') }) : el('span', { className: 'badge', text: '無料' }),
        el('span', { text: chars + '文字' }),
        el('span', { text: '更新 ' + formatDate(a.updatedAt) }),
      ]),
    ]);
    const actions = el('div', { className: 'card-actions' }, [
      el('button', { type: 'button', className: 'btn small', 'data-action': 'duplicate', 'data-id': a.id, text: '複製' }),
      el('button', { type: 'button', className: 'btn small danger', 'data-action': 'delete', 'data-id': a.id, text: '削除' }),
    ]);
    return el('li', { className: 'article-card' }, [open, actions]);
  }

  function renderOutline() {
    const ol = $('#outline-list');
    ol.textContent = '';
    if (!state.article) return;
    const outline = state.article.outline;
    const isPaid = state.article.pricing === 'paid';
    outline.forEach(function (o, i) {
      const heading = el('input', { type: 'text', value: o.heading, placeholder: '見出し', 'aria-label': '見出し' + (i + 1) });
      heading.addEventListener('input', function () { o.heading = heading.value; scheduleSave(); refreshPrompts(); });
      const note = el('textarea', { rows: '2', className: 'note-input', value: o.note, placeholder: 'この見出しで書く内容（メモ）', 'aria-label': 'メモ' + (i + 1) });
      note.addEventListener('input', function () { o.note = note.value; scheduleSave(); refreshPrompts(); });

      const controls = el('div', { className: 'outline-controls' });
      if (isPaid) {
        const cb = el('input', { type: 'checkbox', checked: !!o.paid });
        cb.addEventListener('change', function () { o.paid = cb.checked; scheduleSave(); renderOutline(); refreshPrompts(); });
        controls.appendChild(el('label', { className: 'paid-toggle' }, [cb, el('span', { text: '有料' })]));
      } else {
        controls.appendChild(el('span', { className: 'paid-toggle muted', text: (i + 1) + '.' }));
      }
      controls.appendChild(el('button', { type: 'button', className: 'btn small', 'data-action': 'move-heading', 'data-index': String(i), 'data-dir': '-1', 'aria-label': '上へ', text: '↑' }));
      controls.appendChild(el('button', { type: 'button', className: 'btn small', 'data-action': 'move-heading', 'data-index': String(i), 'data-dir': '1', 'aria-label': '下へ', text: '↓' }));
      controls.appendChild(el('button', { type: 'button', className: 'btn small danger', 'data-action': 'remove-heading', 'data-index': String(i), text: '削除' }));

      ol.appendChild(el('li', { className: 'outline-item' + (isPaid && o.paid ? ' is-paid' : '') }, [heading, note, controls]));
    });
    if (!outline.length) ol.appendChild(el('li', { className: 'muted small', text: 'まだ見出しがありません。' }));
  }

  function buildPrompt(stage) {
    const a = state.article;
    if (stage === 'plan') return prompts.planPrompt(a);
    if (stage === 'write') return prompts.writePrompt(a);
    if (stage === 'proofread') return prompts.proofreadPrompt(a, checker.checkArticle(a));
    return prompts.publishPrompt(a);
  }

  // 開いている「内容を見る」だけ更新する
  function refreshPrompts() {
    if (!state.article) return;
    $$('.prompt-card').forEach(function (card) {
      const d = $('details', card);
      if (d.open) $('.prompt-preview', card).textContent = buildPrompt(card.dataset.prompt);
    });
  }

  function renderChecks() {
    const issues = checker.checkArticle(state.article);
    const ul = $('#check-list');
    ul.textContent = '';
    const errors = issues.filter(function (i) { return i.severity === 'error'; }).length;
    const warns = issues.filter(function (i) { return i.severity === 'warn'; }).length;
    $('#check-summary').textContent = issues.length
      ? '指摘 ' + issues.length + '件（要修正 ' + errors + '・要確認 ' + warns + '・参考 ' + (issues.length - errors - warns) + '）'
      : '自動チェックでの指摘はありません。最終確認はご自身でも行ってください。';
    issues.forEach(function (i) {
      ul.appendChild(el('li', { className: 'issue ' + i.severity }, [
        el('span', { className: 'label', text: checker.TYPE_LABELS[i.type] || i.type }),
        el('span', { text: i.message }),
        i.excerpt ? el('span', { className: 'ex', text: i.excerpt }) : null,
      ]));
    });
  }

  function renderChecklist() {
    const ul = $('#checklist');
    ul.textContent = '';
    publish.checklist(state.article).forEach(function (item) {
      if (item.kind === 'auto') {
        ul.appendChild(el('li', {}, [
          el('span', { className: 'auto-mark ' + (item.ok ? 'ok' : 'ng'), text: item.ok ? '✓' : '!' }),
          el('span', { text: item.label }),
        ]));
      } else {
        const cb = el('input', { type: 'checkbox', checked: item.ok });
        cb.addEventListener('change', function () {
          state.article.checklist[item.key] = cb.checked;
          scheduleSave();
        });
        ul.appendChild(el('li', {}, [el('label', {}, [cb, el('span', { text: item.label })])]));
      }
    });
  }

  function renderData() {
    const count = store.list().length;
    $('#storage-status').textContent = store.persistent
      ? '保存先：この端末のブラウザ内（' + count + '件）'
      : '⚠ このブラウザでは端末に保存できません（プライベートブラウズの可能性）。ページを閉じると記事が消えます。必ずバックアップを保存してください。';
    const last = safeGet(LAST_BACKUP_KEY);
    let msg = last ? '最終バックアップ：' + formatDate(last) : 'まだバックアップを保存していません。';
    if (count && (!last || Date.now() - new Date(last).getTime() > BACKUP_REMIND_DAYS * 86400000)) {
      msg += '　バックアップの保存をおすすめします。';
    }
    $('#backup-status').textContent = msg;
    const rec = store.recovered();
    $('#recovery-box').hidden = !rec && !store.isWriteBlocked();
    $('#recovery-text').textContent = store.isWriteBlocked()
      ? '⚠ 保存データの一部が壊れていて退避できなかったため、データを守るために保存を止めています。下のボタンでバックアップを保存してください。'
      : rec ? '壊れた保存データを ' + formatDate(rec.savedAt) + ' に退避しました（理由：' + rec.reason + '）。必要なら下のボタンで保存できます。' : '';
  }

  // ---------- コピー・保存・共有 ----------

  function copyText(text) {
    function fallback() {
      const ta = el('textarea', { readonly: '' });
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      ta.style.fontSize = '16px';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(0, text.length); // iOS Safari 対策
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  function copyWithToast(text, label) {
    copyText(text).then(function (ok) {
      toast(ok ? label + 'をコピーしました' : 'コピーできませんでした。「内容を見る」から手動で選択してください');
    });
  }

  function downloadFile(name, text, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function shareFile(name, text, type) {
    const file = new File([text], name, { type: type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).then(function () { return true; }, function (e) {
        if (e && e.name === 'AbortError') return false;
        throw e;
      });
    }
    return Promise.reject(new Error('unsupported'));
  }

  function exportParts(part) {
    const a = state.article;
    if (part === 'paid' && a.pricing !== 'paid') return null;
    return { name: exporter.fileName(a, part), text: exporter.toMarkdown(a, part) };
  }

  function markBackedUp() {
    safeSet(LAST_BACKUP_KEY, new Date().toISOString());
    renderData();
  }

  // ---------- 復元 ----------

  function showRestoreError(message) {
    const box = $('#restore-error');
    box.textContent = message;
    box.hidden = !message;
    if (message && box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function resetRestore() {
    state.pendingRestore = null;
    $('#restore-preview').hidden = true;
    $('#restore-details').textContent = '';
  }

  function onRestoreFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    resetRestore();
    showRestoreError('');
    if (!file) return;
    if (file.size > storage.MAX_BACKUP_CHARS) {
      showRestoreError('復元できません：ファイルが大きすぎます（上限 10MB）。今あるデータは変更していません。');
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try {
        data = storage.parseBackup(String(reader.result));
      } catch (err) {
        showRestoreError('復元できません：' + err.message + ' 今あるデータは変更していません。');
        return;
      }
      const p = store.previewImport(data);
      state.pendingRestore = data;
      $('#restore-summary').textContent =
        'バックアップ：' + p.total + '件' + (data.exportedAt ? '（' + formatDate(data.exportedAt) + ' 作成）' : '') +
        '／新しく追加 ' + p.added + '件・上書き ' + p.overwritten + '件／現在の記事 ' + p.currentCount + '件';
      const details = $('#restore-details');
      data.rejected.forEach(function (r) {
        details.appendChild(el('li', { className: 'issue error', text: (r.index) + '件目は復元しません：' + r.reason }));
      });
      data.fixes.forEach(function (f) {
        details.appendChild(el('li', { className: 'issue warn', text: (f.index) + '件目「' + f.title + '」の不正な値を初期値に補正します（' + f.fields.join('、') + '）' }));
      });
      $('#restore-preview').hidden = false;
      if ($('#restore-preview').scrollIntoView) $('#restore-preview').scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    reader.onerror = function () { showRestoreError('ファイルを読み込めませんでした。今あるデータは変更していません。'); };
    reader.readAsText(file);
  }

  function finishRestore(mode) {
    const data = state.pendingRestore;
    if (!data) return;
    const p = store.previewImport(data);
    if (mode === 'replace') {
      if (!confirm('現在の記事 ' + p.currentCount + '件をすべて削除し、バックアップの ' + p.total + '件に置き換えます。よろしいですか？')) return;
      if (p.currentCount && !confirm('最終確認：置き換えると現在の記事は元に戻せません。先に現在のデータのバックアップを保存しましたか？\n［OK］で置き換えを実行します。')) return;
    } else if (p.overwritten) {
      if (!confirm(p.overwritten + '件の記事がバックアップの内容で上書きされます（追加 ' + p.added + '件）。よろしいですか？')) return;
    }
    if (state.saveTimer) flushSave();
    let total;
    try {
      total = store.importBackup(data, mode);
    } catch (err) {
      const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)));
      showRestoreError('復元に失敗しました：' + (quota ? 'ブラウザの保存容量が不足しています。' : err.message) + ' 今あるデータは変更していません。');
      renderData();
      return;
    }
    resetRestore();
    showRestoreError('');
    if (state.article) {
      state.article = store.get(state.article.id);
      fillForm();
    }
    renderLight();
    renderData();
    toast('復元しました（記事 ' + total + '件）');
  }

  // ---------- 操作 ----------

  const actions = {
    'go': function (btn) { go(btn.dataset.view); },
    'new-article': newArticle,
    'open': function (btn) { openArticle(btn.dataset.id); },
    'duplicate': function (btn) {
      const copy = store.duplicate(btn.dataset.id);
      if (copy) { toast('複製しました'); renderList(); }
    },
    'delete': function (btn) {
      const a = store.get(btn.dataset.id);
      if (!a) return;
      const name = a.title || a.theme || '無題の記事';
      if (!confirm('「' + name + '」を削除します。この操作は元に戻せません。よろしいですか？')) return;
      store.remove(a.id);
      if (state.article && state.article.id === a.id) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
        state.article = null;
        setSaveState('');
      }
      toast('削除しました');
      render();
    },
    'build-outline': function () {
      const a = state.article;
      if (a.outline.length && !confirm('今の構成（' + a.outline.length + '件の見出し）をテンプレートで置き換えます。よろしいですか？')) return;
      a.outline = planner.buildOutline(a.articleType, a.pricing);
      renderOutline();
      scheduleSave();
      refreshPrompts();
    },
    'add-heading': function () {
      state.article.outline.push({ id: planner.uid(), heading: '', note: '', paid: false });
      renderOutline();
      scheduleSave();
      const inputs = $$('#outline-list input[type="text"]:not(.note-input)');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    'move-heading': function (btn) {
      const list = state.article.outline;
      const i = Number(btn.dataset.index);
      const j = i + Number(btn.dataset.dir);
      if (j < 0 || j >= list.length) return;
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      renderOutline();
      scheduleSave();
      refreshPrompts();
    },
    'remove-heading': function (btn) {
      const list = state.article.outline;
      const i = Number(btn.dataset.index);
      if ((list[i].heading || list[i].note) && !confirm('見出し「' + (list[i].heading || '（無題）') + '」を削除しますか？')) return;
      list.splice(i, 1);
      renderOutline();
      scheduleSave();
      refreshPrompts();
    },
    'insert-outline': function () {
      const a = state.article;
      if (!a.outline.length) { toast('先に「企画」で構成を作ってください'); return; }
      const parts = a.pricing === 'paid' ? ['free', 'paid'] : ['free'];
      const hasText = parts.some(function (p) { return a.body[p].trim(); });
      if (hasText && !confirm('本文はすでに入力されています。見出しを本文の末尾に追加します（今の本文は消えません）。よろしいですか？')) return;
      parts.forEach(function (p) {
        const md = planner.outlineToMarkdown(a.outline, p);
        if (!md) return;
        a.body[p] = a.body[p].trim() ? a.body[p].replace(/\s+$/, '') + '\n\n' + md + '\n' : md + '\n';
        $('[data-field="body.' + p + '"]').value = a.body[p];
      });
      scheduleSave();
      renderLight();
      toast('見出しを挿入しました。（メモ：…）を本文に書き換えてください');
    },
    'copy-prompt': function (btn) {
      const text = buildPrompt(btn.dataset.stage);
      const card = btn.closest('.prompt-card');
      $('.prompt-preview', card).textContent = text;
      copyWithToast(text, 'プロンプト');
    },
    'run-check': function () { renderChecks(); renderChecklist(); toast('チェックしました'); },
    'make-titles': function () {
      const ul = $('#title-candidates');
      ul.textContent = '';
      const list = publish.titleCandidates(state.article);
      state.article.titleCandidates = list;
      scheduleSave();
      list.forEach(function (t) {
        ul.appendChild(el('li', { className: 'choice' }, [
          el('span', { text: t + '（' + t.length + '文字）' }),
          el('button', { type: 'button', className: 'btn small', 'data-action': 'use-title', 'data-title': t, text: '採用' }),
        ]));
      });
    },
    'use-title': function (btn) {
      const a = state.article;
      const t = btn.dataset.title;
      if (a.title && a.title !== t && !confirm('今のタイトル「' + a.title + '」を「' + t + '」に置き換えますか？')) return;
      a.title = t;
      $('[data-field="title"]').value = t;
      scheduleSave();
      renderLight();
      toast('タイトルを設定しました');
    },
    'suggest-tags': function () {
      const a = state.article;
      const merged = a.hashtags.slice();
      publish.suggestHashtags(a).forEach(function (t) { if (merged.indexOf(t) === -1) merged.push(t); });
      a.hashtags = merged;
      $('#hashtags-input').value = merged.join(' ');
      scheduleSave();
      renderLight();
    },
    'make-image-prompt': function () {
      const a = state.article;
      if (a.imagePrompt.trim() && !confirm('今の画像プロンプトを新しく作り直します。よろしいですか？')) return;
      a.imagePrompt = publish.imagePrompt(a);
      $('[data-field="imagePrompt"]').value = a.imagePrompt;
      scheduleSave();
    },
    'copy-field': function (btn) {
      const v = String(getField(btn.dataset.fieldName) || '');
      if (!v.trim()) { toast('まだ内容がありません'); return; }
      copyWithToast(v, '内容');
    },
    'export-md': function (btn) {
      const f = exportParts(btn.dataset.part);
      if (f) { flushSave(); downloadFile(f.name, f.text, 'text/markdown'); }
    },
    'copy-md': function (btn) {
      const f = exportParts(btn.dataset.part);
      if (f) copyWithToast(f.text, 'Markdown');
    },
    'share-md': function (btn) {
      const f = exportParts(btn.dataset.part);
      if (!f) return;
      shareFile(f.name, f.text, 'text/markdown').catch(function () { downloadFile(f.name, f.text, 'text/markdown'); });
    },
    'backup-download': function () {
      if (state.saveTimer) flushSave();
      const json = JSON.stringify(store.exportBackup(), null, 2);
      downloadFile(storage.backupFileName(), json, 'application/json');
      markBackedUp();
      toast('バックアップを保存しました');
    },
    'backup-share': function () {
      if (state.saveTimer) flushSave();
      const json = JSON.stringify(store.exportBackup(), null, 2);
      shareFile(storage.backupFileName(), json, 'application/json').then(function (done) {
        if (done) { markBackedUp(); toast('バックアップを共有しました'); }
      }, function () {
        downloadFile(storage.backupFileName(), json, 'application/json');
        markBackedUp();
      });
    },
    'restore-merge': function () { finishRestore('merge'); },
    'restore-replace': function () { finishRestore('replace'); },
    'restore-cancel': function () { resetRestore(); },
    'recovery-download': function () {
      const rec = store.recovered();
      if (!rec) { toast('退避データはありません'); return; }
      downloadFile('note-article-studio-recovered_' + String(rec.savedAt).slice(0, 10) + '.txt', String(rec.raw), 'text/plain');
    },
  };

  // ---------- 初期化 ----------

  function init() {
    const typeSelect = $('#article-type');
    Object.keys(planner.ARTICLE_TYPES).forEach(function (k) {
      typeSelect.appendChild(el('option', { value: k, text: planner.ARTICLE_TYPES[k].label }));
    });
    $$('.status-select').forEach(function (s) {
      planner.STATUSES.forEach(function (st) { s.appendChild(el('option', { value: st.value, text: st.label })); });
    });
    planner.STATUSES.forEach(function (st) { $('#list-status').appendChild(el('option', { value: st.value, text: st.label })); });
    prompts.COMMON_RULES.forEach(function (r) { $('#writing-tips').appendChild(el('li', { text: r })); });

    try {
      if (navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })) {
        document.body.classList.add('can-share');
      }
    } catch (e) { /* 共有非対応 */ }

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn || !actions[btn.dataset.action]) return;
      actions[btn.dataset.action](btn);
    });
    $('#main').addEventListener('input', onFieldInput);
    $('#main').addEventListener('change', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.type === 'radio') onFieldInput(e);
    });
    $('#hashtags-input').addEventListener('input', function (e) {
      if (!state.article) return;
      state.article.hashtags = e.target.value.split(/[\s　]+/).filter(Boolean).map(function (t) {
        return t.charAt(0) === '#' || t.charAt(0) === '＃' ? '#' + t.slice(1) : '#' + t;
      });
      scheduleSave();
    });
    $('#list-search').addEventListener('input', renderList);
    $('#list-status').addEventListener('change', renderList);
    $('#restore-file').addEventListener('change', onRestoreFile);
    $$('.prompt-card details').forEach(function (d) {
      d.addEventListener('toggle', refreshPrompts);
    });

    // アプリ切り替え・画面を閉じる直前に保存（iPhoneでは pagehide / visibilitychange が確実）
    document.addEventListener('visibilitychange', function () { if (document.hidden && state.saveTimer) flushSave(); });
    window.addEventListener('pagehide', function () { if (state.saveTimer) flushSave(); });

    const lastId = safeGet(CURRENT_KEY);
    if (lastId && store.get(lastId)) {
      state.article = store.get(lastId);
      fillForm();
    }
    if (!store.persistent) setSaveState('一時保存モード');
    go('list');
  }

  init();
})();
