import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetBodyScrollLock } from "./lib/bodyScrollLock";
import { closeDatabaseConnection } from "./lib/db";
import "./styles.css";
import "./styles-mobile-word-compact.css";
import "./styles-paragraph-heading.css";
import "./styles-keyboard-shortcuts.css";
import "./styles-paragraph-title-tag.css";
import "./styles-entry-tag-group-drag.css";
import "./styles-cloud-upload-header.css";
import "./styles-mobile-interaction-motion.css";

// 以前のオーバーレイが残したスクロール停止を、起動時に必ず初期化する。
resetBodyScrollLock();

// iPhone Safariでは、タブを切り替えただけでは pagehide が発火しない。
// 背景に回ったタブはDB接続だけを手放し、戻った時は次の読み書きで自動再接続する。
// これにより、別タブで起きるIndexedDBのアップグレードをブロックしにくくする。
const releaseDatabaseConnection = () => {
  closeDatabaseConnection();
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    releaseDatabaseConnection();
  }
});

// Safariの戻る／進むやタブ破棄でも、古い画面がメモDBを握り続けないようにする。
window.addEventListener("pagehide", releaseDatabaseConnection);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
