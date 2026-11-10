-- Smart Closet AI — vestir na pessoa (try-on) + consentimento LGPD
-- Pode ser rodado mais de uma vez (idempotente).

-- 1) Campos de consentimento e da foto de modelo no perfil
alter table public.profiles
  add column if not exists lgpd_consent_at timestamptz,
  add column if not exists lgpd_consent_version text,
  add column if not exists body_photo_path text;

-- 2) Buckets privados
insert into storage.buckets (id, name, public)
values ('body-photos', 'body-photos', false), ('tryon', 'tryon', false)
on conflict (id) do update set public = false;

-- 3) Políticas: cada pessoa acessa só a pasta com o próprio user id
drop policy if exists "body photo: ler proprias" on storage.objects;
drop policy if exists "body photo: enviar proprias" on storage.objects;
drop policy if exists "body photo: trocar proprias" on storage.objects;
drop policy if exists "body photo: apagar proprias" on storage.objects;
drop policy if exists "tryon: ler proprias" on storage.objects;
drop policy if exists "tryon: apagar proprias" on storage.objects;

create policy "body photo: ler proprias" on storage.objects for select to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "body photo: enviar proprias" on storage.objects for insert to authenticated
  with check (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "body photo: trocar proprias" on storage.objects for update to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "body photo: apagar proprias" on storage.objects for delete to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "tryon: ler proprias" on storage.objects for select to authenticated
  using (bucket_id = 'tryon' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "tryon: apagar proprias" on storage.objects for delete to authenticated
  using (bucket_id = 'tryon' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4) Verificação
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('lgpd_consent_at','lgpd_consent_version','body_photo_path')) = 3 as perfil_ok,
  (select count(*) from storage.buckets where id in ('body-photos','tryon') and public = false) = 2 as buckets_privados_ok;
