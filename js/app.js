// Smart Closet AI — SPA (hash routing) para GitHub Pages + Supabase
import { CONFIG } from './config.js';

/* ============================================================
   Supabase client
   ============================================================ */
const configured =
  CONFIG.SUPABASE_URL &&
  CONFIG.SUPABASE_ANON_KEY &&
  !CONFIG.SUPABASE_URL.includes('SEU-PROJETO') 
&&
  !CONFIG.SUPABASE_ANON_KEY.startsWith('SUA_CHAVE');

const sb = configured
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/* ============================================================
   Constantes
   ============================================================ */
const CATEGORIES = {
  top: 'Parte de cima',
  bottom: 'Parte de baixo',
  fullbody: 'Peça única',
  outerwear: 'Casaco',
  shoes: 'Calçado',
  accessory: 'Acessório',
};
const CAT_ORDER = ['outerwear', 'top', 'fullbody', 'bottom', 'shoes', 'accessory'];
const SEASONS = ['verão', 'outono', 'inverno', 'primavera'];
const STYLES = ['casual', 'formal', 
'esporte fino', 'street', 'esportivo', 'festa', 'minimalista', 'clássico'];
const PROFILE_STYLES = ['casual', 'esporte fino', 'street', 'minimalista', 'clássico', 'esportivo', 'elegante', 'boho'];
const COLORS = {
  preto: '#111827', branco: '#ffffff', cinza: '#9ca3af', bege: '#d6c3a5', marrom: '#7c5a3c',
  azul: '#2563eb', 'azul-marinho': '#1e3a8a', verde: '#16a34a', vermelho: '#dc2626', rosa: '#f472b6',
  amarelo: '#facc15', laranja: '#fb923c', roxo: '#7c3aed', jeans: '#4b6a9b',
};
const OCCASIONS = [
  'Dia a dia', 'Encontro casual', 'Reunião de trabalho', 'Festa à noite',
  'Academia', 'Viagem', 'Evento formal', 'Fim de semana',
];
const WEATHERS = [
  { id: 'frio', label: 'Frio' },
  { id: 'ameno', label: 'Ameno' },
  { id: 'quente', label: 'Quente' },
  { id: 'chuva', label: 'Chuva' },
];

/* ============================================================
   Utilidades de DOM
   
============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = () => $('#view');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (d) => `<path stroke-linecap="round" stroke-linejoin="round" d="${d}"/
>`;
const ICONS = {
  home: P('M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25'),
  closet: P('M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 
01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'),
  sparkles: P('M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 
3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z'),
  user: P('M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'),
  plus: P('M12 4.5v15m7.5-7.5h-15'),
  heart: P('M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z'),
  share: P('M7.217 
10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z'),
  trash: P('M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 
0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0'),
  x: P('M6 18L18 6M6 6l12 12'),
  camera: P('M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 
1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z'),
  photo: P('M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'),
  refresh: P('M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 
8.25 0 0113.803-3.7l3.181 3.183m0-4.991v4.99'),
  check: P('M4.5 12.75l6 6 9-13.5'),
  download: P('M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3'),
  pin: P('M15 10.5a3 3 0 11-6 0 3 3 0 016 0zM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z'),
  scissors: P('M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 
15.75l1.536-.887m-1.536.887a3 3 0 11-5.196 3 3 3 0 015.196-3zm1.536-.887a2.165 2.165 0 001.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863l2.077-1.199m0-3.328a4.323 4.323 0 012.068-1.379l5.325-1.628a4.5 4.5 0 012.43-.039m-9.823 5.01l5.325 1.628a4.5 4.5 0 002.43.039'),
};
const icon = (n, cls = 'h-5 w-5') =>
  `<svg class="${cls}" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">${ICONS[n] || ''}</svg>`;

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  const tone = type === 'error' ? 'bg-red-600' : type === 'ok' ? 'bg-emerald-700' : 'bg-stone-900';
  el.className = `fade-up pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm text-white shadow-lg ${tone}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5200 : 2800);
}

function setBusy(on, text = 
'Carregando…') {
  const b = $('#busy');
  $('#busy-text').textContent = text;
  b.classList.toggle('hidden', !on);
  b.classList.toggle('flex', on);
}

function openModal(inner, { sheet = true } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 z-40 flex ${sheet ? 'items-end' : 'items-center'} justify-center bg-stone-900/50" data-backdrop>
      <div class="${sheet ? 'sheet-up rounded-t-[2rem]' : 'fade-up 
rounded-[2rem] m-4'} max-h-[92vh] w-full max-w-xl overflow-y-auto bg-white p-5 safe-bottom" role="dialog" aria-modal="true">
        ${inner}
      </div>
    </div>`;
  const back = $('[data-backdrop]', root);
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
  return root;
}
function closeModal() { $
('#modal-root').innerHTML = ''; }

const modalHeader = (title) => `
  <div class="mb-4 flex items-center justify-between">
    <h3 class="font-display text-xl">${esc(title)}</h3>
    <button data-close class="btn btn-ghost !p-2" aria-label="Fechar">${icon('x')}</button>
  </div>`;

/* ============================================================
   Estado
   
============================================================ */
const state = {
  session: null,
  user: null,
  profile: null,
  clothes: [],
  outfits: [],
  loaded: false,
  closetFilter: 'all',
  draft: null,
  gen: { occasion: '', weather: '', style: '', result: null, history: [], customOccasion: '' },
};

function resetState() {
  Object.assign(state, {
    session: null, user: null, profile: null, clothes: [], outfits: [], loaded: false,
    closetFilter: 'all', draft: null,
    gen: { occasion: '', weather: '', style: '', result: null, history: [], customOccasion: '' },
  });
}

async function loadAll() {
  const uid = state.user.id;
  const [p, c, o] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('clothes').select('*').eq('
user_id', uid).order('created_at', { ascending: false }),
    sb.from('outfits').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
  ]);
  if (c.error) throw c.error;
  if (o.error) throw o.error;
  let profile = p.data;
  if (!profile) {
    const ins = await sb.from('profiles').upsert({ id: uid, full_name: state.user.email.split('@')[0] }).select().single();
    profile = ins.data;
  }
  state.profile = profile;
  state.clothes = c.data || [];
  state.outfits = o.data || [];
  state.loaded = true;
}

const clothesById = () => new Map(state.clothes.map((c) => [c.id, c]));
const itemsOf = (outfit) => {
  const m = clothesById();
  return (outfit.items || []).map((id) => m.get(id)).filter(Boolean);
};
const shareUrl = (id) => `${location.origin}${location.pathname}#/share/${id}`;

async function fnError(e) {
  try {
    if (e?.context && typeof e.context.json === 'function') {
      const j = await e.context.json();
      if (j?.error) return j.error;
    }
  } catch { /* ignora */ }
  const msg = e?.message || 'Algo deu errado.';
  if (/Failed to send a request|fetch/i.test(msg)) {
    return 'Não consegui falar com a função de IA. Confira se as Edge Functions foram publicadas.';
  }
  return msg;
}

/* 
============================================================
   Layout: navegação inferior
   ============================================================ */
const NAV = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'closet', label: 'Guarda-roupa', icon: 'closet' },
  { id: 'create', label: 'Criar look', icon: 'sparkles' },
  { id: 'profile', label: 'Perfil', icon: 'user' },
];
function renderNav(active) {
  const nav = $('#bottomnav');
  if (!active) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  nav.innerHTML = `<div class="mx-auto grid max-w-xl grid-cols-4">
    ${NAV.map((n) => `
      <a href="#/${n.id}" class="flex flex-col items-center gap-1 py-2.5 text-[11px] ${n.id === active ? 'font-semibold text-stone-900' : 'text-stone-400'}" ${n.id === active ? 'aria-current="page"' : ''}>
        ${icon(n.icon, 'h-6 w-6')}<span>${n.label}</span>
      </a>`).join('')}
  </div>`;
}

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

/* ============================================================
   Roteador
   ============================================================ */
async function route() {
  if (!sb) return renderConfigMissing();
  const hash = location.hash.startsWith('#/') ? location.hash.slice(2) : '';
  const [name = '', arg] = hash.split('/');
  window.scrollTo(0, 0);

  // Rota pública: look compartilhado
  if (name === 'share') { renderNav(null); return renderShare(arg); }

  if (!state.session) {
    renderNav(null);
    if (name === 'register') return renderRegister();
    if (name === 'reset') return 
renderReset();
    if (name !== 'login') return go('#/login');
    return renderLogin();
  }

  if (name === 'update-password') { renderNav(null); return renderUpdatePassword(); }

  if (!state.loaded) {
    setBusy(true, 'Abrindo seu closet…');
    try { await loadAll(); }
    catch (e) { setBusy(false); toast(e.message || 'Erro ao carregar dados', 'error'); return renderFatal(e); }
    setBusy(false);
  }

  if (!state.profile?.onboarded && name !== 'onboarding') return go('#/onboarding');

  switch (name) {
    case 'onboarding': renderNav(null); return renderOnboarding();
    case 'closet': renderNav('closet'); return arg === 'new' ? renderNewItem() : renderCloset();
    case 'create': renderNav('create'); return renderCreate();
    case 'profile': renderNav('profile'); return 
renderProfile();
    case 'outfit': renderNav('home'); return renderOutfitDetail(arg);
    case 'home': renderNav('home'); return renderHome();
    default: return go('#/home');
  }
}

/* ============================================================
   Telas de erro/config
   ============================================================ */
function renderConfigMissing() {
  renderNav(null);
  view().innerHTML = `
    <div class="card mt-10 p-6">
      <h1 class="font-display text-2xl">Falta configurar o Supabase</h1>
      <p class="mt-3 text-sm text-stone-600">Abra o arquivo <code class="rounded bg-stone-100 px-1.5 py-0.5">js/config.js</code> e preencha
      <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> com os dados do seu projeto (Project Settings → API).</p>
      <p class="mt-3 text-sm text-stone-600">O passo a passo completo está no arquivo 
<b>SUPABASE_SETUP.md</b>.</p>
    </div>`;
}
function renderFatal(e) {
  view().innerHTML = `
    <div class="card mt-10 p-6">
      <h1 class="font-display text-2xl">Não consegui carregar seus dados</h1>
      <p class="mt-3 text-sm text-stone-600">${esc(e?.message || 'Erro desconhecido')}</p>
      <p class="mt-3 text-sm text-stone-600">Se acabou de criar o projeto, confira se o <b>schema.sql</b> foi executado.</p>
      <button class="btn btn-primary 
mt-5" id="retry">Tentar de novo</button>
    </div>`;
  $('#retry').onclick = () => route();
}

/* ============================================================
   Autenticação
   ============================================================ */
const authShell = (title, subtitle, body) => `
  <div class="fade-up mx-auto mt-8 max-w-sm">
    <div class="mb-8 text-center">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-900 text-white">${icon('closet', 'h-7 w-7')}</div>
      <h1 class="font-display text-3xl">${title}</h1>
      <p class="mt-1.5 text-sm text-stone-500">${subtitle}</p>
    </div>
    ${body}
  </div>`;

function renderLogin() {
  view().innerHTML = authShell('Smart Closet AI', 'Seu guarda-roupa digital com estilista 
de IA', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required autocomplete="email" class="input" placeholder="voce@email.com"></div>
      <div><label class="label" for="pw">Senha</label><input id="pw" type="password" required autocomplete="current-password" class="input" placeholder="••••••••"></div>
      <button class="btn btn-primary w-full" type="submit">Entrar</button>
    </form>
    <div class="mt-5 flex items-center justify-between text-sm">
      <a href="#/reset" class="text-stone-500 underline-offset-2 hover:underline">Esqueci a senha</a>
      <a href="#/register" class="font-medium underline-offset-2 hover:underline">Criar conta</a>
    </div>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Entrando…');
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $
('#pw').value });
    setBusy(false);
    if (error) return toast(/Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message, 'error');
    state.session = data.session; state.user = data.user;
    state.loaded = false;
    go('#/home');
  };
}

function renderRegister() {
  view().innerHTML = authShell('Criar conta', 'Leva menos de um minuto', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="name">Nome</label><input id="name" required autocomplete="name" class="input" placeholder="Como quer ser chamada(o)?"></div>
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required autocomplete="email" class="input"></div>
      <div><label class="label" for="pw">Senha (mín. 6 caracteres)</label><input id="pw" type="password" required minlength="6" autocomplete="new-password" class="input"></div>
      <button class="btn btn-primary w-full" type="submit">Cadastrar</button>
    </form>
    <p class="mt-5 text-center text-sm text-stone-500">Já tem conta? <a href="#/login" class="font-medium text-stone-900 underline-offset-2 hover:underline">Entrar</a></p>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Criando conta…');
    const { data, error } = await sb.auth.signUp({
      email: $('#email').value.trim(),
      password: $('#pw').value,
      options: { data: { full_name: $('#name').value.trim() }, 
emailRedirectTo: location.origin + location.pathname },
    });
    setBusy(false);
    if (error) return toast(error.message, 'error');
    if (data.session) { state.session = data.session; state.user = data.user; state.loaded = false; return go('#/onboarding'); }
    view().innerHTML = authShell('Confirme seu e-mail', 'Quase lá!', `
      <div class="card p-5 text-sm text-stone-600">Enviamos um link de confirmação para <b>${esc($('#email')?.value || 'seu e-mail')}</b>. Depois de confirmar, é só 
entrar.
        <a href="#/login" class="btn btn-primary mt-4 w-full">Ir para o login</a></div>`);
  };
}

function renderReset() {
  view().innerHTML = authShell('Redefinir senha', 'Enviaremos um link para o seu e-mail', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required class="input"></div>
      <button class="btn btn-primary 
w-full" type="submit">Enviar link</button>
    </form>
    <p class="mt-5 text-center text-sm"><a href="#/login" class="text-stone-500 underline-offset-2 hover:underline">Voltar ao login</a></p>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Enviando…');
    const { error } = await sb.auth.resetPasswordForEmail($('#email').value.trim(), { redirectTo: location.origin + location.pathname });
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast('Se o e-mail existir, o link foi enviado.', 'ok');
  };
}

function renderUpdatePassword() {
  view().innerHTML = authShell('Nova senha', 'Escolha uma senha que você não use em outro lugar', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="pw">Nova senha</label><input id="pw" type="password" required minlength="6" 
autocomplete="new-password" class="input"></div>
      <button class="btn btn-primary w-full" type="submit">Salvar senha</button>
    </form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Salvando…');
    const { error } = await sb.auth.updateUser({ password: $('#pw').value });
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast('Senha atualizada!', 'ok');
    go('#/home');
  };
}

/* ============================================================
   Onboarding
   ============================================================ */
function renderOnboarding() {
  const sel = new Set(state.profile?.style_preferences || []);
  const paint = () => {
    view().innerHTML = `
      <div class="fade-up mx-auto mt-6 max-w-md">
        <p class="text-xs font-medium uppercase tracking-widest text-stone-400">Bem-vinda(o)</p>
        <h1 class="mt-2 font-display text-3xl leading-tight">Como é o seu estilo?</h1>
        <p class="mt-2 text-sm text-stone-500">Escolha quantos quiser. A IA usa isso para montar looks mais a sua cara.</p>
        <div class="mt-6">
          <label class="label" for="name">Seu nome</label>
          <input id="name" class="input" value="${esc(state.profile?.full_name || '')}" placeholder="Seu nome">
        </div>
        <div class="mt-6 flex flex-wrap gap-2">
          ${PROFILE_STYLES.map((s) => `<button type="button" data-s="${esc(s)}" class="chip ${sel.has(s) ? 'chip-on' : ''}">${esc(s)}</button>`).join('')}
        </div>
        <button id="done" class="btn btn-primary mt-8 w-full">Começar</button>
      </div>`;
    $$('[data-s]').forEach((b) => (b.onclick = () => {
      const name = $('#name').value; const v = b.dataset.s;
      sel.has(v) ? sel.delete(v) : sel.add(v);
      state.profile.full_name = name; paint(); $('#name').value = name;
    }));
    $('#done').onclick = async () => {
      setBusy(true, 'Salvando…');
      const { data, error } = await sb.from('profiles')
        .update({ full_name: $('#name').value.trim() || state.profile.full_name, style_preferences: [...sel], onboarded: true })
        .eq('id', state.user.id).select().single();
      setBusy(false);
      if (error) return toast(error.message, 'error');
      state.profile = data;
      go('#/home');
    };
  };
  paint();
}

/* ============================================================
   Look Card (colagem) — usado em tela e no canvas
   ============================================================ */
const sortItems = (items) =>
  [...items].sort((a, b) => CAT_ORDER.indexOf(a.category) - 
CAT_ORDER.indexOf(b.category));

function layoutItems(items) {
  const s = sortItems(items);
  const out = [];
  let col = 0;
  s.forEach((it, i) => {
    let span = it.category === 'fullbody' ? 2 : 1;
    if (span === 1 && i === s.length - 1 && col === 0) span = 2;
    if (span === 2 && col === 1) { out[out.length - 1].span = 2; col = 0; }
    out.push({ it, span });
    col = (col + span) % 2;
  });
  return out;
}

function lookCard(items) {
  if (!items.length) return '';
  return `<div class="rounded-[2rem] bg-gradient-to-b from-stone-100 to-stone-200 p-3">
    <div class="grid grid-cols-2 gap-2.5">
      ${layoutItems(items).map(({ it, span }) => `
        <figure class="relative flex items-center justify-center overflow-hidden rounded-2xl bg-white/85 p-3 ${span === 2 ? 'col-span-2 aspect-[2/1]' : 'aspect-square'}">
          <img src="${esc(it.image_url)}" alt="${esc(it.name || CATEGORIES[it.category])}" crossorigin="anonymous" loading="lazy" class="max-h-full max-w-full object-contain">
          <figcaption class="absolute bottom-1.5 left-3 text-[10px] uppercase tracking-wider text-stone-400">${CATEGORIES[it.category]}</figcaption>
        </figure>`).join('')}
    </div></div>`;
}

const miniCollage = (items) => {
  const imgs = sortItems(items).slice(0, 4);
  if (!imgs.length) return `<div class="flex aspect-square items-center justify-center rounded-2xl bg-stone-100 text-stone-300">${icon('photo', 'h-8 w-8')}</div>`;
  return `<div class="grid aspect-square grid-cols-2 gap-1 overflow-hidden rounded-2xl bg-stone-100 p-1.5">
    ${imgs.map((i) => `<div class="flex items-center justify-center rounded-lg bg-white p-1"><img src="${esc(i.image_url)}" alt="" crossorigin="anonymous" loading="lazy" class="max-h-full 
max-w-full object-contain"></div>`).join('')}
  </div>`;
};

/* ============================================================
   Início
   ============================================================ */
function renderHome() {
  const first = (state.profile?.full_name || '').split(' ')[0] || 'olá';
  const hour = new 
Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const empty = state.clothes.length === 0;

  view().innerHTML = `
    <div class="fade-up">
      <p class="text-sm text-stone-500">${greet},</p>
      <h1 class="font-display text-3xl">${esc(first)}</h1>

      <div class="mt-6 rounded-[2rem] bg-stone-900 p-6 text-white">
        <p class="text-xs 
uppercase tracking-widest text-stone-400">Estilista de IA</p>
        <h2 class="mt-2 font-display text-2xl leading-snug">${empty ? 'Comece cadastrando suas primeiras peças' : 'O que vamos vestir hoje?'}</h2>
        <a href="${empty ? '#/closet/new' : '#/create'}" class="btn mt-5 bg-white text-stone-900 hover:bg-stone-100">
          ${icon(empty ? 'camera' : 'sparkles')} ${empty ? 'Adicionar peça' : 'Criar look'}
        </a>
      </div>

      <div class="mt-4 grid grid-cols-2 
gap-3">
        <a href="#/closet" class="card p-4"><p class="font-display text-3xl">${state.clothes.length}</p><p class="text-xs text-stone-500">peças no guarda-roupa</p></a>
        <div class="card p-4"><p class="font-display text-3xl">${state.outfits.length}</p><p class="text-xs text-stone-500">looks favoritos</p></div>
      </div>

      <h2 class="mb-3 mt-8 font-display text-xl">Looks favoritos</h2>
      ${state.outfits.length ? `
        <div class="grid grid-cols-2 gap-3">
          ${state.outfits.map((o) => `
            <a href="#/outfit/${o.id}" class="block">
              ${miniCollage(itemsOf(o))}
              <p class="mt-2 truncate text-sm font-medium">${esc(o.title)}</p>
              <p class="truncate text-xs text-stone-500">${esc(o.occasion || '')}${o.is_public ? ' · público' : ''}</p>
            </a>`).join('')}
        </div>` : `<p class="rounded-2xl bg-stone-100 p-5 text-sm text-stone-500">Quando você salvar um look nos favoritos, ele aparece aqui.</p>`}
    </div>`;
}

/* ============================================================
   Guarda-roupa
   ============================================================ */
function renderCloset() {
  const f = state.closetFilter;
  const list = f === 'all' ? state.clothes : state.clothes.filter((c) => c.category === f);
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center justify-between">
        <h1 class="font-display text-3xl">Guarda-roupa</h1>
        <a href="#/closet/new" class="btn btn-primary !px-4">${icon('plus', 'h-4 w-4')} Peça</a>
      </div>
      <div class="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        ${[['all', 'Tudo'], ...Object.entries(CATEGORIES)].map(([k, v]) =>
          `<button data-f="${k}" class="chip shrink-0 ${f === k ? 'chip-on' : ''}">${v}</button>`).join('')}
      </div>
      ${list.length ? `
        <div class="mt-4 grid grid-cols-2 gap-3">
          ${list.map((c) => `
            <button data-id="${c.id}" class="card overflow-hidden text-left">
              <div class="flex aspect-square items-center justify-center bg-stone-50 p-3">
                <img src="${esc(c.image_url)}" alt="${esc(c.name || CATEGORIES[c.category])}" loading="lazy" class="max-h-full max-w-full object-contain">
              </div>
              <div class="p-3">
                <p class="truncate text-sm font-medium">${esc(c.name || CATEGORIES[c.category])}</p>
                <div class="mt-1.5 flex items-center gap-1">
                  ${(c.colors || []).slice(0, 4).map((k) => `<span class="h-3 w-3 rounded-full ring-1 ring-stone-200" style="background:${COLORS[k] || '#ccc'}"></span>`).join('')}
                  <span class="ml-auto text-[11px] text-stone-400">${CATEGORIES[c.category]}</span>
                </div>
              </div>
            </button>`).join('')}
        </div>` : `
        <div class="mt-10 text-center 
text-stone-500">
          <p class="text-sm">${state.clothes.length ? 'Nenhuma peça nesta categoria.' : 'Seu guarda-roupa está vazio.'}</p>
          <a href="#/closet/new" class="btn btn-primary mt-4">${icon('camera')} Adicionar peça</a>
        </div>`}
    </div>`;
  $$('[data-f]').forEach((b) => (b.onclick = () => { state.closetFilter = b.dataset.f; renderCloset(); }));
  $$('[data-id]').forEach((b) => (b.onclick = () => openItemModal(b.dataset.id)));
}

/* --- formulário reutilizável (nova peça / edição) --- */
function chipRow(values, selected, attr, render = (v) => v) {
  return values.map((v) => `<button type="button" data-${attr}="${esc(v)}" class="chip ${selected.has(v) ? 'chip-on' : ''}">${render(v)}</button>`).join('');
}

function mountItemForm(container, d) {
  const paint = () => {
    container.innerHTML = `
      <div class="space-y-5">
        <div><label class="label" for="i-name">Nome (opcional)</
label>
          <input id="i-name" class="input" value="${esc(d.name || '')}" placeholder="Ex.: Camisa social branca"></div>
        <div><span class="label">Categoria</span>
          <div class="flex flex-wrap gap-2">${Object.entries(CATEGORIES).map(([k, v]) =>
            `<button type="button" data-cat="${k}" class="chip ${d.category === k ? 'chip-on' : ''}">${v}</button>`).join('')}</div></div>
        <div><span class="label">Cores predominantes</span>
          <div class="flex 
flex-wrap gap-2">${chipRow(Object.keys(COLORS), d.colors, 'color', (v) =>
            `<span class="h-3.5 w-3.5 rounded-full ring-1 ring-stone-300" style="background:${COLORS[v]}"></span>${v}`)}</div></div>
        <div><span class="label">Estação</span>
          <div class="flex flex-wrap gap-2">${chipRow(SEASONS, d.tags, 'tag')}</div></div>
        <div><span class="label">Estilo</span>
          <div class="flex flex-wrap gap-2">${chipRow(STYLES, d.tags, 'tag')}</div></div>
      </div>`;
    $('#i-name', container).oninput = (e) => (d.name = e.target.value);
    $$('[data-cat]', container).forEach((b) => (b.onclick = () => { d.category = b.dataset.cat; paint(); }));
    $$('[data-color]', container).forEach((b) => (b.onclick = () => { toggle(d.colors, b.dataset.color); paint(); }));
    $$('[data-tag]', container).forEach((b) => (b.onclick = () => { toggle(d.tags, b.dataset.tag); paint(); }));
  };
  paint();
  return paint;
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

/* --- modal de detalhe/edição --- */
function openItemModal(id) {
  const item = state.clothes.find((c) => c.id === id);
  if (!item) return;
  const d = { name: item.name || '', category: item.category, colors: new Set(item.colors || []), tags: new Set(item.tags || []) };
  const root = openModal(`
    ${modalHeader('Peça')}
    <div class="mb-5 flex aspect-[4/3] items-center justify-center rounded-3xl bg-stone-50 p-4"><img 
src="${esc(item.image_url)}" alt="" class="max-h-full max-w-full object-contain"></div>
    <div id="form"></div>
    <div class="mt-6 flex gap-3">
      <button id="del" class="btn btn-danger">${icon('trash')} Excluir</button>
      <button id="save" class="btn btn-primary flex-1">Salvar alterações</button>
    </div>`);
  mountItemForm($('#form', root), d);
  $('#save', root).onclick = async () => {
    setBusy(true, 'Salvando…');
    const { data, error } = await 
sb.from('clothes')
      .update({ name: d.name.trim() || null, category: d.category, colors: [...d.colors], tags: [...d.tags] })
      .eq('id', id).select().single();
    setBusy(false);
    if (error) return toast(error.message, 'error');
    Object.assign(item, data);
    closeModal(); renderCloset(); toast('Peça atualizada', 'ok');
  };
  $('#del', root).onclick = async () => {
    if (!confirm('Excluir esta peça? Looks salvos que a usam ficarão sem ela.')) return;
    setBusy(true, 'Excluindo…');
    const { error } = await sb.from('clothes').delete().eq('id', id);
    if (!error && item.storage_path) await sb.storage.from('clothes').remove([item.storage_path]);
    setBusy(false);
    if (error) return toast(error.message, 'error');
    state.clothes = state.clothes.filter((c) => c.id !== id);
    closeModal(); renderCloset(); toast('Peça excluída');
  };
}

/* ==============================
==============================
   Imagens: redimensionar, remover fundo, base64
   ============================================================ */
const loadImg = (src, cors = true) => new Promise((res, rej) => {
  const i = new Image();
  if (cors) i.crossOrigin = 'anonymous';
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('Não consegui carregar a imagem.'));
  i.src = src;
});
const canvasToBlob = (cv, type = 'image/jpeg', q = 0.88) => new Promise((r) => cv.toBlob(r, type, q));

async function resizeToBlob(fileOrBlob, max = 1200) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await loadImg(url, false);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = 
Math.round(img.height * k);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return await canvasToBlob(cv, 'image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

// Plano B simples (Canvas): remove fundo liso a partir das bordas por "flood fill".
async function simpleBgRemove(blob, tol = 38) {
  const url = 
URL.createObjectURL(blob);
  try {
    const img = await loadImg(url, false);
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h); const px = im.data;
    const corners = [[0, 0], [w - 1, 0], 
[0, h - 1], [w - 1, h - 1]].map(([x, y]) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; });
    const bg = corners.reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);
    const near = (i) => Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) < tol * 3 * 0.6 + tol;
    const seen = new Uint8Array(w * h); const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue; seen[p] = 1;
      const i = p * 4;
      if (!near(i)) continue;
      px[i + 3] = 0;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
    }
    g.putImageData(im, 0, 0);
    return await canvasToBlob(cv, 'image/png');
  } finally { URL.revokeObjectURL(url); }
}

// Remoção de fundo por IA rodando no navegador (carrega sob demanda; ~40MB na 1ª vez).
async function removeBackground(blob) {
  try {
    const mod = await import('https://esm.sh/@imgly/background-removal@1.5.5');
    const fn = mod.removeBackground || mod.default;
    const out = await fn(blob, { output: { format: 'image/png' } });
    return { blob: out, method: 'ia' };
  } catch (e) {
    console.warn('IA de fundo indisponível, usando plano B', e);
    return { blob: await simpleBgRemove(blob), method: 'simples' };
  }
}

async function blobToBase64Jpeg(blob, max = 768) {
  const small = await resizeToBlob(blob, max);
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ============================================================
   Nova peça
   ============================================================ */
function newDraft() {
  return { original: null, blob: null, previewUrl: null, name: '', category: null, colors: new Set(), tags: new Set(), bgRemoved: false };
}

function renderNewItem() {
  if (!state.draft) state.draft = newDraft();
  const d = state.draft;
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="#/closet" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="font-display text-3xl">Nova peça</h1>
      </div>

      ${d.blob ? `
        <div class="mt-5 flex aspect-square items-center justify-center rounded-3xl p-4 
${d.bgRemoved ? 'checker' : 'bg-stone-100'}">
          <img src="${d.previewUrl}" alt="Prévia" class="max-h-full max-w-full object-contain">
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button id="rmbg" class="btn btn-soft" ${d.bgRemoved ? 'disabled' : ''}>${icon('scissors')} ${d.bgRemoved ? 'Fundo removido' : 'Remover fundo'}</button>
          <button id="ai" class="btn btn-soft">${icon('sparkles')} Preencher com IA</button>
          ${d.bgRemoved ? `<button id="restore" class="btn btn-ghost 
col-span-2">Restaurar foto original</button>` : ''}
          <button id="other" class="btn btn-ghost col-span-2">Trocar foto</button>
        </div>` : `
        <p class="mt-3 text-sm text-stone-500">Dica: fotografe a peça sobre uma superfície lisa, com boa luz.</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button id="cam" class="card flex flex-col items-center gap-2 py-10 text-stone-700">${icon('camera', 'h-8 w-8')}<span class="text-sm font-medium">Tirar foto</span></button>
          <button id="gal" class="card flex flex-col items-center gap-2 py-10 text-stone-700">${icon('photo', 'h-8 w-8')}<span class="text-sm font-medium">Galeria</span></button>
        </div>`}

      <input id="file-cam" type="file" accept="image/*" capture="environment" class="hidden">
      <input id="file-gal" type="file" accept="image/*" class="hidden">

      ${d.blob ? `<div id="form" class="mt-6"></div>
        <button id="save" class="btn btn-primary mt-6 w-full">Salvar no guarda-roupa</button>` : ''}
    </div>`;

  const pick = (file) => file && onPick(file);
  $('#file-cam').onchange = (e) => pick(e.target.files[0]);
  $('#file-gal').onchange = (e) => pick(e.target.files[0]);
  if ($('#cam')) { $('#cam').onclick = () => $('#file-cam').click(); $('#gal').onclick = () => $('#file-gal').click(); }
  if (!d.blob) return;

  $('#other').onclick = () => $
('#file-gal').click();
  mountItemForm($('#form'), d);

  $('#rmbg').onclick = async () => {
    setBusy(true, 'Removendo o fundo… (na 1ª vez pode levar um pouco)');
    try {
      const { blob, method } = await removeBackground(d.original);
      setPreview(d, blob); d.bgRemoved = true;
      toast(method === 'ia' ? 'Fundo removido!' : 'Fundo removido (modo simples — funciona melhor com fundo liso)', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false); renderNewItem();
  };
  const restore = $('#restore');
  if (restore) restore.onclick = () => { setPreview(d, d.original); d.bgRemoved = false; renderNewItem(); };

  $('#ai').onclick = async () => {
    setBusy(true, 'A IA está analisando a peça…');
    try {
      const image_base64 = await blobToBase64Jpeg(d.blob);
      const { data, error } = await sb.functions.invoke('analyze-clothing', { body: { image_base64, mime_type: 'image/jpeg' } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data.name && !d.name) d.name = data.name;
      if (data.category) d.category = data.category;
      (data.colors || []).forEach((c) => d.colors.add(c));
      (data.tags || []).forEach((t) => d.tags.add(t));
      toast('Campos preenchidos — confira e ajuste', 'ok');
    } catch (e) { toast(await fnError(e), 'error'); }
    setBusy(false); renderNewItem();
  };

  $('#save').onclick = saveItem;
}

function setPreview(d, blob) {
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
  d.blob = blob; d.previewUrl = URL.createObjectURL(blob);
}

async function onPick(file) {
  setBusy(true, 'Preparando a foto…');
  try {
    const d = state.draft || (state.draft = newDraft());
    const resized = await resizeToBlob(file, 1200);
    d.original = resized; d.bgRemoved = false;
    setPreview(d, resized);
  } catch (e) { toast(e.message, 'error'); }
  setBusy(false); renderNewItem();
}

async function saveItem() {
  const d = state.draft;
  if (!d?.blob) return toast('Escolha uma foto primeiro.', 'error');
  if (!d.category) return toast('Escolha a categoria da peça.', 'error');
  setBusy(true, 'Salvando…');
  try {
    const ext = d.blob.type === 
'image/png' ? 'png' : 'jpg';
    const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from('clothes').upload(path, d.blob, { contentType: d.blob.type, cacheControl: '31536000', upsert: false });
    if (up.error) throw up.error;
    const { data: pub } = sb.storage.from('clothes').getPublicUrl(path);
    const { data, error } = await sb.from('clothes').insert({
      user_id: state.user.id,
      image_url: pub.publicUrl,
      storage_path: path,
      name: d.name.trim() || null,
      category: d.category,
      colors: [...d.colors],
      tags: [...d.tags],
    }).select().single();
    if (error) { await sb.storage.from('clothes').remove([path]); throw error; }
    state.clothes.unshift(data);
    if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    state.draft = null;
    toast('Peça adicionada!', 'ok');
    go('#/closet');
  } catch (e) { toast(e.message || 'Erro ao salvar', 'error'); }
  setBusy(false);
}

/* 
============================================================
   Criar look (AI Stylist)
   ============================================================ */
function renderCreate() {
  const g = state.gen;
  const prefs = state.profile?.style_preferences || [];
  const r = g.result;

  view().innerHTML = `
    <div class="fade-up">
      <h1 class="font-display text-3xl">Criar look</h1>
      <p class="mt-1 text-sm text-stone-500">Diga a ocasião e o clima; a IA monta com as suas peças.</p>

      <div class="mt-5 space-y-5">
        <div><span class="label">Ocasião</span>
          <div class="flex flex-wrap gap-2">
            ${OCCASIONS.map((o) => `<button data-occ="${esc(o)}" class="chip ${g.occasion === o ? 'chip-on' : ''}">${esc(o)}</button>`).join('')}
          </div>
          <input id="occ-custom" class="input mt-2" placeholder="Ou 
descreva: ex. casamento na praia" value="${esc(g.customOccasion)}">
        </div>
        <div><span class="label">Clima</span>
          <div class="flex flex-wrap gap-2">
            ${WEATHERS.map((w) => `<button data-w="${w.id}" class="chip ${g.weather === w.id || g.weather.startsWith(w.id + ' ') ? 'chip-on' : ''}">${w.label}</button>`).join('')}
            <button id="geo" class="chip">${icon('pin', 'h-4 w-4')} Usar minha localização</button>
          </div>
          ${g.weather && !
WEATHERS.some((w) => w.id === g.weather) ? `<p class="mt-2 text-xs text-stone-500">Clima atual: ${esc(g.weather)}</p>` : ''}
        </div>
        ${prefs.length ? `<div><span class="label">Estilo (opcional)</span>
          <div class="flex flex-wrap gap-2">${prefs.map((s) => `<button data-st="${esc(s)}" class="chip ${g.style === s ? 'chip-on' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
      </div>

      <button id="gen" class="btn btn-primary mt-6 w-full">$
{icon('sparkles')} ${r ? 'Gerar outro look' : 'Gerar look'}</button>

      ${r ? `
        <div class="fade-up mt-8" id="result">
          ${lookCard(r.items)}
          <h2 class="mt-5 font-display text-2xl">${esc(r.title)}</h2>
          <p class="mt-1 text-sm text-stone-600">${esc(r.description)}</p>
          ${r.tips ? `<p class="mt-3 rounded-2xl bg-stone-100 p-3 text-sm text-stone-600"><b>Dica:</b> ${esc(r.tips)}</p>` : ''}
          ${r.missing ? `<div class="mt-3 rounded-2xl border 
border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(r.missing)}</div>` : ''}
          <div class="mt-5 grid grid-cols-2 gap-2">
            <button id="fav" class="btn ${r.saved_id ? 'btn-primary' : 'btn-soft'}">${icon(r.saved_id ? 'check' : 'heart')} ${r.saved_id ? 'Nos favoritos' : 'Salvar nos Favoritos'}</button>
            <button id="share" class="btn btn-soft">${icon('share')} Compartilhar</button>
          </div>
        </div>` : ''}
    </div>`;

  $$('[data-occ]').forEach((b) => (b.onclick = () => { g.occasion = g.occasion === b.dataset.occ ? '' : b.dataset.occ; g.customOccasion = ''; renderCreate(); }));
  $('#occ-custom').oninput = (e) => { g.customOccasion = e.target.value; if (e.target.value) g.occasion = ''; };
  $$('[data-w]').forEach((b) => (b.onclick = () => { g.weather = g.weather === b.dataset.w ? '' : b.dataset.w; renderCreate(); }));
  $$('[data-st]').forEach((b) => (b.onclick = () => { g.style = g.style === b.dataset.st ? '' : b.dataset.st; renderCreate(); }));
  $('#geo').onclick = 
useLocationWeather;
  $('#gen').onclick = generateLook;
  if (r) { $('#fav').onclick = toggleFavorite; $('#share').onclick = shareGenerated; }
}

async function useLocationWeather() {
  if (!navigator.geolocation) return toast('Seu navegador não permite localização.', 'error');
  setBusy(true, 'Buscando o clima…');
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, 
{ timeout: 10000 }));
    const { latitude: la, longitude: lo } = pos.coords;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,precipitation,weather_code&timezone=auto`);
    const j = await r.json();
    const t = Math.round(j.current.temperature_2m);
    const rain = j.current.precipitation > 0 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(j.current.weather_code);
    const base = t <= 15 ? 'frio' : t <= 24 ? 'ameno' : 'quente';
    state.gen.weather = `${base} (${t}°C${rain ? ', com chuva' : ''})`;
    toast(`Clima: ${t}°C${rain ? ' com chuva' : ''}`, 'ok');
  } catch (e) {
    toast('Não consegui obter sua localização. Escolha o clima manualmente.', 'error');
  }
  setBusy(false); renderCreate();
}

async function generateLook() {
  const g = state.gen;
  if (state.clothes.length < 2) {
    toast('Cadastre pelo menos 2 peças para gerar looks.', 'error');
    return go('#/closet/new');
  }
  const occasion = g.customOccasion.trim() || g.occasion || 'Dia a dia';
  setBusy(true, 'Montando seu look…');
  try {
    const { data, error } = await sb.functions.invoke('stylist', {
      body: { occasion, weather: g.weather, style: g.style, avoid: g.history.slice(-4) },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const byId = clothesById();
    const items = (data.item_ids 
|| []).map((id) => byId.get(id)).filter(Boolean);
    if (!items.length) throw new Error('A IA não achou peças compatíveis. Tente de novo ou cadastre mais peças.');
    g.result = { title: data.title, description: data.description, tips: data.tips, missing: data.missing_suggestions, items, occasion, saved_id: null };
    g.history.push(items.map((i) => i.id).sort().join(','));
  } catch (e) { toast(await fnError(e), 'error'); }
  setBusy(false);
  renderCreate();
  $('#result')?.scrollIntoView(
{ behavior: 'smooth', block: 'start' });
}

async function saveGenerated() {
  const r = state.gen.result;
  if (r.saved_id) return r.saved_id;
  const { data, error } = await sb.from('outfits').insert({
    user_id: state.user.id, title: r.title, description: r.description, occasion: r.occasion,
    items: r.items.map((i) => i.id), missing_suggestions: r.missing, is_public: false,
  }).select().single();
  if (error) throw error;
  r.saved_id = data.id;
  state.outfits.unshift(data);
  return data.id;
}

async function toggleFavorite() {
  const r = state.gen.result;
  setBusy(true, r.saved_id ? 'Removendo…' : 'Salvando…');
  try {
    if (r.saved_id) {
      const { error } = await sb.from('outfits').delete().eq('id', r.saved_id);
      if (error) throw error;
      state.outfits = state.outfits.filter((o) => o.id !== r.saved_id);
      r.saved_id = null; 
toast('Removido dos favoritos');
    } else { await saveGenerated(); toast('Look salvo nos favoritos!', 'ok'); }
  } catch (e) { toast(e.message, 'error'); }
  setBusy(false); renderCreate();
}

async function shareGenerated() {
  setBusy(true, 'Preparando…');
  try { const id = await saveGenerated(); setBusy(false); await openShare(id); }
  catch (e) { setBusy(false); toast(e.message, 'error'); }
  renderCreate();
}

/* ============================================================
   Detalhe de look salvo
   ============================================================ */
function renderOutfitDetail(id) {
  const o = state.outfits.find((x) => x.id === id);
  if (!o) return go('#/home');
  const items = itemsOf(o);
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="#/home" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="truncate font-display text-2xl">${esc(o.title)}</h1>
      </div>
      <div class="mt-4">${items.length ? lookCard(items) : '<p class="rounded-2xl bg-stone-100 p-5 text-sm text-stone-500">As peças deste look foram removidas do guarda-roupa.</p>'}</div>
      ${o.occasion ? `<p class="mt-4 text-xs uppercase tracking-wide text-stone-400">${esc(o.occasion)}</p>` : ''}
      <p class="mt-1 text-sm 
text-stone-600">${esc(o.description || '')}</p>
      ${o.missing_suggestions ? `<div class="mt-3 rounded-2xl border border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(o.missing_suggestions)}</div>` : ''}
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button id="share" class="btn btn-primary" ${items.length ? '' : 'disabled'}>${icon('share')} Compartilhar</button>
        <button id="del" class="btn btn-danger">${icon('trash')} Excluir</button>
      </div>
    </div>`;
  $('#share').onclick = () => openShare(id);
  $('#del').onclick = async () => {
    if (!confirm('Excluir este look dos favoritos?')) return;
    const { error } = await sb.from('outfits').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    state.outfits = state.outfits.filter((x) => x.id !== id);
    if (state.gen.result?.saved_id === id) state.gen.result.saved_id = null;
    toast('Look excluído'); go('#/home');
  };
}

/* ============================================================
   Compartilhar: card 9:16 (Story) + link público + QR Code
   ============================================================ */
const rr = (g, x, y, w, h, r) => {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
};
function wrapText(g, text, maxW, maxLines = 2) {
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…'); }
  return lines;
}
function drawQR(g, text, x, y, size) {
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const pad = 18; const cell = (size - pad * 2) / n;
  g.fillStyle = '#fff'; rr(g, x, y, size, size, 22); g.fill();
  g.fillStyle = '#1c1917';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
}

async function renderStoryCanvas(title, occasion, 
items, url) {
  const W = 1080, H = 1920, M = 90;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#f5f5f4'); grad.addColorStop(1, '#d6d3d1');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);

  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#78716c';
  g.font = '600 26px Inter, system-ui, sans-serif';
  g.fillText('SMART CLOSET AI', M, 128);

  g.fillStyle = '#1c1917'; g.font = '600 76px Fraunces, Georgia, serif';
  const tl = wrapText(g, title, W - M * 2, 2);
  tl.forEach((l, i) => g.fillText(l, M, 232 + i * 86));
  let y = 232 + (tl.length - 1) * 86 + 56;
  if (occasion) { g.fillStyle = '#78716c'; g.font = '500 32px Inter, system-ui, sans-serif'; g.fillText(occasion, M, y); }

  const top = 360, bottomLimit = 1560, gap = 24;
  const lay = layoutItems(items);
  let col = 0, rowCount = 0;
  lay.forEach((l) => { if (col === 0) rowCount++; col = (col + l.span) % 2; });
  const tileH = Math.min(400, (bottomLimit - top - gap * (rowCount - 1)) / rowCount);
  const colW = (W - M * 2 - gap) / 2;
  const imgs = await Promise.all(lay.map((l) => loadImg(l.it.image_url).catch(() => null)));

  col = 0; let row = 0;
  lay.forEach((l, i) => {
    const x = M + col * (colW + gap); const w = l.span === 2 ? W - M * 2 : colW; const yy = top + row * (tileH + 
gap);
    g.fillStyle = 'rgba(255,255,255,.88)'; rr(g, x, yy, w, tileH, 36); g.fill();
    const im = imgs[i];
    if (im) {
      const pad = 28; const k = Math.min((w - pad * 2) / im.width, (tileH - pad * 2) / im.height);
      const iw = im.width * k, ih = im.height * k;
      g.drawImage(im, x + (w - iw) / 2, yy + (tileH - ih) / 2, iw, ih);
    }
    col = (col + l.span) % 2; if (col === 0) row++;
  });

  // rodapé com QR
  const qs = 230, qy = H - 130 - qs;
  drawQR(g, url, M, qy, qs);
  g.fillStyle = '#1c1917'; g.font = '600 42px Fraunces, Georgia, serif';
  g.fillText('Veja o look completo', M + qs + 40, qy + 100);
  g.fillStyle = '#78716c'; g.font = '400 30px Inter, system-ui, sans-serif';
  g.fillText('Aponte a câmera para o QR Code', M + qs + 40, qy + 150);
  return cv;
}

async function openShare(outfitId) {
  const o = state.outfits.find((x) => x.id === outfitId);
  if (!o) return;
  setBusy(true, 'Gerando o card…');
  let blob, url;
  try {
    if (!o.is_public) {
      const { error } = await sb.from('outfits').update({ is_public: true }).eq('id', outfitId);
      if (error) throw error;
      o.is_public = true;
    }
    url = shareUrl(outfitId);
    const cv = await renderStoryCanvas(o.title, o.occasion, itemsOf(o), url);
    blob = await canvasToBlob(cv, 'image/png');
  } catch (e) { setBusy(false); return 
toast(e.message || 'Erro ao gerar o card', 'error'); }
  setBusy(false);

  const imgUrl = URL.createObjectURL(blob);
  const file = new File([blob], 'meu-look.png', { type: 'image/png' });
  const root = openModal(`
    ${modalHeader('Compartilhar look')}
    <img src="${imgUrl}" alt="Card 9:16 do look" class="mx-auto max-h-[52vh] rounded-2xl shadow-md">
    <p class="mt-4 break-all rounded-2xl bg-stone-100 p-3 
text-xs text-stone-600">${esc(url)}</p>
    <div class="mt-4 grid grid-cols-2 gap-2">
      <button id="sh-native" class="btn btn-primary">${icon('share')} Compartilhar</button>
      <a id="sh-dl" class="btn btn-soft" href="${imgUrl}" download="meu-look.png">${icon('download')} Baixar Story</a>
      <button id="sh-copy" class="btn btn-soft col-span-2">Copiar link</button>
      <button id="sh-private" class="btn btn-ghost col-span-2 text-sm">Tornar este look privado 
de novo</button>
    </div>`);
  const close = () => URL.revokeObjectURL(imgUrl);
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));

  $('#sh-native', root).onclick = async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: o.title, text: `${o.title} — meu look no Smart Closet AI`, url });
      else if (navigator.share) await navigator.share({ title: o.title, text: 
o.title, url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado!', 'ok'); }
    } catch (e) { if (e?.name !== 'AbortError') toast('Não foi possível abrir o compartilhamento.', 'error'); }
  };
  $('#sh-copy', root).onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado!', 'ok'); }
    catch { toast('Copie o link manualmente.', 'error'); }
  };
  $('#sh-private', root).onclick = 
async () => {
    const { error } = await sb.from('outfits').update({ is_public: false }).eq('id', outfitId);
    if (error) return toast(error.message, 'error');
    o.is_public = false; close(); closeModal(); toast('O link público foi desativado.', 'ok');
  };
}

/* ============================================================
   Look público (sem login)
   ==============================
============================== */
async function renderShare(id) {
  view().innerHTML = `<div class="mt-20 text-center text-sm text-stone-400">Carregando look…</div>`;
  if (!id) return renderShareMissing();
  const { data, error } = await sb.rpc('get_public_outfit', { p_outfit_id: id });
  if (error || !data) return renderShareMissing();
  view().innerHTML = `
    <div class="fade-up mx-auto max-w-md">
      <p class="text-center 
text-xs font-semibold uppercase tracking-widest text-stone-400">Smart Closet AI</p>
      <h1 class="mt-3 text-center font-display text-3xl">${esc(data.title)}</h1>
      ${data.owner_name ? `<p class="mt-1 text-center text-sm text-stone-500">por ${esc(data.owner_name)}${data.occasion ? ` · ${esc(data.occasion)}` : ''}</p>` : ''}
      <div class="mt-6">${lookCard(data.items || [])}</div>
      <p class="mt-5 text-sm text-stone-600">${esc(data.description || '')}</p>
      ${data.missing_suggestions ? 
`<div class="mt-3 rounded-2xl border border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(data.missing_suggestions)}</div>` : ''}
      <a href="${state.session ? '#/home' : '#/login'}" class="btn btn-primary mt-8 w-full">${state.session ? 'Ir para o meu closet' : 'Criar meu guarda-roupa digital'}</a>
    </div>`;
}
function renderShareMissing() {
  view().innerHTML = `
    <div class="card mx-auto mt-16 
max-w-sm p-6 text-center">
      <h1 class="font-display text-2xl">Look indisponível</h1>
      <p class="mt-2 text-sm text-stone-500">O link pode ter sido desativado por quem compartilhou.</p>
      <a href="#/login" class="btn btn-primary mt-5">Conhecer o app</a>
    </div>`;
}

/* ============================================================
   Perfil
   
============================================================ */
function renderProfile() {
  const p = state.profile;
  const sel = new Set(p.style_preferences || []);
  const initials = (p.full_name || state.user.email || '?').trim().slice(0, 1).toUpperCase();
  const paint = () => {
    view().innerHTML = `
      <div class="fade-up">
        <h1 class="font-display text-3xl">Perfil</h1>
        <div class="mt-5 flex items-center gap-4">
          <button id="avatar" 
class="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-stone-200 ring-2 ring-white" aria-label="Trocar foto de perfil">
            ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" class="h-full w-full object-cover">` : `<span class="flex h-full w-full items-center justify-center font-display text-3xl text-stone-500">${esc(initials)}</span>`}
          </button>
          <div class="min-w-0"><p class="truncate font-medium">${esc(p.full_name || '')}</p><p class="truncate text-sm text-stone-500">$
{esc(state.user.email)}</p></div>
          <input id="avatar-file" type="file" accept="image/*" class="hidden">
        </div>

        <div class="mt-6"><label class="label" for="name">Nome</label><input id="name" class="input" value="${esc(p.full_name || '')}"></div>
        <div class="mt-5"><span class="label">Preferências de estilo</span>
          <div class="flex flex-wrap gap-2">${PROFILE_STYLES.map((s) => `<button data-s="${esc(s)}" class="chip ${sel.has(s) ? 'chip-on' : 
''}">${esc(s)}</button>`).join('')}</div></div>
        <button id="save" class="btn btn-primary mt-6 w-full">Salvar perfil</button>
        <button id="out" class="btn btn-ghost mt-2 w-full">Sair da conta</button>
        <p class="mt-8 text-center text-xs text-stone-400">Dica: no celular, use “Adicionar à tela inicial” para instalar o app.</p>
      </div>`;
    $$('[data-s]').forEach((b) => (b.onclick = () => { const n = $('#name').value; toggle(sel, b.dataset.s); p.full_name = n; paint(); }));
    $('#save').onclick = async () => {
      setBusy(true, 'Salvando…');
      const { data, error } = await sb.from('profiles').update({ full_name: $('#name').value.trim(), style_preferences: [...sel] }).eq('id', state.user.id).select().single();
      setBusy(false);
      if (error) return toast(error.message, 'error');
      state.profile = data; toast('Perfil salvo', 'ok');
    };
    $('#out').onclick = async () => { await sb.auth.signOut(); };
    $('#avatar').onclick = () => $('#avatar-file').click();
    $('#avatar-file').onchange = async 
(e) => {
      const f = e.target.files[0]; if (!f) return;
      setBusy(true, 'Enviando foto…');
      try {
        const blob = await resizeToBlob(f, 512);
        const path = `${state.user.id}/avatar.jpg`;
        const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
        if (up.error) throw up.error;
        const { data: pub } = sb.storage.from('avatars').getPublicUrl(path);
        const url = `${pub.publicUrl}?v=${Date.now()}`;
        const { data, error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', state.user.id).select().single();
        if (error) throw error;
        state.profile = data; Object.assign(p, data);
      } catch (err) { toast(err.message, 'error'); }
      setBusy(false); paint();
    };
  };
  paint();
}

/* ============================================================
   Inicialização
   ============================================================ */
async function init() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('hashchange', route);
  if (!sb) return route();

  const { data } = await sb.auth.getSession();
  state.session = data.session; state.user = data.session?.user ?? null;

  sb.auth.onAuthStateChange((event, session) => {
    state.session = session; state.user = session?.user ?? null;
    // evita chamadas ao Supabase dentro do callback (podem travar): adia o trabalho
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') location.hash = '#/
update-password';
      else if (event === 'SIGNED_OUT') { resetState(); location.hash = '#/login'; route(); }
      else if (event === 'SIGNED_IN' && !state.loaded) route();
    }, 0);
  });

  route();
}
init();
