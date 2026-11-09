-- =====================================================================
-- Smart Closet AI  |  Schema completo v2 (2026-11-08)
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
