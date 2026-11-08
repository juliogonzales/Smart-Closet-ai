// Edge Function: stylist  (v2)
// Monta um look com as peças do guarda-roupa do usuário usando IA.
// - Valida o usuário pelo token (RLS garante que só lê as próprias peças)
// - Limite diário por usuário (tabela ai_usage)
// - Gemini (padrão) ou OpenAI, escolhido por AI_PROVIDER
//
// Secrets usados: AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL,
//   OPENAI_API_KEY, OPENAI_MODEL, STYLIST_DAILY_LIMIT (opcional, padrão 40)
// Arquivo único: pode ser colado 
direto no editor do Dashboard.

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

const SYSTEM =
  'Você é um estilista de moda pessoal brasileiro, prático e criativo. ' +
  'Responda SEMPRE e SOMENTE com JSON válido, em português do Brasil, ' +
  'sem texto fora do JSON.';

const short = (v: unknown, max: number) => String(v ?? '').slice(0, max).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- IA ----
function friendlyAiError(provider: string, status: number, body: string) {
  console.error(`${provider} $
{status}: ${body.slice(0, 400)}`);
  if (status === 429) {
    return new HttpError(429, 'A IA está com muita demanda agora. Tente de novo em instantes.');
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(body)) {
    return new HttpError(502, 'A chave da IA foi recusada. Confira o secret da chave nas Edge Functions.');
  }
  if (status === 404) {
    return new HttpError(502, 'O modelo de IA configurado não existe. Confira o secret de modelo 
(GEMINI_MODEL).');
  }
  return new HttpError(502, 'A IA não conseguiu responder agora. Tente de novo.');
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

async function askAI(prompt: string): Promise<string> {
  const provider = (Deno.env.get('AI_PROVIDER') ?? 'gemini').toLowerCase();

  if (provider === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new HttpError(500, 'OPENAI_API_KEY 
não configurada nos Secrets.');
    const res = await postWithRetry(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
          temperature: 0.9,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 
SYSTEM },
            { role: 'user', content: prompt },
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
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
  const generationConfig: Record<string, unknown> = {
    temperature: 0.9,
    responseMimeType: 'application/json',
    maxOutputTokens: 1024,
  };
  // Tarefa simples: desliga o "raciocínio" para ficar rápido e barato.
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
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    },
    'Gemini',
  );
  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new HttpError(422, 'A IA recusou este pedido. Tente descrever a ocasião de outro jeito.');
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

// ------------------------------------------------------------- limite ----
// deno-lint-ignore no-explicit-any
async function useQuota(supabase: 
any, userId: string) {
  const limit = Number(Deno.env.get('STYLIST_DAILY_LIMIT') ?? '40');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'stylist')
    .gte('created_at', since);
  if (error) {
    // Tabela ainda não criada: não bloqueia o app, só avisa no log.
    console.warn('ai_usage indisponível:', error.message);
    return { used: 0, limit };
  }
  if ((count ?? 0) >= limit) {
    throw new HttpError(
      429,
      `Você usou os ${limit} looks de IA das últimas 24 horas. Volte mais tarde!`,
    );
  }
  await supabase.from('ai_usage').insert({ user_id: userId, kind: 'stylist' });
  return { used: (count ?? 0) + 1, limit };
}

// ------------------------------------
------------------------- handler ----
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') ?? req.headers.get('apikey') ?? '',
      { global: { headers: { Authorization: 
req.headers.get('Authorization') ?? '' } } },
    );
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');

    const body = await req.json().catch(() => ({}));
    const occasion = short(body.occasion, 120) || 'dia a dia';
    const weather = short(body.weather, 80) || 'não informado';
    const style = short(body.style, 60);
    const avoid: string[] = Array.isArray(body.avoid)
      ? body.avoid.slice(0, 5).map((s: unknown) => short(s, 500))
      : [];
    const mustRaw: string[] = Array.isArray(body.must_include)
      ? body.must_include.slice(0, 3).map((s: unknown) => short(s, 60))
      : [];

    const { data: clothes, error: ce } = await supabase
      .from('clothes')
      .select('id, category, name, colors, tags')
      .order('created_at', { ascending: 
false })
      .limit(250);
    if (ce) throw new HttpError(500, 'Não consegui ler seu guarda-roupa.');
    if (!clothes || clothes.length < 2) {
      throw new HttpError(400, 'Cadastre pelo menos 2 peças no guarda-roupa para gerar looks.');
    }

    const byId = new Map(clothes.map((c: { id: string }) => [c.id, c]));
    const must = mustRaw.filter((id) => byId.has(id));

    const { data: profile } = await 
supabase
      .from('profiles').select('style_preferences').eq('id', u.user.id).maybeSingle();
    const prefs: string[] = Array.isArray(profile?.style_preferences)
      ? profile!.style_preferences : [];

    const quota = await useQuota(supabase, u.user.id);

    const wardrobe = clothes.map((c: Record<string, unknown>) => ({
      id: c.id, categoria: c.category, nome: c.name || undefined,
      cores: c.colors, tags: c.tags,
    }));
    const today = new 
Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long',
    });

    const prompt = `Monte UM look completo usando SOMENTE as peças do guarda-roupa abaixo.

CONTEXTO
- Hoje: ${today} (hemisfério sul)
- Ocasião: ${occasion}
- Clima: ${weather}
- Estilo desejado agora: ${style || 'livre'}
- Preferências gerais da pessoa: ${prefs.length ? prefs.join(', ') : 'não 
informadas'}

REGRAS
1. Use apenas ids que existem na lista. Nunca invente ids.
2. Estrutura: (top + bottom) OU fullbody. Inclua shoes se houver. outerwear só se o clima pedir (frio/chuva) ou combinar com a ocasião. accessory: 0 a 2 peças.
3. No máximo 1 peça por categoria, exceto accessory.
4. Combine cores com harmonia e respeite o dress code da ocasião e o clima.
5. Se faltar algo importante (ex.: sapato adequado, casaco para o frio), NÃO invente id: descreva 
em "missing_suggestions" uma sugestão genérica do que complementaria o look. Se não faltar nada, use null.
6. "title": nome curto e charmoso (até 5 palavras). "description": 1-2 frases explicando por que funciona. "tips": 1 dica rápida de styling.
${must.length ? `7. O look DEVE incluir estes ids: ${must.join(', ')}\n` : ''}${avoid.length ? `8. NÃO repita estas combinações já sugeridas (ids): ${avoid.join(' | ')}\n` : ''}
GUARDA-ROUPA (JSON):
${JSON.stringify(wardrobe)}

Responda neste formato exato:
{"title": string, "description": string, "item_ids": [string], "missing_suggestions": string | null, "tips": string}`;

    const result = parseJSON(await askAI(prompt));

    // Validação: só ids reais, 1 por categoria (acessórios até 2),
    // e nunca peça única junto com top/bottom. Peças obrigatórias primeiro.
    const ids: string[] = [];
    // deno-lint-ignore no-explicit-any
    const catOf = (id: string) => (byId.get(id) as any).category as string;
    const tryAdd = (id: unknown) => {
      if (typeof id !== 'string' || !byId.has(id) || ids.includes(id)) return;
      const cat = catOf(id);
      const same = ids.filter((i) => catOf(i) === cat).length;
      if (same >= (cat === 'accessory' ? 2 : 1)) return;
      const hasFull = ids.some((i) => catOf(i) === 'fullbody');
      const hasTopBottom = ids.some((i) => ['top', 'bottom'].includes(catOf(i)));
      if (cat === 'fullbody' && hasTopBottom) return;
      if ((cat === 'top' || cat === 
'bottom') && hasFull) return;
      ids.push(id);
    };
    must.forEach(tryAdd);
    (Array.isArray(result.item_ids) ? result.item_ids : []).forEach(tryAdd);

    return json({
      title: short(result.title, 80) || 'Look do dia',
      description: short(result.description, 400),
      item_ids: ids,
      missing_suggestions: result.missing_suggestions
        ? short(result.missing_suggestions, 
300) : null,
      tips: short(result.tips, 300),
      quota,
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
