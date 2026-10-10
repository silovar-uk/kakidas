# 「飾らずに、仕立てる」実装状況（2026-10-10）

## ソースコードに反映した内容

- **P1（守）**：入力後すぐに書き口を空ける、保存失敗時の内容復元、ホバー操作、スマホ操作シート、満足度0〜5、色と書体のトークン化、共通SVGアイコン。
- **P2（破）**：共通書き口、URL・改行による区分判定、キーボード操作、列・メモの操作メニュー、余白のヘッダー入口、旧下書きの移行、タイトル取得の共通処理。
- **P3（離）**：清書の見出し・紙面・落款・出力、検索パラメータによる遷移、View Transitionの共通処理、置くときの写しと新着朱線、Entry IDの事前割当。
- スキーマ、バックアップ、Supabaseのテーブル定義は変更していない。

## 検証の実績と制約

| 確認 | 結果 |
|---|---|
| TypeScriptの全 `src/**/*.ts(x)` のパース | 成功（構文エラー0件） |
| `git diff --check` | 最終確認後に再実行 |
| `npm ci` | 未成功。実行環境がregistry.npmjs.orgを名前解決できない |
| `npm run build` | 未成功。依存パッケージ未取得のため `@types/react` 等の型定義不足で停止 |
| `QA_TARGET=app`、ローカル29件 | 未実施。ビルド不可、配信できないため |
| 本番29件 | 未実施 |
| P1/P2/P3それぞれのPR・マージSHA | 未作成・未取得 |
| Vercel本番への反映 | 未実施 |
| iPhone実機・Windows書体・Supabaseログイン | 未確認 |

**判定：実装候補のソースであり、完成・本番受け入れ合格を保証しない。**

## 本番反映に必要な順序

1. `npm ci` → `npm run build` を実行し、型エラーを修正する。
2. `npm run preview -- --host 127.0.0.1 --port 4173` で配信し、Playwrightのある環境で `QA_TARGET=app BASE_URL=http://127.0.0.1:4173/ node docs/shitate/qa.mjs` を実行する。
3. 1366×633と375×667でUIを確認し、横はみ出しとiPhone Safariの入力・スクロールロックを検証する。
4. P1/P2/P3の変更をそれぞれ独立PRに分割し、各フェーズまでのQAを通す。CI成功後に段階ごとsquashマージする。
5. Vercel `kakidas-3gqw` のproductionが成功したことを確認し、`QA_TARGET=app BASE_URL=https://kakidas-3gqw.vercel.app/ node docs/shitate/qa.mjs` の29/29を必ず確認する。

受け入れ基準の数値は変更していない。
