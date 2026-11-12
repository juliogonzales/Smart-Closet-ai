-- =====================================================================
-- Smart Closet AI  |  Schema completo v3 (2026-11-11): inclui as migrações sociais, notificações e Web Push
-- Tabelas, RLS, limites, Storage e função de look público.
--
-- COMO USAR: Supabase > SQL Editor > New query > cole TUDO > Run.
-- É seguro rodar de novo: o script é idempotente e também ATUALIZA
-- bancos criados com a versão anterior.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Enum de categorias
-- ---------------------------------------------------------------------
do $$
begin
  create type public.clothing_category as enum
    ('top', 'bottom', 'shoes', 'accessory', 'outerwear', 'fullbody');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  avatar_url        text,
  style_preferences jsonb not null default '[]'::jsonb,
  onboarded         boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.clothes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  image_url    text not null,
  storage_path text,
  name         text,
  category     public.clothing_category not null,
  colors       jsonb not null default '[]'::jsonb,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now()
);

create table if not exists public.outfits (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  title               text not null,
  description         text,
  occasion            text,
  items               uuid[] not null default '{}',
  missing_suggestions text,
  is_public           boolean not null default false,
  created_at          timestamptz not null default now()
);

-- Controle de uso da IA (limite diario por usuario, aplicado nas Edge Functions)
create table if not exists public.ai_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid()
             references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('stylist', 'analyze')),
  created_at timestamptz not null default now()
);

-- Colunas adicionadas em versoes novas (para bancos antigos)
alter table public.profiles add column if not exists onboarded boolean not null default false;
alter table public.clothes  add column if not exists storage_path text;
alter table public.clothes  add column if not exists name text;
alter table public.outfits  add column if not exists missing_suggestions text;

create index if not exists clothes_user_idx
  on public.clothes (user_id, created_at desc);
create index if not exists outfits_user_idx
  on public.outfits (user_id, created_at desc);
create index if not exists ai_usage_user_idx
  on public.ai_usage (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Validacoes (limites de tamanho)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outfits_title_len') then
    alter table public.outfits add constraint outfits_title_len
      check (char_length(title) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outfits_items_max') then
    alter table public.outfits add constraint outfits_items_max
      check (cardinality(items) <= 12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clothes_name_len') then
    alter table public.clothes add constraint clothes_name_len
      check (name is null or char_length(name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clothes_tags_max') then
    alter table public.clothes add constraint clothes_tags_max
      check (cardinality(tags) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_name_len') then
    alter table public.profiles add constraint profiles_name_len
      check (full_name is null or char_length(full_name) <= 80);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Funcoes e gatilhos
-- ---------------------------------------------------------------------

-- 4.1 Cria o profile quando alguem se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(new.email, '@', 1)
    ), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4.2 Ao excluir uma peca, remove o id dela dos looks salvos
create or replace function public.clothes_cleanup_outfits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.outfits
     set items = array_remove(items, old.id)
   where user_id = old.user_id
     and old.id = any (items);
  return old;
end;
$$;

drop trigger if exists on_clothes_deleted on public.clothes;
create trigger on_clothes_deleted
  after delete on public.clothes
  for each row execute function public.clothes_cleanup_outfits();

-- 4.3 Limites por usuario (evita abuso de armazenamento)
create or replace function public.enforce_row_limits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cnt integer;
  lim integer;
begin
  if tg_table_name = 'clothes' then
    lim := 500;
    select count(*) into cnt from public.clothes where user_id = new.user_id;
  elsif tg_table_name = 'outfits' then
    lim := 300;
    select count(*) into cnt from public.outfits where user_id = new.user_id;
  else
    return new;
  end if;
  if cnt >= lim then
    raise exception 'Limite de % itens atingido.', lim;
  end if;
  return new;
end;
$$;

drop trigger if exists clothes_limit on public.clothes;
create trigger clothes_limit
  before insert on public.clothes
  for each row execute function public.enforce_row_limits();

drop trigger if exists outfits_limit on public.outfits;
create trigger outfits_limit
  before insert on public.outfits
  for each row execute function public.enforce_row_limits();

-- Funcoes de gatilho nao devem ser chamaveis pela API publica
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.clothes_cleanup_outfits() from public, anon, authenticated;
revoke execute on function public.enforce_row_limits() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Permissoes e RLS
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on public.profiles, public.clothes, public.outfits to authenticated;
grant select, insert on public.ai_usage to authenticated;

alter table public.profiles enable row level security;
alter table public.clothes  enable row level security;
alter table public.outfits  enable row level security;
alter table public.ai_usage enable row level security;

-- profiles: cada um ve e edita so o seu
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- clothes: acesso total so as proprias pecas
drop policy if exists "clothes_select_own" on public.clothes;
drop policy if exists "clothes_insert_own" on public.clothes;
drop policy if exists "clothes_update_own" on public.clothes;
drop policy if exists "clothes_delete_own" on public.clothes;
create policy "clothes_select_own" on public.clothes
  for select to authenticated using (user_id = auth.uid());
create policy "clothes_insert_own" on public.clothes
  for insert to authenticated with check (user_id = auth.uid());
create policy "clothes_update_own" on public.clothes
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clothes_delete_own" on public.clothes
  for delete to authenticated using (user_id = auth.uid());

-- outfits: SOMENTE o dono acessa a tabela.
-- (A versao anterior deixava qualquer pessoa listar todos os looks
--  publicos. Agora o acesso publico e so pela funcao get_public_outfit,
--  que exige o id do look.)
drop policy if exists "outfits_select_own_or_public" on public.outfits;
drop policy if exists "outfits_select_own" on public.outfits;
drop policy if exists "outfits_insert_own" on public.outfits;
drop policy if exists "outfits_update_own" on public.outfits;
drop policy if exists "outfits_delete_own" on public.outfits;
create policy "outfits_select_own" on public.outfits
  for select to authenticated using (user_id = auth.uid());
create policy "outfits_insert_own" on public.outfits
  for insert to authenticated with check (user_id = auth.uid());
create policy "outfits_update_own" on public.outfits
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "outfits_delete_own" on public.outfits
  for delete to authenticated using (user_id = auth.uid());

-- ai_usage: so le e grava o proprio uso (sem update/delete: nao da para
-- "zerar" o limite diario)
drop policy if exists "ai_usage_select_own" on public.ai_usage;
drop policy if exists "ai_usage_insert_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());
create policy "ai_usage_insert_own" on public.ai_usage
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. Look publico: devolve um look compartilhado (com as pecas) sem
--    abrir as tabelas ao publico. So funciona se is_public = true.
-- ---------------------------------------------------------------------
create or replace function public.get_public_outfit(p_outfit_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
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
  where o.id = p_outfit_id and o.is_public = true;
$$;

revoke all on function public.get_public_outfit(uuid) from public;
grant execute on function public.get_public_outfit(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Storage: buckets "clothes" e "avatars"
--    Leitura por URL publica (nomes de arquivo sao UUIDs). Gravar e
--    remover so dentro da propria pasta <user_id>/.
-- ---------------------------------------------------------------------
insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('clothes', 'clothes', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clothes_files_select_own" on storage.objects;
drop policy if exists "clothes_files_insert_own" on storage.objects;
drop policy if exists "clothes_files_update_own" on storage.objects;
drop policy if exists "clothes_files_delete_own" on storage.objects;
create policy "clothes_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'clothes'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clothes_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'clothes'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clothes_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'clothes'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "clothes_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'clothes'
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_files_select_own" on storage.objects;
drop policy if exists "avatars_files_insert_own" on storage.objects;
drop policy if exists "avatars_files_update_own" on storage.objects;
drop policy if exists "avatars_files_delete_own" on storage.objects;
create policy "avatars_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 8. Conferencia: este resultado aparece ao final da execucao
-- ---------------------------------------------------------------------
select 'tabelas' as item,
       string_agg(
         tablename || case when rowsecurity then ' (RLS ok)' else ' (SEM RLS!)' end,
         ', ' order by tablename
       ) as resultado
  from pg_tables
 where schemaname = 'public'
   and tablename in ('profiles', 'clothes', 'outfits', 'ai_usage')
union all
select 'buckets',
       string_agg(id || case when public then ' (publico)' else ' (privado)' end, ', ')
  from storage.buckets
 where id in ('clothes', 'avatars')
union all
select 'look publico',
       case when exists (select 1 from pg_proc where proname = 'get_public_outfit')
            then 'ok' else 'FALTA' end
union all
select 'politicas outfits',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'outfits')
         || ' (esperado: 4)';

-- =====================================================================
-- Migrações posteriores (já aplicadas no projeto, em ordem).
-- Base NOVA: rode este arquivo inteiro e depois as migrações de 003 a 006 da pasta migrations, nesta ordem:
-- 003, 003b, 003c, 003d, 003e, 004, 005, 005b, 006. (002_tryon.sql é opcional: a função tryon não é usada.)
-- =====================================================================

-- ---- supabase/migrations/003_social.sql ----
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

-- ---- supabase/migrations/003b_my_people.sql ----
-- 003b | Lista "Pessoas" do perfil (com @apelido, sem expor e-mail)
create or replace function public.my_people()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'target_id', l.target_id,
           'kind', l.kind,
           'handle', p.handle,
           'name', split_part(coalesce(p.full_name, ''), ' ', 1),
           'avatar_url', p.avatar_url)
         order by l.created_at desc), '[]'::jsonb)
  from public.user_lists l
  left join public.profiles p on p.id = l.target_id
  where l.owner_id = auth.uid();
$$;

revoke all on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

-- ---- supabase/migrations/003c_block_feed_owner.sql ----
-- 003c | Bloquear o autor de um look direto pelo feed
create or replace function public.block_feed_owner(p_outfit uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  owner uuid;
begin
  if me is null then raise exception 'Entre na sua conta.'; end if;
  select o.user_id into owner from public.outfits o where o.id = p_outfit;
  if owner is null or owner = me then return false; end if;
  insert into public.user_lists (owner_id, target_id, kind) values (me, owner, 'block')
  on conflict do nothing;
  delete from public.user_lists where owner_id = me and target_id = owner and kind = 'allow';
  return true;
end;
$$;

revoke all on function public.block_feed_owner(uuid) from public, anon;
grant execute on function public.block_feed_owner(uuid) to authenticated;

-- ---- supabase/migrations/003d_feed_shows_own_looks.sql ----
-- 003d | O próprio dono também vê, no feed, os looks que compartilhou
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

revoke all on function public.can_view_feed_outfit(uuid, uuid) from public, anon, authenticated;

-- ---- supabase/migrations/003e_feed_description.sql ----
-- 003e: feed_looks também devolve a descrição do look (cards estilo Instagram)
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
             'description', v.description,
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

grant execute on function public.feed_looks(integer, integer) to authenticated;

-- ---- supabase/migrations/004_notifications.sql ----
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

-- ---- supabase/migrations/005_push.sql ----
-- 005: avisos com o celular fechado (Web Push)

create extension if not exists pg_net;

-- Dispositivos inscritos para receber push (um por navegador/aparelho)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Marca quando o push já foi enviado (evita repetir)
alter table public.notifications add column if not exists push_sent_at timestamptz;

-- Ao criar uma notificação, pede à função push-notify que envie o aviso.
-- Se a chamada falhar, a curtida e o aviso no sino continuam normais.
create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://hmzjnutwsungloctxwfi.supabase.co/functions/v1/push-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notify_push();

-- ---- supabase/migrations/005b_claim_push_endpoint.sql ----
-- 005b: registra o aparelho para push; se o aparelho já era de outra conta, troca o dono
create or replace function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent);
end;
$$;

revoke execute on function public.claim_push_endpoint(text, text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text, text) to authenticated;

-- ---- supabase/migrations/006_trigger_grants.sql ----
-- 006: funções de gatilho não devem ser chamadas pela API pública (/rest/v1/rpc).
-- O banco continua executando os gatilhos normalmente.
revoke execute on function public.notify_on_like() from public, anon, authenticated;
revoke execute on function public.notify_push() from public, anon, authenticated;


-- ============================================================
-- 007: painel do administrador (somente o dono)
-- ============================================================
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


-- ============================================================
-- 008: ações do administrador (suspender, reativar, redefinir senha, excluir) + auditoria
-- A função admin-actions (Edge Function) faz as ações no servidor.
-- ============================================================
-- 008_admin_actions.sql: ações do administrador (suspender, reativar, redefinir senha, excluir) + auditoria
-- As ações rodam na Edge Function admin-actions (servidor). Aqui ficam o registro e as leituras do painel.

-- 1) Registro de auditoria: quem fez, o quê, em qual conta e por qual motivo
create table if not exists public.admin_audit (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  admin_id        uuid not null,
  action          text not null,
  target_user_id  uuid,
  target_handle   text,
  reason          text
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
-- sem policies: só o servidor grava; o painel lê pela função abaixo

create or replace function public.admin_audit_list(p_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(a) order by a.created_at desc)
      from (
        select created_at, action, target_handle, reason
          from public.admin_audit
         order by created_at desc
         limit least(greatest(p_limit, 1), 200)
      ) a
  ), '[]'::jsonb);
end;
$$;

-- 2) Lista de usuários agora traz o id (para as ações) e se a conta está suspensa
create or replace function public.admin_users(p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(u) order by u.created_at desc)
      from (
        select p.id, p.handle, p.full_name, p.created_at,
               (au.banned_until is not null and au.banned_until > now()) as suspended,
               (select count(*) from public.clothes c where c.user_id = p.id) as clothes,
               (select count(*) from public.outfits o where o.user_id = p.id) as looks,
               (select count(*) from public.outfits o where o.user_id = p.id and o.feed_visibility <> 'off') as shared
          from public.profiles p
          left join auth.users au on au.id = p.id
         order by p.created_at desc
         limit least(greatest(p_limit, 1), 200)
      ) u
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_audit_list(int) from public, anon;
grant execute on function public.admin_audit_list(int) to authenticated;
