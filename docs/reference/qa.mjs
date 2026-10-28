// 参考URLワークスペースの受け入れ試験。IndexedDBは新規ブラウザコンテキストごとに隔離。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.PW_FROM ? pathToFileURL(resolve(process.env.PW_FROM) + '/').href : import.meta.url;
const { chromium } = createRequire(base)('playwright');
const url = process.env.BASE_URL || 'http://127.0.0.1:4173/';

async function createMemo(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  context.setDefaultTimeout(10000);
  await context.route('**/api/link-preview**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"title":"検証用URLタイトル"}',
  }));
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: /新しいメモ/ }).first().click();
  await page.waitForURL(/\/memos\//);
  if (width < 920) {
    await page.getByRole('tab', { name: /^参考URL/ }).click();
    await page.locator('.entry-column--word.entry-column--active').waitFor({state:'visible'});
  }
  await page.locator('.reference-workspace').waitFor();
  return { context, page, workspace: page.locator('.reference-workspace') };
}

async function addBatch(workspace) {
  await workspace.getByRole('button', { name: '＋ まとめて追加' }).click();
  await workspace.locator('.reference-workspace__import textarea').fill([
    'https://example.com/article-one?utm_source=test',
    'https://example.com/article-one',
    'https://example.org/article-two',
    'bad text input',
  ].join('\n'));
  const preview = workspace.locator('.reference-workspace__import');
  assert.match(await preview.innerText(), /新規\s*2件/);
  assert.match(await preview.innerText(), /重複\s*1件/);
  assert.match(await preview.innerText(), /無効\s*1件/);
  await preview.getByRole('button', { name: '2件を追加' }).click();
  await workspace.locator('.reference-workspace__item').nth(1).waitFor();
  assert.equal(await workspace.locator('.reference-workspace__item').count(), 2);
}

const browser = await chromium.launch({ headless: true });
try {
  {
    const { context, page, workspace } = await createMemo(browser, 1440);
    await addBatch(workspace);
    await workspace.locator('.reference-workspace__item').first().getByRole('button', { name: '見たと記録' }).click();
    await workspace.locator('.reference-workspace__item').first().getByRole('button', { name: '注目を付ける' }).click();
    await workspace.getByRole('button', { name: '★ 注目' }).click();
    assert.equal(await workspace.locator('.reference-workspace__item').count(), 1, '★だけの絞り込み');
    await page.reload();
    const reloaded = page.locator('.reference-workspace');
    await reloaded.getByRole('button', { name: '★ 注目' }).click();
    await reloaded.locator('.reference-workspace__item').first().waitFor();
    assert.equal(await reloaded.locator('.reference-workspace__item').count(), 1, '注目はIndexedDBへ保存');
    assert.match(await reloaded.locator('.reference-workspace__item').innerText(), /✓ 見た/, '見たも永続化');
    await reloaded.getByRole('button', { name: 'すべて' }).click();
    await reloaded.getByRole('button', { name: '選択', exact: true }).click();
    await reloaded.getByRole('button', { name: /表示中2件を選択/ }).click();
    assert.equal(await reloaded.locator('.reference-workspace__checkbox input:checked').count(), 2);
    page.once('dialog', dialog => void dialog.accept());
    await reloaded.locator('.reference-workspace__bottom-bar').getByRole('button', { name: '削除' }).click();
    await reloaded.locator('.reference-workspace__item').first().waitFor({ state: 'detached' });
    assert.equal(await reloaded.locator('.reference-workspace__item').count(), 0);
    await reloaded.getByRole('button', { name: '元に戻す' }).click();
    await reloaded.locator('.reference-workspace__item').nth(1).waitFor();
    assert.equal(await reloaded.locator('.reference-workspace__item').count(), 2, '全件復元');
    await reloaded.getByRole('button', { name: '未確認を読む' }).click();
    assert.match(await reloaded.locator('.reference-workspace__session').innerText(), /連続閲覧/);
    await page.reload();
    assert.equal(await page.locator('.reference-workspace__session').count(), 1, 'セッション再開');
    await page.locator('.reference-workspace__head').getByRole('button', { name: '調査を大きく表示' }).click();
    assert.equal(await page.locator('body > .reference-workspace--focused').count(), 1, '全画面表示');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.reference-workspace--focused').count(), 0, 'Escapeで戻れる');
    await context.close();
    console.log('OK desktop: add / duplicate / visited / star / select / delete / undo / session / focus');
  }
  {
    const { context, workspace } = await createMemo(browser, 375);
    await workspace.getByRole('button', { name: '＋ まとめて追加' }).click();
    await workspace.locator('.reference-workspace__import textarea').fill('https://example.net/mobile');
    await workspace.getByRole('button', { name: '1件を追加' }).click();
    await workspace.locator('.reference-workspace__item').first().waitFor();
    await workspace.getByRole('button', { name: '選択', exact: true }).click();
    await workspace.locator('.reference-workspace__checkbox input').check();
    assert.equal(await workspace.locator('.reference-workspace__bottom-bar').isVisible(), true);
    assert.equal(await workspace.locator('.reference-workspace__desktop-only').isVisible(), false, 'スマホでは複数タブボタンを隠す');
    await context.close();
    console.log('OK mobile: add / selection / toolbar / popup-safe UI');
  }
} finally { await browser.close(); }
