import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { CloudUploadHeaderButton } from "./components/CloudUploadHeaderButton";
import { EntryTagGroupDragOrder } from "./components/EntryTagGroupDragOrder";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { MemoListTagSort } from "./components/MemoListTagSort";
import { MobileInteractionMotion } from "./components/MobileInteractionMotion";
import { MobileNewMemoTitleFocus } from "./components/MobileNewMemoTitleFocus";
import { ParagraphTitleTagAssist } from "./components/ParagraphTitleTagAssist";
import { TemporaryMemoDock } from "./components/TemporaryMemoDock";
import { TemporaryMemoShortcut } from "./components/TemporaryMemoShortcut";
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
        <MemoListTagSort />
        <MobileNewMemoTitleFocus />
        <ParagraphTitleTagAssist />
        <EntryTagGroupDragOrder />
        <CloudUploadHeaderButton />
        <TemporaryMemoDock />
        <TemporaryMemoShortcut />
        <MobileInteractionMotion />
      </BrowserRouter>
    </AuthProvider>
  );
}
