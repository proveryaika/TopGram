create table if not exists public.topgram_usernames (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text unique,
 collectible_username text unique,
 updated_at timestamptz not null default now(),
 constraint topgram_username_format check (username is null or username ~ '^[a-z0-9_]{5,24}$'),
 constraint topgram_collectible_username_format check (collectible_username is null or collectible_username ~ '^[a-z0-9_]{5,32}$')
);
alter table public.topgram_usernames enable row level security;
revoke all on public.topgram_usernames from anon, authenticated;
grant all on public.topgram_usernames to service_role;

create table if not exists public.topgram_star_admin_log (
 id bigint generated always as identity primary key,
 admin_user_id uuid not null references auth.users(id),
 target_user_id uuid not null references auth.users(id),
 username text not null,
 amount bigint not null check (amount > 0),
 created_at timestamptz not null default now()
);
alter table public.topgram_star_admin_log enable row level security;
revoke all on public.topgram_star_admin_log from anon, authenticated;
grant all on public.topgram_star_admin_log to service_role;

create or replace function public.topgram_admin_grant_stars(p_admin_id uuid,p_username text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_target uuid; v_username text:=lower(trim(both '@' from trim(p_username))); v_balance bigint;
begin
 if not exists(select 1 from public.virtual_numbers where auth_user_id=p_admin_id and number_digits='79228093238') then raise exception 'Доступ только владельцу TopGram'; end if;
 if p_amount is null or p_amount<1 or p_amount>1000000000 then raise exception 'Количество звёзд должно быть от 1 до 1 000 000 000'; end if;
 select user_id into v_target from public.topgram_usernames where username=v_username for update;
 if v_target is null then raise exception 'Пользователь с таким юзернеймом не найден'; end if;
 update public.topgram_wallets set stars=stars+p_amount,updated_at=now() where user_id=v_target returning stars into v_balance;
 if not found then raise exception 'Кошелёк пользователя не найден'; end if;
 insert into public.topgram_star_admin_log(admin_user_id,target_user_id,username,amount) values(p_admin_id,v_target,v_username,p_amount);
 return jsonb_build_object('username',v_username,'stars_added',p_amount,'balance',v_balance);
end; $$;
revoke all on function public.topgram_admin_grant_stars(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.topgram_admin_grant_stars(uuid,text,bigint) to service_role;

create or replace function public.topgram_admin_assign_collectible_username(p_admin_id uuid,p_username text,p_collectible_username text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_target uuid; v_username text:=lower(trim(both '@' from trim(p_username))); v_collectible text:=lower(trim(both '@' from trim(p_collectible_username)));
begin
 if not exists(select 1 from public.virtual_numbers where auth_user_id=p_admin_id and number_digits='79228093238') then raise exception 'Доступ только владельцу TopGram'; end if;
 if v_collectible !~ '^[a-z0-9_]{5,32}$' then raise exception 'Коллекционный юзернейм: 5–32 символа, латиница, цифры и _'; end if;
 select user_id into v_target from public.topgram_usernames where username=v_username for update;
 if v_target is null then raise exception 'Пользователь с таким обычным юзернеймом не найден'; end if;
 insert into public.topgram_usernames(user_id,username,collectible_username,updated_at) values(v_target,v_username,v_collectible,now())
 on conflict(user_id) do update set collectible_username=excluded.collectible_username,updated_at=now();
 return jsonb_build_object('username',v_username,'collectible_username',v_collectible);
exception when unique_violation then raise exception 'Этот коллекционный юзернейм уже занят';
end; $$;
revoke all on function public.topgram_admin_assign_collectible_username(uuid,text,text) from public,anon,authenticated;
grant execute on function public.topgram_admin_assign_collectible_username(uuid,text,text) to service_role;

create or replace function public.topgram_admin_stats(p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_result jsonb;
begin
 if not exists(select 1 from public.virtual_numbers where auth_user_id=p_admin_id and number_digits='79228093238') then raise exception 'Доступ только владельцу TopGram'; end if;
 select jsonb_build_object(
  'total_users',(select count(*) from auth.users),
  'users',coalesce((select jsonb_agg(jsonb_build_object(
   'user_id',u.id,'username',coalesce(tu.username,''),'collectible_username',coalesce(tu.collectible_username,''),
   'stars',coalesce(w.stars,0),
   'number',case when vn.number_digits='79228093238' then '+888 8888' when vn.number_digits is not null then '+'||vn.number_digits else '' end,
   'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,
   'display_name',coalesce(u.raw_user_meta_data->>'name',u.raw_user_meta_data->>'full_name','')
  ) order by u.created_at desc) from auth.users u
  left join public.topgram_usernames tu on tu.user_id=u.id
  left join public.topgram_wallets w on w.user_id=u.id
  left join public.virtual_numbers vn on vn.auth_user_id=u.id),'[]'::jsonb)
 ) into v_result;
 return v_result;
end; $$;
revoke all on function public.topgram_admin_stats(uuid) from public,anon,authenticated;
grant execute on function public.topgram_admin_stats(uuid) to service_role;
