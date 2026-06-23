import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetBodyScrollLock } from "./lib/bodyScrollLock";
import "./styles.css";

// 以前のオーバーレイが残したスクロール停止を、起動時に必ず初期化する。
resetBodyScrollLock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
