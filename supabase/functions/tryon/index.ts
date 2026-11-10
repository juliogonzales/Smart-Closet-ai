// Edge Function: tryon  (v1)
// "Vestir na pessoa": usa a foto de modelo (corpo inteiro) do usuário e as fotos
// das peças escolhidas para gerar uma imagem nova da pessoa vestindo o look.
// - Exige consentimento LGPD registrado no perfil
// - Usa só a foto de modelo do próprio usuário (bucket privado body-photos)
// - Salva o resultado no bucket privado tryon e devolve link temporário (1 hora)
//
// Secrets usados: GEMINI_API_KEY, TRYON_MODEL (modelo com saída de imagem),
//   TRYON_DAILY_LIMIT (opcional, padrão 10)

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

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_ITEMS = 6;

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

const PROMPT = `Image 1 is a photo of a real person (full body). The next images are clothing items, shoes and accessories from that person's wardrobe.
Generate ONE new photo of that same person wearing ALL of the provided items, combined as a coherent outfit.
Keep the person's face, skin tone, hair, body shape, pose and the background of image 1 unchanged.
Keep each item's colors, patterns and design as shown in its photo. Fit the garments naturally on the body.
Do not add text, logos or extra people. Return only the image.`;

// deno-lint-ignore no-explicit-any
async function useQuota(supabase: any, userId: string) {
  const limit = Number(Deno.env.get('TRYON_DAILY_LIMIT') ?? '10');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'tryon')
    .gte('created_at', since);
  if (error) {
    console.warn('ai_usage indisponível:', error.message);
    return { used: 0, limit };
  }
  if ((count ?? 0) >= limit) {
    throw new HttpError(429, `Você usou as ${limit} imagens "vestir na pessoa" das últimas 24 horas. Volte mais tarde.`);
  }
  // Pausa mínima entre tentativas: toques repetidos geravam várias chamadas seguidas ao Google.
  const { data: last } = await supabase
    .from('ai_usage')
    .select('created_at')
    .eq('kind', 'tryon')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < 20000) {
    throw new HttpError(429, 'Espere uns 20 segundos antes de tentar de novo.');
  }
  // Conta a tentativa ANTES de chamar o Google, para que falhas também contem.
  await supabase.from('ai_usage').insert({ user_id: userId, kind: 'tryon' });
  return { used: (count ?? 0) + 1, limit };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    );
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    const uid = u.user.id;

    // Retenção: apaga imagens geradas com mais de 7 dias (LGPD).
    const { data: oldFiles } = await supabase.storage.from('tryon').list(uid, { limit: 200 });
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const expired = (oldFiles ?? [])
      .filter((f: { created_at?: string }) => f.created_at && Date.parse(f.created_at) < cutoff)
      .map((f: { name: string }) => `${uid}/${f.name}`);
    if (expired.length) await supabase.storage.from('tryon').remove(expired);

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.item_ids)
      ? [...new Set(body.item_ids.map((s: unknown) => String(s)))].slice(0, MAX_ITEMS)
      : [];
    if (!ids.length) throw new HttpError(400, 'Escolha pelo menos uma peça para vestir.');

    // Perfil: consentimento e foto de modelo
    const { data: profile, error: pe } = await supabase
      .from('profiles')
      .select('lgpd_consent_at, body_photo_path')
      .eq('id', uid)
      .maybeSingle();
    if (pe) throw new HttpError(500, 'Não consegui ler seu perfil.');
    if (!profile?.lgpd_consent_at) {
      throw new HttpError(403, 'Aceite o uso da sua foto de modelo nas configurações para usar esta função.');
    }
    if (!profile?.body_photo_path) {
      throw new HttpError(400, 'Envie sua foto de corpo inteiro no Perfil para usar "vestir na pessoa".');
    }

    // Peças: só as do próprio usuário
    const { data: items, error: ie } = await supabase
      .from('clothes')
      .select('id, name, category, image_url')
      .in('id', ids);
    if (ie) throw new HttpError(500, 'Não consegui ler as peças escolhidas.');
    if (!items || items.length !== ids.length) {
      throw new HttpError(400, 'Alguma peça escolhida não foi encontrada no seu guarda-roupa.');
    }

    const quota = await useQuota(supabase, uid);

    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) throw new HttpError(500, 'GEMINI_API_KEY não configurada nos Secrets.');
    const model = Deno.env.get('TRYON_MODEL');
    if (!model) throw new HttpError(500, 'TRYON_MODEL não configurado nos Secrets (modelo de geração de imagem).');

    // Baixa a foto de modelo (privada) e as fotos das peças
    const { data: personBlob, error: de } = await supabase.storage
      .from('body-photos').download(profile.body_photo_path);
    if (de || !personBlob) throw new HttpError(400, 'Não encontrei sua foto de modelo. Envie de novo no Perfil.');
    const personB64 = toB64(await personBlob.arrayBuffer());

    const garmentParts = await Promise.all(items.map(async (it) => {
      const r = await fetch(it.image_url);
      if (!r.ok) throw new HttpError(502, `Não consegui carregar a foto de "${it.name || it.category}".`);
      const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      return { inline_data: { mime_type: mime, data: toB64(await r.arrayBuffer()) } };
    }));

    const payload = {
      contents: [{
        role: 'user',
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: personBlob.type || 'image/jpeg', data: personB64 } },
          ...garmentParts,
        ],
      }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    };

    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new HttpError(504, 'A geração demorou demais. Tente de novo com menos peças.');
      }
      throw e;
    }
    if (!res.ok) {
      const txt = await res.text();
      console.error(`Gemini tryon ${res.status}: ${txt.slice(0, 400)}`);
      if (res.status === 429) throw new HttpError(429, 'A IA está com muita demanda agora. Tente em instantes.');
      if (res.status === 401 || res.status === 403) throw new HttpError(502, 'A chave da IA foi recusada. Confira o secret GEMINI_API_KEY.');
      if (res.status === 404) throw new HttpError(502, 'O modelo TRYON_MODEL não existe ou não tem acesso à geração de imagem.');
      throw new HttpError(502, 'A IA não conseguiu gerar a imagem agora. Tente de novo.');
    }
    const data = await res.json();
    if (data.promptFeedback?.blockReason) {
      throw new HttpError(422, 'A IA não conseguiu gerar esta imagem. Tente outra foto ou outras peças.');
    }
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p: { inlineData?: { data?: string }; inline_data?: { data?: string } }) =>
      p.inlineData?.data || p.inline_data?.data);
    const out = img?.inlineData ?? img?.inline_data;
    if (!out?.data) throw new HttpError(422, 'A IA não devolveu uma imagem. Tente de novo.');

    const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
    const ext = (out.mime_type || out.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('tryon').upload(path, bytes, {
      contentType: out.mime_type || out.mimeType || 'image/png', upsert: false,
    });
    if (up.error) throw new HttpError(500, 'Não consegui salvar a imagem gerada.');

    const { data: signed, error: se } = await supabase.storage.from('tryon').createSignedUrl(path, 3600);
    if (se || !signed) throw new HttpError(500, 'Imagem gerada, mas não consegui gerar o link.');

    return json({ url: signed.signedUrl, path, quota });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
