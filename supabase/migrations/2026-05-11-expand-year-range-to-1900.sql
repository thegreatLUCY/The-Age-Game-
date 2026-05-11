-- The Age Game migration: expand object year range from 1950-2026 to 1900-2026.
-- Run this in Supabase SQL Editor if you already ran the original schema.
--
-- Some Supabase/Postgres setups name inline check constraints differently
-- such as "objects_check", so this removes any check constraint on this table
-- that mentions year_start or year_end before adding the new named rule.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'objects'
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%year_start%'
        or pg_get_constraintdef(c.oid) ilike '%year_end%'
      )
  loop
    execute format('alter table public.objects drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.objects
add constraint objects_year_range_check
check (
  year_start >= 1900
  and year_start <= 2026
  and year_end >= 1900
  and year_end <= 2026
  and year_end >= year_start
);
