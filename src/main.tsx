import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetBodyScrollLock } from "./lib/bodyScrollLock";
import { closeDatabaseConnection } from "./lib/db";
import "./styles.css";

// 以前のオーバーレイが残したスクロール停止を、起動時に必ず初期化する。
resetBodyScrollLock();

// Safariの戻る／進むで古い画面がメモDBを握り続けないよう、画面を離れる時は接続を閉じる。
window.addEventListener("pagehide", closeDatabaseConnection);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
