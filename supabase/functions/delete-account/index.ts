// Edge Function: delete-account  (v1)
// Exclui a conta do usuário e todos os dados dela (peças, looks, fotos,
// imagens geradas, perfil e limites de uso). Ação irreversível.
// Usa SUPABASE_SERVICE_ROLE_KEY (já disponível nas Edge Functions) só no servidor.
// Verify JWT desligado: o token é validado dentro da função.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '',
      { global: { headers: { Authorization: auth } } },
    );
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: 'Sessão expirada. Entre novamente.' }, 401);
    const uid = u.user.id;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 1) Arquivos do usuário em todos os buckets privados e públicos
    for (const bucket of ['clothes', 'avatars', 'body-photos', 'tryon']) {
      const { data: files, error: le } = await admin.storage.from(bucket).list(uid, { limit: 1000 });
      if (le) console.warn(`list ${bucket}:`, le.message);
      if (files?.length) {
        const { error: re } = await admin.storage.from(bucket).remove(files.map((f) => `${uid}/${f.name}`));
        if (re) console.warn(`remove ${bucket}:`, re.message);
      }
    }

    // 2) Linhas no banco (looks, peças, limites, perfil)
    for (const table of ['outfits', 'clothes', 'ai_usage', 'profiles']) {
      const col = table === 'profiles' ? 'id' : 'user_id';
      const { error: te } = await admin.from(table).delete().eq(col, uid);
      if (te) {
        console.error(`delete ${table}:`, te.message);
        return json({ error: 'Não consegui apagar seus dados. Tente de novo.' }, 500);
      }
    }

    // 3) Conta de acesso
    const { error: de } = await admin.auth.admin.deleteUser(uid);
    if (de) {
      console.error('deleteUser:', de.message);
      return json({ error: 'Não consegui concluir a exclusão da conta. Tente de novo.' }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
