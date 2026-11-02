import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("memo list menus share one native exclusivity group", () => {
  const page = load("src/pages/MemoListPage.tsx");
  const card = load("src/components/MemoCardMenu.tsx");
  const tag = load("src/components/MemoTagControl.tsx");
  assert.match(page, /name="kakidas-memo-list-menu"/);
  assert.match(card, /name="kakidas-memo-list-menu"/);
  assert.match(page, /event\.target\.closest\('details\[name="kakidas-memo-list-menu"\]'\)/);
  assert.match(page, /trigger\?\.focus\(\)/);
  assert.match(tag, /event\.stopPropagation\(\)/);
});

test("bulk selection reuses the existing list and respects visible filters", () => {
  const page = load("src/pages/MemoListPage.tsx");
  assert.match(page, /selectionMode !== "none"/);
  assert.match(page, /selectableMemos\.every/);
  assert.match(page, /group\.memos/);
  assert.match(page, /selectedMemoIds\.has/);
  assert.match(page, /deleteMemosBatch/);
  assert.match(page, /undoLastMemoDeletion/);
});

test("batch delete snapshots drafts and sync metadata atomically, then restores", () => {
  const db = load("src/lib/db.ts");
  const repo = load("src/repositories/memoRepository.ts");
  assert.match(db, /memoDeletionUndo: "memo_deletion_undo"/);
  assert.match(repo, /async deleteMemosBatch/);
  assert.match(repo, /async undoLastMemoDeletion/);
  assert.match(repo, /undoStore\.put\(batch\)/);
  assert.match(repo, /drafts: (?:drafts|EntryDraftRow\[\])/);
  assert.match(repo, /for \(const draft of batch\.drafts\) draftStore\.put\(draft\)/);
  assert.match(repo, /for \(const meta of batch\.sync_metas\) syncMetaStore\.put\(meta\)/);
});
