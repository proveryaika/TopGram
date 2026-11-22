-- TopGram permanent Telegram-issued virtual identifiers.
-- These are app identifiers only, NOT routable phone numbers.
create table if not exists public.virtual_numbers (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  number_digits text not null unique
    check (number_digits ~ '^([17])[0-9]{10}$'),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  issued_at timestamptz not null default now()
);

create table if not exists public.login_challenges (
  id uuid primary key default gen_random_uuid(),
  virtual_number_id uuid not null references public.virtual_numbers(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_challenges_number_created_idx
  on public.login_challenges (virtual_number_id, created_at desc);

alter table public.virtual_numbers enable row level security;
alter table public.login_challenges enable row level security;

revoke all on public.virtual_numbers from anon, authenticated;
revoke all on public.login_challenges from anon, authenticated;

-- Only Edge Functions using the service-role key may access these tables.
