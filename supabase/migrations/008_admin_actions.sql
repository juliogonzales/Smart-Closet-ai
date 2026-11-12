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
