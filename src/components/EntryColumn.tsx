import { useEffect, useRef, useState } from "react";
import {
  EntryComposer,
  type EntryComposerHandle,
} from "./EntryComposer";
import { EntryItem } from "./EntryItem";
import {
  type EntryKind,
  type EntryTreeNode,
  ENTRY_KIND_GUIDE,
  ENTRY_KIND_LABEL,
  supportsHierarchy,
} from "../types/memo";

type EntryColumnProps = {
  kind: EntryKind;
  entries: EntryTreeNode[];
  isActiveOnMobile: boolean;
  disabled?: boolean;
  onCreate: (
    kind: EntryKind,
    content: string,
    parentId?: string | null,
  ) => Promise<unknown>;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
  onIndent: (entryId: string) => Promise<unknown>;
  onOutdent: (entryId: string) => Promise<unknown>;
  onMove: (entryId: string, direction: "up" | "down") => Promise<unknown>;
};

export function EntryColumn({
  kind,
  entries,
  isActiveOnMobile,
  disabled = false,
  onCreate,
  onUpdate,
  onDelete,
  onIndent,
  onOutdent,
  onMove,
}: EntryColumnProps) {
  const [parentId, setParentId] = useState<string | null>(null);
  const [structureEntryId, setStructureEntryId] = useState<string | null>(null);
  const composerRef = useRef<EntryComposerHandle | null>(null);
  const isHierarchical = supportsHierarchy(kind);

  const parentEntry = parentId
    ? entries.find((entry) => entry.id === parentId) ?? null
    : null;

  useEffect(() => {
    if (parentId && !parentEntry) {
      setParentId(null);
    }
  }, [parentEntry, parentId]);

  useEffect(() => {
    if (
      structureEntryId &&
      !entries.some((entry) => entry.id === structureEntryId)
    ) {
      setStructureEntryId(null);
    }
  }, [entries, structureEntryId]);

  const selectParent = (entryId: string) => {
    setParentId(entryId);
    setStructureEntryId(null);

    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleCreate = async (content: string) => {
    await onCreate(kind, content, isHierarchical ? parentId : null);
  };

  const handleDelete = async (entryId: string) => {
    await onDelete(entryId);

    if (parentId === entryId) {
      setParentId(null);
    }

    setStructureEntryId(null);
  };

  const runStructureAction = async (
    action: (entryId: string) => Promise<unknown>,
    entryId: string,
  ) => {
    await action(entryId);
    setStructureEntryId(null);
  };

  return (
    <section
      className={`entry-column ${isActiveOnMobile ? "entry-column--active" : ""}`}
      aria-labelledby={`${kind}-heading`}
    >
      <div className="entry-column__header">
        <div>
          <h2 id={`${kind}-heading`}>{ENTRY_KIND_LABEL[kind]}</h2>
          <p>{ENTRY_KIND_GUIDE[kind]}</p>
        </div>

        <span className="entry-column__count">{entries.length}</span>
      </div>

      {isHierarchical ? (
        <p className="entry-column__hierarchy-guide">
          <span>＋ 子を追加</span>でつなげる。<span>⋯</span>から順番と階層を動かせます。
        </p>
      ) : (
        <p className="entry-column__hierarchy-guide entry-column__hierarchy-guide--plain">
          長めに書く場所。Paragraphは階層をつけず、流れのまま置けます。
        </p>
      )}

      <EntryComposer
        ref={composerRef}
        kind={kind}
        disabled={disabled}
        targetLabel={isHierarchical ? parentEntry?.content ?? null : null}
        onClearTarget={() => setParentId(null)}
        onSubmit={handleCreate}
      />

      <div className="entry-list" aria-live="polite">
        {entries.length === 0 ? (
          <p className="entry-list__empty">まだ何も置かれていません。</p>
        ) : (
          entries.map((entry) => (
            <EntryItem
              key={entry.id}
              entry={entry}
              kind={kind}
              isStructureOpen={structureEntryId === entry.id}
              disabled={disabled}
              onToggleStructure={(entryId) =>
                setStructureEntryId((current) =>
                  current === entryId ? null : entryId,
                )
              }
              onAddChild={selectParent}
              onIndent={(entryId) => runStructureAction(onIndent, entryId)}
              onOutdent={(entryId) => runStructureAction(onOutdent, entryId)}
              onMove={(entryId, direction) =>
                runStructureAction(
                  (id) => onMove(id, direction),
                  entryId,
                )
              }
              onUpdate={onUpdate}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}
