-- 007_admin.sql: painel de administração (somente o dono do app)
-- Regra: quem decide é o banco. Cada função confere is_app_admin() antes de agir.

-- 1) Lista de administradores (ninguém lê direto; só pelas funções abaixo)
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

insert into public.app_admins (user_id)
values ('e0d35715-9827-4d12-ba6a-bbba737e14fd')   -- juliogonzales@live.com
on conflict (user_id) do nothing;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- 2) Ocultar look do feed pelo administrador
alter table public.outfits add column if not exists admin_hidden boolean not null default false;

-- o dono do look não consegue mudar admin_hidden (só o administrador)
create or replace function public.guard_admin_hidden()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.admin_hidden is distinct from old.admin_hidden and not public.is_app_admin() then
    new.admin_hidden := old.admin_hidden;
  end if;
  return new;
end;
$$;

drop trigger if exists outfits_guard_admin_hidden on public.outfits;
create trigger outfits_guard_admin_hidden
  before update on public.outfits
  for each row execute function public.guard_admin_hidden();

revoke execute on function public.guard_admin_hidden() from public, anon, authenticated;

-- 3) Look oculto pelo admin some do feed e do link público
create or replace function public.can_view_feed_outfit(p_outfit uuid, p_viewer uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.outfits o
     where o.id = p_outfit
       and o.feed_visibility <> 'off'
       and not o.admin_hidden
       and (
         o.user_id = p_viewer
         or (
           not exists (select 1 from public.user_lists b
                        where b.kind = 'block'
                          and ((b.owner_id = o.user_id and b.target_id = p_viewer)
                            or (b.owner_id = p_viewer and b.target_id = o.user_id)))
           and not exists (select 1 from public.outfit_reports r
                            where r.outfit_id = o.id and r.reporter_id = p_viewer)
           and (
                o.feed_visibility = 'everyone'
                or (o.feed_visibility = 'selected' and exists (
                      select 1 from public.user_lists a
                       where a.kind = 'allow'
                         and a.owner_id = o.user_id and a.target_id = p_viewer))
           )
         )
       )
  );
$$;

create or replace function public.get_public_outfit(p_outfit_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id',                  o.id,
    'title',               o.title,
    'description',         o.description,
    'occasion',            o.occasion,
    'missing_suggestions', o.missing_suggestions,
    'owner_name',          split_part(coalesce(p.full_name, ''), ' ', 1),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', c.id,
                 'image_url', c.image_url,
                 'category', c.category,
                 'name', c.name
               )
               order by array_position(o.items, c.id)
             )
      from public.clothes c
      where c.id = any (o.items) and c.user_id = o.user_id
    ), '[]'::jsonb)
  )
  from public.outfits o
  left join public.profiles p on p.id = o.user_id
  where o.id = p_outfit_id and o.is_public = true and not o.admin_hidden;
$$;

-- 4) Funções do painel (todas conferem o administrador)
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users',          (select count(*) from public.profiles),
    'users_week',     (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'clothes',        (select count(*) from public.clothes),
    'looks',          (select count(*) from public.outfits),
    'shared',         (select count(*) from public.outfits where feed_visibility <> 'off' and not admin_hidden),
    'hidden',         (select count(*) from public.outfits where admin_hidden),
    'likes',          (select count(*) from public.outfit_likes),
    'reported_looks', (select count(distinct outfit_id) from public.outfit_reports),
    'push_devices',   (select count(*) from public.push_subscriptions),
    'ai_today',       (select count(*) from public.ai_usage where created_at >= date_trunc('day', now())),
    'ai_week',        (select count(*) from public.ai_usage where created_at > now() - interval '7 days')
  );
end;
$$;

create or replace function public.admin_users(p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(u) order by u.created_at desc)
      from (
        select p.handle, p.full_name, p.created_at,
               (select count(*) from public.clothes c where c.user_id = p.id) as clothes,
               (select count(*) from public.outfits o where o.user_id = p.id) as looks,
               (select count(*) from public.outfits o where o.user_id = p.id and o.feed_visibility <> 'off') as shared
          from public.profiles p
         order by p.created_at desc
         limit least(greatest(p_limit, 1), 200)
      ) u
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_reports()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.last_report desc)
      from (
        select o.id, o.title, o.feed_visibility, o.admin_hidden, o.created_at,
               p.handle as owner_handle,
               count(*) as reports,
               max(rp.created_at) as last_report,
               array_remove(array_agg(nullif(rp.reason, '')), null) as reasons
          from public.outfit_reports rp
          join public.outfits o on o.id = rp.outfit_id
          left join public.profiles p on p.id = o.user_id
         group by o.id, o.title, o.feed_visibility, o.admin_hidden, o.created_at, p.handle
      ) r
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_hidden(p_outfit uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.outfits set admin_hidden = p_hidden where id = p_outfit;
  if not found then raise exception 'look não encontrado'; end if;
end;
$$;

create or replace function public.admin_clear_reports(p_outfit uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  delete from public.outfit_reports where outfit_id = p_outfit;
end;
$$;

-- 5) Quem pode chamar: só usuários logados; cada função confere o administrador
revoke execute on function public.is_app_admin(), public.admin_overview(), public.admin_users(int),
  public.admin_reports(), public.admin_set_hidden(uuid, boolean), public.admin_clear_reports(uuid)
  from public, anon;
grant execute on function public.is_app_admin(), public.admin_overview(), public.admin_users(int),
  public.admin_reports(), public.admin_set_hidden(uuid, boolean), public.admin_clear_reports(uuid)
  to authenticated;
