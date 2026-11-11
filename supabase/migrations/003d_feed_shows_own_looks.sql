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
