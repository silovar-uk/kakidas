import { CANONICAL_APP_ORIGIN, isLegacyAppHost } from "../lib/appOrigin";

export function CanonicalHostNotice() {
  if (typeof window === "undefined" || !isLegacyAppHost(window.location.hostname)) {
    return null;
  }

  return (
    <aside className="canonical-host-notice" role="status" aria-live="polite">
      <div className="canonical-host-notice__body">
        <strong>このURLは旧環境です。</strong>
        <span>
          kakidasの正式URLは <code>kakidas-3gqw.vercel.app</code> です。
          ブラウザ保存はURLごとに分かれるため、自動転送はしていません。
        </span>
      </div>
      <a className="canonical-host-notice__link" href={CANONICAL_APP_ORIGIN}>
        正式版を開く
      </a>
    </aside>
  );
}
