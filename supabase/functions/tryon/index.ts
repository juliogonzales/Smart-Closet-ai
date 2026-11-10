// Edge Function: tryon  (v5)
// "Vestir na pessoa".
//
// Dois modos, escolhidos pelo secret TRYON_MODE:
// - compose (padrão, GRATUITO): o Gemini de TEXTO (GEMINI_MODEL, camada gratuita)
//   olha a foto de corpo inteiro e devolve onde cada peça deve ficar no corpo
//   (caixas normalizadas 0-1). A montagem é feita no navegador do usuário.
//   Nada é gerado nem guardado no servidor.
// - image (PAGO): gera uma imagem nova com TRYON_MODEL (ex.: gemini-2.5-flash-image).
//   Exige faturamento ativo no Google e sai do plano gratuito.
//
// Regras comuns:
// - Exige consentimento LGPD registrado no perfil
// - Usa só a foto de modelo do próprio usuário (bucket privado body-photos)
// - Limite diário e pausa de 20 s entre tentativas (ai_usage, kind 'tryon')
//
// Secrets: GEMINI_API_KEY, GEMINI_MODEL (texto), TRYON_MODE (opcional: compose|image),
//   TRYON_MODEL (só no modo image), TRYON_DAILY_LIMIT (opcional)

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
const CATEGORIES = ['outerwear', 'top', 'fullbody', 'bottom', 'shoes', 'accessory'];

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

// ---------- Modo compose (gratuito) ----------

const PLACE_PROMPT = `The image is a photo of one person (ideally full body).
Return JSON only, with this shape:
{"person":[x,y,w,h],"placements":[{"item_id":"<id>","box":[x,y,w,h]}]}
- All numbers are normalized from 0 to 1, relative to the full image, origin at top-left.
- "person" is the bounding box of the whole person.
- For each clothing item listed below, give "box": where that garment sits on THIS person's body.
  - top: chest and torso, from the shoulders to the waist
  - outerwear: a jacket or coat over the torso, a bit wider than the top
  - bottom: pants or skirt, from the hips to the ankles or mid-calf
  - fullbody: a dress or jumpsuit, from the shoulders to the ankles
  - shoes: the feet, at the bottom of the person
  - accessory: near the waist, neck or head, as appropriate for the item
- Boxes must stay inside the person's box. Use the item_id exactly as given.`;

type Box = [number, number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function validBox(b: unknown): Box | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [x, y, w, h] = b.map((n) => Number(n));
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;
  const X = clamp01(x), Y = clamp01(y);
  const W = Math.min(clamp01(w), 1 - X), H = Math.min(clamp01(h), 1 - Y);
  if (W < 0.02 || H < 0.02) return null;
  return [X, Y, W, H];
}

// Caixas padrão, usadas quando o Gemini não devolve uma peça.
function defaultBox(category: string, p: Box): Box {
  const [px, py, pw, ph] = p;
  const at = (fx: number, fy: number, fw: number, fh: number): Box =>
    [px + pw * fx, py + ph * fy, pw * fw, ph * fh];
  switch (category) {
    case 'outerwear': return at(0.13, 0.15, 0.74, 0.34);
    case 'top': return at(0.18, 0.16, 0.64, 0.30);
    case 'fullbody': return at(0.05, 0.14, 0.9, 0.84);
    case 'bottom': return at(0.2, 0.45, 0.6, 0.4);
    case 'shoes': return at(0.2, 0.88, 0.6, 0.11);
    default: return at(0.3, 0.12, 0.4, 0.12); // accessory
  }
}

// Ordem de desenho: o que fica por baixo vem primeiro.
const DRAW_ORDER = ['fullbody', 'bottom', 'top', 'outerwear', 'shoes', 'accessory'];

async function placeWithText(
  personB64: string, personMime: string,
  items: { id: string; name: string | null; category: string }[],
): Promise<{ person: Box; boxes: Record<string, Box>; fallback: boolean }> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new HttpError(500, 'GEMINI_API_KEY não configurada nos Secrets.');
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
  const list = items.map((i) => `- item_id "${i.id}": ${i.category}${i.name ? ` (${i.name})` : ''}`).join('\n');
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    temperature: 0.2,
    maxOutputTokens: 1024,
  };
  if (/^gemini-[3-9]/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  if (/^gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: PLACE_PROMPT + '\n\nClothing items:\n' + list },
            { inline_data: { mime_type: personMime, data: personB64 } },
          ],
        }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new HttpError(504, 'A IA demorou para localizar as peças. Tente de novo.');
    }
    throw e;
  }
  if (!res.ok) {
    const txt = await res.text();
    console.error(`Gemini placement ${res.status}: ${txt.slice(0, 400)}`);
    if (res.status === 429) throw new HttpError(429, 'A IA está com muita demanda agora. Tente em instantes.');
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'A chave da IA foi recusada. Confira o secret GEMINI_API_KEY.');
    throw new HttpError(502, 'A IA não conseguiu localizar as peças agora. Tente de novo.');
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '').join('');
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  const person = validBox(parsed?.person) ?? [0.1, 0.02, 0.8, 0.96];
  const boxes: Record<string, Box> = {};
  const wanted = new Set(items.map((i) => i.id));
  for (const pl of Array.isArray(parsed?.placements) ? parsed.placements : []) {
    const id = String(pl?.item_id ?? '');
    const b = validBox(pl?.box);
    if (wanted.has(id) && b && !boxes[id]) boxes[id] = b;
  }
  let fallback = false;
  for (const it of items) {
    if (!boxes[it.id]) { boxes[it.id] = defaultBox(it.category, person); fallback = true; }
  }
  return { person, boxes, fallback };
}

// ---------- Modo image (pago) ----------

const IMAGE_PROMPT = `Image 1 is a photo of a real person (full body). The next images are clothing items, shoes and accessories from that person's wardrobe.
Generate ONE new photo of that same person wearing ALL of the provided items, combined as a coherent outfit.
Keep the person's face, skin tone, hair, body shape, pose and the background of image 1 unchanged.
Keep each item's colors, patterns and design as shown in its photo. Fit the garments naturally on the body.
Do not add text, logos or extra people. Return only the image.`;

async function generateImage(
  personB64: string, personMime: string,
  garments: { mime: string; data: string }[],
): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new HttpError(500, 'GEMINI_API_KEY não configurada nos Secrets.');
  const model = Deno.env.get('TRYON_MODEL');
  if (!model) throw new HttpError(500, 'TRYON_MODEL não configurado nos Secrets (modo image).');
  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: IMAGE_PROMPT },
        { inline_data: { mime_type: personMime, data: personB64 } },
        ...garments.map((g) => ({ inline_data: { mime_type: g.mime, data: g.data } })),
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
  return {
    bytes: Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0)),
    mime: out.mime_type || out.mimeType || 'image/png',
  };
}

// ---------- Cota ----------

// deno-lint-ignore no-explicit-any
async function useQuota(supabase: any, userId: string, limit: number) {
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
    throw new HttpError(429, `Você usou as ${limit} prévias "vestir na pessoa" das últimas 24 horas. Volte mais tarde.`);
  }
  // Pausa mínima entre tentativas: toques repetidos geravam várias chamadas seguidas.
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
  // Conta a tentativa ANTES de chamar a IA, para que falhas também contem.
  await supabase.from('ai_usage').insert({ user_id: userId, kind: 'tryon' });
  return { used: (count ?? 0) + 1, limit };
}

// ---------- Handler ----------

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

    // Retenção: apaga imagens geradas (modo image) com mais de 7 dias (LGPD).
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

    const mode = (Deno.env.get('TRYON_MODE') ?? 'compose').toLowerCase() === 'image' ? 'image' : 'compose';

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

    const limit = Number(Deno.env.get('TRYON_DAILY_LIMIT') ?? (mode === 'image' ? '10' : '30'));
    const quota = await useQuota(supabase, uid, limit);

    // Foto de modelo (privada)
    const { data: personBlob, error: de } = await supabase.storage
      .from('body-photos').download(profile.body_photo_path);
    if (de || !personBlob) throw new HttpError(400, 'Não encontrei sua foto de modelo. Envie de novo no Perfil.');
    const personB64 = toB64(await personBlob.arrayBuffer());
    const personMime = personBlob.type || 'image/jpeg';

    // ----- modo compose (gratuito) -----
    if (mode === 'compose') {
      const ordered = [...items].sort((a, b) => DRAW_ORDER.indexOf(a.category) - DRAW_ORDER.indexOf(b.category));
      const { person, boxes, fallback } = await placeWithText(
        personB64, personMime,
        ordered.map((i) => ({ id: i.id, name: i.name, category: i.category })),
      );
      const { data: bodySigned, error: bse } = await supabase.storage
        .from('body-photos').createSignedUrl(profile.body_photo_path, 600);
      if (bse || !bodySigned) throw new HttpError(500, 'Não consegui preparar sua foto de modelo.');
      return json({
        mode: 'compose',
        body_url: bodySigned.signedUrl,
        person_box: person,
        layers: ordered.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          url: i.image_url,
          box: boxes[i.id],
        })),
        approximate: fallback,
        quota,
      });
    }

    // ----- modo image (pago) -----
    const garments = await Promise.all(items.map(async (it) => {
      const r = await fetch(it.image_url);
      if (!r.ok) throw new HttpError(502, `Não consegui carregar a foto de "${it.name || it.category}".`);
      const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      return { mime, data: toB64(await r.arrayBuffer()) };
    }));
    const out = await generateImage(personB64, personMime, garments);
    const ext = out.mime.includes('jpeg') ? 'jpg' : 'png';
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('tryon').upload(path, out.bytes, {
      contentType: out.mime, upsert: false,
    });
    if (up.error) throw new HttpError(500, 'Não consegui salvar a imagem gerada.');
    const { data: signed, error: se } = await supabase.storage.from('tryon').createSignedUrl(path, 3600);
    if (se || !signed) throw new HttpError(500, 'Imagem gerada, mas não consegui gerar o link.');
    return json({ mode: 'image', url: signed.signedUrl, path, quota });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
