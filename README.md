# The Age Game

The Age Game is a web game about guessing when everyday objects were made. Instead of guessing a location, players read visual clues from artifacts, products, devices, packaging, vehicles, and cultural objects, then place them on a timeline.

## Live Demo

Coming soon: Netlify deployment URL will be added here.

## Screenshots

Screenshots will be captured from the deployed Netlify build once the live URL is available.

| Timeline Mode | Older / Newer | Submit an Object |
| --- | --- | --- |
| Coming soon | Coming soon | Coming soon |

## Game Modes

- **Timeline**: guess the year an object belongs to.
- **Older / Newer**: choose which of two objects is older.
- **Daily Artifact**: one deterministic object challenge per day.
- **Submit an Object**: signed-in users can upload objects for review.
- **Imagined Era**: optional mode for clearly labeled AI/imagination-based artifacts.

## Current Features

- Playable range from **1900 to 2026**.
- Supabase-backed shared object database.
- Supabase Storage image uploads.
- Admin approval flow for community submissions.
- User-submitted objects can include title, brand, category, year range, image, tags, and notes.
- Developer toggles for seed objects, hints, explanations, uploads, and AI mode.
- Responsive dark interface designed for artifact inspection.

## Tech Stack

- HTML, CSS, and vanilla JavaScript
- Supabase Postgres database
- Supabase Auth
- Supabase Storage
- Netlify-ready static deployment

## Local Development

Start a local preview server from the project folder:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/index.html
```

The local server is only for development. The production version will be served by Netlify.

## Supabase Setup

Supabase setup files live in `supabase/`.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Run any migration files in `supabase/migrations/`.
4. Copy the project URL and public anon key into `GAME_CONFIG.supabase` in `src/data.js`.
5. Make sure `enabled` is set to `true`.
6. Sign in once from the app.
7. Add your user to the admin table using the admin SQL section in `supabase/schema.sql`.

The Supabase anon key is safe to use in frontend code when Row Level Security is enabled. Never expose a Supabase service role key in this app.

## Deployment Notes

This is a static site, so Netlify can deploy it directly from the repository.

- **Build command**: none
- **Publish directory**: project root
- **Entry file**: `index.html`

After deployment, add the Netlify URL to Supabase Auth redirect settings so email sign-in works correctly on the live site.

## Project Direction

The long-term goal is for the game to use database-backed approved objects only. The current seed objects are temporary and can be disabled in `src/data.js` with:

```js
seedObjectsEnabled: false
```

Once enough approved objects exist in Supabase, the game can run entirely from the shared database.
