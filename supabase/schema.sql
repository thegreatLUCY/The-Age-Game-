-- The Age Game - Supabase setup
-- Run this file in Supabase Dashboard -> SQL Editor.
-- After you sign in to the app once, replace YOUR_EMAIL@example.com near the
-- bottom with your own email and run that admin insert statement.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'age_game_object_source_type') then
    create type public.age_game_object_source_type as enum ('curated', 'community', 'imagined');
  end if;

  if not exists (select 1 from pg_type where typname = 'age_game_object_status') then
    create type public.age_game_object_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.objects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand text not null,
  category text not null,
  year_start integer not null check (year_start >= 1900 and year_start <= 2026),
  year_end integer not null check (year_end >= 1900 and year_end <= 2026 and year_end >= year_start),
  source_type public.age_game_object_source_type not null default 'community',
  image_url text,
  image_path text,
  image_type text not null default 'uploaded',
  difficulty text not null default 'community',
  tags text[] not null default '{}',
  reveal_text text,
  hints text[] not null default '{}',
  submitted_by uuid references auth.users(id) on delete set null,
  status public.age_game_object_status not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists objects_status_created_at_idx on public.objects (status, created_at desc);
create index if not exists objects_submitted_by_idx on public.objects (submitted_by);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists objects_touch_updated_at on public.objects;
create trigger objects_touch_updated_at
before update on public.objects
for each row
execute function public.touch_updated_at();

create or replace function public.is_age_game_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

grant execute on function public.is_age_game_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.objects enable row level security;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
on public.admin_users
for select
to authenticated
using (public.is_age_game_admin());

drop policy if exists "Anyone can read approved objects" on public.objects;
create policy "Anyone can read approved objects"
on public.objects
for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "Users can read own objects" on public.objects;
create policy "Users can read own objects"
on public.objects
for select
to authenticated
using (submitted_by = auth.uid());

drop policy if exists "Admins can read all objects" on public.objects;
create policy "Admins can read all objects"
on public.objects
for select
to authenticated
using (public.is_age_game_admin());

drop policy if exists "Users can insert pending objects" on public.objects;
create policy "Users can insert pending objects"
on public.objects
for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and status = 'pending'
);

drop policy if exists "Admins can insert objects" on public.objects;
create policy "Admins can insert objects"
on public.objects
for insert
to authenticated
with check (public.is_age_game_admin());

drop policy if exists "Users can update own pending objects" on public.objects;
create policy "Users can update own pending objects"
on public.objects
for update
to authenticated
using (
  submitted_by = auth.uid()
  and status = 'pending'
)
with check (
  submitted_by = auth.uid()
  and status = 'pending'
);

drop policy if exists "Admins can update objects" on public.objects;
create policy "Admins can update objects"
on public.objects
for update
to authenticated
using (public.is_age_game_admin())
with check (public.is_age_game_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'object-images',
  'object-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view object images" on storage.objects;
create policy "Anyone can view object images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'object-images');

drop policy if exists "Authenticated users can upload object images" on storage.objects;
create policy "Authenticated users can upload object images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'object-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own object images" on storage.objects;
create policy "Users can update own object images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'object-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'object-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Admins can manage object images" on storage.objects;
create policy "Admins can manage object images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'object-images'
  and public.is_age_game_admin()
)
with check (
  bucket_id = 'object-images'
  and public.is_age_game_admin()
);

-- Make yourself the admin after your account exists in Supabase Auth:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_EMAIL@example.com'
-- on conflict do nothing;
