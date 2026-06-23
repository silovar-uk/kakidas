# kakidas v0.5.7 — Entry timestamp visibility

## Added

- Added an `項目の日時を表示` switch in the memo editor.
- The switch controls whether created-at timestamps appear for all Word / Sentence / Paragraph entries.
- The default is on, preserving v0.5.6 behavior.

## Behavior

- The choice is stored only in the current browser with localStorage.
- It does not alter entry data, cloud uploads, or imported timestamps.
- When hidden, timestamps are removed from both the normal item view and the edit view.

## Deployment

No Supabase schema, Google Cloud, or Vercel environment-variable changes are required.
