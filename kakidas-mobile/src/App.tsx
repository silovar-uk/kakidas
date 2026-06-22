import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MemoEditorPage } from "./pages/MemoEditorPage";
import { MemoListPage } from "./pages/MemoListPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MemoListPage />} />
        <Route path="/memos/:memoId" element={<MemoEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
