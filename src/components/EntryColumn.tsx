import { EntryComposer } from "./EntryComposer";
import { EntryItem } from "./EntryItem";
import {
  type EntryKind,
  type EntryRow,
  ENTRY_KIND_GUIDE,
  ENTRY_KIND_LABEL,
} from "../types/memo";

type EntryColumnProps = {
  kind: EntryKind;
  entries: EntryRow[];
  isActiveOnMobile: boolean;
  disabled?: boolean;
  onCreate: (kind: EntryKind, content: string) => Promise<unknown>;
  onUpdate: (entryId: string, content: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<unknown>;
};

export function EntryColumn({
  kind,
  entries,
  isActiveOnMobile,
  disabled = false,
  onCreate,
  onUpdate,
  onDelete,
}: EntryColumnProps) {
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

      <EntryComposer
        kind={kind}
        disabled={disabled}
        onSubmit={(content) => onCreate(kind, content)}
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
              disabled={disabled}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}
