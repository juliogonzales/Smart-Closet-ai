// Edge Function: analyze-clothing  (v2)
// Recebe a foto (base64) de uma peça e devolve nome, categoria, cores e tags
// sugeridas por IA de visão (Gemini ou OpenAI). Opcional: o app funciona
// sem ela (preenchimento manual).
//
// Secrets usados: AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL,
//   OPENAI_API_KEY, OPENAI_MODEL, ANALYZE_DAILY_LIMIT (opcional, padrão 60)
// Arquivo único: pode ser colado direto no editor do Dashboard.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
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

const CATEGORIES = ['top', 'bottom', 'fullbody', 'outerwear', 'shoes', 'activewear', 'swimwear', 'bag', 'jewelry', 'headwear', 'accessory'];
const COLORS = [
  'preto', 'branco', 'cinza', 'bege', 'marrom', 'azul', 'azul-marinho',
  'verde', 'vermelho', 'rosa', 'amarelo', 'laranja', 'roxo', 'jeans',
];
const TAGS = [
  'casual', 'elegante', 'esporte fino', 'clássico', 'minimalista', 'streetwear',
  'esportivo', 'boho', 'preppy', 'verão', 'inverno', 'outono', 'primavera',
];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const SYSTEM =
  'Você cataloga peças de roupa a partir de fotos. ' +
  'Responda SEMPRE e SOMENTE com JSON válido, sem texto fora do JSON.';

const PROMPT = `Analise a foto desta peça de vestuário e responda neste formato exato:
{"name": string, "category": string, "colors": [string], "tags": [string]}

- "name": nome curto em português (ex.: "Camisa social branca").
- "category": exatamente um de ${JSON.stringify(CATEGORIES)}.
  (top = camisa/camiseta/blusa/regata; bottom = calça/saia/short; fullbody = vestido/macacão/jardineira; outerwear = casaco/jaqueta/blazer/cardigan/terno; shoes = tênis/sapato/sandália/bota; activewear = roupa de treino/academia (legging, top esportivo, short de corrida); swimwear = biquíni/maiô/sunga/roupa de praia; bag = bolsa/mochila/carteira de mão; jewelry = joia/bijuteria/relógio; headwear = chapéu/boné/gorro; accessory = cinto/cachecol/gravata/óculos/outro acessório)
- "colors": 1 a 3 cores predominantes, escolhidas somente de ${JSON.stringify(COLORS)}.
- "tags": 2 a 5 itens escolhidos somente de ${JSON.stringify(TAGS)} (estilo e estação em que a peça é adequada).
Se a foto não mostrar uma peça de roupa ou acessório, responda {"name": "", "category": null, "colors": [], "tags": []}.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendlyAiError(provider: string, status: number, body: string) {
  console.error(`${provider} ${status}: ${body.slice(0, 400)}`);
  if (status === 429) {
    return new HttpError(429, 'A IA está ocupada agora (muitas pessoas usando ao mesmo tempo). Espere cerca de 1 minuto e tente de novo.');
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(body)) {
    return new HttpError(502, 'A chave da IA foi recusada. Confira o secret da chave nas Edge Functions.');
  }
  if (status === 404) {
    return new HttpError(502, 'O modelo de IA configurado não existe. Confira o secret de modelo (GEMINI_MODEL).');
  }
  return new HttpError(502, 'A IA não conseguiu analisar a foto agora. Tente de novo.');
}

async function postWithRetry(url: string, init: RequestInit, provider: string) {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    last = res;
    if (![429, 500, 502, 503].includes(res.status)) break;
    if (attempt === 0) await sleep(1200);
  }
  throw friendlyAiError(provider, last!.status, await last!.text());
}

async function askVision(b64: string, mime: string): Promise<string> {
  const provider = (Deno.env.get('AI_PROVIDER') ?? 'gemini').toLowerCase();

  if (provider === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new HttpError(500, 'OPENAI_API_KEY não configurada nos Secrets.');
    const res = await postWithRetry(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
              ],
            },
          ],
        }),
      },
      'OpenAI',
    );
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new HttpError(500, 'GEMINI_API_KEY não configurada nos Secrets.');
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    responseMimeType: 'application/json',
    maxOutputTokens: 2048,
  };
  if (/^gemini-2\.5-flash/.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const res = await postWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{
          role: 'user',
          parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }],
        }],
        generationConfig,
      }),
    },
    'Gemini',
  );
  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new HttpError(422, 'A IA não conseguiu analisar esta imagem. Tente outra foto.');
  }
  return data.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
}

function parseJSON(raw: string) {
  const clean = raw.trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    console.error('JSON inválido da IA:', clean.slice(0, 300));
    throw new HttpError(502, 'A IA respondeu em formato inesperado. Tente de novo.');
  }
}

// deno-lint-ignore no-explicit-any
async function useQuota(supabase: any, userId: string) {
  const limit = Number(Deno.env.get('ANALYZE_DAILY_LIMIT') ?? '60');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'analyze')
    .gte('created_at', since);
  if (error) {
    console.warn('ai_usage indisponível:', error.message);
    return { refund: async () => {} };
  }
  if ((count ?? 0) >= limit) {
    throw new HttpError(
      429,
      `Você usou as ${limit} análises de foto das últimas 24 horas. Preencha manualmente ou volte mais tarde.`,
    );
  }
  const { data: row } = await supabase
    .from('ai_usage')
    .insert({ user_id: userId, kind: 'analyze' })
    .select('id')
    .maybeSingle();
  const refund = async () => {
    if (!row?.id) return;
    // Estorno pela chave de serviço no servidor (o usuário só insere e lê).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await admin.from('ai_usage').delete().eq('id', row.id).eq('user_id', userId);
  };
  return { refund };
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

    const body = await req.json().catch(() => ({}));
    const b64 = String(body.image_base64 ?? '').replace(/^data:[^,]+,/, '');
    const mime = String(body.mime_type ?? 'image/jpeg');
    if (!b64) throw new HttpError(400, 'Imagem ausente.');
    if (!MIMES.includes(mime)) throw new HttpError(400, 'Formato de imagem não suportado.');
    if (b64.length > 2_500_000) throw new HttpError(413, 'Imagem grande demais.');

    const quota = await useQuota(supabase, u.user.id);

    let r: any;
    try {
      r = parseJSON(await askVision(b64, mime));
    } catch (e) {
      await quota.refund(); // IA falhou: a análise não conta
      throw e;
    }
    const category = CATEGORIES.includes(r.category) ? r.category : null;
    const colors = (Array.isArray(r.colors) ? r.colors : [])
      .filter((c: string) => COLORS.includes(c)).slice(0, 3);
    const tags = (Array.isArray(r.tags) ? r.tags : [])
      .filter((t: string) => TAGS.includes(t)).slice(0, 5);

    if (!category && !colors.length) {
      throw new HttpError(422, 'Não consegui identificar uma peça de roupa nesta foto.');
    }
    return json({ name: String(r.name ?? '').slice(0, 60), category, colors, tags });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
