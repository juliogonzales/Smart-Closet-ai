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
