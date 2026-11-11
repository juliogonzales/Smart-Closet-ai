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
