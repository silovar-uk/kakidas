import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";

type CloudAccountDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function CloudAccountDialog({
  open,
  onClose,
}: CloudAccountDialogProps) {
  const { isConfigured, isLoading, user, error, signInWithGoogle, signOut } =
    useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const handleSignIn = async () => {
    setIsSubmitting(true);

    try {
      await signInWithGoogle();
    } catch {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);

    try {
      await signOut();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cloud-dialog" role="presentation">
      <button
        type="button"
        className="cloud-dialog__backdrop"
        onClick={onClose}
        aria-label="クラウド画面を閉じる"
      />

      <section
        ref={panelRef}
        className="cloud-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-dialog-title"
        tabIndex={-1}
      >
        <button
          type="button"
          className="icon-button cloud-dialog__close"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>

        {!isConfigured ? (
          <>
            <p className="cloud-dialog__eyebrow">CLOUD IS NOT SET UP</p>
            <h2 id="cloud-dialog-title">クラウド連携を準備中</h2>
            <p className="cloud-dialog__body">
              この端末のメモは、これまで通りブラウザ内に保存されています。
              クラウドへ送る機能は、Supabaseの接続設定後に使えるようになります。
            </p>
            <p className="cloud-dialog__note">
              設定後も、メモが自動で送信されることはありません。
            </p>
          </>
        ) : user ? (
          <>
            <p className="cloud-dialog__eyebrow">SIGNED IN</p>
            <h2 id="cloud-dialog-title">クラウド連携</h2>
            <div className="cloud-dialog__user">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span aria-hidden="true">●</span>
              )}
              <div>
                <strong>{user.display_name}</strong>
                <span>{user.email ?? "Googleアカウント"}</span>
              </div>
            </div>
            <p className="cloud-dialog__body">
              選んだメモだけをクラウドへ送れます。ローカル保存はそのまま残り、入力内容が自動送信されることはありません。
            </p>
            <button
              type="button"
              className="secondary-button cloud-dialog__signout"
              disabled={isSubmitting}
              onClick={() => void handleSignOut()}
            >
              ログアウト
            </button>
          </>
        ) : (
          <>
            <p className="cloud-dialog__eyebrow">OPTIONAL CLOUD</p>
            <h2 id="cloud-dialog-title">必要なメモだけ、他の端末へ。</h2>
            <p className="cloud-dialog__body">
              Googleでログインすると、選んだメモだけをクラウドへ送れます。
              この端末にあるメモが、ログインだけで送信されることはありません。
            </p>
            <ul className="cloud-dialog__list">
              <li>書く・保存する：いつも通りこの端末のブラウザ内</li>
              <li>送る：あなたが選んで確定したメモだけ</li>
              <li>取り込む：次の段階で追加予定</li>
            </ul>
            <button
              type="button"
              className="primary-button cloud-dialog__signin"
              disabled={isSubmitting || isLoading}
              onClick={() => void handleSignIn()}
            >
              <span aria-hidden="true">G</span>
              Googleでログイン
            </button>
          </>
        )}

        {error ? <p className="error-message cloud-dialog__error">{error}</p> : null}
      </section>
    </div>
  );
}
