// 受け入れ確認「囲わずに、研ぐ」(kakidasの見た目と手応えの仕上げ)
//
// 使い方(PowerShell、リポジトリ直下で):
//   $env:PW_FROM='C:\Users\vediv\repos\quicklinks'   # node_modules/playwright があるフォルダ(CIでは不要)
//   実装を確かめる : $env:BASE_URL='http://127.0.0.1:4173/'; node docs/togu/qa.mjs
//                    (本番やVercelのプレビューURLでもよい。新しいブラウザー環境で見本のメモを作って測るので、端末のメモやクラウドには触れない)
//   段階を絞る     : $env:QA_PHASES='P1'      (既定は P1,P2,P3)
//   試作を確かめる : 本番に試作のCSSとJSを重ねて測る(計画の確認用。実装では使わない)
//                    $env:PROTO_CSS='docs/togu/proto/proto.css'; $env:PROTO_PATCH_JS='docs/togu/proto/dom-patches.js'; $env:PROTO_BUNDLE='…/index-patched.js'
//
// 測る大きさは、PCが1366×633(本人のChromeを最大化した実寸)、スマホが375×667(iPhone SE)。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const { chromium } = createRequire(base)('playwright');
const URL0 = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(',').map(s => s.trim()));
const PC = { width: 1366, height: 633 };
const SE = { width: 375, height: 667 };
const LIMIT = {
  freezeMs: 400,       // 置いてから画面が動き出すまで(本番は約4000ms)
  pcBorderSides: 12,   // PCの最初の画面に見える枠線の辺の数(本番は60)
  pcFontSizes: 6,      // PCの最初の画面の文字の大きさの種類(本番は10)
  pcFontWeights: 2,    // 同じく太さの種類(本番は10)
  minFont: 12,         // 文字の最小(本番は9px)
  contrast: 4.5,       // 文字のコントラスト比(本番の日時・件数は3.1)
  spine: 2,            // 本文の背骨のずれ(px)
};
const read = p => (p ? readFileSync(p, 'utf8') : null);
const PROTO = { css: read(process.env.PROTO_CSS), patch: read(process.env.PROTO_PATCH_JS), bundle: read(process.env.PROTO_BUNDLE) };

/* ---------- 見本のメモ ---------- */
const SAMPLE = {
  title: '10/11 日「書く道具の仕立て直し」',
  urls: ['https://www.nngroup.com/articles/progressive-disclosure/', 'https://getdrafts.com/'],
  sentences: ['書き始める前に、置き場所を選ばせない', '操作は、触れようとしたときにだけ現れればいい', '保存中でも、次の一文を打てること', '列ごとの表示設定は、ふだん目に入らなくていい'],
  paragraph: ['清書が誇りになる', '散らかった作業台のまま、人にメモを見せることはありません。ひと押しで一枚に仕立て直せれば、メモそのものが成果物になります。'],
};
const LABEL = { url: '参考URL', sentence: 'アウトライン', paragraph: '段落' };
const deskOf = page => page.getByRole('textbox', { name: '書く', exact: true });
async function write(page, kind, text, { heading = '', tag = '', note = '' } = {}) {
  await page.getByRole('radio', { name: LABEL[kind], exact: true }).click();
  if (tag) {
    await page.getByRole('button', { name: 'タグを付ける', exact: true }).click();
    const tagField = page.getByRole('textbox', { name: '項目タグ', exact: true });
    await tagField.fill(tag);
    await tagField.press('Enter');
  }
  if (note) {
    await page.getByRole('button', { name: '気持ち・備考を付ける', exact: true }).click();
    await page.getByRole('textbox', { name: '気持ち・備考', exact: true }).fill(note);
    await page.locator('.entry-composer__meta-apply').first().click();
  }
  if (heading) await page.getByRole('textbox', { name: '段落タイトル', exact: true }).fill(heading);
  await deskOf(page).fill(text);
  await deskOf(page).press(kind === 'paragraph' ? 'Control+Enter' : 'Enter');
  await page.waitForTimeout(450);
}

async function open(browser, viewport, extra = {}, { seed = true } = {}) {
  const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...extra });
  context.setDefaultTimeout(8000);
  await context.route('**/api/link-preview**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'QAで差し替えたタイトル' }) }));
  if (PROTO.css) await context.route(/\/assets\/[^/]+\.css(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: PROTO.css }));
  if (PROTO.bundle) await context.route(/\/assets\/index-[^/]+\.js(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: PROTO.bundle }));
  if (PROTO.patch) await context.addInitScript({ content: PROTO.patch });
  // 置くときの移り変わりを記録する(描画が止まっていた時間を測る)
  await context.addInitScript(() => {
    window.__vt = [];
    const orig = document.startViewTransition?.bind(document);
    if (orig) document.startViewTransition = cb => {
      const rec = { start: performance.now() }; window.__vt.push(rec);
      const t = orig(cb);
      t.updateCallbackDone.then(() => { rec.done = performance.now(); }, () => { rec.done = performance.now(); });
      return t;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL0, { waitUntil: 'networkidle' });
  if (seed) {
    await page.getByRole('button', { name: /新しいメモ/ }).first().click();
    await page.waitForURL(/\/memos\//);
    const title = page.getByRole('textbox', { name: 'メモのタイトル', exact: true });
    await title.fill(SAMPLE.title); await title.press('Tab');
    if (viewport.width >= 921) { // メモのタグ(題の横と一覧のカードに出る)
      await page.locator('.editor-header .memo-tag-control__add').click();
      await page.locator('.memo-tag-control__form input').fill('企画');
      await page.locator('.memo-tag-control__save').click();
      await page.waitForTimeout(300);
    }
    for (const u of SAMPLE.urls) await write(page, 'url', u);
    for (const [i, s] of SAMPLE.sentences.entries()) await write(page, 'sentence', s, i === 1 ? { tag: '設計', note: 'あとで確かめる' } : {});
    await write(page, 'paragraph', SAMPLE.paragraph[1], { heading: SAMPLE.paragraph[0] });
    await page.waitForTimeout(600);
  }
  await settle(page);
  return { context, page, errors };
}
async function settle(page) {
  await page.mouse.move(2, 2);
  await page.evaluate(() => { document.activeElement?.blur?.(); document.scrollingElement.scrollTop = 0; });
  await page.waitForTimeout(350);
  // 行が加わったときの既存の動きなど、終わりのある動きは終わるまで待つ(最大2秒)
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))),
    new Promise(r => setTimeout(r, 2000)),
  ]));
}

/* ---------- 画面の中で使う道具(文字列で渡す) ---------- */
const LIB = `
  window.__qa = (() => {
    const vis = el => { if (el.closest('details:not([open])') && !el.closest('summary')) return false;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < .05) return false; }
      const s = getComputedStyle(el); if (s.clipPath === 'inset(50%)' || (r.width <= 1 && r.height <= 1)) return false;
      return true; };
    const parse = c => { const m = c.match(/[\\d.]+/g) || []; if (/^color\\(srgb/.test(c)) return [m[0]*255, m[1]*255, m[2]*255, m[3] === undefined ? 1 : +m[3]];
      return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat(1); };
    const bgOf = el => { const chain = []; for (let n = el; n; n = n.parentElement) chain.push(parse(getComputedStyle(n).backgroundColor));
      let c = parse(getComputedStyle(document.documentElement).backgroundColor); if (c[3] < 1) c = [255, 255, 255, 1];
      for (const layer of chain.reverse()) if (layer[3] > 0) c = over(layer, c); return c; };
    const opacityOf = el => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const hasText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !/^(OPTION|SCRIPT|STYLE)$/.test(el.tagName);
    const disabled = el => !!el.closest('button:disabled, [aria-disabled="true"], input:disabled, select:disabled');
    const texts = root => [...(root || document.body).querySelectorAll('*')].filter(el => hasText(el) && vis(el) && !disabled(el) && !el.closest('[aria-hidden="true"]'));
    const name = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '') + ' 「' + el.textContent.trim().slice(0, 14) + '」';
    const chainOf = el => { const out = []; for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\\(0, 0, 0, 0\\)/.test(c)) out.push(n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0] + '=' + c); } return out.join(' < '); };
    const contrastIssues = (root, min) => texts(root).map(el => { const bg = bgOf(el); let fg = parse(getComputedStyle(el).color);
        fg = over(fg, bg); const o = opacityOf(el); if (o < 1) fg = over([...fg.slice(0, 3), o], bg);
        return { el: name(el), r: Math.round(ratio(fg, bg) * 100) / 100, why: 'fg ' + getComputedStyle(el).color + ' op ' + o.toFixed(2) + ' / ' + chainOf(el) }; }).filter(x => x.r < min).sort((a, b) => a.r - b.r);
    const sizes = root => texts(root).map(el => parseFloat(getComputedStyle(el).fontSize));
    const weights = root => texts(root).map(el => getComputedStyle(el).fontWeight);
    const borderSides = (root, pred = () => true) => { let n = 0; const who = [];
      for (const el of (root || document.body).querySelectorAll('*')) { if (!vis(el)) continue; const s = getComputedStyle(el);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) { const w = parseFloat(s['border' + side + 'Width']); const st = s['border' + side + 'Style']; const c = parse(s['border' + side + 'Color']);
          if (w > 0 && st !== 'none' && st !== 'hidden' && c[3] > .05 && pred(c, st)) { n++; who.push(name(el) + ':' + side); } } }
      return { n, who }; };
    const isShu = c => { const [r, g, b] = c; const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max - min < 60) return false; const h = max === r ? ((g - b) / (max - min)) * 60 : 999; return h >= 5 && h <= 35; };
    const textLeft = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() ? 1 : 3 }); const t = w.nextNode(); if (!t) return null;
      const r = document.createRange(); r.selectNodeContents(t); const rect = r.getClientRects()[0]; return rect ? rect.left : null; };
    const lineRects = el => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { const r = document.createRange(); r.selectNodeContents(t); out.push(...r.getClientRects()); } return out; };
    const inputTextLeft = el => { const s = getComputedStyle(el); return el.getBoundingClientRect().left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft); };
    return { vis, parse, lum, ratio, bgOf, texts, name, contrastIssues, sizes, weights, borderSides, isShu, textLeft, lineRects, inputTextLeft };
  })();`;
const lib = page => page.evaluate(LIB);
const q = (page, fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg ?? null)})`);
const uniq = a => [...new Set(a)];

/* ---------- 確認項目 ---------- */
const checks = [];
const check = (phase, id, name, fn) => checks.push({ phase, id, name, fn });

// P1 守「戻す」:壊れて見えるところを直し、読める・押せるを取り戻す
check('P1', 'P1-1', `置いた直後も画面が止まらない(移り変わりの待ちが${LIMIT.freezeMs}ms以内)`, async ({ pc }) => {
  const { page } = pc;
  await page.evaluate(() => { window.__vt = []; });
  await write(page, 'sentence', '止まらない確認');
  await page.keyboard.type('続けて');
  await page.waitForTimeout(LIMIT.freezeMs + 400);
  const rec = await page.evaluate(() => window.__vt.at(-1) || null);
  assert.ok(rec, '置くときに移り変わりが起きていない(PCで動きを減らす設定でないのに)');
  const frozen = rec.done ? Math.round(rec.done - rec.start) : Infinity;
  assert.ok(frozen <= LIMIT.freezeMs, `描画が${frozen === Infinity ? `${LIMIT.freezeMs + 400}ms以上` : `${frozen}ms`}止まった`);
  await deskOf(page).fill('');
});
check('P1', 'P1-2', '新しい行の印は、いま置いた行に付く', async ({ pc }) => {
  const { page } = pc;
  await write(page, 'sentence', '印の確認です');
  const got = await page.evaluate(() => [...document.querySelectorAll('.entry-item--fresh')].map(r => r.textContent));
  assert.ok(got.length && got.every(t => t.includes('印の確認です')), `印が付いた行: ${JSON.stringify(got.map(t => t.slice(0, 12)))}`);
});
check('P1', 'P1-3', '濃い灰色の面がない(一覧・帯・余白・メニュー)', async ({ pc }) => {
  const { page } = pc;
  const scan = () => page.evaluate(() => { const { vis, parse, lum } = window.__qa; const bad = [];
    for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.width * r.height < 300) continue;
      const c = parse(getComputedStyle(el).backgroundColor); if (c[3] < .3) continue;
      const [R, G, B] = c; const max = Math.max(R, G, B), min = Math.min(R, G, B); const sat = max ? (max - min) / max : 0;
      if (lum(c) < .45 && sat < .35) bad.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]); }
    return bad; });
  const where = [];
  where.push(...(await scan()).map(s => '編集:' + s));
  await page.getByRole('button', { name: '余白を開く', exact: true }).click(); await page.waitForTimeout(300);
  where.push(...(await scan()).map(s => '余白:' + s));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.goto(URL0, { waitUntil: 'networkidle' }); await lib(page);
  where.push(...(await scan()).map(s => '一覧:' + s));
  await page.goBack({ waitUntil: 'networkidle' }); await lib(page); await settle(page);
  assert.equal(where.length, 0, uniq(where).slice(0, 6).join(', '));
});
check('P1', 'P1-4', `文字のコントラスト比は${LIMIT.contrast}以上(PC・スマホ・一覧)`, async ({ pc, se }) => {
  const issues = [];
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) issues.push(...(await q(page, 'm => window.__qa.contrastIssues(document.body, m)', LIMIT.contrast)).map(x => `${where} ${x.el} ${x.r}${process.env.QA_DEBUG ? ` (${x.why})` : ''}`));
  await pc.page.goto(URL0, { waitUntil: 'networkidle' }); await lib(pc.page);
  issues.push(...(await q(pc.page, 'm => window.__qa.contrastIssues(document.body, m)', LIMIT.contrast)).map(x => `一覧 ${x.el} ${x.r}`));
  await pc.page.goBack({ waitUntil: 'networkidle' }); await lib(pc.page); await settle(pc.page);
  assert.equal(issues.length, 0, `${issues.length}か所: ${issues.slice(0, 5).join(' / ')}`);
});
check('P1', 'P1-5', `文字は${LIMIT.minFont}px以上(PC・スマホの書く画面と一覧)`, async ({ pc, se }) => {
  const smallOf = page => page.evaluate(m => window.__qa.texts().filter(el => parseFloat(getComputedStyle(el).fontSize) < m).map(el => window.__qa.name(el) + ' ' + getComputedStyle(el).fontSize), LIMIT.minFont);
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    const small = await smallOf(page);
    await page.goto(URL0, { waitUntil: 'networkidle' }); await lib(page);
    small.push(...(await smallOf(page)).map(s => '一覧 ' + s));
    await page.goBack({ waitUntil: 'networkidle' }); await lib(page); await settle(page);
    assert.equal(small.length, 0, `${where}: ${small.slice(0, 5).join(' / ')}`);
  }
});
check('P1', 'P1-6', '破線・点線の枠を使わない', async ({ pc, se }) => {
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    const { n, who } = await page.evaluate(() => window.__qa.borderSides(document.body, (c, st) => st === 'dashed' || st === 'dotted'));
    assert.equal(n, 0, `${where}: ${uniq(who).slice(0, 5).join(', ')}`);
  }
});
check('P1', 'P1-7', '何も触れていないとき、朱の枠線はない', async ({ pc, se }) => {
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    const { n, who } = await page.evaluate(() => window.__qa.borderSides(document.body, c => window.__qa.isShu(c)));
    assert.equal(n, 0, `${where}で${n}辺: ${uniq(who).slice(0, 5).join(', ')}`);
  }
});
check('P1', 'P1-8', 'スマホの「この項目の操作」は、ブラウザー既定のボタンが残らない', async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^アウトライン/ }).first().click();
  await page.locator('.outline__item-wrap').filter({ hasText: SAMPLE.sentences[0] }).first().getByRole('button', { name: 'この項目の操作', exact: true }).click();
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.mobile-action-sheet__panel button')].filter(b => window.__qa.vis(b)).filter(b => {
    const s = getComputedStyle(b); return /rgb\(240, 240, 240\)|rgb\(239, 239, 239\)/.test(s.backgroundColor) || !/Hiragino|Noto Sans JP|BIZ UD/.test(s.fontFamily) || b.getBoundingClientRect().height < 40;
  }).map(b => b.textContent.trim().slice(0, 12)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  assert.equal(bad.length, 0, `既定のまま・40px未満: ${bad.join('、')}`);
});
check('P1', 'P1-9', '清書の落款は、2文字とも印の枠の中に収まる', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '清書にする', exact: true }).click();
  await page.getByRole('article', { name: '清書', exact: true }).waitFor();
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => { const s = document.querySelector('.seisho-stamp'); const box = s.getBoundingClientRect();
    const t = s.firstChild; const out = []; for (let i = 0; i < t.textContent.length; i++) { const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1); out.push(rg.getBoundingClientRect()); }
    return { box: { l: box.left, t: box.top, r: box.right, b: box.bottom }, chars: out.map(c => ({ l: c.left, t: c.top, r: c.right, b: c.bottom })) }; });
  const inside = r.chars.every(c => c.l >= r.box.l - 1 && c.r <= r.box.r + 1 && c.t >= r.box.t - 1 && c.b <= r.box.b + 1);
  await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click(); await page.waitForTimeout(600);
  assert.ok(inside, `字の位置 ${JSON.stringify(r.chars.map(c => [Math.round(c.l), Math.round(c.t)]))} / 枠 ${JSON.stringify(r.box)}`);
});
check('P1', 'P1-10', '余白の呼び名がそろい、スマホでキー操作の案内を出さない', async ({ pc, se }) => {
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    await page.getByRole('button', { name: '余白を開く', exact: true }).click(); await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const layer = document.querySelector('.temporary-memo-layer') || document.body;
      const labels = [...layer.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).join(' ');
      const after = getComputedStyle(document.querySelector('.temporary-memo-panel__footer'), '::after').content;
      return { old: /一時メモ/.test(layer.innerText + labels), after }; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.ok(!r.old, `${where}の余白に「一時メモ」が残っている`);
    if (where === 'スマホ') assert.ok(!/Alt/.test(r.after), `スマホで「${r.after}」が出ている`);
  }
});
check('P1', 'P1-11', '一覧の検索欄の案内が切れず、「すべて・タグ別」が折り返さない(PC・スマホ)', async ({ pc, se }) => {
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    await page.goto(URL0, { waitUntil: 'networkidle' }); await lib(page);
    const r = await page.evaluate(() => { const i = document.querySelector('.memo-search input, input[type="search"]'); const s = getComputedStyle(i);
      const c = document.createElement('canvas').getContext('2d'); c.font = s.font; const need = c.measureText(i.placeholder).width;
      const room = i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const wraps = [...document.querySelectorAll('.memo-view-switch button')].filter(b => window.__qa.lineRects(b).length > 1).map(b => b.textContent.trim());
      return { need: Math.round(need), room: Math.round(room), wraps, placeholder: i.placeholder }; });
    await page.goBack({ waitUntil: 'networkidle' }); await lib(page); await settle(page);
    assert.ok(r.need <= r.room, `${where}: 「${r.placeholder}」に${r.need}px要るが${r.room}px`);
    assert.equal(r.wraps.length, 0, `${where}: ${r.wraps.join('・')}が折り返す`);
  }
});

// P2 破「囲わない」:線と箱をやめ、余白と背骨で並べる
check('P2', 'P2-1', `題・書き口の背骨は${LIMIT.spine}px以内、3領域の文字は列幅からはみ出さない`, async ({ pc }) => {
  const r = await pc.page.evaluate(() => {
    const { textLeft, inputTextLeft } = window.__qa;
    const cols = [...document.querySelectorAll('.editor-grid .entry-column')];
    const parts = cols.map(col => {
      const bounds = col.getBoundingClientRect();
      const heading = col.querySelector('.entry-column__header h2');
      const content = col.querySelector('.outline__content, .entry-item__content-text, .entry-item__body');
      return { column: col.className, x: bounds.left, right: bounds.right,
        head: heading ? textLeft(heading) : null,
        row: content ? content.getBoundingClientRect().left : null,
        rowRight: content ? content.getBoundingClientRect().right : null };
    });
    return { title: inputTextLeft(document.querySelector('.memo-title-input')),
      desk: inputTextLeft(document.querySelector('.entry-composer--desk textarea')), parts };
  });
  assert.ok(Math.abs(r.title-r.desk)<=LIMIT.spine,`題${r.title}・書き口${r.desk}のずれ`);
  for(const p of r.parts) {
    assert.ok(p.head>=p.x-1 && p.head<=p.right,`${p.column}:見出しが列外`);
    if(p.row!==null)assert.ok(p.row>=p.x-1 && p.rowRight<=p.right+1,`${p.column}:本文が列外`);
  }
});
check('P2', 'P2-2', 'スマホの本文は画面の左端から16px、右は操作のぶんだけ空ける', async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^アウトライン/ }).first().click(); await settle(page);
  const r = await page.evaluate(() => { const row = document.querySelector('.entry-column--sentence .outline__item'); const t = row.querySelector('.outline__content');
    const rects = window.__qa.lineRects(t); return { left: row.getBoundingClientRect().left, textLeft:Math.min(...rects.map(x=>x.left)), right: Math.max(...rects.map(x => x.right)) }; });
  assert.ok(Math.abs(r.left - 16) <= 1, `行の左端が${Math.round(r.left)}px`);
  assert.ok(r.textLeft>=r.left, '階層記号と本文が重なる');
  assert.ok(r.right <= 375 - 44, `本文の右端が${Math.round(r.right)}pxで操作に重なる`);
});
check('P2', 'P2-3', `PCの最初の画面に囲み(3辺以上の枠)がなく、行の罫を除く線は${LIMIT.pcBorderSides}辺まで`, async ({ pc }) => {
  const r = await pc.page.evaluate(() => { const { vis, parse, name } = window.__qa; const boxes = []; let lines = 0; const who = [];
    for (const el of document.body.querySelectorAll('*')) { if (!vis(el)) continue; const s = getComputedStyle(el); let sides = 0;
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) { const w = parseFloat(s['border' + side + 'Width']); const st = s['border' + side + 'Style']; const c = parse(s['border' + side + 'Color']);
        if (w > 0 && st !== 'none' && st !== 'hidden' && c[3] > .05) sides++; }
      if (sides >= 3) boxes.push(name(el));
      else if (sides && !el.classList.contains('entry-item')) { lines += sides; who.push(name(el)); } }
    return { boxes, lines, who }; });
  assert.equal(r.boxes.length, 0, `囲み${r.boxes.length}個: ${uniq(r.boxes).slice(0, 5).join(', ')}`);
  assert.ok(r.lines <= LIMIT.pcBorderSides, `線${r.lines}辺: ${uniq(r.who).slice(0, 6).join(', ')}`);
});
check('P2', 'P2-4', `PCの最初の画面の文字は大きさ${LIMIT.pcFontSizes}段・太さ${LIMIT.pcFontWeights}種まで`, async ({ pc }) => {
  const sizes = uniq(await pc.page.evaluate(() => window.__qa.sizes()));
  const weights = uniq(await pc.page.evaluate(() => window.__qa.weights()));
  const odd = await pc.page.evaluate(() => window.__qa.texts().filter(el => !['400', '600'].includes(getComputedStyle(el).fontWeight)).map(el => window.__qa.name(el) + ' ' + getComputedStyle(el).fontWeight));
  assert.ok(sizes.length <= LIMIT.pcFontSizes, `大きさ${sizes.length}段: ${sizes.sort((a, b) => a - b).join(', ')}`);
  assert.ok(weights.length <= LIMIT.pcFontWeights, `太さ${weights.length}種: ${weights.join(', ')}(${uniq(odd).slice(0, 4).join(' / ')})`);
});
check('P2', 'P2-5', '行の道具は本文を隠さず、触れても行の高さが変わらない(PC)', async ({ pc }) => {
  const { page } = pc;
  const row = page.locator('.entry-column--sentence .outline__item').filter({ hasText: SAMPLE.sentences[1] }).first();
  const h0 = (await row.boundingBox()).height;
  await row.hover(); await page.waitForTimeout(350);
  const h1 = (await row.boundingBox()).height;
  const hit = await row.evaluate(el => { const a = el.querySelector('.outline__actions').getBoundingClientRect();
    const lines = window.__qa.lineRects(el.querySelector('.outline__content'));
    return lines.some(l => !(l.right <= a.left || l.left >= a.right || l.bottom <= a.top || l.top >= a.bottom)); });
  await settle(page);
  assert.ok(!hit, '行の道具が本文の字に重なる');
  assert.ok(Math.abs(h1 - h0) < 1, `触れると行の高さが${Math.round(h0)}→${Math.round(h1)}px`);
});
check('P2', 'P2-6', 'スマホの行の操作は枠なしで、44px四方の押せる大きさ', async ({ se }) => {
  const r = await se.page.evaluate(() => { const b = [...document.querySelectorAll('.outline__mobile-actions')].find(x => window.__qa.vis(x)); const s = getComputedStyle(b); const rect = b.getBoundingClientRect();
    return { border: parseFloat(s.borderTopWidth) + parseFloat(s.borderLeftWidth), w: rect.width, h: rect.height }; });
  assert.equal(r.border, 0, '操作ボタンに枠がある');
  assert.ok(r.w >= 44 && r.h >= 44, `${Math.round(r.w)}×${Math.round(r.h)}px`);
});
check('P2', 'P2-7', '書き口は2段(書く/置き先と気持ち・リンク・タグ)で、高さ112px以内(PC)', async ({ pc }) => {
  const r = await pc.page.evaluate(() => { const d = document.querySelector('.entry-composer--desk'); const a = d.querySelector('.entry-composer__destinations').getBoundingClientRect(); const m = d.querySelector('.entry-composer__meta-controls').getBoundingClientRect();
    return { h: d.getBoundingClientRect().height, dy: Math.abs((a.top + a.bottom) / 2 - (m.top + m.bottom) / 2) }; });
  assert.ok(r.dy <= 6, `置き先と気持ち・リンク・タグが別の段(${Math.round(r.dy)}pxずれ)`);
  assert.ok(r.h <= 112, `書き口の高さ${Math.round(r.h)}px`);
});
check('P2', 'P2-8', '列の間は縦線でなく余白(24px以上)', async ({ pc }) => {
  const r = await pc.page.evaluate(() => { const c = [...document.querySelectorAll('.editor-grid .entry-column')].map(x => ({ rect: x.getBoundingClientRect(), bl: parseFloat(getComputedStyle(x).borderLeftWidth), br: parseFloat(getComputedStyle(x).borderRightWidth) }));
    return { gaps: [c[1].rect.left - c[0].rect.right, c[2].rect.left - c[1].rect.right], lines: c.reduce((n, x) => n + x.bl + x.br, 0) }; });
  assert.equal(r.lines, 0, '列に縦線がある');
  assert.ok(Math.min(...r.gaps) >= 24, `列の間が${r.gaps.map(Math.round).join('・')}px`);
});
check('P2', 'P2-9', 'メニューの項目名は、印(✓)の有無にかかわらず左端がそろう', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: 'メモの操作', exact: true }).click(); await page.waitForTimeout(300);
  const lefts = await page.evaluate(() => [...document.querySelectorAll('.memo-actions__panel button')].filter(b => window.__qa.vis(b)).map(b => Math.round(window.__qa.textLeft(b))));
  await page.keyboard.press('Escape'); await settle(page);
  assert.ok(uniq(lefts).length === 1, `左端が${uniq(lefts).join('・')}pxに分かれる`);
});
check('P2', 'P2-10', '消す操作は赤で、ほかと罫で分ける(列の操作)', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: 'アウトラインの操作', exact: true }).click(); await page.waitForTimeout(300);
  const c = await page.evaluate(() => { const b = [...document.querySelectorAll('.entry-column__menu button')].at(-1); return { text: b.textContent, color: getComputedStyle(b).color }; });
  await page.keyboard.press('Escape'); await settle(page);
  const [r, g, b] = c.color.match(/\d+/g).map(Number);
  assert.ok(/削除/.test(c.text) && r > 140 && g < 90 && b < 90, `「${c.text}」の色が${c.color}`);
});
check('P2', 'P2-11', '余白はページの右に開き、メモが透けて見える(PC)', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '余白を開く', exact: true }).click(); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const p = document.querySelector('.temporary-memo-panel').getBoundingClientRect(); const bd = document.querySelector('.temporary-memo-backdrop'); const s = bd ? getComputedStyle(bd) : null;
    return { left: p.left, blur: s ? s.backdropFilter : 'none', alpha: s ? window.__qa.parse(s.backgroundColor)[3] : 0 }; });
  await page.keyboard.press('Escape'); await settle(page);
  assert.ok(r.left >= 1366 / 2, `余白の左端が${Math.round(r.left)}px`);
  assert.ok((r.blur === 'none' || !r.blur) && r.alpha <= .1, `背景をぼかす・暗くする(${r.blur} / ${r.alpha})`);
});
check('P2', 'P2-12', '一覧のカードは紙の色で、題がはっきり読める', async ({ pc }) => {
  const { page } = pc;
  await page.goto(URL0, { waitUntil: 'networkidle' }); await lib(page);
  const r = await page.evaluate(() => { const c = document.querySelector('.memo-card'); const t = c.querySelector('strong') || c;
    const bg = window.__qa.bgOf(c); const fg = window.__qa.parse(getComputedStyle(t).color); return { l: window.__qa.lum(bg), ratio: window.__qa.ratio(fg, bg) }; });
  await page.goBack({ waitUntil: 'networkidle' }); await lib(page); await settle(page);
  assert.ok(r.l >= .85 && r.ratio >= 7, `カードの明るさ${r.l.toFixed(2)}、題のコントラスト比${r.ratio.toFixed(1)}`);
});

// P3 離「研ぎ澄ます」:紙と墨と朱の手応え
check('P3', 'P3-1', '机に紙の目を敷き、強制配色では消す', async ({ pc, browser }) => {
  const img = await pc.page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  assert.ok(/svg/.test(img), `机の背景が${img.slice(0, 40)}`);
  const fc = await open(browser, PC, { forcedColors: 'active' }, { seed: false });
  const img2 = await fc.page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  await fc.context.close();
  assert.equal(img2, 'none', '強制配色でも紙の目が残る');
});
check('P3', 'P3-2', '書き口に触れると墨の線が走り、離れると消える', async ({ pc }) => {
  const { page } = pc;
  const sx = () => page.evaluate(() => { const t = getComputedStyle(document.querySelector('.entry-composer--desk .entry-composer__desk-fields'), '::after').transform; return t === 'none' ? 1 : +t.match(/matrix\(([^,]+)/)[1]; });
  const before = await sx();
  await deskOf(page).focus(); await page.waitForTimeout(450);
  const during = await sx();
  await settle(page);
  assert.ok(before < .05 && during > .95, `線の伸び ${before} → ${during}`);
});
check('P3', 'P3-3', '「置く」は書くまで沈み、書くと朱が灯る', async ({ pc }) => {
  const { page } = pc;
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('.entry-composer--desk .entry-composer__submit')).backgroundColor);
  await deskOf(page).fill(''); await page.waitForTimeout(250);
  const empty = await bg();
  await deskOf(page).fill('灯る'); await page.waitForTimeout(300);
  const lit = await bg();
  await deskOf(page).fill(''); await settle(page);
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(empty), `空のときの地が${empty}`);
  const [r, g, b] = lit.match(/\d+/g).map(Number);
  assert.ok(r > 150 && g < 110 && b < 80, `書いたときの地が${lit}`);
});
check('P3', 'P3-4', '置いた字は朱から墨へ乾く(動きを減らす設定では最初から墨)', async ({ pc, browser }) => {
  const { page } = pc;
  await write(page, 'sentence', '乾く字の確認');
  const color = () => page.evaluate(() => { const row = [...document.querySelectorAll('.outline__item')].find(r => r.textContent.includes('乾く字の確認'));
    return getComputedStyle(row.querySelector('.outline__content')).color; });
  const wet = (await color()).match(/\d+/g).map(Number);
  await page.waitForTimeout(2100);
  const dry = (await color()).match(/\d+/g).map(Number);
  assert.ok(wet[0] - wet[2] > 40, `置いた直後の字が朱でない(${wet})`);
  assert.ok(Math.abs(dry[0] - 35) <= 4 && Math.abs(dry[2] - 29) <= 4, `2秒後も墨にならない(${dry})`);
  const rm = await open(browser, PC, { reducedMotion: 'reduce' }, { seed: false });
  await rm.page.getByRole('button', { name: /新しいメモ/ }).first().click(); await rm.page.waitForURL(/\/memos\//);
  await write(rm.page, 'sentence', '動かない確認');
  const still = await rm.page.evaluate(() => { const row = [...document.querySelectorAll('.outline__item')].find(r => r.textContent.includes('動かない確認'));
    const t = row.querySelector('.outline__content'); return { color: getComputedStyle(t).color, anim: getComputedStyle(t).animationName }; });
  await rm.context.close();
  assert.ok(still.anim === 'none' && /35, 33, 29/.test(still.color), `動きを減らす設定で${still.anim} / ${still.color}`);
});
check('P3', 'P3-5', '保存の表示に状態(wet/dry)があり、乾いた後は墨の淡色', async ({ pc }) => {
  const r = await pc.page.evaluate(() => { const s = document.querySelector('.save-status'); return { state: s.dataset.state, color: getComputedStyle(s).color }; });
  assert.ok(r.state === 'dry' || r.state === 'wet', `data-stateが${r.state}`);
  if (r.state === 'dry') assert.ok(!/178, 78, 41|189, 86, 47/.test(r.color), `乾いた表示が朱のまま(${r.color})`);
});
check('P3', 'P3-6', '落款は紙に押し込まれる(重ね・かすれ・押す動き。動きを減らす設定では押さない)', async ({ pc, browser }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '清書にする', exact: true }).click(); await page.getByRole('article', { name: '清書', exact: true }).waitFor();
  const s = await page.evaluate(() => { const st = getComputedStyle(document.querySelector('.seisho-stamp')); return { blend: st.mixBlendMode, mask: st.maskImage || st.webkitMaskImage, anim: st.animationName }; });
  await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click(); await page.waitForTimeout(500); await settle(page);
  assert.equal(s.blend, 'multiply', '落款が紙に重なっていない');
  assert.ok(/svg/.test(s.mask), 'かすれがない');
  assert.ok(s.anim && s.anim !== 'none', '押す動きがない');
  const rm = await open(browser, PC, { reducedMotion: 'reduce' });
  await rm.page.getByRole('button', { name: '清書にする', exact: true }).click(); await rm.page.getByRole('article', { name: '清書', exact: true }).waitFor();
  const a2 = await rm.page.evaluate(() => getComputedStyle(document.querySelector('.seisho-stamp')).animationName);
  await rm.context.close();
  assert.equal(a2, 'none', '動きを減らす設定でも押す動きがある');
});
check('P3', 'P3-7', '清書は版面で組む(要点はぶら下げ、本文は一字下げ)', async ({ se }) => {
  const { page } = se;
  await page.getByRole('button', { name: '清書にする', exact: true }).click(); await page.getByRole('article', { name: '清書', exact: true }).waitFor(); await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const li = [...document.querySelectorAll('.seisho__list li')].map(el => window.__qa.lineRects(el)).find(rs => new Set(rs.map(x => Math.round(x.top))).size > 1);
    const p = document.querySelector('.seisho-paper p'); const ps = getComputedStyle(p);
    return { hang: li ? Math.abs(li[0].left - li.at(-1).left) : null, indent: parseFloat(ps.textIndent), em: parseFloat(ps.fontSize) }; });
  await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click(); await page.waitForTimeout(500); await settle(page);
  assert.ok(r.hang !== null, '折り返す要点がない(見本が短すぎる)');
  assert.ok(r.hang <= 2, `要点の2行目が${Math.round(r.hang)}pxずれる(ぶら下げになっていない)`);
  assert.ok(Math.abs(r.indent - r.em) <= 1, `本文の字下げが${r.indent}px(1字は${r.em}px)`);
});

/* ---------- 実行 ---------- */
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const phase of ['P1', 'P2', 'P3']) {
    if (!PHASES.has(phase)) continue;
    const list = checks.filter(c => c.phase === phase);
    const pc = await open(browser, PC, { permissions: ['clipboard-read', 'clipboard-write'] });
    const se = await open(browser, SE, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    for (const s of [pc, se]) await lib(s.page);
    for (const c of list) {
      try { await c.fn({ pc, se, browser }); results.push([c.id, 'ok', c.name]); }
      catch (e) { results.push([c.id, 'NG', c.name, e.message.split('\n')[0]]); }
      for (const s of [pc, se]) { await lib(s.page).catch(() => {}); await settle(s.page).catch(() => {}); }
    }
    for (const [where, s] of [['PC', pc], ['スマホ', se]]) {
      const overflow = await s.page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      if (overflow > 1) results.push([`${phase}-横`, 'NG', `${where}で横にはみ出す`, `${overflow}px`]);
      if (s.errors.length) results.push([`${phase}-JS`, 'NG', `${where}でページのエラー`, s.errors[0]]);
    }
    await pc.context.close(); await se.context.close();
  }
} finally {
  await browser.close();
}
const ok = results.filter(r => r[1] === 'ok').length;
console.log(`\n受け入れ確認「囲わずに、研ぐ」 対象: ${URL0}${PROTO.css ? ' + 試作のCSS' : ''}${PROTO.bundle ? ' + 試作のJS' : ''}`);
for (const r of results) console.log(`${r[1] === 'ok' ? '合格' : '不合格'}  ${r[0]}  ${r[2]}${r[3] ? `  …${r[3]}` : ''}`);
console.log(`\n${ok}/${results.length} 合格`);
process.exitCode = ok === results.length ? 0 : 1;
