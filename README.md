# The Age Game

The Age Game is a static prototype for an object-era guessing game.

## Modes

- Timeline: guess the year an object belongs to.
- Older / Newer: choose which of two objects is older.
- Daily Artifact: one deterministic daily challenge.
- Submit an Object: add a local community object with image and metadata.
- Imagined Era: play with clearly labeled imagined objects.

## Product Rules

- The playable date range is `1900` through `2026`.
- Objects store `yearStart` and `yearEnd`, so ranges are first-class.
- Starter/vector objects can be disabled with `GAME_CONFIG.seedObjectsEnabled`.
- Hints and reveal explanations are developer toggles in `src/data.js`.
- User submissions are saved locally until Supabase is configured.
- With Supabase configured, submissions are uploaded to Supabase Storage and saved in Postgres as `pending`.
- Admin users can approve or reject pending submissions from the app.

Open `index.html` in a browser to play.

## Supabase

Supabase setup files live in `supabase/`.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Copy your project URL and anon public key into `GAME_CONFIG.supabase` in `src/data.js`.
4. Set `enabled: true`.
5. Sign in once from the app.
6. Run the final admin insert in `supabase/schema.sql` using your email.

The anon key is safe to put in frontend code when Row Level Security is enabled. Never put the Supabase service role key in this app.
