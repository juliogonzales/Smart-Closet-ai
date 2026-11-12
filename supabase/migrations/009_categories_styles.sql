-- 009: novas categorias de peça, estilos e ocasiões unificados

-- 1) Novas categorias (acessório é dividido; esporte e praia viram categorias)
alter type public.clothing_category add value if not exists 'bag';
alter type public.clothing_category add value if not exists 'jewelry';
alter type public.clothing_category add value if not exists 'headwear';
alter type public.clothing_category add value if not exists 'activewear';
alter type public.clothing_category add value if not exists 'swimwear';

-- 2) Estilos das peças: formal/street/festa viram elegante/streetwear (festa sai: é ocasião)
update public.clothes
   set tags = array_remove(
                array_replace(array_replace(tags, 'formal', 'elegante'), 'street', 'streetwear'),
                'festa')
 where tags && array['formal', 'street', 'festa']::text[];

-- 3) Estilos do perfil (mesma conversão)
update public.profiles p
   set style_preferences = (
     select coalesce(jsonb_agg(distinct to_jsonb(v)), '[]'::jsonb)
       from (
         select case (x #>> '{}')
                  when 'formal' then 'elegante'
                  when 'street' then 'streetwear'
                  else x #>> '{}'
                end as v
           from jsonb_array_elements(p.style_preferences) x
          where (x #>> '{}') <> 'festa'
       ) s
   )
 where jsonb_typeof(p.style_preferences) = 'array'
   and p.style_preferences ?| array['formal', 'street', 'festa']::text[];

-- 4) Ocasiões dos looks salvos
update public.outfits set occasion = case occasion
    when 'Reunião de trabalho' then 'Trabalho'
    when 'Encontro casual' then 'Encontro ou jantar'
    when 'Festa à noite' then 'Festa ou evento'
    when 'Evento formal' then 'Festa ou evento'
    when 'Fim de semana' then 'Dia a dia'
    else occasion end
 where occasion in ('Reunião de trabalho', 'Encontro casual', 'Festa à noite', 'Evento formal', 'Fim de semana');
