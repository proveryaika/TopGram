create or replace function public.topgram_upgrade_gift_bundle(
  p_user_id uuid,
  p_inventory_id uuid,
  p_attributes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.topgram_gift_inventory%rowtype;
  v_wallet public.topgram_wallets%rowtype;
  v_cost bigint := 0;
  v_old jsonb;
begin
  if p_attributes is null
     or not (p_attributes ? 'model' and p_attributes ? 'pattern' and p_attributes ? 'background') then
    raise exception 'Нужно выбрать модель, узор и фон';
  end if;
  if p_attributes->>'model' not in ('Золотая','Сапфировая','Рубиновая','Кристальная') then
    raise exception 'Недопустимая модель';
  end if;
  if p_attributes->>'pattern' not in ('Звёздный','Геометрия','Волны','Орнамент') then
    raise exception 'Недопустимый узор';
  end if;
  if p_attributes->>'background' not in ('Ночное небо','Аметист','Изумруд','Закат') then
    raise exception 'Недопустимый фон';
  end if;

  select * into v_item
  from public.topgram_gift_inventory
  where id = p_inventory_id and user_id = p_user_id
  for update;
  if not found then raise exception 'Подарок не найден'; end if;
  v_old := coalesce(v_item.attributes, '{}'::jsonb);

  if v_old->>'model' is distinct from p_attributes->>'model' then v_cost := v_cost + 120; end if;
  if v_old->>'pattern' is distinct from p_attributes->>'pattern' then v_cost := v_cost + 60; end if;
  if v_old->>'background' is distinct from p_attributes->>'background' then v_cost := v_cost + 90; end if;
  if v_cost = 0 then raise exception 'Выбранные характеристики уже установлены'; end if;

  update public.topgram_wallets
  set stars = stars - v_cost, updated_at = now()
  where user_id = p_user_id and stars >= v_cost
  returning * into v_wallet;
  if not found then raise exception 'Недостаточно звёзд'; end if;

  update public.topgram_gift_inventory
  set attributes = p_attributes, updated_at = now()
  where id = p_inventory_id and user_id = p_user_id;

  return jsonb_build_object('stars', v_wallet.stars, 'cost', v_cost, 'attributes', p_attributes);
end;
$$;
revoke all on function public.topgram_upgrade_gift_bundle(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.topgram_upgrade_gift_bundle(uuid,uuid,jsonb) to service_role;
