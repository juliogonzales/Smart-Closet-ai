// Edge Function: admin-actions (v1)
// Ações do administrador: suspender, reativar, enviar redefinição de senha e excluir conta.
// Só quem está na tabela app_admins passa. Cada ação grava um registro em admin_audit.
// Nunca devolve senha nem e-mail: a redefinição vai direto para a caixa do usuário.
// Usa SUPABASE_SERVICE_ROLE_KEY só aqui no servidor. Verify JWT desligado: o token é validado dentro da função.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUSPEND_FOR = '876000h'; // cerca de 100 anos: suspensão "por tempo indeterminado"
const ACTIONS = ['suspend', 'unsuspend', 'reset_password', 'delete'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Quem está chamando?
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: 'Sessão expirada. Entre novamente.' }, 401);
    const adminId = u.user.id;

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2) É administrador?
    const { data: isAdm } = await admin.from('app_admins').select('user_id').eq('user_id', adminId).maybeSingle();
    if (!isAdm) return json({ error: 'Sem permissão.' }, 403);

    // 3) Dados da ação
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? '');
    const targetId = String(body?.user_id ?? '');
    const reason = String(body?.reason ?? '').trim().slice(0, 200);

    if (!ACTIONS.includes(action)) return json({ error: 'Ação inválida.' }, 400);
    if (!UUID.test(targetId)) return json({ error: 'Conta inválida.' }, 400);
    if (targetId === adminId) return json({ error: 'Você não pode fazer isso na sua própria conta.' }, 400);
    if (action !== 'unsuspend' && reason.length < 3) {
      return json({ error: 'Escreva o motivo (pelo menos 3 letras).' }, 400);
    }

    // 4) Não age sobre outro administrador
    const { data: tgtAdm } = await admin.from('app_admins').select('user_id').eq('user_id', targetId).maybeSingle();
    if (tgtAdm) return json({ error: 'Não é possível aplicar esta ação a um administrador.' }, 400);

    // 5) A conta existe?
    const { data: tgt, error: te } = await admin.auth.admin.getUserById(targetId);
    if (te || !tgt?.user) return json({ error: 'Conta não encontrada.' }, 404);

    const { data: prof } = await admin.from('profiles').select('handle').eq('id', targetId).maybeSingle();
    const handle: string | null = prof?.handle ?? null;

    // 6) Executa a ação
    if (action === 'suspend' || action === 'unsuspend') {
      const { error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: action === 'suspend' ? SUSPEND_FOR : 'none',
      });
      if (error) {
        console.error(action, error.message);
        return json({ error: 'Não consegui alterar o acesso dessa conta.' }, 500);
      }
    }

    if (action === 'reset_password') {
      const email = tgt.user.email;
      if (!email) return json({ error: 'Esta conta não tem e-mail para redefinir a senha.' }, 400);
      const redirectTo = typeof body?.redirect_to === 'string' && body.redirect_to.startsWith('https://')
        ? body.redirect_to
        : undefined;
      const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error('reset:', error.message);
        return json({ error: 'Não consegui enviar o e-mail de redefinição.' }, 500);
      }
    }

    if (action === 'delete') {
      // Arquivos do usuário nos buckets
      for (const bucket of ['clothes', 'avatars', 'body-photos', 'tryon']) {
        const { data: files, error: le } = await admin.storage.from(bucket).list(targetId, { limit: 1000 });
        if (le) console.warn(`list ${bucket}:`, le.message);
        if (files?.length) {
          const { error: re } = await admin.storage.from(bucket).remove(files.map((f) => `${targetId}/${f.name}`));
          if (re) console.warn(`remove ${bucket}:`, re.message);
        }
      }
      // Linhas no banco
      for (const table of ['outfits', 'clothes', 'ai_usage', 'profiles']) {
        const col = table === 'profiles' ? 'id' : 'user_id';
        const { error: dbe } = await admin.from(table).delete().eq(col, targetId);
        if (dbe) {
          console.error(`delete ${table}:`, dbe.message);
          return json({ error: 'Não consegui apagar os dados dessa conta. Tente de novo.' }, 500);
        }
      }
      // Conta de acesso
      const { error: de } = await admin.auth.admin.deleteUser(targetId);
      if (de) {
        console.error('deleteUser:', de.message);
        return json({ error: 'Não consegui excluir a conta. Tente de novo.' }, 500);
      }
    }

    // 7) Registro de auditoria (quem, o quê, em qual conta, por qual motivo)
    const { error: ae } = await admin.from('admin_audit').insert({
      admin_id: adminId,
      action,
      target_user_id: targetId,
      target_handle: handle,
      reason: reason || null,
    });
    if (ae) console.error('audit:', ae.message);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
