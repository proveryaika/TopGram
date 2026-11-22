create table if not exists public.topgram_gifts (
  id uuid primary key default gen_random_uuid(),
  gift_key text not null,
  gift_name text not null,
  asset_key text not null,
  price_stars bigint not null check (price_stars > 0),
  total_supply bigint not null check (total_supply > 0),
  issued_count bigint not null default 0 check (issued_count >= 0 and issued_count <= total_supply),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists topgram_gifts_active_created_idx
  on public.topgram_gifts (is_active, created_at desc);

alter table public.topgram_gifts enable row level security;

drop policy if exists "Authenticated users can view active TopGram gifts" on public.topgram_gifts;
create policy "Authenticated users can view active TopGram gifts"
  on public.topgram_gifts
  for select
  to authenticated
  using (is_active = true);

revoke all on public.topgram_gifts from anon, authenticated;
grant select on public.topgram_gifts to authenticated;
