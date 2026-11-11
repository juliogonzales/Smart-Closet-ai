-- 004: notificações de curtidas (sino) + preferência de silenciar alertas

alter table public.profiles add column if not exists notify_muted boolean not null default false;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- quem recebe
  actor_id uuid not null references auth.users(id) on delete cascade,  -- quem curtiu
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  kind text not null default 'like' check (kind in ('like')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notif_select_own" on public.notifications;
create policy "notif_select_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notif_update_own" on public.notifications;
create policy "notif_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notif_delete_own" on public.notifications;
create policy "notif_delete_own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.notifications from anon;
grant select, update, delete on public.notifications to authenticated;

-- Cada curtida gera uma notificação para o dono do look (sem notificar a si mesmo).
-- Evita duplicar: se já existe um aviso não lido do mesmo amigo para o mesmo look, não cria outro.
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.outfits where id = new.outfit_id;
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
     where n.user_id = v_owner and n.actor_id = new.user_id
       and n.outfit_id = new.outfit_id and n.kind = 'like' and n.read_at is null
  ) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, outfit_id, kind)
  values (v_owner, new.user_id, new.outfit_id, 'like');
  return new;
end;
$$;

drop trigger if exists outfit_likes_notify on public.outfit_likes;
create trigger outfit_likes_notify
  after insert on public.outfit_likes
  for each row execute function public.notify_on_like();

-- Lista as notificações do usuário logado, com dados de quem curtiu e do look.
create or replace function public.my_notifications(p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select n.id, n.kind, n.outfit_id, n.created_at, n.read_at,
           o.title as outfit_title,
           p.handle as actor_handle,
           split_part(coalesce(p.full_name, ''), ' ', 1) as actor_name,
           p.avatar_url as actor_avatar
      from public.notifications n
      left join public.outfits o on o.id = n.outfit_id
      left join public.profiles p on p.id = n.actor_id
     where n.user_id = auth.uid()
     order by n.created_at desc
     limit least(greatest(p_limit, 1), 100)
  ) x;
$$;

revoke execute on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;

-- Entrega em tempo real para o app aberto (respeita as políticas RLS acima).
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
