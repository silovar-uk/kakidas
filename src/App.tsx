import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { MemoEditorPage } from "./pages/MemoEditorPage";
import { MemoListPage } from "./pages/MemoListPage";
import { TagManagerPage } from "./pages/TagManagerPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MemoListPage />} />
          <Route path="/tags" element={<TagManagerPage />} />
          <Route path="/memos/:memoId" element={<MemoEditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <KeyboardShortcuts />
      </BrowserRouter>
    </AuthProvider>
  );
}
