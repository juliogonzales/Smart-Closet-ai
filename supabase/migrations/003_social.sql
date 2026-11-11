-- =====================================================================
-- 003 | Feedback do look (gostei / não gostei / vou usar) + feed social
--       simples: compartilhar, curtir, listas de permissão e bloqueio.
--       Sem comentários nesta versão. Idempotente (pode rodar de novo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists handle text;
alter table public.outfits  add column if not exists feed_visibility text not null default 'off';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_handle_format') then
    alter table public.profiles add constraint profiles_handle_format
      check (handle is null or handle ~ '^[a-z0-9_.]{3,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outfits_feed_visibility_check') then
    alter table public.outfits add constraint outfits_feed_visibility_check
      check (feed_visibility in ('off', 'everyone', 'selected'));
  end if;
end $$;

create unique index if not exists profiles_handle_unique on public.profiles (handle);

-- ---------------------------------------------------------------------
-- 2. Tabelas novas
-- ---------------------------------------------------------------------
-- Listas de cada pessoa: 'allow' = só estas pessoas veem os looks marcados
-- como "selecionados"; 'block' = estas pessoas não veem nenhum look seu e
-- você não vê os delas.
create table if not exists public.user_lists (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id  uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('allow', 'block')),
  created_at timestamptz not null default now(),
  primary key (owner_id, target_id, kind),
  check (owner_id <> target_id)
);

create table if not exists public.outfit_likes (
  outfit_id  uuid not null references public.outfits (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (outfit_id, user_id)
);

-- Avaliação privada de cada pessoa sobre um look (alimenta a IA).
create table if not exists public.outfit_feedback (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outfit_id  uuid not null references public.outfits (id) on delete cascade,
  rating     smallint check (rating in (-1, 1)),
  will_wear  boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, outfit_id)
);

-- Denúncias: só a pessoa que denuncia escreve; o look some para ela.
create table if not exists public.outfit_reports (
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outfit_id   uuid not null references public.outfits (id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (reporter_id, outfit_id)
);

create index if not exists outfit_likes_outfit_idx on public.outfit_likes (outfit_id);
create index if not exists user_lists_target_idx on public.user_lists (target_id);

-- ---------------------------------------------------------------------
-- 3. Regra central: quem pode ver um look no feed
-- ---------------------------------------------------------------------
create or replace function public.can_view_feed_outfit(p_outfit uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.outfits o
     where o.id = p_outfit
       and o.feed_visibility <> 'off'
       and o.user_id <> p_viewer
       -- bloqueio nos dois sentidos
       and not exists (select 1 from public.user_lists b
                        where b.kind = 'block'
                          and ((b.owner_id = o.user_id and b.target_id = p_viewer)
                            or (b.owner_id = p_viewer and b.target_id = o.user_id)))
       -- não mostra o que a pessoa denunciou
       and not exists (select 1 from public.outfit_reports r
                        where r.outfit_id = o.id and r.reporter_id = p_viewer)
       and (
            o.feed_visibility = 'everyone'
            or (o.feed_visibility = 'selected' and exists (
                  select 1 from public.user_lists a
                   where a.kind = 'allow'
                     and a.owner_id = o.user_id and a.target_id = p_viewer))
       )
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Funções de leitura e escrita do feed
-- ---------------------------------------------------------------------

-- 4.1 Lista os looks do feed visíveis para quem chama
create or replace function public.feed_looks(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  visible as (
    select o.*
      from public.outfits o, me
     where me.uid is not null
       and public.can_view_feed_outfit(o.id, me.uid)
     order by o.created_at desc
     limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', v.id,
             'title', v.title,
             'occasion', v.occasion,
             'created_at', v.created_at,
             'owner_handle', p.handle,
             'owner_name', split_part(coalesce(p.full_name, ''), ' ', 1),
             'owner_avatar', p.avatar_url,
             'likes', (select count(*) from public.outfit_likes l where l.outfit_id = v.id),
             'liked', exists (select 1 from public.outfit_likes l
                               where l.outfit_id = v.id and l.user_id = me.uid),
             'items', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', c.id, 'image_url', c.image_url,
                        'category', c.category, 'name', c.name)
                        order by array_position(v.items, c.id))
                 from public.clothes c
                where c.id = any (v.items) and c.user_id = v.user_id
             ), '[]'::jsonb)
           )
           order by v.created_at desc), '[]'::jsonb)
  from visible v
  left join public.profiles p on p.id = v.user_id
  cross join me;
$$;

-- 4.2 Curtir / descurtir (só se a pessoa puder ver o look)
create or replace function public.toggle_like(p_outfit uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  total integer;
begin
  if me is null then raise exception 'Entre na sua conta para curtir.'; end if;
  if not public.can_view_feed_outfit(p_outfit, me) then
    raise exception 'Este look não está disponível para você.';
  end if;
  if p_like then
    insert into public.outfit_likes (outfit_id, user_id) values (p_outfit, me)
    on conflict do nothing;
  else
    delete from public.outfit_likes where outfit_id = p_outfit and user_id = me;
  end if;
  select count(*) into total from public.outfit_likes where outfit_id = p_outfit;
  return jsonb_build_object('likes', total, 'liked', p_like);
end;
$$;

-- 4.3 Procura uma pessoa pelo @apelido (sem expor e-mail)
create or replace function public.find_user_by_handle(p_handle text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle,
    'name', split_part(coalesce(p.full_name, ''), ' ', 1),
    'avatar_url', p.avatar_url)
  from public.profiles p
  where auth.uid() is not null
    and p.handle = lower(regexp_replace(coalesce(p_handle, ''), '^@', ''))
    and p.id <> auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 5. Permissões e RLS das tabelas novas
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.user_lists, public.outfit_likes,
  public.outfit_feedback, public.outfit_reports to authenticated;

alter table public.user_lists      enable row level security;
alter table public.outfit_likes    enable row level security;
alter table public.outfit_feedback enable row level security;
alter table public.outfit_reports  enable row level security;

-- user_lists: só o dono vê e edita a própria lista
drop policy if exists "user_lists_own" on public.user_lists;
create policy "user_lists_own" on public.user_lists
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- outfit_likes: a pessoa vê e grava só as próprias curtidas
drop policy if exists "outfit_likes_own" on public.outfit_likes;
create policy "outfit_likes_own" on public.outfit_likes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- outfit_feedback: só a própria avaliação
drop policy if exists "outfit_feedback_own" on public.outfit_feedback;
create policy "outfit_feedback_own" on public.outfit_feedback
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- outfit_reports: só insere e vê as próprias denúncias
drop policy if exists "outfit_reports_own" on public.outfit_reports;
create policy "outfit_reports_own" on public.outfit_reports
  for all to authenticated
  using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());

revoke all on function public.can_view_feed_outfit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.feed_looks(integer, integer) from public, anon;
revoke all on function public.toggle_like(uuid, boolean) from public, anon;
revoke all on function public.find_user_by_handle(text) from public, anon;
grant execute on function public.feed_looks(integer, integer) to authenticated;
grant execute on function public.toggle_like(uuid, boolean) to authenticated;
grant execute on function public.find_user_by_handle(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Conferência
-- ---------------------------------------------------------------------
select 'tabelas sociais' as item,
       (select count(*)::text from pg_tables
         where schemaname = 'public'
           and tablename in ('user_lists', 'outfit_likes', 'outfit_feedback', 'outfit_reports')
           and rowsecurity) || ' de 4 com RLS (esperado: 4)' as resultado
union all
select 'funcoes do feed',
       (select count(*)::text from pg_proc
         where proname in ('feed_looks', 'toggle_like', 'find_user_by_handle', 'can_view_feed_outfit'))
       || ' de 4 (esperado: 4)';
