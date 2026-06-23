# kakidas v0.5.5 — Mobile composer normal-flow fix

## Fixed

On mobile widths, the entry composer no longer uses `position: fixed`.

The previous fixed composer could grow (especially with Paragraph input), cover most of the viewport, and intercept touches meant for the memo list, tabs, copy, and delete controls.

## New behavior

- The composer remains in the normal document flow under the active section guide.
- The memo list and all surrounding controls remain tappable.
- Long Paragraph fields are constrained to an internal scroll area rather than expanding across the viewport.
- A final mobile-only CSS safeguard prevents future rules from turning the composer into a fixed overlay.

## Deployment

No Supabase, Google Cloud, or Vercel environment-variable changes are required.
Replace the project files in GitHub and redeploy through Vercel.
