# kakidas v0.5.6 — Entry created timestamps

## Added

- Every Word, Sentence, and Paragraph now displays its original creation timestamp.
- The timestamp remains visible while editing the item.
- Time is shown in the device's local timezone as `YYYY/MM/DD HH:MM`.

## Cloud import

- When a cloud memo is imported as a copy, entry `created_at` values are preserved instead of being reset to the import time.
- Existing hierarchy, sort order, and kind handling stay unchanged.

## Deployment

No Supabase schema, Google Cloud, or Vercel environment-variable changes are required.
