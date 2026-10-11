// 色トークン移行(f67abe5)で役割を取り違えた置き換えだけを、元の色から引き直す。
//
// 使い方(リポジトリ直下で):
//   node docs/togu/remap-colors.mjs            … 変更の一覧と件数を出す(書き換えない)
//   node docs/togu/remap-colors.mjs --write    … src/*.css を書き換える
//   node docs/togu/remap-colors.mjs --out=DIR  … 書き換えた写しをDIRへ出す(試作用)
//
// 根拠: `git diff fad9299 f67abe5` の各行で、元の色(-行)と置き換え後のトークン(+行)を順に対応づける。
// 直すのは「役割の取り違え」と分かる組み合わせだけ(白い面→罫線色、中立の線→朱、中立の面→朱の淡色、
// 白の半透明→墨の半透明、茶灰色の文字→朱)。それ以外の置き換えはそのまま残す。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = 'fad9299', HEAD = 'f67abe5';
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const OUT = (args.find(a => a.startsWith('--out=')) || '').slice(6);
const ROOT = process.cwd();
// 生きているCSS(main.tsxが読み込むもの)。トークン定義のファイルは対象外。
const FILES = ['styles.css', 'styles-paragraph-heading.css', 'styles-keyboard-shortcuts.css', 'styles-paragraph-title-tag.css',
  'styles-entry-tag-group-drag.css', 'styles-mobile-interaction-motion.css', 'styles-temporary-memo.css',
  'styles-temporary-memo-mobile-refine.css', 'styles-temporary-memo-instant.css', 'styles-memo-tag-prompt.css',
  'styles-entry-structure-actions.css', 'styles-completed-entry-danger.css', 'styles-memo-list-quiet.css',
  'styles-canonical-host.css', 'styles-reference-url.css', 'styles-workspace-fold.css', 'styles-shitate.css'];

/* ---------- 色の読み取りとOKLCH ---------- */
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/g;
function parseColor(s) {
  if (NAMED[s]) return NAMED[s];
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    const n = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2) || 'ff', 16));
    return [n[0], n[1], n[2], n[3] / 255];
  }
  const p = s.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
function oklch([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360 };
}

/* ---------- 役割 ---------- */
function roleOf(prop) {
  if (/^(color|caret-color|-webkit-text-fill-color)$/.test(prop) || /--[\w-]*(text|ink|fg|foreground)\b/.test(prop)) return 'text';
  if (/^(border|outline|column-rule|text-decoration)/.test(prop) || /--[\w-]*(border|line|rule|outline)/.test(prop)) return 'line';
  if (/^(background|fill)/.test(prop) || /--[\w-]*(background|bg|surface|wash|fill|paper)/.test(prop)) return 'fill';
  if (/shadow/.test(prop)) return 'shadow';
  return null;
}
const tokenOf = expr => (expr.match(/var\(--(color-[a-z0-9-]+)\)/) || [])[1];
const mix = (t, a) => (a >= 0.995 ? `var(--${t})` : `color-mix(in srgb,var(--${t}) ${Math.round(a * 100)}%,transparent)`);

// 元の色と役割から、本来のトークンを決める。直さない場合はnull。
function ideal(role, rgba, current) {
  const { L, C, h } = oklch(rgba);
  const a = rgba[3];
  const warm = h >= 15 && h <= 85;
  const neutral = C < 0.035;
  if (role === 'fill') {
    if (L >= 0.95 && (neutral || C < 0.03) && ['color-line', 'color-ink', 'color-shu-wash', 'color-line-strong'].includes(current))
      return L >= 0.985 || a < 0.995 ? mix('color-sheet', a) : mix('color-paper', a);
    if (neutral && L < 0.95 && L >= 0.86 && ['color-shu-wash', 'color-shu', 'color-ink'].includes(current)) return mix('color-line', a);
    if (!neutral && warm && C >= 0.03 && current === 'color-ink') return mix(L >= 0.9 ? 'color-shu-wash' : 'color-shu', a);
    return null;
  }
  if (role === 'line') {
    if (neutral && L >= 0.6 && ['color-shu', 'color-shu-wash', 'color-shu-ink'].includes(current)) return mix(L >= 0.86 ? 'color-line' : 'color-line-strong', a);
    if (L >= 0.95 && current === 'color-ink' && a < 0.995) return mix('color-sheet', a);
    return null;
  }
  if (role === 'text') {
    if (neutral && ['color-shu', 'color-shu-ink'].includes(current)) return mix(L < 0.4 ? 'color-ink' : L < 0.6 ? 'color-ink-2' : 'color-ink-3', a);
    if (L >= 0.95 && current === 'color-ink') return mix('color-sheet', a);
    return null;
  }
  if (role === 'shadow') {
    if (L >= 0.95 && current === 'color-ink') return mix('color-sheet', a);
    if (!neutral && warm && C >= 0.05 && current === 'color-ink') return mix('color-shu', a);
    return null;
  }
  return null;
}

/* ---------- 差分の対応づけ ---------- */
const diff = execFileSync('git', ['diff', '-U0', BASE, HEAD, '--', ...FILES.map(f => 'src/' + f)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const EXPR_RE = /color-mix\(in srgb,var\(--color-[a-z0-9-]+\) \d+%,transparent\)|var\(--color-[a-z0-9-]+\)/g;
const edits = new Map(); // file -> Map(lineNo -> {from, to})
const stats = new Map(); let skipped = 0;
let file = null, newLine = 0, minus = [], plus = [], lastProp = null;
function flush() {
  if (minus.length && minus.length === plus.length) {
    for (let i = 0; i < plus.length; i++) {
      const before = minus[i], after = plus[i].text;
      const pm = after.match(/^\s*(--[\w-]+|[a-z-]+)\s*:/);
      if (pm) lastProp = pm[1];
      const role = roleOf(lastProp || '');
      const cols = before.match(COLOR_RE) || [], exprs = after.match(EXPR_RE) || [];
      if (!role || !cols.length) continue;
      if (cols.length !== exprs.length) { skipped++; continue; }
      let k = 0, changed = false;
      const next = after.replace(EXPR_RE, expr => {
        const rgba = parseColor(cols[k++]); const cur = tokenOf(expr);
        const to = ideal(role, rgba, cur);
        if (!to || to === expr) return expr;
        changed = true;
        const key = `${role}: ${cur} → ${tokenOf(to)}`; stats.set(key, (stats.get(key) || 0) + 1);
        return to;
      });
      if (changed) {
        if (!edits.has(file)) edits.set(file, new Map());
        edits.get(file).set(plus[i].line, { from: after, to: next });
      }
    }
  } else if (minus.length || plus.length) skipped += Math.min(minus.length, plus.length);
  minus = []; plus = [];
}
for (const line of diff.split('\n')) {
  if (line.startsWith('diff --git')) { flush(); file = line.split(' b/')[1]; continue; }
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (hunk) { flush(); newLine = Number(hunk[1]); lastProp = null; continue; }
  if (line.startsWith('---') || line.startsWith('+++')) continue;
  if (line.startsWith('-')) minus.push(line.slice(1));
  else if (line.startsWith('+')) plus.push({ text: line.slice(1), line: newLine++ });
}
flush();

/* ---------- 出力 ---------- */
let total = 0;
for (const [f, m] of edits) {
  const path = join(ROOT, f);
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const [no, { from, to }] of m) {
    // Windowsの作業ツリーはCRLF(autocrlf)。行末の\rは比べずに残す。
    const cr = lines[no - 1]?.endsWith('\r') ? '\r' : '';
    if (lines[no - 1]?.replace(/\r$/, '') !== from) { console.error(`一致しない行を飛ばしました ${f}:${no}`); continue; }
    lines[no - 1] = to + cr; total++;
    if (!WRITE && !OUT) console.log(`${f}:${no}\n  - ${from.trim()}\n  + ${to.trim()}`);
  }
  if (WRITE) writeFileSync(path, lines.join('\n'));
  if (OUT) { const dest = resolve(OUT, f.replace(/^src\//, '')); mkdirSync(resolve(dest, '..'), { recursive: true }); writeFileSync(dest, lines.join('\n')); }
}
if (OUT) for (const f of FILES) { const dest = resolve(OUT, f); try { readFileSync(dest); } catch { writeFileSync(dest, readFileSync(join(ROOT, 'src', f), 'utf8')); } }
console.log('\n[直した組み合わせ]');
for (const [k, v] of [...stats].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
console.log(`\n合計 ${total} 行(対応づけできず飛ばした行 ${skipped})${WRITE ? ' を書き換えました' : OUT ? ` を ${OUT} へ出しました` : ''}`);
