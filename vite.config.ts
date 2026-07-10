import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 既存データ形式を変えず、表示に関わる小さな統一だけをビルド前に適用する。
 * - 気持ちアイコンを、入力時に使っているレポート風アイコンへ統一
 * - 新規メモの日付タイトルを「m/d 曜「」」形式へ変更
 * - スマホで空のリンクボタンを押した時、クリップボード内容を確認用に仮入力
 * - スマホで項目を別区分へ移した時、表示も移動先タブへ切り替える
 */
function applyKakidasUiConsistency(): Plugin {
  return {
    name: "kakidas-ui-consistency",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replace(/\\/gu, "/");

      if (normalizedId.endsWith("/src/components/EntryItem.tsx")) {
        let nextSource = source
          .replace(
            '<path d="m4 16.7-.7 4 4-.7L18.7 8.6l-3.3-3.3L4 16.7Z" />',
            '<path d="M5.5 4.8h13v14.4H9.3l-3.8 2.4V4.8Z" />',
          )
          .replace(
            '<path d="m13.9 6.8 3.3 3.3" />',
            '<path d="M8.3 9h7.4M8.3 12.6h5.4" />',
          );

        nextSource = nextSource.replace(
          `  const [mobileParagraphEditorFocus, setMobileParagraphEditorFocus] = useState<
    MobileParagraphEditorFocus | null
  >(null);`,
          `  const [mobileParagraphEditorFocus, setMobileParagraphEditorFocus] = useState<
    MobileParagraphEditorFocus | null
  >(null);
  const [mobileParagraphInitialLink, setMobileParagraphInitialLink] = useState("");`,
        );

        nextSource = nextSource.replace(
          `  const beginLinkEdit = () => {
    if (disabled) return;
    if (openMobileParagraphEditor("link")) return;
    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(false);
    setShowLinkEditor(true);
    setLinkError(null);
    setEditMode("link");
  };`,
          `  const beginLinkEdit = () => {
    if (disabled) return;

    const isMobileViewport =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 920px)").matches;
    const canReadClipboard =
      isMobileViewport &&
      !entry.link_url.trim() &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.clipboard?.readText);

    if (usesMobileParagraphSheet()) {
      setMobileParagraphInitialLink("");
      setMobileParagraphEditorFocus("link");

      if (canReadClipboard) {
        void navigator.clipboard.readText()
          .then((clipboardText) => {
            const pastedLink = clipboardText.trim();
            if (pastedLink) setMobileParagraphInitialLink(pastedLink);
          })
          .catch(() => {
            // 権限がない場合も、空欄のリンク編集画面はそのまま使える。
          });
      }
      return;
    }

    setValue(entry.content);
    setHeadingValue(entry.heading);
    setNoteValue(entry.note);
    setLinkValue(entry.link_url);
    setShowNoteEditor(false);
    setShowLinkEditor(true);
    setLinkError(null);
    setEditMode("link");

    if (canReadClipboard) {
      void navigator.clipboard.readText()
        .then((clipboardText) => {
          const pastedLink = clipboardText.trim();
          if (pastedLink) setLinkValue(pastedLink);
        })
        .catch(() => {
          // 権限がない場合も、手入力へそのまま移れる。
        });
    }
  };`,
        );

        nextSource = nextSource.replace(
          `        initialFocus={mobileParagraphEditorFocus ?? "content"}
        disabled={disabled || isSaving}
        onClose={() => setMobileParagraphEditorFocus(null)}`,
          `        initialFocus={mobileParagraphEditorFocus ?? "content"}
        initialLinkValue={mobileParagraphInitialLink}
        disabled={disabled || isSaving}
        onClose={() => {
          setMobileParagraphEditorFocus(null);
          setMobileParagraphInitialLink("");
        }}`,
        );

        return nextSource === source ? null : nextSource;
      }

      if (normalizedId.endsWith("/src/components/MobileParagraphEditorSheet.tsx")) {
        let nextSource = source.replace(
          `  initialFocus: MobileParagraphEditorFocus;
  disabled?: boolean;`,
          `  initialFocus: MobileParagraphEditorFocus;
  /** リンク追加ボタンから読み取った、まだ保存していない確認用URL。 */
  initialLinkValue?: string;
  disabled?: boolean;`,
        );

        nextSource = nextSource.replace(
          `  initialFocus,
  disabled = false,`,
          `  initialFocus,
  initialLinkValue = "",
  disabled = false,`,
        );

        nextSource = nextSource.replace(
          `  const [linkUrl, setLinkUrl] = useState(() => entry?.link_url ?? "");`,
          `  const [linkUrl, setLinkUrl] = useState(
    () => entry?.link_url || initialLinkValue,
  );`,
        );

        nextSource = nextSource.replace(
          `    setLinkUrl(entry.link_url);`,
          `    setLinkUrl(entry.link_url || initialLinkValue);`,
        );

        nextSource = nextSource.replace(
          `  }, [entry?.id, entry?.content, entry?.heading, entry?.link_url, entry?.note, initialFocus]);`,
          `  }, [
    entry?.id,
    entry?.content,
    entry?.heading,
    entry?.link_url,
    entry?.note,
    initialFocus,
    initialLinkValue,
  ]);`,
        );

        return nextSource === source ? null : nextSource;
      }

      if (normalizedId.endsWith("/src/components/EntryComposer.tsx")) {
        const nextSource = source.replace(
          `                onClick={() => openMetaPicker("link")}
                aria-expanded={activeMetaPicker === "link"}`,
          `                onClick={() => {
                  const isOpening = activeMetaPicker !== "link";
                  openMetaPicker("link");

                  const canReadClipboard =
                    isOpening &&
                    !hasLink &&
                    typeof window !== "undefined" &&
                    window.matchMedia("(max-width: 920px)").matches &&
                    typeof navigator !== "undefined" &&
                    Boolean(navigator.clipboard?.readText);

                  if (canReadClipboard) {
                    void navigator.clipboard.readText()
                      .then((clipboardText) => {
                        const pastedLink = clipboardText.trim();
                        if (!pastedLink) return;
                        setLinkDraft(pastedLink);
                        setLinkError(null);
                      })
                      .catch(() => {
                        // 権限がない場合も、空欄を開いて手入力できる。
                      });
                  }
                }}
                aria-expanded={activeMetaPicker === "link"}`,
        );

        return nextSource === source ? null : nextSource;
      }

      if (normalizedId.endsWith("/src/pages/MemoEditorPage.tsx")) {
        let nextSource = source.replace(
          `  const handleComposerAutoFocusHandled = useCallback(() => {
    setShouldFocusNewMemoComposer(false);
  }, []);`,
          `  const handleComposerAutoFocusHandled = useCallback(() => {
    setShouldFocusNewMemoComposer(false);
  }, []);

  /** スマホでは移動した項目を追えるよう、保存成功後に移動先のタブを開く。 */
  const handleMoveEntryToKind = useCallback(
    async (entryId: string, targetKind: EntryKind): Promise<void> => {
      await moveEntryToKind(entryId, targetKind);

      if (
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 920px)").matches
      ) {
        setActiveKind(targetKind);
      }
    },
    [moveEntryToKind],
  );`,
        );

        nextSource = nextSource.replace(
          `            onMoveToKind={moveEntryToKind}`,
          `            onMoveToKind={handleMoveEntryToKind}`,
        );

        return nextSource === source ? null : nextSource;
      }

      if (normalizedId.endsWith("/src/types/memo.ts")) {
        const oldFormatter = `function formatMemoDatePrefix(date: Date): string {
  return \`${"${date.getMonth() + 1}/${date.getDate()}"}\`;
}`;
        const newFormatter = `const JAPANESE_WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function formatMemoDatePrefix(date: Date): string {
  const weekday = JAPANESE_WEEKDAY_LABELS[date.getDay()];
  return \`${"${date.getMonth() + 1}/${date.getDate()} ${weekday}"}\`;
}`;
        const nextSource = source.replace(oldFormatter, newFormatter);

        return nextSource === source ? null : nextSource;
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [applyKakidasUiConsistency(), react()],
});
