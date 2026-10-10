// 受け入れ確認「飾らずに、仕立てる」(kakidasの守破離)
//
// 使い方(PowerShell):
//   $env:PW_FROM='C:\Users\vediv\repos\quicklinks'          # node_modules/playwright があるフォルダ
//   試作で台本を確かめる : $env:QA_TARGET='mock'; node docs/shitate/qa.mjs
//   アプリで確かめる     : $env:QA_TARGET='app'; $env:BASE_URL='http://127.0.0.1:4173/'; node docs/shitate/qa.mjs
//   (本番やVercelのプレビューURLでもよい。新しいブラウザー環境で動くので、端末のメモやクラウドには触れない)
//   段階を絞る           : $env:QA_PHASES='P1'      (既定は P1,P2,P3)
//
// 測る大きさは、PCが1366×633(本人のChrome最大化の実寸)、スマホが375×667(iPhone SE)。
// アプリでは「新しいメモ」から見本のメモを作ってから測る。参考URLのタイトル取得(/api/link-preview)は台本の中で差し替え、外へは出ない。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const { chromium } = createRequire(base)('playwright');

const TARGET = process.env.QA_TARGET === 'app' ? 'app' : 'mock';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(',').map(s => s.trim()));
const PC = { width: 1366, height: 633 };
const SE = { width: 375, height: 667 };
const LIMIT = {
  pcControls: 30,      // PCの最初の画面で見える操作部品(現行は見本が4件でも66)
  pcColors: 26,        // PCの最初の画面で使われている色の数(文字・背景・枠)
  pcFirstEntryTop: 300, // PCで最初の項目の上端(現行393)
  seDeskTop: 200,      // スマホで書き口の上端(現行の入力欄は502)
  seFirstEntryTop: 420, // スマホで最初の項目の上端(現行607)
  seRowControls: 2,    // スマホの1行に見える操作部品
  headerControls: 2,   // 列見出しに見える操作部品(折りたたみ・操作)
};
const LABEL = { url: '参考URL', sentence: '文', paragraph: '段落' };
const OLD_INPUT = { url: '参考URLを入力', sentence: '文を入力', paragraph: '段落を入力' };

/* ---------- 試作の配信(doctype付きの包みで出す) ---------- */
async function serveMock() {
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
    + readFileSync(resolve(here, 'mock.html'), 'utf8') + '</body></html>';
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

/* ---------- 見えているかどうか(画面内・非表示なし・透明でない) ---------- */
const VISIBLE_FN = `(el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
  }
  return !el.closest('[aria-label="試作の操作"]');
}`;
const countControls = page => page.evaluate(`(() => { const vis = ${VISIBLE_FN};
  return [...document.querySelectorAll('button, select, input:not([type=hidden]), textarea, a[href]')].filter(vis).length; })()`);
const countColors = page => page.evaluate(`(() => { const vis = ${VISIBLE_FN}; const set = new Set();
  for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const s = getComputedStyle(el);
    if (el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) set.add(s.color);
    if (!/rgba\\(.*,\\s*0\\)$|transparent/.test(s.backgroundColor)) set.add(s.backgroundColor);
    if (parseFloat(s.borderTopWidth) > 0 && !/rgba\\(.*,\\s*0\\)$/.test(s.borderTopColor)) set.add(s.borderTopColor); }
  return set.size; })()`);
const topOf = loc => loc.first().evaluate(el => Math.round(el.getBoundingClientRect().top));

/* ---------- 書く(書き口があれば書き口、なければ今の各列の入力欄) ---------- */
const deskOf = page => page.getByRole('textbox', { name: '書く', exact: true });
async function write(page, kind, text, { heading = '' } = {}) {
  const desk = deskOf(page);
  if (await desk.count()) {
    if (kind === 'paragraph') await page.getByRole('radio', { name: '段落', exact: true }).click();
    if (heading) await page.getByRole('textbox', { name: '段落タイトル', exact: true }).fill(heading);
    await desk.fill(text);
    await desk.press(kind === 'paragraph' ? 'Control+Enter' : 'Enter');
  } else {
    const tab = page.getByRole('tab', { name: new RegExp(`^${LABEL[kind]}`) }).first();
    if (await tab.count() && await tab.isVisible()) await tab.click();
    if (heading) await page.getByRole('textbox', { name: '段落タイトルを入力', exact: true }).first().fill(heading);
    const box = page.getByRole('textbox', { name: OLD_INPUT[kind], exact: true }).first();
    await box.fill(text);
    await box.press(kind === 'paragraph' ? 'Control+Enter' : 'Enter');
  }
  await page.waitForTimeout(350);
}
const column = (page, kind) => page.getByRole('region', { name: LABEL[kind], exact: true });
const rowsOf = (page, kind) => column(page, kind).locator('.entry-item');
const rowWith = (page, kind, text) => rowsOf(page, kind).filter({ hasText: text });

/* ---------- 見本のメモ(試作と同じ件数:参考URL3・文5+完了1・段落2) ---------- */
const SAMPLE = {
  urls: ['https://www.nngroup.com/articles/progressive-disclosure/', 'https://developer.chrome.com/blog/view-transitions-in-2025', 'https://getdrafts.com/'],
  sentences: ['書き始める前に、置き場所を選ばせない', '操作は、触れようとしたときにだけ現れればいい', '保存中でも、次の一文を打てること', '清書したメモを、人に見せたくなるか？', '列ごとの表示設定は、ふだん目に入らなくていい', '日時の表示をそろえる'],
  paragraphs: [['なぜ書き口をひとつにするのか', '単語・文・段落という器は、書いたあとで整理するための棚です。書く瞬間に棚を選ばせると、手が止まります。'], ['清書が誇りになる', '散らかった作業台のまま、人にメモを見せることはありません。ひと押しで一枚に仕立て直せれば、メモそのものが成果物になります。']],
  done: '日時の表示をそろえる',
  title: '10/9 金「書く道具の仕立て直し」',
  inner: '書く道具の仕立て直し',
};

async function open(browser, url, viewport, extra = {}, seed = viewport.width >= 920) {
  const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...extra });
  context.setDefaultTimeout(8000);
  await context.route('**/api/link-preview**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'QAで差し替えたタイトル' }) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (TARGET === 'app') {
    await page.getByRole('button', { name: /新しいメモ/ }).first().click();
    await page.waitForURL(/\/memos\//);
    const title = page.getByRole('textbox', { name: 'メモのタイトル', exact: true });
    await title.fill(SAMPLE.title);
    await title.press('Tab');
    if (seed) {
      for (const u of SAMPLE.urls) await write(page, 'url', u);
      for (const s of SAMPLE.sentences) await write(page, 'sentence', s);
      for (const [h, p] of SAMPLE.paragraphs) await write(page, 'paragraph', p, { heading: h });
      try {
        const done = rowWith(page, 'sentence', SAMPLE.done).first();
        await done.hover();
        await done.getByRole('button', { name: /^完了(にする)?$/ }).first().click({ timeout: 5000 });
        await page.waitForTimeout(400);
      } catch { /* 完了にできなくても測定は続ける(P3-3で分かる) */ }
    }
  } else {
    await page.locator('#grid .entry-item').first().waitFor({ state: 'attached' });
    await page.addStyleTag({ content: '[aria-label="試作の操作"]{display:none!important}' });
  }
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.scrollingElement.scrollTop = 0));
  await page.waitForTimeout(300);
  return { context, page, errors };
}

/* ---------- 確認項目 ---------- */
const checks = [];
const check = (phase, id, name, fn, only) => checks.push({ phase, id, name, fn, only });

// P1 守「飾らない」
check('P1', 'P1-1', '続けて打っても、打った文が消えない', async ({ pc }) => {
  const { page } = pc;
  const texts = ['連打の一', '連打の二', '連打の三', '連打の四'];
  const desk = deskOf(page);
  const box = (await desk.count()) ? desk : page.getByRole('textbox', { name: OLD_INPUT.sentence, exact: true }).first();
  await box.click();
  for (const t of texts) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(1500);
  for (const t of texts) {
    const got = await rowsOf(page, 'sentence').locator('.e-text, p, span').filter({ hasText: new RegExp(`^${t}$`) }).count();
    assert.ok(got >= 1, `「${t}」がそのまま文に置かれていない(字が消えたか、前の文とつながった)`);
  }
});
check('P1', 'P1-2', '保存中も入力欄を止めない(disabledにしない)', async ({ pc }) => {
  const { page } = pc;
  await page.evaluate(() => {
    window.__disabledSeen = 0;
    new MutationObserver(ms => { for (const m of ms) if (m.target.matches?.('input, textarea') && m.target.disabled) window.__disabledSeen++; })
      .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['disabled'] });
  });
  const desk = deskOf(page);
  const box = (await desk.count()) ? desk : page.getByRole('textbox', { name: OLD_INPUT.sentence, exact: true }).first();
  await box.fill('止めない確認');
  await box.press('Enter');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.__disabledSeen), 0, '保存中に入力欄がdisabledになった');
});
check('P1', 'P1-3', '行の操作は、触れたとき(ホバー・フォーカス)だけ見える', async ({ pc }) => {
  const { page } = pc;
  const row = rowWith(page, 'sentence', SAMPLE.sentences[0]).first();
  const actions = row.locator('[data-entry-actions]');
  assert.equal(await actions.count(), 1, '行の操作をまとめた要素に data-entry-actions がない');
  await page.mouse.move(2, 2); await page.waitForTimeout(250);
  const rest = await actions.evaluate(el => parseFloat(getComputedStyle(el).opacity));
  assert.ok(rest < 0.05, `触れていないのに操作が見えている(opacity ${rest})`);
  await row.hover(); await page.waitForTimeout(300);
  const hover = await actions.evaluate(el => parseFloat(getComputedStyle(el).opacity));
  assert.ok(hover > 0.95, `ホバーしても操作が見えない(opacity ${hover})`);
  await page.mouse.move(2, 2);
  await actions.locator('button').first().focus(); await page.waitForTimeout(300);
  const focus = await actions.evaluate(el => parseFloat(getComputedStyle(el).opacity));
  assert.ok(focus > 0.95, `キーボードで操作に入っても見えない(opacity ${focus})`);
});
check('P2', 'P2-9', `PCの最初の画面に見える操作部品は${LIMIT.pcControls}個まで`, async ({ pc }) => {
  const n = await countControls(pc.page);
  assert.ok(n <= LIMIT.pcControls, `${n}個見えている`);
});
check('P1', 'P1-4', `PCの最初の画面で使う色は${LIMIT.pcColors}色まで`, async ({ pc }) => {
  const n = await countColors(pc.page);
  assert.ok(n <= LIMIT.pcColors, `${n}色使っている`);
});
check('P2', 'P2-8', '削除のボタンを表に出さない(PC・スマホ)', async ({ pc, se }) => {
  for (const [where, page] of [['PC', pc.page], ['スマホ', se.page]]) {
    const n = await page.evaluate(`(() => { const vis = ${VISIBLE_FN}; return [...document.querySelectorAll('button')].filter(b => vis(b) && /削除/.test(b.textContent + (b.getAttribute('aria-label') || ''))).length; })()`);
    assert.equal(n, 0, `${where}で削除ボタンが${n}個見えている`);
  }
});
check('P1', 'P1-5', '和文の書体を先頭にし、題にはpaltを効かせる', async ({ pc }) => {
  const { page } = pc;
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const first = family.split(',')[0].replace(/["']/g, '').trim();
  assert.ok(/Hiragino|Noto Sans JP|BIZ UD/.test(first), `本文の書体の先頭が「${first}」`);
  const palt = await page.getByRole('textbox', { name: 'メモのタイトル', exact: true }).evaluate(el => getComputedStyle(el).fontFeatureSettings);
  assert.ok(/palt/.test(palt), `題のfont-feature-settingsが「${palt}」`);
});
check('P1', 'P1-6', 'スマホに「Alt+Q」などのキー表示を出さない', async ({ se }) => {
  const txt = await se.page.evaluate(() => document.body.innerText);
  assert.ok(!/Alt\s*[+＋]\s*Q/i.test(txt), 'スマホでAlt+Qが見えている');
});
check('P1', 'P1-7', `スマホの1行に見える操作は${LIMIT.seRowControls}個まで`, async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^文/ }).first().click();
  const row = rowsOf(page, 'sentence').filter({ hasText: SAMPLE.sentences[1] }).first();
  await row.scrollIntoViewIfNeeded();
  const n = await row.evaluate((row, src) => { const vis = eval(src); return [...row.querySelectorAll('button, select')].filter(vis).length; }, VISIBLE_FN);
  assert.ok(n <= LIMIT.seRowControls, `1行に${n}個見えている`);
});
check('P1', 'P1-8', 'スマホの「この項目の操作」に満足度・完了・気持ち・リンク・タグがそろう', async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^文/ }).first().click();
  const row = rowsOf(page, 'sentence').filter({ hasText: SAMPLE.sentences[1] }).first();
  await row.getByRole('button', { name: 'この項目の操作', exact: true }).click();
  for (const name of ['完了にする', '気持ち・備考を書く', 'リンクを付ける', 'タグを変える']) {
    assert.ok(await page.getByRole('menuitem', { name, exact: true }).or(page.getByRole('button', { name, exact: true })).first().isVisible(), `「${name}」がない`);
  }
  const sat = page.getByRole('group', { name: '満足度', exact: true });
  assert.equal(await sat.getByRole('button').count(), 6, '満足度の0〜5がない');
  await page.keyboard.press('Escape');
});

// P2 破「迷わない」
check('P2', 'P2-1', '書き口はひとつ(各列の入力欄はない)', async ({ pc }) => {
  const { page } = pc;
  assert.equal(await deskOf(page).count(), 1, '「書く」の入力欄がひとつではない');
  for (const name of Object.values(OLD_INPUT)) assert.equal(await page.getByRole('textbox', { name, exact: true }).count(), 0, `「${name}」が残っている`);
});
check('P2', 'P2-2', 'URLを書くと参考URLに置かれる', async ({ pc }) => {
  const { page } = pc;
  await deskOf(page).fill('https://www.nngroup.com/articles/ten-usability-heuristics/');
  assert.equal(await page.getByRole('radio', { name: '参考URL', exact: true }).getAttribute('aria-checked'), 'true', '置き先が参考URLにならない');
  await deskOf(page).press('Enter');
  await page.waitForTimeout(600);
  assert.ok(await rowsOf(page, 'url').filter({ hasText: /nngroup\.com|QAで差し替えたタイトル/ }).count() >= 2, '参考URLに置かれていない');
});
check('P2', 'P2-3', 'Shift+Enterで段落へ育ち、Ctrl+Enterで段落に置かれる', async ({ pc }) => {
  const { page } = pc;
  const desk = deskOf(page);
  await desk.click(); await desk.fill('');
  await page.keyboard.type('育つ一行目');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('二行目');
  assert.equal(await page.getByRole('radio', { name: '段落', exact: true }).getAttribute('aria-checked'), 'true', '置き先が段落にならない');
  assert.ok(await page.getByRole('textbox', { name: '段落タイトル', exact: true }).isVisible(), '段落タイトルの欄が出ない');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(600);
  assert.equal(await rowWith(page, 'paragraph', '育つ一行目').count(), 1, '段落に置かれていない');
});
check('P2', 'P2-4', 'ふつうに書いてEnterなら文に置かれる', async ({ pc }) => {
  const { page } = pc;
  await deskOf(page).fill('ふつうの一文');
  assert.equal(await page.getByRole('radio', { name: '文', exact: true }).getAttribute('aria-checked'), 'true', '置き先が文ではない');
  await deskOf(page).press('Enter');
  await page.waitForTimeout(600);
  assert.equal(await rowWith(page, 'sentence', 'ふつうの一文').count(), 1, '文に置かれていない');
});
check('P2', 'P2-5', 'Alt+1/2/3で置き先を選べる', async ({ pc }) => {
  const { page } = pc;
  await deskOf(page).click();
  for (const [key, name] of [['Alt+1', '参考URL'], ['Alt+3', '段落'], ['Alt+2', '文']]) {
    await page.keyboard.press(key);
    assert.equal(await page.getByRole('radio', { name, exact: true }).getAttribute('aria-checked'), 'true', `${key}で${name}にならない`);
  }
});
check('P2', 'P2-6', `列見出しに見える操作は${LIMIT.headerControls}個まで、設定は「…の操作」にまとまる`, async ({ pc }) => {
  const { page } = pc;
  for (const kind of ['url', 'sentence', 'paragraph']) {
    const col = column(page, kind);
    const n = await col.evaluate((col, src) => { const vis = eval(src); const top = col.querySelector('h2').getBoundingClientRect().top;
      return [...col.querySelectorAll('button, select')].filter(b => vis(b) && Math.abs(b.getBoundingClientRect().top - top) < 30).length; }, VISIBLE_FN);
    assert.ok(n <= LIMIT.headerControls, `${LABEL[kind]}の見出しに${n}個見えている`);
  }
  await page.getByRole('button', { name: '文の操作', exact: true }).click();
  for (const name of [/タグでまとめる/, /^畳む$/, /すべて削除/]) {
    assert.ok(await page.getByRole('menuitem', { name }).or(page.getByRole('menuitemcheckbox', { name })).first().isVisible(), `文の操作に${name}がない`);
  }
  await page.keyboard.press('Escape');
});
check('P2', 'P2-7', '上の帯の「メモの操作」に、クラウド・コピー・並び順・削除などがまとまる', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: 'メモの操作', exact: true }).click();
  for (const name of [/クラウドに保存/, /クラウドに合わせる/, /ChatGPT/, /メモをコピー/, /\.txt/, /ショートカット/, /メモを削除/]) {
    assert.ok(await page.getByRole('menuitem', { name }).first().isVisible(), `メモの操作に${name}がない`);
  }
  assert.equal(await page.getByRole('menuitemradio').count(), 3, '並び順の3つがない');
  await page.keyboard.press('Escape');
});
check('P2', 'P2-10', `PCで最初の項目の上端は${LIMIT.pcFirstEntryTop}px以内`, async ({ pc }) => {
  const top = Math.min(...await Promise.all(['url', 'sentence', 'paragraph'].map(k => topOf(rowsOf(pc.page, k)))));
  assert.ok(top <= LIMIT.pcFirstEntryTop, `最初の項目が${top}px`);
});
check('P2', 'P2-11', `スマホで書き口は${LIMIT.seDeskTop}px、最初の項目は${LIMIT.seFirstEntryTop}px以内`, async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^文/ }).first().click();
  await page.evaluate(() => (document.scrollingElement.scrollTop = 0));
  const d = await topOf(deskOf(page));
  const r = await topOf(rowsOf(page, 'sentence'));
  assert.ok(d <= LIMIT.seDeskTop, `書き口が${d}px`);
  assert.ok(r <= LIMIT.seFirstEntryTop, `最初の項目が${r}px`);
});
check('P2', 'P2-12', 'スマホで置くと、置いた棚のタブへ移る', async ({ se }) => {
  const { page } = se;
  await page.getByRole('tab', { name: /^文/ }).first().click();
  await deskOf(page).fill('スマホから段落へ');
  await page.getByRole('radio', { name: '段落', exact: true }).click();
  await page.getByRole('button', { name: '置く', exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole('tab', { name: /^段落/ }).first().getAttribute('aria-selected'), 'true', '段落のタブへ移らない');
  assert.equal(await rowWith(page, 'paragraph', 'スマホから段落へ').count(), 1, '段落に置かれていない');
});
check('P2', 'P2-13', '前の段落の下書きを、書き口が拾う', async ({ pc }) => {
  const { page } = pc;
  const memoId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
  await page.evaluate(async memoId => {
    const db = await new Promise((ok, ng) => { const r = indexedDB.open('kakidasu-db'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
    const now = new Date().toISOString();
    const row = { id: JSON.stringify([memoId, 'paragraph', 'main', null]), memo_id: memoId, kind: 'paragraph', scope: 'main', tag_key: null, fixed_tag: null,
      content: '前に書きかけた段落', heading: '書きかけ', tag_value: '', note_value: '', link_value: '', tag_draft: '', note_draft: '', link_draft: '', active_meta_picker: null,
      base_memo_updated_at: now, updated_at: now, expires_at: new Date(Date.now() + 864e5).toISOString(), version: 1 };
    await new Promise((ok, ng) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(row); tx.oncomplete = ok; tx.onerror = () => ng(tx.error); });
    db.close();
  }, memoId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert.equal(await deskOf(page).inputValue(), '前に書きかけた段落', '書き口に前の下書きが出ない');
  assert.equal(await page.getByRole('radio', { name: '段落', exact: true }).getAttribute('aria-checked'), 'true', '下書きの置き先が段落にならない');
}, 'app');
check('P2', 'P2-14', '余白は上の帯から開く', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '余白を開く', exact: true }).click();
  assert.ok(await page.getByRole('textbox', { name: '余白に書く', exact: true }).isVisible(), '余白の入力欄が出ない');
  await page.keyboard.press('Escape');
});

// P3 離「仕立てる」
async function toSeisho(page) {
  await page.getByRole('button', { name: '清書にする', exact: true }).click();
  const article = page.getByRole('article', { name: '清書', exact: true });
  await article.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(700);
  return article;
}
check('P3', 'P3-1', '清書にすると一枚の紙になり、URLで戻れる形になる', async ({ pc }) => {
  const { page } = pc;
  const article = await toSeisho(page);
  assert.ok(await article.getByRole('heading', { level: 1 }).isVisible(), '題(h1)がない');
  assert.ok(/view=seisho|#seisho/.test(page.url()), `URLに清書の印がない(${page.url()})`);
  assert.ok(await article.getByLabel('落款').isVisible(), '落款がない');
});
check('P3', 'P3-2', '清書は要点・本文・参考の順。題は「」の中身、日付は日付行へ', async ({ pc }) => {
  const { page } = pc;
  const article = page.getByRole('article', { name: '清書', exact: true });
  const h2 = await article.getByRole('heading', { level: 2 }).allTextContents();
  assert.deepEqual(h2.map(s => s.trim()), ['要点', '本文', '参考'], `見出しの順が${h2.join('・')}`);
  assert.equal((await article.getByRole('heading', { level: 1 }).textContent()).trim(), SAMPLE.inner, '題が「」の中身になっていない');
  assert.ok(/10月9日/.test(await article.innerText()), '日付行がない');
});
check('P3', 'P3-3', '完了した項目と満足度は清書に入れない', async ({ pc }) => {
  const { page } = pc;
  const t = await page.getByRole('article', { name: '清書', exact: true }).innerText();
  assert.ok(!t.includes(SAMPLE.done), '完了した項目が入っている');
  assert.ok(!/満足度/.test(t.replace(/満足度、/, '')), '満足度が入っている');
});
check('P3', 'P3-4', '書式つきでコピーすると、見出しつきのHTMLが入る', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '書式つきでコピー', exact: true }).click();
  await page.waitForTimeout(300);
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const it of items) if (it.types.includes('text/html')) return await (await it.getType('text/html')).text();
    return '';
  });
  assert.ok(/<h1[\s>]/i.test(html) && html.includes('要点'), 'クリップボードに見出しつきのHTMLがない');
});
check('P3', 'P3-5', '「書き口へ戻る」で作業台に戻る', async ({ pc }) => {
  const { page } = pc;
  await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok(await deskOf(page).isVisible(), '書き口に戻らない');
  assert.ok(!/view=seisho|#seisho/.test(page.url()), 'URLに清書の印が残っている');
});
check('P3', 'P3-6', '印刷では紙だけが出る', async ({ pc }) => {
  const { page } = pc;
  await toSeisho(page);
  await page.emulateMedia({ media: 'print' });
  const shown = await page.evaluate(() => {
    const d = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return { bar: d(document.querySelector('header')), paper: d(document.querySelector('[aria-label="清書"] h1')) };
  });
  await page.emulateMedia({ media: 'screen' });
  assert.ok(shown.paper && !shown.bar, `印刷で上の帯が出る、または紙が出ない(${JSON.stringify(shown)})`);
  await page.getByRole('button', { name: '書き口へ戻る', exact: true }).click();
});
check('P3', 'P3-7', '清書と置くときに移り変わりを使い、動きを減らす設定では使わない', async ({ browser, url }) => {
  for (const reduce of [false, true]) {
    const s = await open(browser, url, PC, { reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await s.page.evaluate(() => {
      window.__vt = 0;
      const orig = document.startViewTransition?.bind(document);
      if (orig) document.startViewTransition = (...a) => { window.__vt++; return orig(...a); };
    });
    await toSeisho(s.page);
    await s.page.getByRole('button', { name: '書き口へ戻る', exact: true }).click();
    await s.page.waitForTimeout(600);
    await write(s.page, 'sentence', '移り変わりの確認');
    const n = await s.page.evaluate(() => window.__vt);
    await s.context.close();
    if (reduce) assert.equal(n, 0, `動きを減らす設定でも移り変わりを${n}回使った`);
    else assert.ok(n >= 3, `移り変わりが${n}回(清書・戻る・置くで3回以上のはず)`);
  }
});

/* ---------- 実行 ---------- */
const results = [];
const mock = TARGET === 'mock' ? await serveMock() : null;
const url = mock ? mock.url : (process.env.BASE_URL || 'http://127.0.0.1:4173/');
const browser = await chromium.launch({ headless: true });
try {
  for (const phase of ['P1', 'P2', 'P3']) {
    if (!PHASES.has(phase)) continue;
    const list = checks.filter(c => c.phase === phase && (!c.only || c.only === TARGET));
    // 段階ごとにPCとスマホを1つずつ作り、順に使う(各確認は前の確認で増えた項目があっても通るように書いてある)
    const pc = await open(browser, url, PC, { permissions: ['clipboard-read', 'clipboard-write'] });
    const se = await open(browser, url, SE, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, true);
    for (const c of list) {
      try { await c.fn({ pc, se, browser, url }); results.push([c.id, 'ok', c.name]); }
      catch (e) { results.push([c.id, 'NG', c.name, e.message.split('\n')[0]]); }
      await pc.page.mouse.move(2, 2).catch(() => {});
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
  mock?.close();
}
const order = id => { const m = id.match(/^P(\d)-(\d+)/); return m ? m[1] * 100 + Number(m[2]) : Number(id[1]) * 100 + 99; };
results.sort((a, b) => order(a[0]) - order(b[0]));
const ok = results.filter(r => r[1] === 'ok').length;
console.log(`\n受け入れ確認「飾らずに、仕立てる」 対象: ${TARGET} ${url}`);
for (const r of results) console.log(`${r[1] === 'ok' ? '合格' : '不合格'}  ${r[0]}  ${r[2]}${r[3] ? `  …${r[3]}` : ''}`);
console.log(`\n${ok}/${results.length} 合格`);
process.exitCode = ok === results.length ? 0 : 1;
