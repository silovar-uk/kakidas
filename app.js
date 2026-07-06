(() => {
  'use strict';

  const Diff = window.TextReviewDiffCore;
  if (!Diff) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">diff-core.js を読み込めませんでした。</p>';
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const VERSION = 'v0.6.0';
  const AUTO_SAVE_KEY = 'text-review-studio-v0.6.0';

  const STYLE_RULES = [
    { id: 'fw-space', label: '全角スペースを半角スペースに統一', category: '空白', pattern: /　/g, replacement: ' ', severity: 'minor' },
    { id: 'double-space', label: '連続する半角スペースを1つに統一', category: '空白', pattern: / {2,}/g, replacement: ' ', severity: 'minor' },
    { id: 'trailing-space', label: '行末の空白を削除', category: '空白', pattern: /[ \t]+(?=\n|$)/g, replacement: '', severity: 'minor' },
    { id: 'exclamation', label: '全角感嘆符を半角に統一', category: '記号', pattern: /！/g, replacement: '!', severity: 'minor' },
    { id: 'question', label: '全角疑問符を半角に統一', category: '記号', pattern: /？/g, replacement: '?', severity: 'minor' },
    { id: 'paren-left', label: '全角の左かっこを半角に統一', category: '記号', pattern: /（/g, replacement: '(', severity: 'minor' },
    { id: 'paren-right', label: '全角の右かっこを半角に統一', category: '記号', pattern: /）/g, replacement: ')', severity: 'minor' },
    { id: 'samazama', label: '様々をさまざまに統一', category: '表記', pattern: /様々/g, replacement: 'さまざま', severity: 'normal' },
    { id: 'arakajime', label: '予めをあらかじめに統一', category: '表記', pattern: /予め/g, replacement: 'あらかじめ', severity: 'normal' },
    { id: 'seiippai', label: '精一杯を精いっぱいに統一', category: '表記', pattern: /精一杯/g, replacement: '精いっぱい', severity: 'normal' },
    { id: 'yoroshiku', label: '宜しくお願いしますをよろしくお願いしますに統一', category: '表記', pattern: /宜しくお願いします/g, replacement: 'よろしくお願いします', severity: 'normal' },
    { id: 'nyudan', label: '入団を加入に統一', category: '社内用語', pattern: /入団/g, replacement: '加入', severity: 'normal' },
    { id: 'month', label: 'か月／ヶ月をヵ月に統一', category: '数字・単位', pattern: /([0-9０-９]+)(か月|ヶ月)/g, replacement: '$1ヵ月', severity: 'normal' }
  ];

  const PROFILES = {
    'urawa-news': {
      name: '浦和公式サイト｜お知らせ記事',
      summary: 'URL・メール・HTMLは保護。半角 ! ?・半角かっこ、統一表記、【見出し】の扱いを丁寧に確認します。',
      absolute: ['fw-space'],
      principle: ['double-space', 'trailing-space', 'exclamation', 'question', 'paren-left', 'paren-right', 'samazama', 'arakajime', 'seiippai', 'yoroshiku', 'nyudan', 'month'],
      context: ['labels'],
      defaults: { tagPolicy: 'keep', labelPolicy: 'tag', linePolicy: 'keep', linkPolicy: 'raw' }
    },
    'cms-html': {
      name: 'CMS作業｜HTML優先',
      summary: '既存タグを守りながら、ラベル・注記・リンクの構造を優先して仕上げます。記号や表記は提案として扱います。',
      absolute: [],
      principle: ['fw-space', 'double-space', 'trailing-space', 'exclamation', 'question', 'paren-left', 'paren-right'],
      context: ['labels'],
      defaults: { tagPolicy: 'keep', labelPolicy: 'tag', linePolicy: 'br', linkPolicy: 'raw' }
    },
    'free-edit': {
      name: '自由編集｜提案を控えめ',
      summary: '文章の意図を優先。空白・行末・明確な表記ゆれだけを静かに提案します。URL・メール・HTMLは常に保護します。',
      absolute: [],
      principle: ['trailing-space', 'double-space'],
      context: ['labels'],
      defaults: { tagPolicy: 'keep', labelPolicy: 'keep', linePolicy: 'keep', linkPolicy: 'raw' }
    }
  };

  const state = {
    title: '名称未設定の原稿',
    baseline: '',
    working: '',
    mode: 'edit',
    activeId: null,
    railOpen: false,
    reviews: {},
    skipped: {},
    profile: 'urawa-news',
    strict: false,
    rulePrefs: { disabled: {} },
    output: {
      tagPolicy: 'keep',
      labelPolicy: 'tag',
      linePolicy: 'keep',
      linkPolicy: 'raw'
    },
    display: {
      whitespace: false,
      tags: false,
      urls: false,
      pendingOnly: false
    },
    search: { open: false, query: '', current: 0, replaceOpen: false },
    showGhost: false,
    lastTransform: null,
    cmsHistory: [],
    undoStack: [],
    redoStack: [],
    derived: null,
    pendingTransform: null,
    pendingCopy: null,
    debounceTimer: null,
    analyzing: false
  };

  function activeProfile() {
    return PROFILES[state.profile] || PROFILES['urawa-news'];
  }

  function rulePreferenceKey(ruleId) {
    return `${state.profile}:${ruleId}`;
  }

  function ruleStrength(ruleId) {
    const profile = activeProfile();
    if (profile.absolute.includes(ruleId)) return 'absolute';
    if (profile.context.includes(ruleId)) return 'context';
    return 'principle';
  }

  function strengthLabel(strength) {
    return ({ absolute: '絶対守る', principle: '原則守る', context: '文脈で判断' }[strength] || '確認');
  }

  function strengthReason(strength, ruleLabel = '') {
    const head = ({
      absolute: 'この原稿セットでは必ず守る基準です。',
      principle: 'この原稿セットでは原則としてそろえる基準です。',
      context: '文脈や引用・固有表記を見て判断する項目です。'
    }[strength] || '確認が必要な項目です。');
    return ruleLabel ? `${head} ${ruleLabel}` : head;
  }

  function activeStyleRules() {
    const profile = activeProfile();
    const enabled = new Set([...profile.absolute, ...profile.principle]);
    return STYLE_RULES.filter(rule => enabled.has(rule.id) && !state.rulePrefs.disabled[rulePreferenceKey(rule.id)]);
  }

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function truncate(value = '', length = 46) {
    const text = String(value).replace(/\n/g, '↵');
    return text.length > length ? `${text.slice(0, length - 1)}…` : text || '（なし）';
  }

  function stats(text) {
    const value = String(text || '');
    return {
      chars: [...value].length,
      lines: value ? value.split('\n').length : 0,
      urls: (value.match(/https?:\/\/[^\s<]+/g) || []).length,
      tags: (value.match(/<[^>]*>/g) || []).length
    };
  }

  function nowLabel() {
    return new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }

  function signature(...items) {
    return items.map(item => encodeURIComponent(String(item))).join('|');
  }

  function protectedRanges(text) {
    const ranges = [];
    const pattern = /https?:\/\/[^\s<]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|<[^>]*>/g;
    let match;
    while ((match = pattern.exec(text))) ranges.push({ start: match.index, end: match.index + match[0].length, type: match[0].startsWith('<') ? 'tag' : match[0].includes('@') ? 'email' : 'url' });
    return ranges;
  }

  function isProtected(start, end, ranges) {
    return ranges.some(range => start < range.end && end > range.start);
  }

  function contextAt(text, start, end, radius = 58) {
    return String(text).slice(Math.max(0, start - radius), Math.min(String(text).length, end + radius));
  }

  function classifySeverity(before, after) {
    const all = `${before}${after}`;
    if (/(https?:\/\/|www\.|@[\w.-]+\.|<\/?[A-Za-z][^>]*>|[0-9０-９]+\s*(年|月|日|時|分|円|%|％)|\b(?:AM|PM)\b)/i.test(all)) return 'critical';
    if (/^[\s\n\r\t、。,.!！?？()（）\[\]【】「」『』]+$/u.test(all)) return 'minor';
    return 'normal';
  }

  function makeStyleCandidates(text) {
    const output = [];
    const protectedAreas = protectedRanges(text);
    for (const rule of activeStyleRules()) {
      const scanner = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
      const one = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
      const strength = ruleStrength(rule.id);
      let match;
      while ((match = scanner.exec(text))) {
        if (!match[0]) { scanner.lastIndex += 1; continue; }
        if (isProtected(match.index, match.index + match[0].length, protectedAreas)) continue;
        const before = match[0];
        const after = before.replace(one, rule.replacement);
        const id = `style:${signature(rule.id, match.index, before, after)}`;
        output.push({
          id, type: 'style', category: rule.category, label: rule.label,
          before, after, start: match.index, end: match.index + before.length,
          severity: strength === 'absolute' ? 'critical' : (rule.severity || classifySeverity(before, after)),
          strength, ruleId: rule.id, ruleKey: rulePreferenceKey(rule.id),
          rationale: strengthReason(strength, rule.label),
          context: contextAt(text, match.index, match.index + before.length),
          skipKey: signature('style', state.profile, rule.id, before, after, contextAt(text, match.index, match.index + before.length, 22))
        });
      }
    }
    return output;
  }

  function makeLabelCandidates(text) {
    const output = [];
    let offset = 0;
    text.split('\n').forEach((line, index) => {
      const match = line.match(/^([ \t]*)【([^\n】]{1,40})】([ \t]*)$/);
      if (!match) { offset += line.length + 1; return; }
      const before = line;
      const value = match[2];
      const id = `label:${signature(index, offset, before)}`;
      output.push({
        id, type: 'label', category: 'HTML', label: '【ラベル】の扱い',
        before, after: `<span class="info24-label">${escapeHTML(value)}</span>`,
        start: offset, end: offset + line.length, line: index + 1,
        leading: match[1], value, trailing: match[3], severity: 'normal', strength: 'context',
        rationale: strengthReason('context', '見出しとして扱うか、原文のまま残すかを判断します。'),
        context: `${index + 1}行目：${line}`,
        skipKey: signature('label', before, index)
      });
      offset += line.length + 1;
    });
    return output;
  }

  function makeEditorialCandidates(text) {
    const output = [];
    const datePattern = /(?<!\d)(\d{1,2})\/(\d{1,2})\((日|月|火|水|木|金|土)\)/g;
    let match;
    while ((match = datePattern.exec(text))) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const weekday = match[3];
      const year = new Date().getFullYear();
      const expected = '日月火水木金土'[new Date(year, month - 1, day).getDay()];
      const note = expected === weekday ? '曜日の整合を確認してください' : `曜日が一致しない可能性：${weekday} → ${expected}`;
      const id = `editorial:${signature(match.index, match[0], expected)}`;
      output.push({
        id, type: 'editorial', category: '校閲', label: note,
        before: match[0], after: match[0], start: match.index, end: match.index + match[0].length,
        severity: expected === weekday ? 'normal' : 'critical', strength: 'absolute',
        rationale: strengthReason('absolute', '日付・曜日の整合は公開前に確認します。'),
        context: contextAt(text, match.index, match.index + match[0].length),
        skipKey: signature('editorial', match[0], match.index)
      });
    }
    return output;
  }

  function makeManualCandidates() {
    if (!state.baseline || !state.working) return [];
    const diff = Diff.diffText(state.baseline, state.working);
    return diff.hunks.map((hunk, index) => ({
      id: `manual:${hunk.id}`,
      sourceId: hunk.id,
      type: 'manual', category: '差分', label: '人が修正した変更',
      before: hunk.before, after: hunk.after,
      start: hunk.afterStart, end: hunk.afterEnd,
      severity: hunk.severity, strength: 'context', rationale: strengthReason('context', '人が入れた修正の意図を確認します。'), order: index + 1,
      context: contextAt(state.working, hunk.afterStart, hunk.afterEnd || hunk.afterStart),
      skipKey: signature('manual', hunk.before, hunk.after, hunk.afterStart)
    }));
  }

  function candidateStatus(candidate) {
    const explicit = state.reviews[candidate.id];
    if (explicit === 'done') return 'done';
    if (state.skipped[candidate.skipKey]) return 'skipped';
    return 'pending';
  }

  function candidates() {
    const manual = makeManualCandidates();
    const style = makeStyleCandidates(state.working);
    const label = makeLabelCandidates(state.working);
    const editorial = makeEditorialCandidates(state.working);
    const rankSeverity = { critical: 0, normal: 1, minor: 2 };
    const rankStrength = { absolute: 0, principle: 1, context: 2 };
    const rankType = { editorial: 0, manual: 1, style: 2, label: 3 };
    return [...editorial, ...manual, ...style, ...label].sort((a, b) => {
      const statusRank = candidateStatus(a) === 'pending' ? 0 : 1;
      const otherStatusRank = candidateStatus(b) === 'pending' ? 0 : 1;
      if (statusRank !== otherStatusRank) return statusRank - otherStatusRank;
      if (rankStrength[a.strength || 'context'] !== rankStrength[b.strength || 'context']) return rankStrength[a.strength || 'context'] - rankStrength[b.strength || 'context'];
      if (rankSeverity[a.severity] !== rankSeverity[b.severity]) return rankSeverity[a.severity] - rankSeverity[b.severity];
      return rankType[a.type] - rankType[b.type];
    });
  }

  function derive() {
    const list = candidates();
    const manualDiff = state.baseline && state.working ? Diff.diffText(state.baseline, state.working) : { parts: [], hunks: [] };
    const pending = list.filter(item => candidateStatus(item) === 'pending');
    return { list, manualDiff, pending, critical: pending.filter(item => item.severity === 'critical'), absolute: pending.filter(item => item.strength === 'absolute'), done: list.filter(item => candidateStatus(item) !== 'pending') };
  }

  function ensureActive() {
    if (!state.derived.list.length) { state.activeId = null; return; }
    if (!state.derived.list.some(item => item.id === state.activeId)) state.activeId = state.derived.pending[0]?.id || state.derived.list[0].id;
  }

  function activeCandidate() {
    return state.derived?.list.find(item => item.id === state.activeId) || null;
  }

  function snapshot() {
    return JSON.stringify({
      title: state.title, baseline: state.baseline, working: state.working,
      mode: state.mode, activeId: state.activeId, reviews: state.reviews, skipped: state.skipped,
      profile: state.profile, strict: state.strict, rulePrefs: state.rulePrefs,
      output: state.output, display: state.display, cmsHistory: state.cmsHistory, lastTransform: state.lastTransform
    });
  }

  function pushUndo() {
    state.undoStack.push(snapshot());
    if (state.undoStack.length > 80) state.undoStack.shift();
    state.redoStack = [];
  }

  function restoreSnapshot(raw) {
    const data = JSON.parse(raw);
    state.title = data.title || '名称未設定の原稿';
    state.baseline = data.baseline || '';
    state.working = data.working || '';
    state.mode = data.mode || 'edit';
    state.activeId = data.activeId || null;
    state.reviews = data.reviews || {};
    state.skipped = data.skipped || {};
    state.profile = PROFILES[data.profile] ? data.profile : state.profile;
    state.strict = Boolean(data.strict);
    state.rulePrefs = { disabled: {}, ...(data.rulePrefs || {}) };
    state.output = { ...state.output, ...(data.output || {}) };
    state.display = { ...state.display, ...(data.display || {}) };
    state.cmsHistory = data.cmsHistory || [];
    state.lastTransform = data.lastTransform || null;
    $('#projectTitle').value = state.title;
    $('#baselineText').value = state.baseline;
    $('#workingText').value = state.working;
    if ($('#profileSelect')) $('#profileSelect').value = state.profile;
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshot());
    restoreSnapshot(state.undoStack.pop());
    renderAll();
    notify('直前の操作を元に戻しました');
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshot());
    restoreSnapshot(state.redoStack.pop());
    renderAll();
    notify('やり直しました');
  }

  function commitWorking(nextText, description, count = 1, detail = '') {
    const next = String(nextText);
    if (next === state.working) { notify('変更対象はありません'); return false; }
    pushUndo();
    const before = state.working;
    state.working = next;
    state.lastTransform = { before, after: next, description, count };
    state.cmsHistory.unshift({ id: `${Date.now()}-${Math.random()}`, at: nowLabel(), description, count, detail, before, after: next });
    state.manualReviews = {};
    $('#workingText').value = state.working;
    renderAll();
    notify(`${description}：${count}件を反映しました`);
    return true;
  }

  function tokeniseProtected(text, options = {}) {
    const tokens = [];
    const protectPattern = options.protect === false ? /$^/g : /https?:\/\/[^\s<]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|<[^>]*>/g;
    const safe = String(text).replace(protectPattern, match => {
      const marker = `\uE000TRS${tokens.length}\uE001`;
      tokens.push(match);
      return marker;
    });
    return { safe, restore(value) { return tokens.reduce((out, token, index) => out.replaceAll(`\uE000TRS${index}\uE001`, token), value); }, protectedCount: tokens.length };
  }

  function runRecipe(recipe, source = state.working) {
    const sourceText = String(source);
    let count = 0;
    let protectedCount = 0;
    let output = sourceText;
    let description = '';
    let detail = '';

    const replaceProtected = (transform, protect = true) => {
      const tokenized = tokeniseProtected(output, { protect });
      protectedCount += tokenized.protectedCount;
      const result = transform(tokenized.safe, (pattern, replacement) => {
        const matches = tokenized.safe.match(pattern);
        count += matches ? matches.length : 0;
        return tokenized.safe.replace(pattern, replacement);
      });
      output = tokenized.restore(result);
    };

    if (recipe === 'space') {
      description = '空白を整える';
      replaceProtected((text, replace) => {
        let value = replace(/　/g, ' ');
        value = value.replace(/ {2,}/g, match => { count += 1; return ' '; });
        value = value.replace(/[ \t]+(?=\n|$)/g, match => { count += 1; return ''; });
        return value;
      });
      detail = '全角スペース・連続半角スペース・行末空白';
    }

    if (recipe === 'symbol') {
      description = '記号を統一する';
      replaceProtected((text) => {
        const map = [['！', '!'], ['？', '?'], ['（', '('], ['）', ')'], ['＆', '&'], ['：', ':'], ['／', '/'], ['〜', '～']];
        let value = text;
        map.forEach(([before, after]) => {
          const re = new RegExp(escapeRegExp(before), 'g');
          const matches = value.match(re);
          count += matches ? matches.length : 0;
          value = value.replace(re, after);
        });
        return value;
      });
      detail = '！・？・かっこ・記号';
    }

    if (recipe === 'notation') {
      description = '表記をそろえる';
      replaceProtected((text) => {
        const rules = STYLE_RULES.filter(rule => ['samazama', 'arakajime', 'seiippai', 'yoroshiku', 'nyudan', 'month'].includes(rule.id));
        let value = text;
        rules.forEach(rule => {
          const matches = value.match(rule.pattern);
          count += matches ? matches.length : 0;
          value = value.replace(rule.pattern, rule.replacement);
        });
        return value;
      });
      detail = '様々・予め・精一杯など';
    }

    if (recipe === 'newline') {
      description = '改行を整える';
      replaceProtected((text) => {
        let value = text.replace(/\r\n?/g, '\n');
        const matches = value.match(/\n{3,}/g);
        count += matches ? matches.length : 0;
        value = value.replace(/\n{3,}/g, '\n\n');
        return value;
      });
      detail = '改行コード・空行の連続';
    }

    if (recipe === 'unwrap') {
      description = 'HTMLタグを外す';
      const matches = output.match(/<[^>]*>/g);
      count = matches ? matches.length : 0;
      output = output.replace(/<[^>]*>/g, '');
      detail = 'タグだけを削除し、中の文字は残す';
    }

    return { recipe, description, detail, before: sourceText, after: output, count, protectedCount };
  }

  function patternTransform(kind) {
    const before = state.working;
    let after = before;
    let count = 0;
    let description = '';
    let detail = '';

    if (kind === 'brackets') {
      description = '【】をラベル化';
      after = before.replace(/^([ \t]*)【([^\n】]{1,40})】([ \t]*)$/gm, (match, leading, value, trailing) => {
        count += 1;
        return `${leading}<span class="info24-label">${escapeHTML(value)}</span>${trailing}`;
      });
      detail = '40文字以下・行全体が【】の対象のみ';
    }

    if (kind === 'urls') {
      description = 'URLをリンク化';
      const tokenized = tokeniseProtected(before, { protect: true });
      // URLs are protected by default, so re-run while preserving tags only.
      const tags = [];
      const safe = before.replace(/<[^>]*>/g, tag => { const marker = `\uE010TAG${tags.length}\uE011`; tags.push(tag); return marker; });
      const linked = safe.replace(/https?:\/\/[^\s<]+/g, url => {
        if (/^\uE010TAG/.test(url)) return url;
        count += 1;
        return `<a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`;
      });
      after = tags.reduce((out, tag, index) => out.replaceAll(`\uE010TAG${index}\uE011`, tag), linked);
      detail = '既存HTMLタグの外にあるURLのみ';
      void tokenized;
    }

    if (kind === 'notes') {
      description = '※注記を注意書きタグ化';
      after = before.replace(/^([ \t]*)(※[^\n]+)$/gm, (match, leading, value) => {
        count += 1;
        return `${leading}<span class="info24-note">${escapeHTML(value)}</span>`;
      });
      detail = '行頭の※から始まる行';
    }
    return { recipe: `pattern:${kind}`, description, detail, before, after, count, protectedCount: 0 };
  }

  function replaceAt(text, start, end, value) {
    return `${text.slice(0, start)}${value}${text.slice(end)}`;
  }

  function wrapSelection(tag) {
    if (state.mode !== 'edit') { notify('タグ付けは「原稿を編集」で行えます'); return; }
    const editor = $('#workingText');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = state.working.slice(start, end);
    if (!selected) { notify('タグを付ける文字を選択してください'); return; }
    let replacement = selected;
    let description = '';
    if (tag === 'label') { replacement = `<span class="info24-label">${escapeHTML(selected)}</span>`; description = '選択範囲をラベル化'; }
    if (tag === 'heading') { replacement = `<span class="info24-t2">${escapeHTML(selected)}</span>`; description = '選択範囲を中見出し化'; }
    if (tag === 'note') { replacement = `<span class="info24-note">${escapeHTML(selected)}</span>`; description = '選択範囲を注意書き化'; }
    if (tag === 'strong') { replacement = `<strong>${escapeHTML(selected)}</strong>`; description = '選択範囲を強調'; }
    if (tag === 'link') {
      const url = window.prompt('リンク先URLを入力してください');
      if (!url) return;
      replacement = `<a href="${escapeHTML(url)}">${escapeHTML(selected)}</a>`;
      description = '選択範囲にリンクを付与';
    }
    const next = replaceAt(state.working, start, end, replacement);
    if (commitWorking(next, description, 1, selected)) {
      state.mode = 'edit';
      setTimeout(() => {
        const field = $('#workingText');
        field.focus();
        field.setSelectionRange(start, start + replacement.length);
      }, 0);
    }
    hideSelectionToolbar();
  }

  function stripTagsKeepGenerated(text) {
    const held = [];
    const safe = String(text).replace(/<span class="info24-label">[\s\S]*?<\/span>/g, match => {
      const marker = `\uE100LABEL${held.length}\uE101`;
      held.push(match);
      return marker;
    });
    const stripped = safe.replace(/<[^>]*>/g, '');
    return held.reduce((out, value, index) => out.replaceAll(`\uE100LABEL${index}\uE101`, value), stripped);
  }

  function convertLabelsForOutput(text, policy) {
    if (policy === 'keep') return text;
    return String(text).replace(/^([ \t]*)【([^\n】]{1,40})】([ \t]*)$/gm, (match, leading, value, trailing) => {
      if (policy === 'tag') return `${leading}<span class="info24-label">${escapeHTML(value)}</span>${trailing}`;
      return `${leading}${value}${trailing}`;
    });
  }

  function linkifyOutput(text) {
    const tags = [];
    const safe = String(text).replace(/<[^>]*>/g, tag => {
      const marker = `\uE200TAG${tags.length}\uE201`;
      tags.push(tag);
      return marker;
    });
    const linked = safe.replace(/https?:\/\/[^\s<]+/g, url => `<a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`);
    return tags.reduce((out, tag, index) => out.replaceAll(`\uE200TAG${index}\uE201`, tag), linked);
  }

  function lineConvert(text, policy) {
    if (policy === 'keep') return text;
    if (policy === 'br') return String(text).replace(/\n/g, '<br>\n');
    return String(text).split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('\n');
  }

  function generatedHTML() {
    let output = state.working;
    output = convertLabelsForOutput(output, state.output.labelPolicy);
    if (state.output.linkPolicy === 'anchor') output = linkifyOutput(output);
    if (state.output.tagPolicy === 'unwrap') output = stripTagsKeepGenerated(output);
    output = lineConvert(output, state.output.linePolicy);
    return output;
  }

  function generatedPlain() {
    let output = convertLabelsForOutput(state.working, state.output.labelPolicy === 'keep' ? 'keep' : 'plain');
    return output.replace(/<[^>]*>/g, '');
  }

  function renderText(text, options = {}) {
    const raw = String(text || '');
    const query = state.search.query;
    const currentIndex = state.search.matches?.[state.search.current] ?? -1;
    const offset = options.offset || 0;
    const tokenPattern = /(https?:\/\/[^\s<]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|<[^>]*>)/g;
    let cursor = 0;
    let tokenMatch;
    const parts = [];

    const renderSegment = (segment, start, kind = '') => {
      let html = escapeHTML(segment);
      if (query) {
        const re = new RegExp(escapeRegExp(escapeHTML(query)), 'g');
        let match;
        let indexShift = 0;
        html = html.replace(re, (found, matchOffset) => {
          const actualStart = start + Math.max(0, matchOffset - indexShift);
          const current = actualStart === currentIndex;
          return `<mark class="search-hit${current ? ' current' : ''}">${found}</mark>`;
        });
      }
      if (state.display.whitespace && !kind) {
        html = html.replace(/ /g, '<span class="display-space">·</span>')
          .replace(/　/g, '<span class="display-space">□</span>')
          .replace(/\n/g, '<span class="display-space">↵</span>\n')
          .replace(/\t/g, '<span class="display-space">⇥</span>');
      }
      if (kind === 'tag' && state.display.tags) return `<span class="display-tag">${html}</span>`;
      if ((kind === 'url' || kind === 'email') && state.display.urls) return `<span class="display-url">${html}</span>`;
      return html;
    };

    while ((tokenMatch = tokenPattern.exec(raw))) {
      const before = raw.slice(cursor, tokenMatch.index);
      if (before) parts.push(renderSegment(before, offset + cursor));
      const token = tokenMatch[0];
      const kind = token.startsWith('<') ? 'tag' : token.includes('@') && !token.startsWith('http') ? 'email' : 'url';
      parts.push(renderSegment(token, offset + tokenMatch.index, kind));
      cursor = tokenMatch.index + token.length;
    }
    if (cursor < raw.length) parts.push(renderSegment(raw.slice(cursor), offset + cursor));
    return parts.join('');
  }

  function buildAlignedRows() {
    if (!state.baseline && !state.working) return [];
    if (!state.baseline) return [{ id: 'working-only', kind: 'insert', before: '比較元を入力すると左右差分を表示します。', after: state.working, beforeStart: 0, beforeEnd: 0, afterStart: 0, afterEnd: state.working.length }];
    if (!state.working) return [{ id: 'baseline-only', kind: 'delete', before: state.baseline, after: 'CMS作業版を入力してください。', beforeStart: 0, beforeEnd: state.baseline.length, afterStart: 0, afterEnd: 0 }];

    const diff = state.derived.manualDiff;
    const rows = [];
    let beforePos = 0;
    let afterPos = 0;
    diff.hunks.forEach(hunk => {
      const commonBefore = state.baseline.slice(beforePos, hunk.beforeStart);
      const commonAfter = state.working.slice(afterPos, hunk.afterStart);
      if (commonBefore || commonAfter) {
        const max = Math.max(commonBefore.split('\n').length, commonAfter.split('\n').length);
        const beforeLines = commonBefore.split('\n');
        const afterLines = commonAfter.split('\n');
        let bOffset = beforePos;
        let aOffset = afterPos;
        for (let i = 0; i < max; i += 1) {
          const b = beforeLines[i] ?? '';
          const a = afterLines[i] ?? '';
          rows.push({ id: `same-${rows.length}`, kind: 'same', before: b + (i < beforeLines.length - 1 ? '\n' : ''), after: a + (i < afterLines.length - 1 ? '\n' : ''), beforeStart: bOffset, beforeEnd: bOffset + b.length, afterStart: aOffset, afterEnd: aOffset + a.length });
          bOffset += b.length + (i < beforeLines.length - 1 ? 1 : 0);
          aOffset += a.length + (i < afterLines.length - 1 ? 1 : 0);
        }
      }
      rows.push({ id: hunk.id, kind: hunk.kind, before: hunk.before, after: hunk.after, beforeStart: hunk.beforeStart, beforeEnd: hunk.beforeEnd, afterStart: hunk.afterStart, afterEnd: hunk.afterEnd, severity: hunk.severity });
      beforePos = hunk.beforeEnd;
      afterPos = hunk.afterEnd;
    });
    const tailBefore = state.baseline.slice(beforePos);
    const tailAfter = state.working.slice(afterPos);
    if (tailBefore || tailAfter) {
      const max = Math.max(tailBefore.split('\n').length, tailAfter.split('\n').length);
      const beforeLines = tailBefore.split('\n');
      const afterLines = tailAfter.split('\n');
      let bOffset = beforePos;
      let aOffset = afterPos;
      for (let i = 0; i < max; i += 1) {
        const b = beforeLines[i] ?? '';
        const a = afterLines[i] ?? '';
        rows.push({ id: `same-${rows.length}`, kind: 'same', before: b + (i < beforeLines.length - 1 ? '\n' : ''), after: a + (i < afterLines.length - 1 ? '\n' : ''), beforeStart: bOffset, beforeEnd: bOffset + b.length, afterStart: aOffset, afterEnd: aOffset + a.length });
        bOffset += b.length + (i < beforeLines.length - 1 ? 1 : 0);
        aOffset += a.length + (i < afterLines.length - 1 ? 1 : 0);
      }
    }
    return rows;
  }

  function innerHunk(textBefore, textAfter, side) {
    const diff = Diff.diffText(textBefore, textAfter);
    return diff.parts.map(part => {
      if (side === 'before' && part.type === 'add') return '';
      if (side === 'after' && part.type === 'remove') return '';
      const cls = part.type === 'remove' ? 'diff-del' : part.type === 'add' ? 'diff-add' : '';
      const rendered = renderText(part.value, { offset: 0 });
      return cls ? `<mark class="${cls}">${rendered}</mark>` : rendered;
    }).join('');
  }

  function rowIsActive(row) {
    const active = activeCandidate();
    if (!active) return false;
    if (active.type === 'manual') return row.id === active.sourceId;
    const start = active.start ?? 0;
    const end = active.end ?? start;
    return start <= row.afterEnd && end >= row.afterStart;
  }

  function rowShouldDim(row) {
    if (!state.display.pendingOnly) return false;
    return row.kind === 'same' && !rowIsActive(row);
  }

  function ghostRanges() {
    if (!state.showGhost || !state.lastTransform?.before) return [];
    const diff = Diff.diffText(state.lastTransform.before, state.working);
    return diff.hunks.map(h => ({ start: h.afterStart, end: h.afterEnd || h.afterStart }));
  }

  function overlapsGhost(row, ranges) {
    return ranges.some(range => range.start <= row.afterEnd && range.end >= row.afterStart);
  }

  function renderCompare() {
    const beforeSurface = $('#baselineCompare');
    const afterSurface = $('#afterCompare');
    const gutter = $('#gutterMap');
    if (state.mode !== 'compare') {
      beforeSurface.hidden = true;
      afterSurface.hidden = true;
      $('#baselineText').hidden = false;
      $('#workingText').hidden = false;
      gutter.innerHTML = '<span class="gutter-marker same">↔</span>';
      return;
    }
    beforeSurface.hidden = false;
    afterSurface.hidden = false;
    $('#baselineText').hidden = true;
    $('#workingText').hidden = true;
    const rows = buildAlignedRows();
    const ghosts = ghostRanges();
    beforeSurface.innerHTML = rows.map(row => {
      const active = rowIsActive(row) ? ' is-active' : '';
      const dim = rowShouldDim(row) ? ' is-dim' : '';
      const body = row.kind === 'same' ? renderText(row.before, { offset: row.beforeStart }) : innerHunk(row.before, row.after, 'before');
      return `<div class="compare-row${active}${dim}" data-row-id="${escapeHTML(row.id)}">${body || '&nbsp;'}</div>`;
    }).join('');
    afterSurface.innerHTML = rows.map(row => {
      const active = rowIsActive(row) ? ' is-active' : '';
      const dim = rowShouldDim(row) ? ' is-dim' : '';
      const ghost = overlapsGhost(row, ghosts) ? ' ghost-change' : '';
      const body = row.kind === 'same' ? renderText(row.after, { offset: row.afterStart }) : innerHunk(row.before, row.after, 'after');
      return `<div class="compare-row${active}${dim}${ghost}" data-row-id="${escapeHTML(row.id)}">${body || '&nbsp;'}</div>`;
    }).join('');
    const meaningful = rows.filter(row => row.kind !== 'same');
    gutter.innerHTML = meaningful.length ? meaningful.map(row => {
      const symbol = row.kind === 'insert' ? '+' : row.kind === 'delete' ? '−' : '↔';
      const className = row.kind === 'insert' ? 'add' : row.kind === 'delete' ? 'remove' : 'replace';
      const important = row.severity === 'critical' ? ' critical' : '';
      return `<button class="gutter-marker ${className}${important}" data-action="jump-row" data-row-id="${escapeHTML(row.id)}" title="差分へ移動">${symbol}</button>`;
    }).join('') : '<span class="gutter-marker same">✓</span>';
  }

  function renderStats() {
    const b = stats(state.baseline);
    const w = stats(state.working);
    $('#baselineStats').textContent = `${b.chars.toLocaleString()}文字・${b.lines.toLocaleString()}行`;
    $('#workingStats').textContent = `${w.chars.toLocaleString()}文字・${w.lines.toLocaleString()}行`;
    $('#workingMeta').textContent = `URL ${w.urls}件・HTMLタグ ${w.tags}件`;
    $('#analysisState').textContent = state.analyzing ? '差分を更新中…' : state.working ? (state.strict && state.derived?.absolute?.length ? `絶対守る ${state.derived.absolute.length}件` : '比較・確認は最新') : '入力待ち';
    $('#processingCount').textContent = `CMS加工 ${state.cmsHistory.length}件`;
    $('#ghostButton').disabled = !state.lastTransform;
    $('#ghostButton').classList.toggle('is-active', state.showGhost);
    $('#ghostButton').textContent = state.showGhost ? '加工前の重ね表示を閉じる' : '加工前を重ねて表示';
    $('#editModeButton').classList.toggle('is-active', state.mode === 'edit');
    $('#compareModeButton').classList.toggle('is-active', state.mode === 'compare');
  }

  function renderReviewRail() {
    const list = state.derived.list;
    const pending = state.derived.pending;
    const critical = state.derived.critical;
    const absolute = state.derived.absolute;
    const done = state.derived.done;
    $('#railTotal').textContent = pending.length;
    $('#railSub').textContent = pending.length ? `未確認 ${pending.length}` : list.length ? '確認完了' : '入力待ち';
    $('#reviewCounts').innerHTML = `
      <div class="count-tile critical"><strong>${critical.length}</strong><span>重要</span></div>
      <div class="count-tile pending"><strong>${pending.length}</strong><span>未確認</span></div>
      <div class="count-tile done"><strong>${done.length}</strong><span>完了</span></div>
    `;
    $('#queueListCount').textContent = `${list.length}件`;
    $('#railDots').innerHTML = list.slice(0, 14).map(item => `<span class="rail-dot ${item.strength === 'absolute' && candidateStatus(item) === 'pending' ? 'critical' : candidateStatus(item) === 'pending' ? 'pending' : 'done'}"></span>`).join('');

    const active = activeCandidate();
    const panel = $('#activeReview');
    if (!active) {
      panel.innerHTML = '<p style="color:#7d8aa3;font-size:12px;line-height:1.7">原稿を入力すると、差分・表記・校閲・HTMLの確認がここへ並びます。</p>';
    } else {
      const status = candidateStatus(active);
      const type = ({ manual: '差分', style: '表記', label: 'HTML', editorial: '校閲' }[active.type] || '確認');
      const strength = active.strength || 'context';
      const label = active.type === 'manual'
        ? active.before && active.after ? `${truncate(active.before, 32)} → ${truncate(active.after, 32)}` : active.before ? `削除：${truncate(active.before, 32)}` : `追加：${truncate(active.after, 32)}`
        : active.type === 'label' ? active.before : active.type === 'editorial' ? active.before : `${active.before} → ${active.after}`;
      let actions = '';
      if (active.type === 'manual') actions = status === 'done'
        ? `<button data-action="review-pending" data-id="${escapeHTML(active.id)}">未確認に戻す</button>`
        : `<button class="safe" data-action="review-done" data-id="${escapeHTML(active.id)}">確認済み</button><button data-action="add-note" data-id="${escapeHTML(active.id)}">メモ</button>`;
      if (active.type === 'style') actions = status === 'skipped'
        ? `<button data-action="unskip" data-id="${escapeHTML(active.id)}">今回は残すを戻す</button>`
        : `<button class="primary" data-action="apply-candidate" data-id="${escapeHTML(active.id)}">反映</button><button class="skip" data-action="skip-candidate" data-id="${escapeHTML(active.id)}">今回は残す</button><button class="keep-rule" data-action="keep-rule" data-id="${escapeHTML(active.id)}">今後もこの表記を残す</button>`;
      if (active.type === 'label') actions = status === 'skipped'
        ? `<button data-action="unskip" data-id="${escapeHTML(active.id)}">保留を戻す</button>`
        : `<button class="primary" data-action="apply-label" data-id="${escapeHTML(active.id)}" data-value="tag">ラベル化</button><button class="safe" data-action="apply-label" data-id="${escapeHTML(active.id)}" data-value="plain">かっこだけ外す</button><button class="skip" data-action="skip-candidate" data-id="${escapeHTML(active.id)}">そのまま</button>`;
      if (active.type === 'editorial') actions = status === 'done'
        ? `<button data-action="review-pending" data-id="${escapeHTML(active.id)}">要確認に戻す</button>`
        : `<button class="safe" data-action="review-done" data-id="${escapeHTML(active.id)}">確認済み</button><button class="skip" data-action="skip-candidate" data-id="${escapeHTML(active.id)}">要確認のまま</button><button data-action="add-note" data-id="${escapeHTML(active.id)}">メモ</button>`;
      const pair = active.type === 'style' || active.type === 'manual' ? `
        <div class="change-pair"><div class="before"><label>変更前</label><span>${escapeHTML(active.before || '（追加）')}</span></div><div class="after"><label>変更後</label><span>${escapeHTML(active.after || '（削除）')}</span></div></div>` : '';
      panel.innerHTML = `
        <span class="review-type ${active.severity === 'critical' ? 'critical' : ''}">${type}${active.severity === 'critical' ? '｜重要' : ''}</span>
        <span class="rule-badge ${strength}">${escapeHTML(strengthLabel(strength))}</span>
        <h3>${escapeHTML(label)}</h3>
        <p>${escapeHTML(active.label)}<br>${escapeHTML(active.context)}</p>
        <p class="review-reason">${escapeHTML(active.rationale || strengthReason(strength, active.label))}</p>
        ${pair}
        <div class="review-actions">${actions}</div>
        <div class="next-row"><span>${status === 'pending' ? '未確認' : status === 'skipped' ? '保留・除外済み' : '確認済み'}</span><button data-action="next-pending">次の未確認へ →</button></div>
      `;
    }

    $('#queueList').innerHTML = list.map(item => {
      const status = candidateStatus(item);
      const title = item.type === 'label' ? item.before : item.type === 'editorial' ? item.before : item.before && item.after ? `${truncate(item.before, 28)} → ${truncate(item.after, 28)}` : truncate(item.before || item.after, 28);
      return `<button class="queue-item ${item.id === state.activeId ? 'is-active' : ''}" data-action="select-candidate" data-id="${escapeHTML(item.id)}"><span class="q-kind">${({ manual: '差分', style: '表記', label: 'HTML', editorial: '校閲' }[item.type])} ・ ${strengthLabel(item.strength || 'context')} ・ ${status === 'pending' ? '未確認' : status === 'done' ? '完了' : '保留'}</span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(item.label)}</small></button>`;
    }).join('') || '<p class="history-empty">確認項目はありません。</p>';
    void absolute;
  }

  function renderProfile() {
    const profile = activeProfile();
    const disabled = Object.values(state.rulePrefs.disabled || {}).filter(item => item.profile === state.profile).length;
    if ($('#profileSelect')) $('#profileSelect').value = state.profile;
    $('#profileSummary').textContent = profile.summary;
    $('#ruleStrengthList').innerHTML = [
      ['absolute', '絶対守る', 'URL・メール・HTMLを保護'],
      ['principle', '原則守る', `${profile.principle.length + profile.absolute.length}ルール`],
      ['context', '文脈で判断', '見出し・引用・固有表記']
    ].map(([kind, title, detail]) => `<div class="rule-strength ${kind}"><i></i><strong>${title}</strong><small>${detail}</small></div>`).join('');
    $('#exceptionCount').textContent = disabled;
    [$('#strictModeTop'), $('#strictModeSide')].forEach(button => {
      button.textContent = state.strict ? '厳密 ON' : '厳密 OFF';
      button.classList.toggle('is-on', state.strict);
      button.setAttribute('aria-pressed', String(state.strict));
    });
    ['whitespace', 'tags', 'urls', 'pendingOnly'].forEach(key => {
      const ids = { whitespace: ['showWhitespace', 'sideWhitespace'], tags: ['showTags', 'sideTags'], urls: ['showUrls', 'sideUrls'], pendingOnly: ['pendingOnly', 'sidePendingOnly'] }[key];
      ids.forEach(id => { const el = $(`#${id}`); if (el) el.checked = Boolean(state.display[key]); });
    });
    if ($('#sideSearchInput')) $('#sideSearchInput').value = state.search.query || '';
  }

  function renderExceptions() {
    const entries = Object.entries(state.rulePrefs.disabled || {}).filter(([, item]) => item.profile === state.profile);
    const target = $('#exceptionList');
    if (!entries.length) {
      target.innerHTML = '<p class="exception-empty">このセットには固定例外がありません。候補で「今後もこの表記を残す」を選ぶと、ここに理由ごと残ります。</p>';
      return;
    }
    target.innerHTML = entries.map(([key, item]) => `<article class="exception-item"><div><strong>${escapeHTML(item.label || item.ruleId)}</strong><small>${escapeHTML(item.note || 'このこだわりセットでは、以後候補に出しません。')}</small></div><button data-action="restore-rule" data-key="${escapeHTML(key)}">ルールに戻す</button></article>`).join('');
  }

  function setProfile(value) {
    if (!PROFILES[value] || value === state.profile) return;
    pushUndo();
    state.profile = value;
    const profile = activeProfile();
    state.output = { ...state.output, ...profile.defaults };
    state.activeId = null;
    renderAll();
    notify(`こだわりセットを「${profile.name}」に切り替えました`);
  }

  function toggleStrict() {
    pushUndo();
    state.strict = !state.strict;
    renderAll();
    notify(state.strict ? '厳密モードをONにしました。絶対守る基準をコピー前に明示します。' : '厳密モードをOFFにしました。');
  }

  function keepRule(id) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate?.ruleId) return;
    pushUndo();
    state.rulePrefs.disabled[candidate.ruleKey] = { ruleId: candidate.ruleId, profile: state.profile, label: candidate.label, note: `「${candidate.before}」を残す作法`, at: new Date().toISOString() };
    renderAll();
    notify('今後もこの表記を残す設定にしました');
  }

  function restoreRule(key) {
    if (!state.rulePrefs.disabled[key]) return;
    pushUndo();
    delete state.rulePrefs.disabled[key];
    renderAll();
    notify('この表記ルールを再び提案する設定に戻しました');
  }

  function renderHistory() {
    const container = $('#historyList');
    if (!state.cmsHistory.length) {
      container.innerHTML = '<p class="history-empty">CMS加工はまだありません。空白・記号・表記の整形や、タグ付けを行うとここに残ります。</p>';
      return;
    }
    container.innerHTML = state.cmsHistory.map((item, index) => `
      <article class="history-item"><time>${escapeHTML(item.at)}</time><div><strong>${escapeHTML(item.description)}　${item.count}件</strong><small>${escapeHTML(item.detail || 'CMS作業版に反映')}</small></div><button data-action="preview-history" data-index="${index}">箇所を見る</button></article>
    `).join('');
  }

  function renderOutputSettings() {
    const groups = [
      ['tag-policy', 'tagPolicy'], ['label-policy', 'labelPolicy'], ['line-policy', 'linePolicy'], ['link-policy', 'linkPolicy']
    ];
    groups.forEach(([group, key]) => {
      $$(`[data-group="${group}"] button`).forEach(button => button.classList.toggle('is-active', button.dataset.value === state.output[key]));
    });
    $('#outputPreview').textContent = generatedHTML();
  }

  function renderSelectionToolbar() {
    if (state.mode !== 'edit') hideSelectionToolbar();
  }

  function renderAll() {
    state.derived = derive();
    ensureActive();
    renderStats();
    renderProfile();
    renderCompare();
    renderReviewRail();
    renderHistory();
    renderExceptions();
    renderOutputSettings();
    renderSelectionToolbar();
    renderUndo();
    persist();
  }

  function renderUndo() {
    $('#undoButton').disabled = !state.undoStack.length;
    $('#redoButton').disabled = !state.redoStack.length;
  }

  function persist() {
    try {
      const data = { version: VERSION, title: state.title, baseline: state.baseline, working: state.working, profile: state.profile, strict: state.strict, rulePrefs: state.rulePrefs, output: state.output, cmsHistory: state.cmsHistory, exportedAt: new Date().toISOString() };
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data));
    } catch { /* Storage can be unavailable. The app still works. */ }
  }

  function hydrate() {
    try {
      const raw = localStorage.getItem(AUTO_SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.working !== 'string') return;
      state.title = data.title || state.title;
      state.baseline = data.baseline || '';
      state.working = data.working || '';
      state.output = { ...state.output, ...(data.output || {}) };
      state.profile = PROFILES[data.profile] ? data.profile : state.profile;
      state.strict = Boolean(data.strict);
      state.rulePrefs = { disabled: {}, ...(data.rulePrefs || {}) };
      state.cmsHistory = data.cmsHistory || [];
      $('#projectTitle').value = state.title;
      $('#baselineText').value = state.baseline;
      $('#workingText').value = state.working;
      if ($('#profileSelect')) $('#profileSelect').value = state.profile;
      $('#saveState').textContent = 'この端末に保存中';
    } catch { /* Ignore malformed stale data. */ }
  }

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'compare' && !state.baseline) notify('比較元が未入力のため、右側をCMS作業版として表示します');
    renderAll();
  }

  function toggleRail(force) {
    const panel = $('#reviewPanel');
    state.railOpen = typeof force === 'boolean' ? force : !state.railOpen;
    panel.hidden = !state.railOpen;
    $('.rail-summary').setAttribute('aria-expanded', String(state.railOpen));
  }

  function selectCandidate(id) {
    state.activeId = id;
    renderAll();
    toggleRail(true);
    requestAnimationFrame(() => focusCandidate());
  }

  function focusCandidate() {
    const candidate = activeCandidate();
    if (!candidate) return;
    if (state.mode === 'edit') {
      const editor = $('#workingText');
      const start = candidate.start ?? 0;
      const end = candidate.end ?? start;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, end);
      const line = state.working.slice(0, start).split('\n').length;
      editor.scrollTop = Math.max(0, (line - 4) * 29);
      return;
    }
    const row = candidate.type === 'manual' ? candidate.sourceId : findRowForCandidate(candidate);
    const target = $('#afterCompare').querySelector(`[data-row-id="${CSS.escape(row)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const leftTarget = $('#baselineCompare').querySelector(`[data-row-id="${CSS.escape(row)}"]`);
    leftTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function findRowForCandidate(candidate) {
    const row = buildAlignedRows().find(item => (candidate.start ?? 0) <= item.afterEnd && (candidate.end ?? candidate.start ?? 0) >= item.afterStart);
    return row?.id || '';
  }

  function moveCandidate(direction) {
    const pool = state.derived.pending.length ? state.derived.pending : state.derived.list;
    if (!pool.length) return;
    const current = pool.findIndex(item => item.id === state.activeId);
    const next = pool[(current + direction + pool.length) % pool.length] || pool[0];
    selectCandidate(next.id);
  }

  function nextPending() {
    const pool = state.derived.pending;
    if (!pool.length) { notify('未確認の項目はありません'); return; }
    const current = pool.findIndex(item => item.id === state.activeId);
    selectCandidate(pool[(current + 1 + pool.length) % pool.length].id);
  }

  function reviewDone(id) {
    pushUndo();
    state.reviews[id] = 'done';
    renderAll();
    notify('確認済みにしました');
  }

  function reviewPending(id) {
    pushUndo();
    delete state.reviews[id];
    renderAll();
    notify('未確認に戻しました');
  }

  function skipCandidate(id) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate) return;
    pushUndo();
    state.skipped[candidate.skipKey] = true;
    renderAll();
    notify('この原稿では保留・除外にしました');
  }

  function unskip(id) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate) return;
    pushUndo();
    delete state.skipped[candidate.skipKey];
    renderAll();
    notify('保留・除外を戻しました');
  }

  function applyCandidate(id) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate) return;
    const next = replaceAt(state.working, candidate.start, candidate.end, candidate.after);
    commitWorking(next, candidate.label, 1, `${candidate.before} → ${candidate.after}`);
  }

  function applyLabel(id, action) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate) return;
    let replacement = candidate.before;
    if (action === 'tag') replacement = `${candidate.leading}<span class="info24-label">${escapeHTML(candidate.value)}</span>${candidate.trailing}`;
    if (action === 'plain') replacement = `${candidate.leading}${candidate.value}${candidate.trailing}`;
    const description = action === 'tag' ? '【】をラベル化' : '【】のかっこを外す';
    commitWorking(replaceAt(state.working, candidate.start, candidate.end, replacement), description, 1, candidate.before);
  }

  function addNote(id) {
    const candidate = state.derived.list.find(item => item.id === id);
    if (!candidate) return;
    const note = window.prompt('メモを入力してください');
    if (note === null) return;
    pushUndo();
    state.reviews[id] = 'done';
    state.cmsHistory.unshift({ id: `${Date.now()}-${Math.random()}`, at: nowLabel(), description: '確認メモ', count: 1, detail: `${candidate.before || candidate.label}｜${note}`, before: state.working, after: state.working });
    renderAll();
    notify('メモを記録しました');
  }

  function closeIfOpen(selector) { const dialog = $(selector); if (dialog?.open) dialog.close(); }

  function openSearch() {
    closeIfOpen('#commandDialog');
    state.search.open = true;
    $('#searchBar').hidden = false;
    setTimeout(() => $('#searchInput').focus(), 0);
  }

  function closeSearch() {
    state.search.open = false;
    state.search.query = '';
    state.search.current = 0;
    state.search.matches = [];
    $('#searchInput').value = '';
    if ($('#sideSearchInput')) $('#sideSearchInput').value = '';
    $('#searchBar').hidden = true;
    renderCompare();
  }

  function computeSearch() {
    const query = state.search.query;
    const matches = [];
    if (query) {
      let position = 0;
      while (position <= state.working.length) {
        const found = state.working.indexOf(query, position);
        if (found < 0) break;
        matches.push(found);
        position = found + Math.max(query.length, 1);
      }
    }
    state.search.matches = matches;
    if (state.search.current >= matches.length) state.search.current = 0;
    $('#searchCount').textContent = query ? `${matches.length}件` : '0件';
    if ($('#sideSearchInput')) $('#sideSearchInput').value = query;
    if (query) { state.search.open = true; $('#searchBar').hidden = false; }
    renderCompare();
  }

  function goSearch(direction) {
    if (!state.search.matches?.length) { notify('該当はありません'); return; }
    state.search.current = (state.search.current + direction + state.search.matches.length) % state.search.matches.length;
    const start = state.search.matches[state.search.current];
    const editor = $('#workingText');
    if (state.mode === 'edit') {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start, start + state.search.query.length);
      const line = state.working.slice(0, start).split('\n').length;
      editor.scrollTop = Math.max(0, (line - 4) * 29);
    } else {
      const row = buildAlignedRows().find(item => start <= item.afterEnd && start >= item.afterStart);
      $('#afterCompare').querySelector(`[data-row-id="${CSS.escape(row?.id || '')}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    renderCompare();
  }

  function replaceSearch(all) {
    const query = state.search.query;
    const replacement = $('#replaceInput').value;
    if (!query) { notify('検索する文字列を入力してください'); return; }
    const protect = $('#replaceProtect').checked;
    let count = 0;
    let output;
    if (protect) {
      const tokenized = tokeniseProtected(state.working, { protect: true });
      const re = new RegExp(escapeRegExp(query), all ? 'g' : '');
      output = tokenized.restore(tokenized.safe.replace(re, () => { count += 1; return replacement; }));
    } else {
      const re = new RegExp(escapeRegExp(query), all ? 'g' : '');
      output = state.working.replace(re, () => { count += 1; return replacement; });
    }
    if (!count) { notify('置換対象はありません'); return; }
    commitWorking(output, all ? '検索結果を一括置換' : '検索結果を置換', count, `${query} → ${replacement}`);
    computeSearch();
  }

  function openTransform(recipe) {
    closeIfOpen('#commandDialog');
    const result = runRecipe(recipe);
    state.pendingTransform = result;
    $('#transformTitle').textContent = result.description;
    $('#transformSummary').textContent = `変更予定：${result.count}件　保護して除外：${result.protectedCount}箇所`;
    const beforeParts = result.before.split('\n').filter((line, index) => result.after.split('\n')[index] !== line).slice(0, 3);
    const afterParts = result.after.split('\n').filter((line, index) => result.before.split('\n')[index] !== line).slice(0, 3);
    $('#transformExamples').innerHTML = result.count ? `
      <p class="transform-summary">${escapeHTML(result.detail || '変換内容を確認してから反映します。')}</p>
      ${beforeParts.map((line, index) => `<div class="example-pair"><code>${escapeHTML(line || '（空行）')}</code><span class="arrow">↓</span><code>${escapeHTML(afterParts[index] || '（空行）')}</code></div>`).join('') || '<p class="transform-summary">変更箇所をプレビューします。</p>'}` : '<p class="transform-summary">変更対象はありません。</p>';
    $('#applyTransformButton').disabled = !result.count;
    $('#applyTransformButton').textContent = result.count ? `${result.count}件を反映` : '反映';
    $('#transformDialog').showModal();
  }

  function previewPattern(kind) {
    const result = patternTransform(kind);
    state.pendingTransform = result;
    $('#patternPreview').innerHTML = result.count ? `
      <p><strong>${escapeHTML(result.description)}</strong></p><p>対象：${result.count}件<br>${escapeHTML(result.detail)}</p>
      <div class="example-pair"><code>${escapeHTML(result.before)}</code><span class="arrow">↓</span><code>${escapeHTML(result.after)}</code></div>` : '<p>対象はありません。</p>';
    $('#applyPatternButton').disabled = !result.count;
    $('#applyPatternButton').textContent = result.count ? `${result.count}件を反映` : '反映';
  }

  function applyPendingTransform() {
    const result = state.pendingTransform;
    if (!result || !result.count) return;
    commitWorking(result.after, result.description, result.count, result.detail);
    $('#transformDialog').close();
    $('#patternDialog').close();
    state.pendingTransform = null;
  }

  function setOutput(key, value) {
    pushUndo();
    state.output[key] = value;
    renderAll();
    notify('出力設定を更新しました');
  }

  function toggleDrawer(id, button) {
    const el = $(id);
    el.hidden = !el.hidden;
    if (button) button.classList.toggle('is-active', !el.hidden);
  }

  function requestCopy(kind) {
    $('#copyMenu').hidden = true;
    $('#copyButton').setAttribute('aria-expanded', 'false');
    const pending = state.derived.pending;
    const absolute = state.derived.absolute || [];
    if (pending.length || (state.strict && absolute.length)) {
      state.pendingCopy = kind;
      const critical = pending.filter(item => item.severity === 'critical').length;
      const strictMessage = state.strict && absolute.length ? `厳密モード：絶対守る基準が${absolute.length}件、未確認です。` : '';
      $('#copyConfirmText').textContent = strictMessage || (critical
        ? `重要な未確認が${critical}件、未確認が合計${pending.length}件あります。内容を把握したうえでコピーしてください。`
        : `未確認の項目が${pending.length}件あります。このままコピーできます。`);
      $('#copyConfirmDialog').showModal();
      return;
    }
    performCopy(kind);
  }

  async function performCopy(kind) {
    const map = { plain: generatedPlain(), html: generatedHTML(), report: buildReport() };
    const label = { plain: '整形後テキスト', html: '掲載用HTML', report: '差分・確認記録' }[kind];
    const value = map[kind] || '';
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    $('#copyConfirmDialog').close();
    state.pendingCopy = null;
    notify(`${label}をコピーしました`);
  }

  function buildReport() {
    const lines = [`Text Review Studio ${VERSION}｜${state.title}`, `作成日時：${new Date().toLocaleString('ja-JP')}`, `こだわりセット：${activeProfile().name}｜厳密モード：${state.strict ? 'ON' : 'OFF'}`, ''];
    if (!state.derived.list.length) lines.push('確認対象はありません。');
    state.derived.list.forEach((item, index) => {
      const status = candidateStatus(item) === 'pending' ? '未確認' : candidateStatus(item) === 'done' ? '確認済み' : '保留';
      const type = ({ manual: '差分', style: '表記', label: 'HTML', editorial: '校閲' }[item.type]);
      lines.push(`${index + 1}. [${type}／${strengthLabel(item.strength || 'context')}／${status}${item.severity === 'critical' ? '／重要' : ''}] ${item.before && item.after ? `${item.before} → ${item.after}` : item.before || item.label}`);
      lines.push(`   内容：${item.label}`);
    });
    if (state.cmsHistory.length) {
      lines.push('', 'CMS加工履歴');
      state.cmsHistory.slice().reverse().forEach(item => lines.push(`- ${item.at} ${item.description} ${item.count}件${item.detail ? `｜${item.detail}` : ''}`));
    }
    return lines.join('\n');
  }

  function openAudit() {
    const html = generatedHTML();
    $('#auditGrid').innerHTML = [
      ['比較元', state.baseline || '— 比較元なし —'],
      ['CMS作業版', state.working || '—'],
      ['整形後テキスト', generatedPlain() || '—'],
      ['掲載用HTML', html || '—']
    ].map(([label, text]) => `<section><header>${escapeHTML(label)}</header><pre>${escapeHTML(text)}</pre></section>`).join('');
    $('#auditDialog').showModal();
  }

  function jumpRow(id) {
    if (state.mode !== 'compare') setMode('compare');
    requestAnimationFrame(() => {
      $('#afterCompare').querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#baselineCompare').querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function showSelectionToolbar() {
    if (state.mode !== 'edit') return;
    const editor = $('#workingText');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) { hideSelectionToolbar(); return; }
    const toolbar = $('#selectionToolbar');
    const rect = editor.getBoundingClientRect();
    toolbar.style.left = `${Math.min(rect.width - 265, 22)}px`;
    toolbar.style.top = `${Math.max(8, editor.scrollTop + 8)}px`;
    toolbar.hidden = false;
  }

  function hideSelectionToolbar() { $('#selectionToolbar').hidden = true; }

  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function scheduleAnalysis(target = 'working') {
    state.analyzing = true;
    renderStats();
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.analyzing = false;
      if (target === 'working') state.manualReviews = {};
      renderAll();
    }, 520);
  }

  function loadSample() {
    if ((state.working || state.baseline) && !window.confirm('現在の内容をサンプルに置き換えますか？')) return;
    state.title = 'サンプル｜ポケモンJリーグフェス告知';
    state.baseline = `浦和レッズは、8月15日（土）サンフレッチェ広島戦にて「ポケモンJリーグフェス」を開催いたします。\n\n当日は来場者先着52,000名さまにEVO BAGをプレゼントいたします。\n\n【対象試合】\n8月15日(日) サンフレッチェ広島戦\n\n詳細は https://example.com/ticket?foo=1&bar=2 をご確認ください。\n\n宜しくお願いします！`;
    state.working = `浦和レッズは、8/15(土)サンフレッチェ広島戦にて「ポケモンJリーグフェス」を開催いたします。\n\n当日は、来場者先着52,000名さまにEVO BAGをプレゼントいたします。様々なイベントを予定しております。\n\n【対象試合】\n8/15(土) サンフレッチェ広島戦\n\n詳細は https://example.com/ticket?foo=1&bar=2 をご確認ください。\n\n<span class="note">宜しくお願いします！</span>\n\n新加入選手は精一杯プレーいたします。`;
    state.reviews = {}; state.skipped = {}; state.cmsHistory = []; state.undoStack = []; state.redoStack = []; state.lastTransform = null; state.mode = 'compare';
    $('#projectTitle').value = state.title; $('#baselineText').value = state.baseline; $('#workingText').value = state.working;
    $('#moreDialog').close();
    renderAll();
    notify('サンプルを読み込みました');
  }

  function clearWork() {
    if (!window.confirm('原稿・比較元・判断・履歴を消去しますか？')) return;
    state.title = '名称未設定の原稿'; state.baseline = ''; state.working = ''; state.reviews = {}; state.skipped = {}; state.cmsHistory = []; state.undoStack = []; state.redoStack = []; state.lastTransform = null; state.activeId = null;
    $('#projectTitle').value = state.title; $('#baselineText').value = ''; $('#workingText').value = '';
    localStorage.removeItem(AUTO_SAVE_KEY);
    $('#moreDialog').close();
    renderAll();
    notify('この画面の内容を消去しました');
  }

  function exportWork() {
    const payload = { version: VERSION, title: state.title, baseline: state.baseline, working: state.working, profile: state.profile, strict: state.strict, rulePrefs: state.rulePrefs, output: state.output, reviews: state.reviews, skipped: state.skipped, cmsHistory: state.cmsHistory, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${VERSION}-${(state.title || 'text-review').replace(/[\\/:*?"<>|]/g, '_')}-work.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    notify('作業データを書き出しました');
  }

  function importWork(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data.working !== 'string') throw new Error('invalid');
        state.title = data.title || '名称未設定の原稿';
        state.baseline = data.baseline || '';
        state.working = data.working;
        state.output = { ...state.output, ...(data.output || {}) };
        state.reviews = data.reviews || {};
        state.skipped = data.skipped || {};
        state.profile = PROFILES[data.profile] ? data.profile : state.profile;
        state.strict = Boolean(data.strict);
        state.rulePrefs = { disabled: {}, ...(data.rulePrefs || {}) };
        state.cmsHistory = data.cmsHistory || [];
        state.undoStack = []; state.redoStack = [];
        $('#projectTitle').value = state.title; $('#baselineText').value = state.baseline; $('#workingText').value = state.working; if ($('#profileSelect')) $('#profileSelect').value = state.profile;
        $('#moreDialog').close();
        renderAll();
        notify('作業データを読み込みました');
      } catch { notify('読み込めませんでした。Text Review StudioのJSONを確認してください。'); }
    };
    reader.readAsText(file);
  }

  function handleAction(action, control) {
    switch (action) {
      case 'scroll-top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'set-mode': setMode(control.dataset.mode); break;
      case 'toggle-review-rail': toggleRail(); break;
      case 'toggle-copy-menu': $('#copyMenu').hidden = !$('#copyMenu').hidden; $('#copyButton').setAttribute('aria-expanded', String(!$('#copyMenu').hidden)); break;
      case 'request-copy': requestCopy(control.dataset.copyType); break;
      case 'confirm-copy': performCopy(state.pendingCopy); break;
      case 'open-command': $('#commandDialog').showModal(); break;
      case 'toggle-strict': toggleStrict(); break;
      case 'left-quick-search': state.search.query = control.dataset.query; state.search.current = 0; $('#searchInput').value = state.search.query; if ($('#sideSearchInput')) $('#sideSearchInput').value = state.search.query; computeSearch(); goSearch(0); break;
      case 'clear-side-search': closeSearch(); break;
      case 'open-more': $('#moreDialog').showModal(); break;
      case 'open-search': openSearch(); break;
      case 'close-search': closeSearch(); break;
      case 'search-next': goSearch(1); break;
      case 'search-prev': goSearch(-1); break;
      case 'quick-search': state.search.query = control.dataset.query; $('#searchInput').value = state.search.query; computeSearch(); goSearch(0); break;
      case 'toggle-replace': state.search.replaceOpen = !state.search.replaceOpen; $('#replaceControls').hidden = !state.search.replaceOpen; break;
      case 'replace-one': replaceSearch(false); break;
      case 'replace-all': replaceSearch(true); break;
      case 'open-transform': openTransform(control.dataset.recipe); break;
      case 'apply-pending-transform': applyPendingTransform(); break;
      case 'open-pattern-tags': closeIfOpen('#commandDialog'); $('#patternDialog').showModal(); break;
      case 'preview-pattern': previewPattern(control.dataset.pattern); break;
      case 'unwrap-working-tags': closeIfOpen('#commandDialog'); openTransform('unwrap'); break;
      case 'open-display-settings': closeIfOpen('#commandDialog'); $('#displayDialog').showModal(); break;
      case 'toggle-display-settings': $('#displayDialog').showModal(); break;
      case 'toggle-ghost': state.showGhost = !state.showGhost; renderAll(); break;
      case 'wrap-selection': wrapSelection(control.dataset.tag); break;
      case 'select-candidate': selectCandidate(control.dataset.id); break;
      case 'next-pending': nextPending(); break;
      case 'review-done': reviewDone(control.dataset.id); break;
      case 'review-pending': reviewPending(control.dataset.id); break;
      case 'skip-candidate': skipCandidate(control.dataset.id); break;
      case 'keep-rule': keepRule(control.dataset.id); break;
      case 'restore-rule': restoreRule(control.dataset.key); break;
      case 'unskip': unskip(control.dataset.id); break;
      case 'apply-candidate': applyCandidate(control.dataset.id); break;
      case 'apply-label': applyLabel(control.dataset.id, control.dataset.value); break;
      case 'add-note': addNote(control.dataset.id); break;
      case 'jump-row': jumpRow(control.dataset.rowId); break;
      case 'toggle-output-settings': toggleDrawer('#outputSettings', '#outputSettingsButton'); break;
      case 'toggle-history': toggleDrawer('#historyDrawer', '#historyButton'); break;
      case 'toggle-exceptions': toggleDrawer('#exceptionsDrawer', '#exceptionsButton'); break;
      case 'set-tag-policy': setOutput('tagPolicy', control.dataset.value); break;
      case 'set-label-policy': setOutput('labelPolicy', control.dataset.value); break;
      case 'set-line-policy': setOutput('linePolicy', control.dataset.value); break;
      case 'set-link-policy': setOutput('linkPolicy', control.dataset.value); break;
      case 'open-audit': openAudit(); break;
      case 'close-audit': $('#auditDialog').close(); break;
      case 'preview-history': {
        const item = state.cmsHistory[Number(control.dataset.index)];
        if (item) { state.lastTransform = item; state.showGhost = true; setMode('compare'); notify('このCMS加工の差分を重ねて表示しています'); }
        break;
      }
      case 'paste-baseline': navigator.clipboard?.readText().then(text => { state.baseline = text; $('#baselineText').value = text; scheduleAnalysis('baseline'); }).catch(() => notify('貼り付けられませんでした。ブラウザの貼り付けをご利用ください。')); break;
      case 'paste-working': navigator.clipboard?.readText().then(text => { state.working = text; $('#workingText').value = text; scheduleAnalysis('working'); }).catch(() => notify('貼り付けられませんでした。ブラウザの貼り付けをご利用ください。')); break;
      case 'clear-baseline': if (state.baseline && window.confirm('比較元を消去しますか？')) { pushUndo(); state.baseline = ''; $('#baselineText').value = ''; renderAll(); } break;
      case 'clear-working': if (state.working && window.confirm('CMS作業版を消去しますか？')) { pushUndo(); state.working = ''; $('#workingText').value = ''; state.cmsHistory = []; state.lastTransform = null; renderAll(); } break;
      case 'load-sample': loadSample(); break;
      case 'download-work': exportWork(); break;
      case 'upload-work': $('#workFile').click(); break;
      case 'clear-work': clearWork(); break;
      default: break;
    }
  }

  document.addEventListener('click', event => {
    const control = event.target.closest('[data-action]');
    if (control) { event.preventDefault(); handleAction(control.dataset.action, control); return; }
    if (!event.target.closest('.copy-wrap')) { $('#copyMenu').hidden = true; $('#copyButton').setAttribute('aria-expanded', 'false'); }
  });

  $('#workingText').addEventListener('input', event => { state.working = event.target.value; hideSelectionToolbar(); scheduleAnalysis('working'); });
  $('#baselineText').addEventListener('input', event => { state.baseline = event.target.value; scheduleAnalysis('baseline'); });
  $('#projectTitle').addEventListener('input', event => { state.title = event.target.value || '名称未設定の原稿'; persist(); });
  $('#profileSelect').addEventListener('change', event => setProfile(event.target.value));
  $('#sideSearchInput').addEventListener('input', event => { state.search.query = event.target.value; state.search.current = 0; $('#searchInput').value = state.search.query; computeSearch(); });
  $('#workingText').addEventListener('mouseup', showSelectionToolbar);
  $('#workingText').addEventListener('keyup', event => { if (event.shiftKey || ['ArrowLeft', 'ArrowRight'].includes(event.key)) showSelectionToolbar(); });
  $('#workingText').addEventListener('blur', () => setTimeout(hideSelectionToolbar, 180));
  $('#searchInput').addEventListener('input', event => { state.search.query = event.target.value; state.search.current = 0; computeSearch(); });
  $('#workFile').addEventListener('change', event => { const [file] = event.target.files || []; if (file) importWork(file); event.target.value = ''; });

  ['showWhitespace', 'showTags', 'showUrls', 'pendingOnly'].forEach(id => {
    $(`#${id}`).addEventListener('change', event => {
      const key = ({ showWhitespace: 'whitespace', showTags: 'tags', showUrls: 'urls', pendingOnly: 'pendingOnly' }[id]);
      state.display[key] = event.target.checked;
      renderAll();
    });
  });
  $$('[data-display-layer]').forEach(input => input.addEventListener('change', event => {
    state.display[input.dataset.displayLayer] = event.target.checked;
    renderAll();
  }));

  document.addEventListener('keydown', event => {
    const target = event.target;
    const editing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target.isContentEditable;
    if (event.key === 'Escape') hideSelectionToolbar();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#commandDialog').showModal(); return; }
    if (editing) return;
    if ($('#commandDialog').open || $('#transformDialog').open || $('#patternDialog').open || $('#displayDialog').open || $('#copyConfirmDialog').open || $('#moreDialog').open || $('#auditDialog').open) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); moveCandidate(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveCandidate(-1); }
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); const active = activeCandidate(); if (active?.type === 'manual' || active?.type === 'editorial') reviewDone(active.id); else if (active?.type === 'style') applyCandidate(active.id); else if (active?.type === 'label') applyLabel(active.id, 'tag'); }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); const active = activeCandidate(); if (active) skipCandidate(active.id); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
  });

  [$('#commandDialog'), $('#transformDialog'), $('#patternDialog'), $('#displayDialog'), $('#copyConfirmDialog'), $('#moreDialog'), $('#auditDialog')].forEach(dialog => {
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  });

  hydrate();
  renderAll();
})();
