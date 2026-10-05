import { useRef } from "react";
import type { MemoTagSummary } from "../lib/memoTags";
import { MemoTagControl } from "./MemoTagControl";

type MemoCardCloudAction = {
  label: string;
  kind: "upload" | "update" | "clone";
};

type MemoCardMenuProps = {
  memoTitle: string;
  tag: string | null;
  suggestions: MemoTagSummary[];
  cloudAction: MemoCardCloudAction | null;
  isCloudActionBusy: boolean;
  isCopying: boolean;
  copyDisabled: boolean;
  includeCompletedInCopy: boolean;
  onPrimeCopy: () => void;
  onCopy: () => Promise<void>;
  onTagSave: (tag: string | null) => Promise<void>;
  onCloudAction: () => void;
  onDelete: () => void;
};

/**
 * 一覧カードでは本文を主役にし、整理操作は必要な時だけ開く。
 * タグ編集もこのメニュー内に置き、カードの高さを常時増やさない。
 */
export function MemoCardMenu({
  memoTitle,
  tag,
  suggestions,
  cloudAction,
  isCloudActionBusy,
  isCopying,
  copyDisabled,
  includeCompletedInCopy,
  onPrimeCopy,
  onCopy,
  onTagSave,
  onCloudAction,
  onDelete,
}: MemoCardMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const close = () => {
    detailsRef.current?.removeAttribute("open");
  };

  return (
    <details ref={detailsRef} className="memo-card-menu">
      <summary
        className="memo-card-menu__trigger"
        aria-label={`「${memoTitle}」の操作を開く`}
        title="その他の操作"
        onPointerEnter={onPrimeCopy}
        onPointerDown={onPrimeCopy}
        onFocus={onPrimeCopy}
      >
        <span aria-hidden="true">•••</span>
      </summary>

      <div className="memo-card-menu__panel">
        <button
          type="button"
          className="memo-card-menu__item"
          disabled={copyDisabled}
          onClick={() => {
            close();
            void onCopy();
          }}
        >
          <span aria-hidden="true">⧉</span>
          <span>
            {isCopying
              ? "コピー中…"
              : includeCompletedInCopy
                ? "完了済みも含めてコピー"
                : "コピー"}
          </span>
        </button>

        <div className="memo-card-menu__tag">
          <span className="memo-card-menu__section-label">タグ</span>
          <MemoTagControl
            tag={tag}
            suggestions={suggestions}
            onSave={async (nextTag) => {
              await onTagSave(nextTag);
              close();
            }}
          />
        </div>

        {cloudAction ? (
          <button
            type="button"
            className={`memo-card-menu__item memo-card-menu__item--cloud memo-card-menu__item--${cloudAction.kind}`}
            disabled={isCloudActionBusy}
            onClick={() => {
              close();
              onCloudAction();
            }}
          >
            <span aria-hidden="true">☁</span>
            <span>{cloudAction.label}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="memo-card-menu__item memo-card-menu__item--danger"
          onClick={() => {
            close();
            onDelete();
          }}
        >
          <span aria-hidden="true">×</span>
          <span>削除</span>
        </button>
      </div>
    </details>
  );
}
