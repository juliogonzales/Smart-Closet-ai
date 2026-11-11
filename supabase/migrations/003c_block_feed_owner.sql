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
