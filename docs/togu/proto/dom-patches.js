// 試作専用:TSXで行う小さな変更を、描画のたびにDOMへ当てて見せる(本番のコードには入れない)
(() => {
  const icon = d => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const BACK = icon('<path d="m14 5-7 7 7 7"/>');
  const NOTE = icon('<path d="M5 4h14v15H9l-4 3z"/><path d="M8 9h8m-8 4h6"/>');
  const LINK = icon('<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2m3 3a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2"/>');
  const TAG = icon('<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8" cy="8" r="1"/>');
  const apply = () => {
    const back = document.querySelector('.editor-header--shitate .back-link');
    if (back && !back.dataset.toguPatched) { back.dataset.toguPatched = '1'; back.setAttribute('aria-label', 'メモ一覧へ戻る'); back.title = 'メモ一覧へ'; back.innerHTML = BACK; }
    const save = document.querySelector('.editor-header--shitate .save-status');
    if (save) { const s = /保存中/.test(save.textContent) ? 'wet' : 'dry'; if (save.dataset.state !== s) save.dataset.state = s; }
    for (const b of document.querySelectorAll('.mobile-action-sheet__panel > button[role="menuitem"]')) {
      if (b.dataset.toguPatched) continue; b.dataset.toguPatched = '1';
      const t = b.textContent; b.insertAdjacentHTML('afterbegin', /気持ち/.test(t) ? NOTE : /リンク/.test(t) ? LINK : TAG);
    }
    const clear = document.querySelector('.temporary-memo-panel__clear');
    if (clear && clear.textContent.trim() === '一時メモをクリア') clear.textContent = '余白を消す';
    const bd = document.querySelector('.temporary-memo-backdrop');
    if (bd && bd.getAttribute('aria-label') !== '余白を閉じる') bd.setAttribute('aria-label', '余白を閉じる');
  };
  new MutationObserver(apply).observe(document, { subtree: true, childList: true, characterData: true });
  document.addEventListener('DOMContentLoaded', apply);
})();
