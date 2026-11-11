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
