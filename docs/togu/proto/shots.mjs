// kakidasの撮影と見た目の実測(枠線・文字の大きさと太さ・色・角丸・影・入れ子)
// 使い方(PowerShell、リポジトリ直下で):
//   $env:PW_FROM='C:\Users\vediv\repos\quicklinks'; $env:OUT='<出力フォルダ>'; $env:BASE_URL='http://127.0.0.1:4173/'
//   node docs/togu/proto/shots.mjs            … PC 1366×633・スマホ375×667で主な画面を撮り、OUT/audit.json に実測を書く
//   $env:SHOT_TYPE='jpeg'                      … JPEGで撮る(比較ページ用)
//   試作を重ねる: PROTO_CSS / PROTO_PATCH_JS / PROTO_BUNDLE(qa.mjs と同じ)
// 新しいブラウザー環境で見本のメモを作るので、端末のメモやクラウドには触れない。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const { chromium } = createRequire(process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url)('playwright');
const URL0 = process.env.BASE_URL || 'https://kakidas-3gqw.vercel.app/';
const OUT = process.env.OUT;
mkdirSync(OUT, { recursive: true });
const PC = { width: 1366, height: 633 };
const SE = { width: 375, height: 667 };
const LABEL = { url: '参考URL', sentence: 'アウトライン', paragraph: '段落' };

const SAMPLE = {
  urls: ['https://www.nngroup.com/articles/progressive-disclosure/', 'https://developer.chrome.com/blog/view-transitions-in-2025', 'https://getdrafts.com/'],
  sentences: ['書き始める前に、置き場所を選ばせない', '操作は、触れようとしたときにだけ現れればいい', '保存中でも、次の一文を打てること', '清書したメモを、人に見せたくなるか？', '列ごとの表示設定は、ふだん目に入らなくていい', '日時の表示をそろえる'],
  paragraphs: [['なぜ書き口をひとつにするのか', '単語・文・段落という器は、書いたあとで整理するための棚です。書く瞬間に棚を選ばせると、手が止まります。'], ['清書が誇りになる', '散らかった作業台のまま、人にメモを見せることはありません。ひと押しで一枚に仕立て直せれば、メモそのものが成果物になります。']],
  done: '日時の表示をそろえる',
  title: '10/11 日「書く道具の仕立て直し」',
};

const desk = page => page.getByRole('textbox', { name: '書く', exact: true });
async function write(page, kind, text, { heading = '', tag = '', note = '' } = {}) {
  await page.getByRole('radio', { name: LABEL[kind], exact: true }).click();
  if (tag) {
    try {
      await page.getByRole('button', { name: 'タグを付ける', exact: true }).click();
      await page.getByRole('textbox', { name: '項目タグ', exact: true }).fill(tag);
      await page.getByRole('textbox', { name: '項目タグ' }).press('Enter');
    } catch (e) { console.log('tag失敗', e.message.split('\n')[0]); }
  }
  if (note) {
    try {
      await page.getByRole('button', { name: '気持ち・備考を付ける', exact: true }).click();
      await page.getByRole('textbox', { name: '気持ち・備考', exact: true }).fill(note);
      await page.locator('.entry-composer__meta-apply').first().click();
    } catch (e) { console.log('note失敗', e.message.split('\n')[0]); }
  }
  if (heading) await page.getByRole('textbox', { name: '段落タイトル', exact: true }).fill(heading);
  await desk(page).fill(text);
  await desk(page).press(kind === 'paragraph' ? 'Control+Enter' : 'Enter');
  await page.waitForTimeout(350);
}

const MEASURE = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
    }
    return true;
  };
  const transparent = c => /rgba\\(.*,\\s*0\\)$|transparent/.test(c);
  const tally = (o, k) => (o[k] = (o[k] || 0) + 1);
  const name = el => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '');
  };
  const els = [...document.querySelectorAll('body *')].filter(vis);
  const borderSides = {}, borderOwners = {}, radii = {}, shadows = {}, fs = {}, fw = {}, lh = {}, ls = {}, fam = {}, tc = {}, bg = {}, bc = {};
  let sideCount = 0;
  const framed = [];
  for (const el of els) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || /INPUT|TEXTAREA/.test(el.tagName);
    let sides = 0;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(s['border' + side + 'Width']);
      const st = s['border' + side + 'Style'];
      const col = s['border' + side + 'Color'];
      if (w > 0 && st !== 'none' && st !== 'hidden' && !transparent(col)) {
        sides++; sideCount++;
        tally(borderSides, w + 'px ' + st + ' ' + col);
        tally(bc, col);
      }
    }
    if (sides) tally(borderOwners, name(el) + ' (' + sides + '辺)');
    if (s.borderTopLeftRadius !== '0px') tally(radii, s.borderTopLeftRadius);
    if (s.boxShadow !== 'none') tally(shadows, s.boxShadow);
    if (!transparent(s.backgroundColor)) tally(bg, s.backgroundColor);
    if (s.backgroundImage !== 'none') tally(bg, 'IMG:' + s.backgroundImage.slice(0, 90));
    if (hasText) {
      tally(fs, s.fontSize); tally(fw, s.fontWeight); tally(lh, s.lineHeight); tally(ls, s.letterSpacing);
      tally(fam, s.fontFamily.split(',')[0]); tally(tc, s.color);
    }
    const boxed = (sides >= 3 || s.boxShadow !== 'none') && r.width >= 24 && r.height >= 24;
    if (boxed) framed.push(el);
  }
  // 枠の入れ子(枠のある要素の中にある、枠のある要素)
  const depthOf = el => { let d = 0; for (let n = el.parentElement; n; n = n.parentElement) if (framed.includes(n)) d++; return d; };
  const nest = framed.map(el => ({ el: name(el), depth: depthOf(el), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
  const sort = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
  return {
    viewport: [innerWidth, innerHeight],
    visibleElements: els.length,
    borderSideCount: sideCount,
    borderSides: sort(borderSides),
    borderOwners: sort(borderOwners),
    radii: sort(radii), shadows: sort(shadows),
    fontSizes: sort(fs), fontWeights: sort(fw), lineHeights: sort(lh), letterSpacings: sort(ls), fontFamilies: sort(fam),
    textColors: sort(tc), backgrounds: sort(bg), borderColors: sort(bc),
    framedCount: framed.length,
    maxNest: Math.max(0, ...nest.map(n => n.depth)),
    nested: nest.filter(n => n.depth >= 1),
  };
})()`;

const RECTS = `((sels) => Object.fromEntries(sels.map(sel => {
  const el = document.querySelector(sel); if (!el) return [sel, null];
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return [sel, { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pad: s.padding, margin: s.margin, border: s.borderTop + ' / ' + s.borderBottom, radius: s.borderRadius, bg: s.backgroundColor, shadow: s.boxShadow.slice(0, 80), font: s.fontSize + ' ' + s.fontWeight + ' / ' + s.lineHeight, ls: s.letterSpacing, color: s.color }];
})))`;

const ROOTVARS = `(() => { const out = {}; for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
  for (const r of rules) if (r.selectorText && /^:root/.test(r.selectorText)) for (const p of r.style) if (p.startsWith('--')) out[p] = r.style.getPropertyValue(p).trim(); } return out; })()`;

const results = {};
const JPEG = process.env.SHOT_TYPE === 'jpeg';
const shot = async (page, file, opts = {}) => page.screenshot({ path: resolve(OUT, JPEG ? file.replace(/\.png$/, '.jpg') : file), ...(JPEG ? { type: 'jpeg', quality: 82 } : {}), ...opts });

// 試作: 本番のCSSを組み立てたCSSへ差し替え、TSXの小さな変更をDOMへ当てる
const PROTO_CSS = process.env.PROTO_CSS ? (await import('node:fs')).readFileSync(process.env.PROTO_CSS, 'utf8') : null;
const PATCH_JS = process.env.PROTO_PATCH_JS ? (await import('node:fs')).readFileSync(process.env.PROTO_PATCH_JS, 'utf8') : null;
const PATCHED_BUNDLE = process.env.PROTO_BUNDLE ? (await import('node:fs')).readFileSync(process.env.PROTO_BUNDLE, 'utf8') : null;
async function prepare(context) {
  if (PROTO_CSS) await context.route(/\/assets\/[^/]+\.css(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: PROTO_CSS }));
  if (PATCHED_BUNDLE) await context.route(/\/assets\/index-[^/]+\.js(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: PATCHED_BUNDLE }));
  if (PATCH_JS) await context.addInitScript({ content: PATCH_JS });
}

async function seedMemo(page, rich) {
  await page.getByRole('button', { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  const title = page.getByRole('textbox', { name: 'メモのタイトル', exact: true });
  await title.waitFor({ state: 'visible' });
  await title.fill(SAMPLE.title);
  await title.press('Tab');
  if (!rich) return;
  for (const u of SAMPLE.urls) await write(page, 'url', u);
  for (const [i, s] of SAMPLE.sentences.entries()) await write(page, 'sentence', s, i === 1 ? { tag: '設計', note: 'あとで確認したい' } : i === 3 ? { tag: '設計' } : {});
  for (const [h, p] of SAMPLE.paragraphs) await write(page, 'paragraph', p, { heading: h });
  try {
    const done = page.getByRole('region', { name: 'アウトライン', exact: true }).locator('.outline__item-wrap').filter({ hasText: SAMPLE.done }).first();
    await done.hover();
    await done.getByRole('button', { name: /^完了(にする)?$/ }).first().click({ timeout: 4000 });
    await page.waitForTimeout(400);
  } catch (e) { console.log('完了失敗', e.message.split('\n')[0]); }
}

const browser = await chromium.launch({ headless: true });
try {
  // ---------- PC ----------
  {
    const context = await browser.newContext({ viewport: PC, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', permissions: ['clipboard-read', 'clipboard-write'] });
    context.setDefaultTimeout(8000);
    await context.route('**/api/link-preview**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'サイト名(差し替え)' }) }));
    await prepare(context);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL0, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await shot(page, 'pc-01-list-empty.png');
    results.pcListEmpty = await page.evaluate(MEASURE);
    results.rootVars = await page.evaluate(ROOTVARS);
    await seedMemo(page, true);
    await page.mouse.move(2, 2);
    await page.evaluate(() => (document.scrollingElement.scrollTop = 0));
    await page.waitForTimeout(500);
    await shot(page, 'pc-02-editor-top.png');
    await shot(page, 'pc-03-editor-full.png', { fullPage: true });
    results.pcEditor = await page.evaluate(MEASURE);
    results.pcEditorRects = await page.evaluate(RECTS + `(${JSON.stringify(['.editor-page', '.editor-header--shitate', '.back-link', '.memo-title-input', '.editor-header__seisho', '.editor-header__margin', '.memo-actions__trigger', '.entry-composer--desk', '.entry-composer__destinations', '.entry-composer__textarea', '.entry-composer__submit', '.entry-composer__meta-row', '.editor-grid', '.entry-column', '.entry-column__header', '.entry-column__header h2', '.entry-list', '.entry-item', '.entry-item__row', '.entry-item .e-text', '.entry-item p'])})`);
    // 列ごとの先頭行・行間
    results.pcRows = await page.evaluate(() => [...document.querySelectorAll('.entry-column')].map(col => ({
      col: col.getAttribute('aria-label'),
      x: Math.round(col.getBoundingClientRect().left), w: Math.round(col.getBoundingClientRect().width),
      colBorder: getComputedStyle(col).border, colBg: getComputedStyle(col).backgroundColor, colRadius: getComputedStyle(col).borderRadius, colShadow: getComputedStyle(col).boxShadow,
      rows: [...col.querySelectorAll('.entry-item')].slice(0, 4).map(r => { const b = r.getBoundingClientRect(); const s = getComputedStyle(r); return { y: Math.round(b.top), h: Math.round(b.height), pad: s.padding, border: s.borderBottom, bg: s.backgroundColor, radius: s.borderRadius, mb: s.marginBottom }; }),
    })));
    // 行にホバー
    const row = page.getByRole('region', { name: 'アウトライン', exact: true }).locator('.outline__item-wrap').filter({ hasText: SAMPLE.sentences[1] }).first();
    await row.hover(); await page.waitForTimeout(300);
    await shot(page, 'pc-04-row-hover.png');
    const rb = await row.boundingBox();
    if (rb) await shot(page, 'pc-04b-row-hover-zoom.png', { clip: { x: Math.max(0, rb.x - 20), y: Math.max(0, rb.y - 20), width: Math.min(560, rb.width + 40), height: rb.height + 60 } });
    await page.mouse.move(2, 2);
    // 書き口(段落に育てる)
    await desk(page).click();
    await page.keyboard.type('育つ一行目');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('二行目');
    await page.waitForTimeout(400);
    const db = await page.locator('.entry-composer--desk').boundingBox();
    await shot(page, 'pc-05-desk-paragraph.png', { clip: { x: 0, y: 0, width: 1366, height: Math.min(633, (db?.y || 0) + (db?.height || 200) + 60) } });
    results.pcDeskParagraph = await page.evaluate(RECTS + `(${JSON.stringify(['.entry-composer--desk', '.entry-composer__desk-heading--open input', '.entry-composer__textarea', '.entry-composer__hint', '.entry-composer__meta-row'])})`);
    await desk(page).fill('');
    await page.keyboard.press('Escape');
    // メモの操作
    await page.getByRole('button', { name: 'メモの操作', exact: true }).click(); await page.waitForTimeout(300);
    await shot(page, 'pc-06-memo-menu.png');
    results.pcMemoMenu = await page.evaluate(MEASURE);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // 列の操作
    try { await page.getByRole('button', { name: 'アウトラインの操作', exact: true }).click(); await page.waitForTimeout(300); await shot(page, 'pc-07-column-menu.png'); await page.keyboard.press('Escape'); } catch (e) { console.log('列メニュー失敗', e.message.split('\n')[0]); }
    // 余白
    try { await page.getByRole('button', { name: '余白を開く', exact: true }).click(); await page.waitForTimeout(500); await page.getByRole('textbox', { name: '余白に書く', exact: true }).fill('ここは余白。思いついたことを置いておく。\n二行目のメモ。'); await shot(page, 'pc-08-yohaku.png'); results.pcYohaku = await page.evaluate(MEASURE); await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch (e) { console.log('余白失敗', e.message.split('\n')[0]); }
    // 清書
    try {
      await page.getByRole('button', { name: '清書にする', exact: true }).click();
      await page.getByRole('article', { name: '清書', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(1200);
      await shot(page, 'pc-09-seisho.png');
      await shot(page, 'pc-10-seisho-full.png', { fullPage: true });
      results.pcSeisho = await page.evaluate(MEASURE);
      await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click();
      await page.waitForTimeout(600);
    } catch (e) { console.log('清書失敗', e.message.split('\n')[0]); }
    // 一覧に戻る
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
    await shot(page, 'pc-11-list.png');
    results.pcList = await page.evaluate(MEASURE);
    results.pcListRects = await page.evaluate(RECTS + `(${JSON.stringify(['header', 'h1', '.memo-list', '.memo-card', 'input[type=search]', '.memo-list-toolbar', 'footer', 'main'])})`);
    try { await page.goto(new URL('/tags', URL0).href, { waitUntil: 'networkidle' }); await page.waitForTimeout(500); await shot(page, 'pc-12-tags.png'); } catch {}
    results.pcErrors = errors;
    await context.close();
  }
  // ---------- スマホ ----------
  {
    const context = await browser.newContext({ viewport: SE, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    context.setDefaultTimeout(8000);
    await context.route('**/api/link-preview**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'サイト名(差し替え)' }) }));
    await prepare(context);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL0, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await shot(page, 'se-01-list-empty.png');
    await seedMemo(page, true);
    await page.evaluate(() => (document.scrollingElement.scrollTop = 0));
    for (const [kind, label] of Object.entries(LABEL)) {
      try { await page.getByRole('tab', { name: new RegExp('^' + label) }).first().click(); await page.waitForTimeout(400); await page.evaluate(() => (document.scrollingElement.scrollTop = 0)); await shot(page, `se-02-editor-${kind}.png`); } catch (e) { console.log('tab失敗', kind, e.message.split('\n')[0]); }
    }
    await page.getByRole('tab', { name: /^アウトライン/ }).first().click(); await page.waitForTimeout(300);
    await page.evaluate(() => (document.scrollingElement.scrollTop = 0));
    results.seEditor = await page.evaluate(MEASURE);
    results.seEditorRects = await page.evaluate(RECTS + `(${JSON.stringify(['.editor-header--shitate', '.editor-tabs', '.entry-composer--desk', '.entry-composer__textarea', '.entry-composer__submit', '.entry-column__header', '.entry-item', '.entry-item__structure-button'])})`);
    await shot(page, 'se-03-editor-full.png', { fullPage: true });
    try { await page.locator('.outline__item-wrap').filter({ hasText: SAMPLE.sentences[1] }).first().getByRole('button', { name: 'この項目の操作', exact: true }).click(); await page.waitForTimeout(500); await shot(page, 'se-04-action-sheet.png'); results.seSheet = await page.evaluate(MEASURE); await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch (e) { console.log('シート失敗', e.message.split('\n')[0]); }
    try { await page.getByRole('button', { name: 'メモの操作', exact: true }).click(); await page.waitForTimeout(400); await shot(page, 'se-05-memo-menu.png'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch (e) { console.log('メニュー失敗', e.message.split('\n')[0]); }
    try { const b = page.locator('.memo-actions__backdrop'); if (await b.count() && await b.isVisible()) await b.click(); } catch {}
    try { await page.getByRole('button', { name: '余白を開く', exact: true }).click(); await page.waitForTimeout(500); await shot(page, 'se-06-yohaku.png'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch (e) { console.log('余白失敗', e.message.split('\n')[0]); }
    try { await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600); await page.getByRole('button', { name: '清書にする', exact: true }).click(); await page.getByRole('article', { name: '清書', exact: true }).waitFor({ state: 'visible', timeout: 5000 }); await page.waitForTimeout(1200); await shot(page, 'se-07-seisho.png'); await shot(page, 'se-08-seisho-full.png', { fullPage: true }); } catch (e) { console.log('清書失敗', e.message.split('\n')[0]); }
    await page.goto(URL0, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    await shot(page, 'se-09-list.png');
    results.seErrors = errors;
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(resolve(OUT, 'audit.json'), JSON.stringify(results, null, 1));
console.log('done', Object.keys(results));
