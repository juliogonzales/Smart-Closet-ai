// Edge Function: stylist  (v2)
// Monta um look com as peças do guarda-roupa do usuário usando IA.
// - Valida o usuário pelo token (RLS garante que só lê as próprias peças)
// - Limite diário por usuário (tabela ai_usage)
// - Gemini (padrão) ou OpenAI, escolhido por AI_PROVIDER
//
// Secrets usados: AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL,
//   OPENAI_API_KEY, OPENAI_MODEL, STYLIST_DAILY_LIMIT (opcional, padrão 40)
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

const SYSTEM =
  'Você é um estilista de moda pessoal brasileiro, prático e criativo. ' +
  'Responda SEMPRE e SOMENTE com JSON válido, em português do Brasil, ' +
  'sem texto fora do JSON.';

const short = (v: unknown, max: number) => String(v ?? '').slice(0, max).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- IA ----
function friendlyAiError(provider: string, status: number, body: string) {
  console.error(`${provider} ${status}: ${body.slice(0, 400)}`);
  if (status === 429) {
    return new HttpError(429, 'A IA está ocupada agora (muitas pessoas usando ao mesmo tempo). Espere cerca de 1 minuto e toque em gerar de novo.');
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(body)) {
    return new HttpError(502, 'A chave da IA foi recusada. Confira o secret da chave nas Edge Functions.');
  }
  if (status === 404) {
    return new HttpError(502, 'O modelo de IA configurado não existe. Confira o secret de modelo (GEMINI_MODEL).');
  }
  return new HttpError(502, 'A IA não conseguiu responder agora. Tente de novo.');
}

async function postWithRetry(url: string, init: RequestInit, provider: string) {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      // Limite por tentativa: evita que a função seja derrubada pelo Supabase (erro 546).
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new HttpError(504, 'A IA demorou demais para responder. Tente de novo.');
      }
      throw e;
    }
    if (res.ok) return res;
    last = res;
    if (![429, 500, 502, 503].includes(res.status)) break;
    if (attempt === 0) await sleep(1000);
  }
  throw friendlyAiError(provider, last!.status, await last!.text());
}

async function askAI(prompt: string): Promise<string> {
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
          temperature: 0.9,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
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
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const baseConfig: Record<string, unknown> = {
    temperature: 0.9,
    responseMimeType: 'application/json',
    maxOutputTokens: 2048,
  };
  const makeInit = (config: Record<string, unknown>): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: config,
    }),
  });
  // Modelos "pensantes" (família 3) gastam muito tempo raciocinando. Pedimos raciocínio mínimo;
  // se o modelo recusar esse campo, repetimos sem ele.
  const thinkingConfig = /^gemini-[3-9]/.test(model) ? { thinkingLevel: 'low' } : null;
  const configWithThinking = thinkingConfig ? { ...baseConfig, thinkingConfig } : baseConfig;
  if (/^gemini-2\.5-flash/.test(model)) {
    baseConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  let res: Response;
  try {
    res = await postWithRetry(url, makeInit(configWithThinking), 'Gemini');
  } catch (e) {
    if (thinkingConfig && e instanceof HttpError && e.status === 502) {
      res = await postWithRetry(url, makeInit(baseConfig), 'Gemini');
    } else {
      throw e;
    }
  }
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
// Conta a tentativa ANTES da IA (para barrar toques repetidos), mas DEVOLVE a
// tentativa se a IA falhar. Assim só look gerado com sucesso consome o limite.
// deno-lint-ignore no-explicit-any
async function useQuota(supabase: any, userId: string) {
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
    return { info: { used: 0, limit }, refund: async () => {} };
  }
  if ((count ?? 0) >= limit) {
    throw new HttpError(
      429,
      `Você usou os ${limit} looks de IA das últimas 24 horas. Volte mais tarde!`,
    );
  }
  // Pausa mínima entre gerações: evita rajadas que só geram "IA ocupada".
  const { data: last } = await supabase
    .from('ai_usage')
    .select('created_at')
    .eq('kind', 'stylist')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.created_at && Date.now() - Date.parse(last.created_at) < 15000) {
    throw new HttpError(429, 'Espere uns 15 segundos antes de gerar outro look.');
  }
  const { data: row } = await supabase
    .from('ai_usage')
    .insert({ user_id: userId, kind: 'stylist' })
    .select('id')
    .maybeSingle();
  const refund = async () => {
    if (!row?.id) return;
    // A tabela só permite ao usuário inserir e ler; o estorno usa a chave de serviço no servidor.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await admin.from('ai_usage').delete().eq('id', row.id).eq('user_id', userId);
  };
  return { info: { used: (count ?? 0) + 1, limit }, refund };
}

// ------------------------------------------------------------- handler ----
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
      .order('created_at', { ascending: false })
      .limit(250);
    if (ce) throw new HttpError(500, 'Não consegui ler seu guarda-roupa.');
    if (!clothes || clothes.length < 2) {
      throw new HttpError(400, 'Cadastre pelo menos 2 peças no guarda-roupa para gerar looks.');
    }

    const byId = new Map(clothes.map((c: { id: string }) => [c.id, c]));
    const must = mustRaw.filter((id) => byId.has(id));

    const { data: profile } = await supabase
      .from('profiles').select('style_preferences').eq('id', u.user.id).maybeSingle();
    const prefs: string[] = Array.isArray(profile?.style_preferences)
      ? profile!.style_preferences : [];

    const quota = await useQuota(supabase, u.user.id);
    let result: any;

    const wardrobe = clothes.map((c: Record<string, unknown>) => ({
      id: c.id, categoria: c.category, nome: c.name || undefined,
      cores: c.colors, tags: c.tags,
    }));
    // Gosto observado: avaliações da própria pessoa (gostei, não gostei, vou usar).
    // Se a consulta falhar, a IA segue sem essa informação.
    const { data: fbRows } = await supabase
      .from('outfit_feedback')
      .select('rating, will_wear, outfits(items, occasion)')
      .order('updated_at', { ascending: false })
      .limit(30);
    // deno-lint-ignore no-explicit-any
    const describeLook = (row: any): string | null => {
      const names = (row?.outfits?.items || [])
        .map((id: string) => byId.get(id))
        .filter(Boolean)
        // deno-lint-ignore no-explicit-any
        .map((c: any) => `${c.name || c.category}${Array.isArray(c.colors) && c.colors.length ? ` (${c.colors.join('/')})` : ''}`);
      return names.length ? `${row.outfits?.occasion || 'sem ocasião'}: ${names.join(', ')}` : null;
    };
    // deno-lint-ignore no-explicit-any
    const rows: any[] = Array.isArray(fbRows) ? fbRows : [];
    const liked = rows.filter((r) => r.rating === 1 || r.will_wear === true).map(describeLook).filter(Boolean).slice(0, 6);
    const disliked = rows.filter((r) => r.rating === -1).map(describeLook).filter(Boolean).slice(0, 6);
    const tasteBlock = liked.length || disliked.length
      ? `\nGOSTO OBSERVADO (avaliações anteriores desta pessoa):\n${liked.length ? `- Gostou ou vai usar: ${liked.join(' || ')}\n` : ''}${disliked.length ? `- Não gostou: ${disliked.join(' || ')}\n` : ''}Use isso como referência de estilo e não repita combinações que ela não gostou.\n`
      : '';

    const today = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long',
    });

    const prompt = `Monte UM look completo usando SOMENTE as peças do guarda-roupa abaixo.

CONTEXTO
- Hoje: ${today} (hemisfério sul)
- Ocasião: ${occasion}
- Clima: ${weather}
- Estilo desejado agora: ${style || 'livre'}
- Preferências gerais da pessoa: ${prefs.length ? prefs.join(', ') : 'não informadas'}
${tasteBlock}
REGRAS
1. Use apenas ids que existem na lista. Nunca invente ids.
2. Estrutura: (top + bottom) OU fullbody. Inclua shoes se houver. outerwear só se o clima pedir (frio/chuva) ou combinar com a ocasião. Acessórios (bag, jewelry, headwear, accessory): 0 a 2 peças no total. activewear (esporte) e swimwear (praia) só se a ocasião pedir treino ou praia; nunca misture com terno ou vestido de festa.
3. No máximo 1 peça por categoria.
4. Combine cores com harmonia e respeite o dress code da ocasião e o clima.
5. Se faltar algo importante (ex.: sapato adequado, casaco para o frio), NÃO invente id: descreva em "missing_suggestions" uma sugestão genérica do que complementaria o look. Se não faltar nada, use null.
6. "title": nome curto e charmoso (até 5 palavras). "description": 1-2 frases explicando por que funciona. "tips": 1 dica rápida de styling.
${must.length ? `7. O look DEVE incluir estes ids: ${must.join(', ')}\n` : ''}${avoid.length ? `8. NÃO repita estas combinações já sugeridas (ids): ${avoid.join(' | ')}\n` : ''}
GUARDA-ROUPA (JSON):
${JSON.stringify(wardrobe)}

Responda neste formato exato:
{"title": string, "description": string, "item_ids": [string], "missing_suggestions": string | null, "tips": string}`;

    try {
      result = parseJSON(await askAI(prompt));
    } catch (e) {
      await quota.refund(); // IA falhou: a tentativa não conta
      throw e;
    }

    // Validação: só ids reais, 1 por categoria (acessórios até 2),
    // e nunca peça única junto com top/bottom. Peças obrigatórias primeiro.
    const ids: string[] = [];
    // deno-lint-ignore no-explicit-any
    const catOf = (id: string) => (byId.get(id) as any).category as string;
    const ACCESSORY = ['bag', 'jewelry', 'headwear', 'accessory'];
    const tryAdd = (id: unknown) => {
      if (typeof id !== 'string' || !byId.has(id) || ids.includes(id)) return;
      const cat = catOf(id);
      const same = ids.filter((i) => catOf(i) === cat).length;
      if (same >= 1) return; // 1 peça por categoria
      if (ACCESSORY.includes(cat) && ids.filter((i) => ACCESSORY.includes(catOf(i))).length >= 2) return;
      const hasFull = ids.some((i) => catOf(i) === 'fullbody');
      const hasTopBottom = ids.some((i) => ['top', 'bottom'].includes(catOf(i)));
      if (cat === 'fullbody' && hasTopBottom) return;
      if ((cat === 'top' || cat === 'bottom') && hasFull) return;
      ids.push(id);
    };
    must.forEach(tryAdd);
    (Array.isArray(result.item_ids) ? result.item_ids : []).forEach(tryAdd);

    return json({
      title: short(result.title, 80) || 'Look do dia',
      description: short(result.description, 400),
      item_ids: ids,
      missing_suggestions: result.missing_suggestions
        ? short(result.missing_suggestions, 300) : null,
      tips: short(result.tips, 300),
      quota: quota.info,
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
