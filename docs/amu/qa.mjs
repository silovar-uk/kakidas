// 受け入れ確認「並べずに、編む」(kakidasの3機能のUIの守破離)
//
// 使い方(PowerShell):
//   $env:PW_FROM='C:\Users\vediv\repos\quicklinks'   # node_modules/playwright があるフォルダ(CIでは不要)
//   試作で台本を確かめる : $env:QA_TARGET='mock'; node docs/amu/qa.mjs
//   アプリで確かめる     : $env:QA_TARGET='app'; $env:BASE_URL='http://127.0.0.1:4173/'; node docs/amu/qa.mjs
//   (本番やVercelのプレビューURLでもよい。新しいブラウザー環境で動き、端末のメモやクラウドには触れない)
//   段階を絞る           : $env:QA_PHASES='P1'      (既定は P1,P2,P3)
//   1項目だけ            : $env:QA_ONLY='P2-4'
//
// 測る大きさは、PCが1366×633(本人のChrome最大化の実寸)、スマホが375×667(iPhone SE)。
// アプリでは、一覧の「JSONを読み込む」で見本のメモ(試作と同じ19項目)を入れてから測る。
// 参考URLの題名取得(/api/link-preview)は台本の中で差し替え、外へは出ない。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {resolve, dirname, join} from 'node:path';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const {chromium} = createRequire(base)('playwright');
const TARGET = process.env.QA_TARGET === 'app' ? 'app' : 'mock';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(',').map((s) => s.trim()));
const ONLY = process.env.QA_ONLY || '';
const PC = {viewport: {width: 1366, height: 633}, locale: 'ja-JP', timezoneId: 'Asia/Tokyo'};
const SE = {viewport: {width: 375, height: 667}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo'};
const LIMIT = {pcControls: 30, pcFirstRowTop: 140, seHeader: 56, seFirstRowTop: 240, rowTools: 3, childShift: 12};
const MEMO_ID = '11111111-2222-4333-8444-555555555555';
const LABEL = {sentence: 'アウトライン', paragraph: '段落', word: '参考URL'};

/* ---------- 見本のメモ(試作の seed() と同じ中身) ---------- */
function seedBackup() {
  let n = 0, t = Date.parse('2026-10-18T09:00:00+09:00');
  const id = () => `a0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const rows = [];
  const add = (kind, content, extra = {}) => { const r = {id: id(), memo_id: MEMO_ID, user_id: null, kind, parent_id: null, content, heading: '', tag: null, note: '', link_url: '', satisfaction: 0, is_completed: false, sort_order: 0, created_at: new Date(t += 61000).toISOString(), updated_at: new Date(t).toISOString(), deleted_at: null, ...extra}; rows.push(r); return r; };
  const o1 = add('sentence', '目的', {sort_order: 0});
  add('sentence', '書き出した断片を、そのまま構成へ育てたい', {parent_id: o1.id, sort_order: 0});
  add('sentence', '調べたURLを、論点のすぐ横に置きたい', {parent_id: o1.id, sort_order: 1, note: '前回の取材で困った'});
  const o2 = add('sentence', '論点', {sort_order: 1});
  add('sentence', '3つの列は、書く順番と合っているか', {parent_id: o2.id, sort_order: 0, tag: '要検討'});
  const o22 = add('sentence', '段落はどこで書くのが自然か', {parent_id: o2.id, sort_order: 1});
  add('sentence', 'アウトラインの下で、そのまま書き下ろしたい', {parent_id: o22.id, sort_order: 0});
  add('sentence', '段落だけの画面も残したい', {parent_id: o22.id, sort_order: 1, tag: '要検討'});
  add('sentence', 'URLの題名が長いと列が詰まる', {parent_id: o2.id, sort_order: 2, is_completed: true});
  const o3 = add('sentence', '次にやること', {sort_order: 2});
  add('sentence', '試作を本番に重ねて撮る', {parent_id: o3.id, sort_order: 0});
  add('sentence', '移り変わりはView Transitionで', {parent_id: o3.id, sort_order: 1, link_url: 'https://developer.mozilla.org/ja/docs/Web/API/View_Transition_API'});
  add('sentence', 'スマホで片手のまま書けるか確かめる', {parent_id: o3.id, sort_order: 2});
  add('paragraph', 'アウトラインの行のすぐ下で書けると、骨組みを見ながら肉付けできる。段落だけを見る画面は、読み返すときに使う。', {heading: '段落はどこで書くのが自然か', sort_order: 0});
  add('paragraph', '最初は単語やURLを放り込むだけでよい。並べ替えるうちに論点が見えてきて、最後に段落として書き下ろす。順番が逆になっても構わないが、書き下ろす段階では手元に骨組みが見えていてほしい。', {heading: '書き出しの順番', sort_order: 1});
  add('paragraph', '3列を同時に見せると、どこに書けばよいか毎回迷う。迷う時間は短いが、書き始めの勢いを削ぐ。', {sort_order: 2, tag: '要検討'});
  add('word', 'Understanding Success Criterion 2.5.8: Target Size (Minimum) | WAI | W3C', {link_url: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum', note: 'タップ領域の根拠', sort_order: 3});
  add('word', 'View Transition API - Web API | MDN', {link_url: 'https://developer.mozilla.org/ja/docs/Web/API/View_Transition_API', sort_order: 2});
  add('word', 'Dynalist — Your Workflowy alternative', {link_url: 'https://dynalist.io/', sort_order: 1, tag: '要検討'});
  add('word', '情報の構造化と見出し設計について考える', {link_url: 'https://example.com/articles/2026/10/structure-and-headings?utm_source=x', sort_order: 0});
  const memo = {id: MEMO_ID, user_id: null, title: '10/18 日「kakidasの次の一手」', tag: '企画', created_at: '2026-10-18T00:00:00.000Z', updated_at: new Date(t).toISOString(), deleted_at: null};
  const dir = mkdtempSync(join(tmpdir(), 'amu-qa-'));
  const file = join(dir, 'seed.json');
  writeFileSync(file, JSON.stringify({version: 8, exported_at: new Date().toISOString(), memos: [memo], entries: rows}));
  return file;
}

/* ---------- 試作の配信(doctype付きの包みで出す) ---------- */
async function serveMock() {
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
    + readFileSync(resolve(here, 'mock.html'), 'utf8') + '</body></html>';
  const server = http.createServer((req, res) => { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close()};
}

/* ---------- 開く ---------- */
const VT_SPY = `(() => { window.__vtSpy = 0; const o = document.startViewTransition?.bind(document); if (o) document.startViewTransition = (cb) => { window.__vtSpy++; return o(cb); }; })();`;
let SEED_FILE = null;
async function openMemo(browser, url, device, {reduced = false} = {}) {
  const ctx = await browser.newContext({...device, ...(reduced ? {reducedMotion: 'reduce'} : {})});
  ctx.setDefaultTimeout(6000);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(url).origin}).catch(() => {});
  await ctx.route('**/api/link-preview**', (r) => r.fulfill({status: 200, contentType: 'application/json', body: '{"title":"Bullet list – WorkFlowy Help"}'}));
  await ctx.addInitScript(VT_SPY);
  const page = await ctx.newPage();
  if (TARGET === 'mock') {
    await page.goto(url); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto(url);
  } else {
    SEED_FILE ??= seedBackup();
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    await page.locator('input[type=file][accept*="json"]').setInputFiles(SEED_FILE);
    await page.getByText('バックアップを読み込みました').waitFor({timeout: 10000});
    await page.goto(new URL(`memos/${MEMO_ID}`, url).href, {waitUntil: 'domcontentloaded'});
  }
  await page.getByRole('treeitem').first().waitFor({state: 'attached', timeout: 10000}).catch(() => {});
  await page.waitForTimeout(400);
  return {ctx, page};
}
async function openNewMemo(browser, url, device) {
  const ctx = await browser.newContext(device); ctx.setDefaultTimeout(6000);
  const page = await ctx.newPage();
  if (TARGET === 'mock') { await page.goto(url + '?new'); }
  else { await page.goto(url, {waitUntil: 'domcontentloaded'}); await page.getByRole('button', {name: /新しいメモ/}).first().click(); await page.waitForURL(/\/memos\//); }
  await page.waitForTimeout(700);
  return {ctx, page};
}

/* ---------- 部品 ---------- */
const desk = (page) => page.getByRole('textbox', {name: '書く', exact: true});
const region = (page, kind) => page.getByRole('region', {name: LABEL[kind], exact: true});
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 行の文が「その文で始まる」行だけを選ぶ(「論点」が別の行の文中に含まれても取り違えない)
const row = (page, text) => page.getByRole('treeitem').filter({has: page.locator('.outline__content, .text, .edit', {hasText: new RegExp('^\\s*' + reEsc(text))})}).first();
const rowText = (r) => r.locator('.outline__content, .text').first();
const tab = (page, kind) => page.getByRole('tab', {name: new RegExp('^' + LABEL[kind])}).first();
const inRegion = async (page, kind, loc) => loc.evaluate((el, name) => { const r = [...document.querySelectorAll('section,[role=region]')].find((s) => { const id = s.getAttribute('aria-labelledby'); const h = id && document.getElementById(id); return (h?.textContent?.trim() === name) || s.getAttribute('aria-label') === name; }); return Boolean(r && r.contains(el)); }, LABEL[kind]);
const levels = (page) => page.getByRole('treeitem').evaluateAll((els) => els.map((e) => ({t: (e.querySelector('.outline__content,.text,textarea')?.textContent || e.querySelector('textarea')?.value || '').trim(), l: Number(e.getAttribute('aria-level')), sel: e.getAttribute('aria-selected') === 'true'})));
const VISIBLE = `(el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false; }
  return !el.closest('[aria-label="試作の操作"]'); }`;
const countControls = (page) => page.evaluate(`(() => { const vis = ${VISIBLE}; return [...document.querySelectorAll('button, select, input:not([type=hidden]), textarea, a[href], [role=tab]')].filter(vis).length; })()`);
const iconButtonsIn = (loc) => loc.evaluate((item, src) => { const vis = (0, eval)(src); return [...item.querySelectorAll('button, select, a[href]')].filter((b) => vis(b) && !b.matches('.twisty,.outline__twisty') && (b.textContent.trim().length <= 2 || b.tagName === 'SELECT')).length; }, VISIBLE);
async function poll(fn, ms = 4000) { const until = Date.now() + ms; let last; while (Date.now() < until) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 120)); } return last; }
async function typeLine(page, text, key = 'Enter') { const d = desk(page); await d.click(); await d.pressSequentially(text); await d.press(key); await page.waitForTimeout(250); }
async function pasteOnBody(page, text) {
  await page.evaluate((t) => { document.activeElement?.blur?.(); const dt = new DataTransfer(); dt.setData('text/plain', t); (document.activeElement || document.body).dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }, text);
  await page.waitForTimeout(400);
}
async function openMemoMenuItem(page, name) {
  await page.getByRole('button', {name: 'メモの操作'}).click();
  await page.getByRole('menuitem', {name, exact: true}).click();
}

/* ====================================================================
   受け入れ確認
   ==================================================================== */
const checks = [];
const check = (phase, id, title, fn) => checks.push({phase, id, title, fn});

/* ---------------- P1 守「揃える」 ---------------- */
check('P1', 'P1-1', '欄・棚・書き口の行き先が、アウトライン→段落→参考URLの順にそろう', async ({open}) => {
  const {ctx, page} = await open(PC);
  const xs = [];
  for (const k of ['sentence', 'paragraph', 'word']) xs.push(await region(page, k).evaluate((e) => e.getBoundingClientRect().x));
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'PCの欄の並び ' + xs.join(','));
  const radios = page.getByRole('radiogroup', {name: '置き先'});
  if (await radios.count()) {
    const names = await radios.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
    assert.deepEqual(names, ['アウトライン', '段落', '参考URL'], '書き口の置き先の並び');
  }
  await ctx.close();
  const sp = await open(SE);
  const tabs = await sp.page.getByRole('tab').evaluateAll((els) => els.map((e) => e.textContent.replace(/\d+/g, '').trim()));
  assert.deepEqual(tabs, ['アウトライン', '段落', '参考URL'], 'スマホの棚の並び');
  await sp.ctx.close();
});
check('P1', 'P1-2', '「メモをコピー」の文も、アウトライン→段落→参考URLの順', async ({open}) => {
  const {ctx, page} = await open(PC);
  await openMemoMenuItem(page, 'メモをコピー');
  const text = await poll(() => page.evaluate(() => navigator.clipboard.readText()).then((t) => (t.includes('##') ? t : null)));
  assert.equal(typeof text, 'string', 'クリップボードを読めない');
  const a = text.indexOf('## アウトライン'), p = text.indexOf('## 段落'), w = text.indexOf('## 参考URL');
  assert.ok(a >= 0 && p > a && w > p, `見出しの順 アウトライン${a} 段落${p} 参考URL${w}`);
  await ctx.close();
});
check('P1', 'P1-3', 'スマホで開くと、アウトラインの棚から始まる', async ({open}) => {
  const {ctx, page} = await open(SE);
  assert.equal(await tab(page, 'sentence').getAttribute('aria-selected'), 'true');
  await ctx.close();
});
check('P1', 'P1-4', 'スマホでも字下げが見える(子は親より12px以上右)', async ({open}) => {
  const {ctx, page} = await open(SE);
  await tab(page, 'sentence').click();
  const x = async (t) => rowText(row(page, t)).evaluate((e) => e.getBoundingClientRect().x);
  const p = await x('論点'), c = await x('段落はどこで書くのが自然か'), g = await x('段落だけの画面も残したい');
  assert.ok(c - p >= LIMIT.childShift && g - c >= LIMIT.childShift, `字下げ 親${p} 子${c} 孫${g}`);
  await ctx.close();
});
check('P1', 'P1-5', '完了を明示的に表示したとき打ち消し線または文字色で識別できる', async ({open}) => {
  const {ctx, page} = await open(PC);
  // アウトラインの完了済みは初期非表示になった。表示ボタンで復帰してから文字装飾を検証する。
  await page.getByRole('button',{name:'完了済み 1件を表示'}).click();
  const style = (t) => rowText(row(page, t)).evaluate((e) => { const s = getComputedStyle(e); return {c: s.color, d: s.textDecorationLine}; });
  const done = await style('URLの題名が長いと列が詰まる'), open1 = await style('論点');
  assert.ok(done.d.includes('line-through') || done.c !== open1.c, JSON.stringify({done, open1}));
  await ctx.close();
});
check('P1', 'P1-6', '新しいメモ:題を書いてEnterで、書き口へ移る(PC・スマホ)', async ({openNew}) => {
  for (const device of [PC, SE]) {
    const {ctx, page} = await openNew(device);
    const title = page.getByRole('textbox', {name: 'メモのタイトル'});
    await title.focus(); await page.keyboard.type('テスト'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.equal(focus, '書く', (device === SE ? 'スマホ' : 'PC') + 'でEnter後のフォーカス');
    await ctx.close();
  }
});
check('P1', 'P1-7', '段落を書くときの案内に「Enterで置く」と書かない', async ({open}) => {
  const {ctx, page} = await open(PC);
  await typeLine(page, '一行目', 'Shift+Enter');
  const ph = await desk(page).getAttribute('placeholder');
  assert.ok(!/(?<![+＋])Enterで置く/.test(ph || ''), '案内 ' + ph);   // 「Ctrl+Enterで置く」はよい
  await ctx.close();
});
check('P1', 'P1-8', 'スマホで別の棚へ置いても、今の棚にとどまり、置いた先を知らせる', async ({open}) => {
  const {ctx, page} = await open(SE);
  await tab(page, 'sentence').click();
  await desk(page).click(); await desk(page).fill('https://example.org/qa');
  await page.getByRole('button', {name: '置く', exact: true}).click(); await page.waitForTimeout(500);
  assert.equal(await tab(page, 'sentence').getAttribute('aria-selected'), 'true', '棚が移った');
  const said = await poll(() => page.getByRole('status').filter({hasText: '参考URL'}).count());
  assert.ok(said > 0, '置いた先の知らせがない');
  await ctx.close();
});
check('P1', 'P1-9', 'スマホの帯は1行(56px以下)で、最初の行が上から240px以内', async ({open}) => {
  const {ctx, page} = await open(SE);
  await tab(page, 'sentence').click();
  const h = await page.locator('.editor-header, .bar').first().evaluate((e) => e.getBoundingClientRect().height);
  const top = await page.getByRole('treeitem').first().evaluate((e) => e.getBoundingClientRect().top);
  assert.ok(h <= LIMIT.seHeader, '帯の高さ ' + h);
  assert.ok(top <= LIMIT.seFirstRowTop, '最初の行の上端 ' + top);
  await ctx.close();
});
check('P1', 'P1-10', '開いた親を選んでEnter・Enterで書くと、最初の子として、見えた場所に入る', async ({open}) => {
  const {ctx, page} = await open(PC);
  // P1(行の下書き)でもP2(次の一行)でも同じ手順:行を選ぶ→Enterで直す→Enterで次の行へ→書いてEnter
  await rowText(row(page, '段落はどこで書くのが自然か')).click(); await page.waitForTimeout(150);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.keyboard.type('親の真下に入る行'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
  const ls = await levels(page);
  const i = ls.findIndex((r) => r.t.startsWith('段落はどこで書くのが自然か'));
  assert.ok(ls[i + 1]?.t.startsWith('親の真下に入る行') && ls[i + 1].l === ls[i].l + 1, JSON.stringify(ls.slice(i, i + 3)));
  await ctx.close();
});
check('P1', 'P1-11', '項目の日時は、既定では出さない', async ({open}) => {
  const {ctx, page} = await open(PC);
  const shown = await page.evaluate(`(() => { const vis = ${VISIBLE}; return [...document.querySelectorAll('time, .time, .entry-item__created-at')].filter(vis).length; })()`);
  assert.equal(shown, 0, '見えている日時 ' + shown);
  await ctx.close();
});

/* ---------------- P2 破「そこで書く」 ---------------- */
check('P2', 'P2-1', '書き口はひとつ(「書く」の欄が1つだけ)', async ({open}) => {
  for (const device of [PC, SE]) { const {ctx, page} = await open(device); assert.equal(await desk(page).count(), 1, device === SE ? 'スマホ' : 'PC'); await ctx.close(); }
});
check('P2', 'P2-2', 'PCでは書き口がアウトラインの欄の中にあり、最初の行が上から140px以内', async ({open}) => {
  const {ctx, page} = await open(PC);
  assert.ok(await inRegion(page, 'sentence', desk(page)), '書き口がアウトラインの欄の外');
  const top = await page.getByRole('treeitem').first().evaluate((e) => e.getBoundingClientRect().top);
  assert.ok(top <= LIMIT.pcFirstRowTop, '最初の行の上端 ' + top);
  await ctx.close();
});
check('P2', 'P2-3', 'PCでは画面全体が動かず、欄ごとに流れる', async ({open}) => {
  const {ctx, page} = await open(PC);
  const m = await page.evaluate(() => ({h: document.documentElement.scrollHeight, inner: innerHeight}));
  assert.ok(m.h <= m.inner + 1, `ページの高さ ${m.h}/${m.inner}`);
  const scrolls = await region(page, 'sentence').evaluate((sec) => [...sec.querySelectorAll('*')].some((e) => /auto|scroll/.test(getComputedStyle(e).overflowY)));
  assert.ok(scrolls, 'アウトラインの欄に流れる箱がない');
  await ctx.close();
});
check('P2', 'P2-4', '書きながら組める:Enter・Tab・Shift+Tabで親子ができる', async ({open}) => {
  const {ctx, page} = await open(PC);
  await page.keyboard.press('Control+Shift+Digit1'); await page.waitForTimeout(200);
  const d = desk(page);
  await d.click(); await d.pressSequentially('親A'); await d.press('Enter');
  await d.press('Tab'); await d.pressSequentially('子B'); await d.press('Enter');
  await d.pressSequentially('子C'); await d.press('Enter');
  await d.press('Shift+Tab'); await d.pressSequentially('親D'); await d.press('Enter');
  await page.waitForTimeout(400);
  const ls = await levels(page); const at = (t) => ls.find((r) => r.t === t);
  const [A, B, C, D] = ['親A', '子B', '子C', '親D'].map(at);
  assert.ok(A && B && C && D, '行が見つからない ' + JSON.stringify(ls.slice(-6)));
  assert.ok(B.l === A.l + 1 && C.l === A.l + 1 && D.l === A.l, JSON.stringify({A, B, C, D}));
  const order = ls.map((r) => r.t); const iA = order.indexOf('親A');
  assert.deepEqual(order.slice(iA, iA + 4), ['親A', '子B', '子C', '親D'], '並び');
  await ctx.close();
});
check('P2', 'P2-5', '行を選ぶと、書き口がその行のすぐ下に来る', async ({open}) => {
  const {ctx, page} = await open(PC);
  const r = row(page, '書き出した断片を、そのまま構成へ育てたい');
  await rowText(r).click(); await page.waitForTimeout(200);
  const gap = await page.evaluate(([a, b]) => b.getBoundingClientRect().top - a.getBoundingClientRect().bottom, [await r.elementHandle(), await desk(page).elementHandle()]);
  assert.ok(gap >= -4 && gap <= 40, '行と書き口の間 ' + gap);
  await typeLine(page, '選んだ行の隣');
  const ls = await levels(page); const i = ls.findIndex((x) => x.t.startsWith('書き出した断片を'));
  assert.ok(ls[i + 1]?.t === '選んだ行の隣' && ls[i + 1].l === ls[i].l, JSON.stringify(ls.slice(i, i + 3)));
  await ctx.close();
});
check('P2', 'P2-6', '空の書き口で↑を押すと、上の行へ戻れる', async ({open}) => {
  const {ctx, page} = await open(PC);
  await rowText(row(page, '書き出した断片を、そのまま構成へ育てたい')).click(); await page.waitForTimeout(150);
  await desk(page).click(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(250);
  const f = await page.evaluate(() => ({role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent || ''}));
  assert.ok(f.role === 'treeitem' && f.text.includes('書き出した断片を'), JSON.stringify(f).slice(0, 120));
  await ctx.close();
});
check('P2', 'P2-7', 'アウトラインの書き口にURLを書くと、参考URLへ置かれ、アウトラインは増えない', async ({open}) => {
  const {ctx, page} = await open(PC);
  const before = await page.getByRole('treeitem').count();
  await typeLine(page, 'https://workflowy.com/help/bullets/');
  await page.waitForTimeout(800);
  assert.equal(await page.getByRole('treeitem').count(), before, 'アウトラインが増えた');
  assert.ok(await poll(() => region(page, 'word').getByText(/workflowy/i).count()), '参考URLに入っていない');
  await ctx.close();
});
check('P2', 'P2-8', 'Shift+Enterで書き口が段落の欄へ移り、Ctrl+Enterで段落に置かれる', async ({open}) => {
  const {ctx, page} = await open(PC);
  await typeLine(page, '段落にしたい一文', 'Shift+Enter');
  await page.waitForTimeout(500);
  assert.ok(await inRegion(page, 'paragraph', desk(page)), '書き口が段落の欄にない');
  assert.ok((await desk(page).inputValue()).startsWith('段落にしたい一文'), '文が消えた');
  await page.keyboard.type('二行目。'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(500);
  assert.ok(await region(page, 'paragraph').getByText('段落にしたい一文').count(), '段落に置かれていない');
  await ctx.close();
});
check('P2', 'P2-9', 'どこで貼っても、URLが参考URLに入る', async ({open}) => {
  const {ctx, page} = await open(PC);
  await pasteOnBody(page, 'https://dynalist.io/help');
  assert.ok(await poll(() => region(page, 'word').getByText(/dynalist\.io\/help|dynalist/).count().then((n) => n >= 2)), '貼ったURLが入っていない');
  await ctx.close();
});
check('P2', 'P2-10', 'Ctrl+Shift+1/2/3で、書き口がアウトライン・段落・参考URLの欄へ移る', async ({open}) => {
  const {ctx, page} = await open(PC);
  for (const [key, kind] of [['2', 'paragraph'], ['3', 'word'], ['1', 'sentence']]) {
    await page.keyboard.press('Control+Shift+Digit' + key); await page.waitForTimeout(300);
    assert.ok(await inRegion(page, kind, desk(page)), `Ctrl+Shift+${key} で ${LABEL[kind]} にない`);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '書く', `Ctrl+Shift+${key} でフォーカスがない`);
  }
  await ctx.close();
});
check('P2', 'P2-11', '段落を「下へ移す」で並べ替えられ、読み込み直しても残る', async ({open}) => {
  const {ctx, page} = await open(PC);
  const first = () => region(page, 'paragraph').locator('article, .entry-item').first().innerText();
  const before = await first();
  const card = region(page, 'paragraph').locator('article, .entry-item').first();
  await card.hover(); await card.getByRole('button', {name: '下へ移す'}).click(); await page.waitForTimeout(500);
  assert.notEqual(await first(), before, '並びが変わらない');
  await page.reload(); await page.waitForTimeout(800);
  assert.notEqual(await first(), before, '読み込み直すと戻った');
  await ctx.close();
});
check('P2', 'P2-12', '行の道具は、触れたときに3つまで(アウトライン・段落・参考URL)', async ({open}) => {
  const {ctx, page} = await open(PC);
  const r = row(page, '論点'); await r.hover(); await page.waitForTimeout(150);
  const n1 = await iconButtonsIn(r);
  const p = region(page, 'paragraph').locator('article, .entry-item').first(); await p.hover(); await page.waitForTimeout(150);
  const n2 = await iconButtonsIn(p);
  const w = region(page, 'word').locator('article, .entry-item').first(); await w.hover(); await page.waitForTimeout(150);
  const n3 = await iconButtonsIn(w);
  assert.ok(n1 <= LIMIT.rowTools && n2 <= LIMIT.rowTools && n3 <= LIMIT.rowTools, `道具の数 アウトライン${n1} 段落${n2} 参考URL${n3}`);
  await ctx.close();
});
check('P2', 'P2-13', '項目の詳細に、すべての操作がそろう(アウトラインの行)', async ({open}) => {
  const {ctx, page} = await open(PC);
  const r = row(page, '調べたURLを、論点のすぐ横に置きたい'); await r.hover();
  await r.getByRole('button', {name: '項目の詳細'}).click(); await page.waitForTimeout(250);
  const dlg = page.getByRole('dialog', {name: '項目の詳細'});
  // 「段落にする」はP3(P3-1)で確かめる。P2の詳細は「段落に複製」のままでよい
  for (const name of ['上げる', '下げる', '上へ', '下へ', /完了にする/, /気持ち・備考/, /リンク/, /タグ/, 'コピー', '新しいメモにする', '段落へ移動', '削除']) {
    assert.ok(await dlg.getByRole('button', {name}).count(), '詳細にない: ' + name);
  }
  assert.ok(await dlg.getByRole('group', {name: '評価'}).count(), '評価がない');
  await ctx.close();
});
check('P2', 'P2-14', 'スマホの字下げは2タップ(この項目の操作→下げる)で、シートは画面内', async ({open}) => {
  const {ctx, page} = await open(SE);
  await tab(page, 'sentence').click();
  const target = '調べたURLを、論点のすぐ横に置きたい';
  const lv = async () => (await levels(page)).find((x) => x.t.startsWith(target)).l;
  const before = await lv();
  await row(page, target).getByRole('button', {name: 'この項目の操作'}).click(); await page.waitForTimeout(300);
  const down = page.getByRole('dialog').getByRole('button', {name: '下げる', exact: true});
  const box = await down.boundingBox();
  assert.ok(box && box.y + box.height <= 667, '下げるが画面の外 ' + JSON.stringify(box));
  await down.click(); await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  assert.equal(await lv(), before + 1, '深さが変わらない');
  await ctx.close();
});
check('P2', 'P2-15', 'スマホの書き口の「字下げ」で、子として置ける', async ({open}) => {
  const {ctx, page} = await open(SE);
  await tab(page, 'sentence').click();
  await desk(page).click();
  await page.getByRole('button', {name: '字下げ', exact: true}).click();
  await desk(page).fill('子として置く行');
  await page.getByRole('button', {name: '置く', exact: true}).click(); await page.waitForTimeout(500);
  const ls = await levels(page); const me = ls.find((x) => x.t === '子として置く行');
  assert.ok(me && me.l === 2, JSON.stringify(me));
  await ctx.close();
});
check('P2', 'P2-16', 'PCの最初の画面で見える操作は30個以下(v0.7.1は36個)', async ({open}) => {
  const {ctx, page} = await open(PC);
  await page.mouse.move(1, 1);
  const n = await countControls(page);
  assert.ok(n <= LIMIT.pcControls, '操作の数 ' + n);
  await ctx.close();
});

/* ---------------- P3 離「編み上げる」 ---------------- */
async function growRow(page, text, body) {
  const r = row(page, text); await r.hover();
  await r.getByRole('button', {name: '段落にする'}).first().click(); await page.waitForTimeout(600);
  await desk(page).click(); await desk(page).pressSequentially(body); await desk(page).press('Control+Enter'); await page.waitForTimeout(500);
}
check('P3', 'P3-1', '「段落にする」で、行を見出しにした段落の書き口が開き、置くと結ばれる', async ({open}) => {
  const {ctx, page} = await open(PC);
  const X = '3つの列は、書く順番と合っているか';
  const r = row(page, X); await r.hover();
  await r.getByRole('button', {name: '段落にする'}).first().click(); await page.waitForTimeout(600);
  const heading = page.getByRole('textbox', {name: '段落の見出し'});
  assert.equal(await heading.inputValue(), X, '見出しに行の文が入っていない');
  assert.ok(await inRegion(page, 'paragraph', desk(page)), '書き口が段落の欄にない');
  await desk(page).click(); await desk(page).pressSequentially('列の順と書く順がずれると迷う。'); await desk(page).press('Control+Enter'); await page.waitForTimeout(500);
  assert.ok(await region(page, 'paragraph').getByText('列の順と書く順がずれると迷う。').count(), '段落がない');
  assert.ok(await row(page, X).getByRole('button', {name: '段落を開く'}).count(), '行に「段落を開く」がない');
  await ctx.close();
});
check('P3', 'P3-2', '結ばれた段落には行への印があり、押すとその行が選ばれる', async ({open}) => {
  const {ctx, page} = await open(PC);
  const X = '段落はどこで書くのが自然か';
  await region(page, 'paragraph').getByRole('button', {name: `アウトラインの「${X}」へ`}).click(); await page.waitForTimeout(300);
  assert.ok((await levels(page)).find((x) => x.t.startsWith(X))?.sel, '行が選ばれていない');
  await ctx.close();
});
check('P3', 'P3-3', '結ばれた行の文を直すと、段落の見出しも同じ文になる', async ({open}) => {
  const {ctx, page} = await open(PC);
  const X = '段落はどこで書くのが自然か', X2 = '段落はどこで書くのがいちばん自然か';
  const r = row(page, X); await rowText(r).click(); await r.press('Enter'); await page.waitForTimeout(200);
  const ed = page.getByRole('textbox', {name: 'アウトラインの本文を編集'}); await ed.fill(X2); await ed.press('Enter'); await page.waitForTimeout(500);
  assert.ok(await region(page, 'paragraph').getByText(X2, {exact: true}).count(), '段落の見出しが変わっていない');
  await ctx.close();
});
check('P3', 'P3-4', '参考URLの「アウトラインに引く」で、次の一行にリンク付きで入り、引用の印が付く', async ({open}) => {
  const {ctx, page} = await open(PC);
  const card = region(page, 'word').locator('article, .entry-item').filter({hasText: 'Dynalist'}).first();
  await card.hover(); await card.getByRole('button', {name: 'アウトラインに引く'}).click(); await page.waitForTimeout(700);
  const newRow = row(page, 'Dynalist');
  assert.ok(await newRow.count(), 'アウトラインに入っていない');
  assert.ok(await newRow.getByRole('link').count(), 'リンクが付いていない');
  assert.ok(await card.getByRole('button', {name: /^アウトラインで引用/}).count(), '引用の印がない');
  await ctx.close();
});
check('P3', 'P3-5', '清書では、結ばれた段落が行のすぐ後に編み込まれ、本文に重ねて出ない', async ({open}) => {
  const {ctx, page} = await open(PC);
  await page.getByRole('button', {name: '清書にする'}).click(); await page.waitForTimeout(800);
  const paper = page.getByRole('article', {name: '清書'});
  const r = await paper.evaluate((el) => {
    const secs = [...el.querySelectorAll('section')]; const find = (h) => secs.find((s) => s.querySelector('h2')?.textContent.replace(/\s/g, '') === h);
    const yoten = find('要点')?.innerText || '', honbun = find('本文')?.innerText || '';
    const body = 'アウトラインの行のすぐ下で書けると';
    return {inYoten: yoten.includes(body), inHonbun: honbun.includes(body), after: yoten.indexOf(body) > yoten.indexOf('段落はどこで書くのが自然か')};
  });
  assert.ok(r.inYoten && r.after && !r.inHonbun, JSON.stringify(r));
  await ctx.close();
});
check('P3', 'P3-6', '清書は要点・本文・参考の順(前回のP3-2を引き継ぐ)', async ({open}) => {
  const {ctx, page} = await open(PC);
  await page.getByRole('button', {name: '清書にする'}).click(); await page.waitForTimeout(800);
  const hs = await page.getByRole('article', {name: '清書'}).locator('h2').allInnerTexts();
  assert.deepEqual(hs.map((h) => h.replace(/\s/g, '')), ['要点', '本文', '参考']);
  await ctx.close();
});
check('P3', 'P3-7', '清書の切り替えと「段落にする」で移り変わりを使い、動きを減らす設定では使わない', async ({open}) => {
  for (const reduced of [false, true]) {
    const {ctx, page} = await open(PC, {reduced});
    const r = row(page, '試作を本番に重ねて撮る'); await r.hover(); await r.getByRole('button', {name: '段落にする'}).first().click(); await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: '清書にする'}).click(); await page.waitForTimeout(600);
    const n = await page.evaluate(() => window.__vtSpy || 0);
    if (reduced) assert.equal(n, 0, '動きを減らす設定で移り変わりを使った'); else assert.ok(n >= 2, '移り変わりの回数 ' + n);
    await ctx.close();
  }
});
check('P3', 'P3-8', 'アウトラインの書き口にURLを書くと、行き先(参考URLへ)が出る', async ({open}) => {
  const {ctx, page} = await open(PC);
  await desk(page).click(); await desk(page).fill('https://workflowy.com/help/bullets/'); await page.waitForTimeout(250);
  assert.ok(await page.getByText(/参考URLへ置きます/).first().isVisible(), '行き先が出ていない');
  await ctx.close();
});

/* ====================================================================
   実行
   ==================================================================== */
const mock = TARGET === 'mock' ? await serveMock() : null;
const URL0 = mock ? mock.url : (process.env.BASE_URL || 'http://127.0.0.1:4173/');
const browser = await chromium.launch({headless: true});
const results = [];
for (const c of checks) {
  if (!PHASES.has(c.phase) || (ONLY && c.id !== ONLY)) continue;
  const started = Date.now();
  try {
    await c.fn({open: (device, opts) => openMemo(browser, URL0, device, opts), openNew: (device) => openNewMemo(browser, URL0, device)});
    results.push({...c, ok: true}); console.log(`OK  ${c.id} ${c.title} (${Date.now() - started}ms)`);
  } catch (e) {
    results.push({...c, ok: false, error: String(e?.message || e).split('\n')[0].slice(0, 220)});
    console.log(`NG  ${c.id} ${c.title}\n    → ${String(e?.message || e).split('\n')[0].slice(0, 220)}`);
  }
}
await browser.close(); mock?.close();
const by = (p) => { const r = results.filter((x) => x.phase === p); return `${p} ${r.filter((x) => x.ok).length}/${r.length}`; };
console.log(`\n${TARGET === 'mock' ? '試作' : URL0}: ${['P1', 'P2', 'P3'].filter((p) => PHASES.has(p)).map(by).join('  ')}  計 ${results.filter((x) => x.ok).length}/${results.length}`);
if (results.some((x) => !x.ok)) process.exitCode = 1;
