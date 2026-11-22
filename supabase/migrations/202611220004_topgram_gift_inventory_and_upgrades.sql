create table if not exists public.topgram_gift_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gift_id uuid not null references public.topgram_gifts(id) on delete restrict,
  attributes jsonb not null default '{"model":"Классическая","pattern":"Без узора","background":"Стандартный"}'::jsonb,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists topgram_gift_inventory_user_idx
  on public.topgram_gift_inventory(user_id, acquired_at desc);
alter table public.topgram_gift_inventory enable row level security;
drop policy if exists "Users can view own TopGram gift inventory" on public.topgram_gift_inventory;
create policy "Users can view own TopGram gift inventory"
  on public.topgram_gift_inventory for select to authenticated using (auth.uid() = user_id);
revoke all on public.topgram_gift_inventory from anon, authenticated;
grant select on public.topgram_gift_inventory to authenticated;

create or replace function public.topgram_purchase_gift(p_user_id uuid, p_gift_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.topgram_gifts%rowtype;
  w public.topgram_wallets%rowtype;
  inv public.topgram_gift_inventory%rowtype;
begin
  select * into g from public.topgram_gifts where id = p_gift_id and is_active = true for update;
  if not found then raise exception 'Подарок больше недоступен'; end if;
  if g.issued_count >= g.total_supply then raise exception 'Тираж закончился'; end if;
  update public.topgram_wallets set stars = stars - g.price_stars, updated_at = now()
    where user_id = p_user_id and stars >= g.price_stars returning * into w;
  if not found then raise exception 'Недостаточно звёзд'; end if;
  update public.topgram_gifts set issued_count = issued_count + 1 where id = p_gift_id;
  insert into public.topgram_gift_inventory(user_id, gift_id) values(p_user_id, p_gift_id) returning * into inv;
  return jsonb_build_object('inventory_id', inv.id, 'stars', w.stars, 'gift_name', g.gift_name);
end; $$;

create or replace function public.topgram_upgrade_gift(
  p_user_id uuid, p_inventory_id uuid, p_attribute text, p_value text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  upgrade_cost bigint;
  allowed boolean := false;
  w public.topgram_wallets%rowtype;
  inv public.topgram_gift_inventory%rowtype;
begin
  if p_attribute = 'model' then
    upgrade_cost := 120;
    allowed := p_value in ('Золотая','Сапфировая','Рубиновая','Кристальная');
  elsif p_attribute = 'pattern' then
    upgrade_cost := 60;
    allowed := p_value in ('Звёздный','Геометрия','Волны','Орнамент');
  elsif p_attribute = 'background' then
    upgrade_cost := 90;
    allowed := p_value in ('Ночное небо','Аметист','Изумруд','Закат');
  end if;
  if not allowed then raise exception 'Такой вариант улучшения недоступен'; end if;
  select * into inv from public.topgram_gift_inventory where id = p_inventory_id and user_id = p_user_id for update;
  if not found then raise exception 'Подарок не найден'; end if;
  update public.topgram_wallets set stars = stars - upgrade_cost, updated_at = now()
    where user_id = p_user_id and stars >= upgrade_cost returning * into w;
  if not found then raise exception 'Недостаточно звёзд'; end if;
  update public.topgram_gift_inventory
    set attributes = jsonb_set(attributes, array[p_attribute], to_jsonb(p_value), true), updated_at = now()
    where id = p_inventory_id returning * into inv;
  return jsonb_build_object('inventory_id', inv.id, 'attributes', inv.attributes, 'stars', w.stars, 'cost', upgrade_cost);
end; $$;

revoke all on function public.topgram_purchase_gift(uuid,uuid) from public, anon, authenticated;
revoke all on function public.topgram_upgrade_gift(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.topgram_purchase_gift(uuid,uuid) to service_role;
grant execute on function public.topgram_upgrade_gift(uuid,uuid,text,text) to service_role;
