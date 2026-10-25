import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// 追加のテスト依存ライブラリを使わず、実際にUIとDBが呼ぶ純粋関数を実行する。
const source = await readFile(new URL("../src/lib/draftRecovery.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isSupportedDraft, snapshotFromOutlineEntry, canUndoCreatedOutlineEntry } =
  await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("30日より古い下書きでもバージョン1なら表示対象として残す", () => {
  assert.equal(isSupportedDraft({version:1, expires_at:"2020-01-01T00:00:00Z"}), true);
  assert.equal(isSupportedDraft({version:1, expires_at:"invalid"}), true);
  assert.equal(isSupportedDraft({version:2, expires_at:"2099-01-01T00:00:00Z"}), false);
});

test("新規追加Undoで本文・タグ・備考・リンクを損失なく復元する", () => {
  const entry = {
    content: "競合の新技術", tag: "仮説", note: "出典を確認する",
    link_url: "https://example.org/study", has_children: false,
  };
  assert.deepEqual(snapshotFromOutlineEntry(entry), {
    content: "競合の新技術", heading: "", tag_value: "仮説",
    note_value: "出典を確認する", link_value: "https://example.org/study",
    tag_draft: "", note_draft: "", link_draft: "", active_meta_picker: null,
  });
  assert.equal(snapshotFromOutlineEntry({...entry,tag:null}).tag_value, "");
});

test("子項目のある行や別の書きかけをUndoで壊さない", () => {
  assert.equal(canUndoCreatedOutlineEntry(null, true).allowed, false);
  assert.equal(canUndoCreatedOutlineEntry({has_children:true}, true).allowed, false);
  assert.equal(canUndoCreatedOutlineEntry({has_children:false}, false).allowed, false);
  assert.deepEqual(canUndoCreatedOutlineEntry({has_children:false}, true), {
    allowed:true, reason:null,
  });
});

test("下書きRepositoryは期限切れのみを理由に削除しない", async () => {
  const repo = await readFile(new URL("../src/repositories/draftRepository.ts", import.meta.url), "utf8");
  assert.ok(!repo.includes("isEntryDraftExpired("));
  assert.ok(!repo.includes("expiredIds"));
  assert.match(repo, /\.filter\(isSupportedDraft\)/);
  assert.match(repo, /expires_at: NO_EXPIRY/);
  assert.match(repo, /async hasAnyDraft\(draftId\)/);
});

test("空メモ整理でも、旧下書きが一件あれば削除しない", async () => {
  const repo = await readFile(new URL("../src/repositories/memoRepository.ts", import.meta.url), "utf8");
  const start = repo.indexOf("async discardUntitledEmptyMemo(");
  assert.ok(start >= 0);
  const block = repo.slice(start, repo.indexOf("async createEntry(", start));
  assert.match(block, /const hasActiveDraft = drafts\.length > 0/);
  assert.match(block, /hasActiveEntry \|\| hasActiveDraft/);
  assert.ok(!block.includes("isEntryDraftExpired"));
});

test("新規追加Undoは復元を保存してから子のいない行だけ削除する", async () => {
  const page = await readFile(new URL("../src/pages/MemoEditorPage.tsx", import.meta.url), "utf8");
  const start = page.indexOf("const undoCreatedOutlineEntry =");
  assert.ok(start >= 0);
  const body = page.slice(start, page.indexOf("/** どこで貼っても", start));
  assert.match(body, /await draftRepository\.hasAnyDraft\(draftId\)/);
  const save = body.indexOf("await draftRepository.save(");
  const remove = body.indexOf("await deleteEntry(row.id, { requireLeaf: true })");
  assert.ok(save >= 0 && remove > save, "durable write must precede constrained delete");
  assert.match(body, /writer\.loadTransferredDraft\(snapshot\)/);
  const repo = await readFile(new URL("../src/repositories/memoRepository.ts", import.meta.url), "utf8");
  assert.match(repo, /if \(options\.requireLeaf && targetIds\.size !== 1\)/);
  assert.match(repo, /transaction\.abort\(\)/);
});
