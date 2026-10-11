// 試作専用:本番に重ねるCSSを組み立てる(実装では使わない)
//   既存のCSS(色の役割を直した写し)を @layer legacy に入れ、仕上げの層(styles-togu.css)を重ねる。
//
// 使い方(リポジトリ直下で):
//   node docs/togu/remap-colors.mjs --out=<写しのフォルダ>
//   node docs/togu/proto/compose.mjs <写しのフォルダ> <出力.css>
// 出力を qa.mjs / shots.mjs の PROTO_CSS に渡すと、本番の画面に重ねて測れる。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const [fixedDir, out] = process.argv.slice(2);
const ORDER = ['styles.css', 'styles-paragraph-heading.css', 'styles-keyboard-shortcuts.css', 'styles-paragraph-title-tag.css',
  'styles-entry-tag-group-drag.css', 'styles-mobile-interaction-motion.css', 'styles-temporary-memo.css',
  'styles-temporary-memo-mobile-refine.css', 'styles-temporary-memo-instant.css', 'styles-memo-tag-prompt.css',
  'styles-entry-structure-actions.css', 'styles-completed-entry-danger.css', 'styles-memo-list-quiet.css',
  'styles-canonical-host.css', 'styles-reference-url.css', 'styles-workspace-fold.css', 'styles-shitate.css'];
// 依頼書4.3で外す !important(一覧のカードの抜粋・種類・タグ)
const UNIMPORTANT = {
  'styles.css': [324, 325, 332, 333, 1927, 5006, 5008],
  'styles-memo-list-quiet.css': [322, 323, 342, 582],
  'styles-memo-tag-prompt.css': [5],
};
// トークンは本番(v0.6.0)で計算済みの値の写し。styles-tokens.css は読まない
const vars = JSON.parse(readFileSync(join(here, 'tokens-v0.6.0.json'), 'utf8'));
let legacy = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}\n';
for (const f of ORDER) {
  const lines = readFileSync(join(fixedDir, f), 'utf8').split('\n');
  for (const n of UNIMPORTANT[f] || []) lines[n - 1] = lines[n - 1].replace(/\s*!important/, '');
  legacy += `/* ${f} */\n` + lines.join('\n') + '\n';
}
const css = '@layer legacy, togu;\n@layer legacy {\n' + legacy + '\n}\n' + readFileSync(join(here, '..', 'styles-togu.css'), 'utf8');
writeFileSync(out, css);
console.log('組み立てた', (css.length / 1024).toFixed(0) + 'KB');
