-- Persistent TopGram Stars wallet with a one-time welcome grant.
-- Existing accounts are initialized with 0 Stars; only newly inserted TopGram
-- profiles receive the 5,000-Star welcome grant.

create schema if not exists private;

create table if not exists public.topgram_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stars bigint not null default 0 check (stars >= 0),
  welcome_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.topgram_wallets enable row level security;

revoke all on table public.topgram_wallets from anon, authenticated;
grant select on table public.topgram_wallets to authenticated;

drop policy if exists "Users can read their own TopGram wallet" on public.topgram_wallets;
create policy "Users can read their own TopGram wallet"
on public.topgram_wallets
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.topgram_wallets (user_id, stars)
select id, 0 from public.topgram_profiles
on conflict (user_id) do nothing;

create or replace function private.grant_topgram_welcome_stars()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.topgram_wallets (user_id, stars, welcome_granted_at)
  values (new.id, 5000, now())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.grant_topgram_welcome_stars() from public, anon, authenticated;

drop trigger if exists topgram_welcome_stars_after_profile_insert on public.topgram_profiles;
create trigger topgram_welcome_stars_after_profile_insert
after insert on public.topgram_profiles
for each row execute function private.grant_topgram_welcome_stars();
