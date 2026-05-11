# Supabase Setup For The Age Game

Supabase is the shared backend for the hosted version of The Age Game.

It stores two kinds of data:

- `public.objects`: object metadata such as title, brand, category, year range, status, and image URL.
- `object-images`: image files uploaded by users.

## Setup Steps

1. Create a Supabase project named `The Age Game`.
2. Open `SQL Editor` in the Supabase dashboard.
3. Run `supabase/schema.sql`.
4. In the app, fill in `GAME_CONFIG.supabase.url` and `GAME_CONFIG.supabase.anonKey` in `src/data.js`.
5. Sign in once from the app using your email.
6. In Supabase SQL Editor, run the admin insert at the bottom of `schema.sql` with your email.

After that, submissions go into the database as `pending`, and your signed-in admin account can approve or reject them.
