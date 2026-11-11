-- 006: funções de gatilho não devem ser chamadas pela API pública (/rest/v1/rpc).
-- O banco continua executando os gatilhos normalmente.
revoke execute on function public.notify_on_like() from public, anon, authenticated;
revoke execute on function public.notify_push() from public, anon, authenticated;
