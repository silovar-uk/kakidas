// 旧台本(outline・shitate・togu・layout)が書き口の行き先を選ぶための共通の小さな関数。
// v0.8.0で置き先の3択(radio)をなくしたため、PCはCtrl+Shift+1/2/3、スマホは棚(tab)を押す。
export const LABEL = {sentence: 'アウトライン', paragraph: '段落', word: '参考URL', url: '参考URL'};
const KEY = {sentence: 'Control+Shift+1', paragraph: 'Control+Shift+2', word: 'Control+Shift+3', url: 'Control+Shift+3'};

export const isMobile = (page) => page.evaluate(() => matchMedia('(max-width: 920px)').matches);

/** 書き口の行き先を kind にする。PCはCtrl+Shift+数字、スマホは棚を押す。 */
export async function selectKind(page, kind) {
  if (await isMobile(page)) await page.getByRole('tab', {name: new RegExp('^' + LABEL[kind])}).click();
  else await page.keyboard.press(KEY[kind]);
  await page.getByRole('textbox', {name: '書く', exact: true}).waitFor();
}

export const region = (page, kind) => page.getByRole('region', {name: LABEL[kind], exact: true});

/** 書き口(「書く」の欄)がいま kind の欄の中にあるか。3択が残っている版ではその選択状態で見る。 */
export async function deskIsFor(page, kind) {
  const radios = page.getByRole('radiogroup', {name: '置き先'});
  if (await radios.count()) return (await radios.getByRole('radio', {name: LABEL[kind], exact: true}).getAttribute('aria-checked')) === 'true';
  return (await region(page, kind).getByRole('textbox', {name: '書く', exact: true}).count()) > 0;
}

/**
 * 打っている内容が kind の欄へ置かれる状態か。3択が残っている版では選択状態、
 * 書き口を運ぶ版では「→ 参考URLへ置きます」の予告か、書き口がその欄にいるかで見る。
 */
export async function routedTo(page, kind) {
  if (await page.getByRole('radiogroup', {name: '置き先'}).count()) return deskIsFor(page, kind);
  if (await page.getByText('→ ' + LABEL[kind] + 'へ置きます').first().isVisible().catch(() => false)) return true;
  return deskIsFor(page, kind);
}

/** 余白を開く。PCは帯のボタン、スマホは「メモの操作」の中から(v0.7.2で帯から移した)。 */
export async function openMargin(page) {
  if (await isMobile(page)) {
    await page.getByRole('button', {name: 'メモの操作', exact: true}).click();
    await page.getByRole('menuitem', {name: '余白を開く', exact: true}).click();
  } else await page.getByRole('button', {name: '余白を開く', exact: true}).click();
}
