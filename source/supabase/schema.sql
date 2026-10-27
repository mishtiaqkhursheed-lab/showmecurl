-- ShowMe: run this once in Supabase → SQL Editor.
-- Row Level Security is ON and there are NO policies, so browsers (anon / signed-in users)
-- cannot read or write these tables. Only the Vercel functions can, using the secret/service key.

create table if not exists public.admins (
  email      text primary key check (email = lower(email)),
  added_by   text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge (
  id         bigint generated always as identity primary key,
  name       text not null,
  text       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.admins       enable row level security;
alter table public.knowledge    enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.admins, public.knowledge, public.app_settings from anon, authenticated;
