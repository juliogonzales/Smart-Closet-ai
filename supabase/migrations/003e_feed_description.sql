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
