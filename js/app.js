// Smart Closet AI — SPA (rotas por hash) para GitHub Pages + Supabase
// v2 (2026-11-08): correções de auth/PWA, diagnóstico, trocar peças,
// "look com esta peça", checklist inicial, limpeza de dados e mais.
import { CONFIG } from './config.js';

window.__appBooted = true;

/* ============================================================
   Hash inicial (links de e-mail do Supabase chegam aqui)
   ============================================================ */
const INITIAL_HASH = location.hash || '';
const AUTH_LINK_ERROR = (() => {
  if (!/error(_code|_description)?=/.test(INITIAL_HASH)) return null;
  const q = new URLSearchParams(INITIAL_HASH.replace(/^#\/?/, ''));
  const code = q.get('error_code') || '';
  if (/otp_expired|expired/i.test(code + (q.get('error_description') || ''))) {
    return 'Este link expirou ou já foi usado. Peça um novo.';
  }
  return 'Não foi possível validar o link. Tente de novo.';
})();
const IS_RECOVERY_LINK = /type=recovery/.test(INITIAL_HASH);

/* ============================================================
   Supabase client
   ============================================================ */
const configured =
  CONFIG.SUPABASE_URL &&
  CONFIG.SUPABASE_ANON_KEY &&
  !CONFIG.SUPABASE_URL.includes('SEU-PROJETO') &&
  !CONFIG.SUPABASE_ANON_KEY.startsWith('SUA_CHAVE');

const sb = configured && window.supabase
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
const LGPD_VERSION = '1.1';
const APP_VERSION = '2.0';
// Preencha com o e-mail de contato para dúvidas de privacidade (ex.: 'voce@exemplo.com').
const CONTACT_EMAIL = 'juliogonzales@live.com';
const TERMS_HTML = `
  <p><b>Quem trata seus dados:</b> o responsável pelo Smart Closet AI.${CONTACT_EMAIL ? ` Contato: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.` : ''}</p>
  <p><b>O que guardamos:</b> sua conta, as fotos e dados das peças e os looks que você montar ou salvar.</p>
  <p><b>Google Gemini:</b> ao usar a IA (preencher dados da peça, sugerir looks ou testar a IA), a foto da peça ou a lista de peças escolhidas é enviada ao Google Gemini. Nenhuma foto de pessoa é solicitada ou usada.</p>
  <p><b>Prévia do look:</b> é montada no seu próprio aparelho, a partir dos recortes das suas peças. Não é enviada para a IA e não fica guardada no servidor.</p>
  <p><b>Seus direitos:</b> acessar, corrigir, excluir seus dados e retirar o consentimento a qualquer momento, em Perfil. Você pode excluir a conta inteira em Perfil > Excluir minha conta.</p>
  <p class="text-xs text-stone-500">Versão ${LGPD_VERSION}. O texto completo está em docs/TERMOS_LGPD.md no repositório.</p>`;
const SEASONS = ['verão', 'outono', 'inverno', 'primavera'];
const STYLES = ['casual', 'formal', 'esporte fino', 'street', 'esportivo', 'festa', 'minimalista', 'clássico'];
const THEMES = [
  { id: 'classico', name: 'Clássico', swatch: '#1c1917', meta: '#1c1917' },
  { id: 'por-do-sol', name: 'Pôr do sol', swatch: '#e11d48', meta: '#e11d48' },
  { id: 'oceano', name: 'Oceano', swatch: '#0e7490', meta: '#0e7490' },
  { id: 'lavanda', name: 'Lavanda', swatch: '#7c3aed', meta: '#7c3aed' },
  { id: 'menta', name: 'Verde', swatch: '#15803d', meta: '#15803d' }
];
function currentTheme() {
  try { return localStorage.getItem('sc_theme') || 'classico'; } catch (e) { return 'classico'; }
}
function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem('sc_theme', id); } catch (e) { /* navegação privada: o tema vale só nesta visita */ }
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.meta);
}
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
const MAX_ITEMS_PER_LOOK = 12;

/* ============================================================
   Utilidades de DOM
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = () => $('#view');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const P = (d) => `<path stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
const ICONS = {
  home: P('M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25'),
  closet: P('M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'),
  sparkles: P('M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z'),
  user: P('M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'),
  plus: P('M12 4.5v15m7.5-7.5h-15'),
  users: P('M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'),
  thumb: P('M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z'),
  flag: P('M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5'),
  bell: P('M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0'),
  bellOff: P('M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0M3 3l18 18'),
  dots: P('M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z'),
  heart: P('M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z'),
  share: P('M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z'),
  trash: P('M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0'),
  x: P('M6 18L18 6M6 6l12 12'),
  camera: P('M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z'),
  photo: P('M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'),
  refresh: P('M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.183m0-4.991v4.99'),
  check: P('M4.5 12.75l6 6 9-13.5'),
  download: P('M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3'),
  pin: P('M15 10.5a3 3 0 11-6 0 3 3 0 016 0zM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z'),
  scissors: P('M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 11-5.196 3 3 3 0 015.196-3zm1.536-.887a2.165 2.165 0 001.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863l2.077-1.199m0-3.328a4.323 4.323 0 012.068-1.379l5.325-1.628a4.5 4.5 0 012.43-.039m-9.823 5.01l5.325 1.628a4.5 4.5 0 002.43.039'),
  search: P('M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'),
  swap: P('M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5'),
  pencil: P('M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125'),
};
const icon = (n, cls = 'h-5 w-5') =>
  `<svg class="${cls}" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">${ICONS[n] || ''}</svg>`;

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  const tone = type === 'error' ? 'bg-red-600' : type === 'ok' ? 'bg-emerald-700' : 'bg-stone-900';
  el.className = `fade-up pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm text-white shadow-lg ${tone}`;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 2800);
}

function setBusy(on, text = 'Carregando…') {
  const b = $('#busy');
  $('#busy-text').textContent = text;
  b.classList.toggle('hidden', !on);
  b.classList.toggle('flex', on);
}
const setBusyText = (t) => { const el = $('#busy-text'); if (el) el.textContent = t; };

/* --- Modais --- */
let lastFocus = null;
function openModal(inner, { sheet = true } = {}) {
  lastFocus = document.activeElement;
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="fixed inset-0 z-40 flex ${sheet ? 'items-end' : 'items-center'} justify-center bg-stone-900/50" data-backdrop>
      <div class="${sheet ? 'sheet-up rounded-t-[2rem]' : 'fade-up rounded-[2rem] m-4'} max-h-[92vh] w-full max-w-xl overflow-y-auto bg-white p-5 safe-bottom" role="dialog" aria-modal="true" tabindex="-1">
        ${inner}
      </div>
    </div>`;
  const back = $('[data-backdrop]', root);
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
  const first = $('input, textarea, [data-autofocus]', root) || $('[role="dialog"]', root);
  setTimeout(() => first?.focus?.({ preventScroll: true }), 30);
  return root;
}
function closeModal() {
  const root = $('#modal-root');
  if (!root.innerHTML) return;
  root.innerHTML = '';
  try { lastFocus?.focus?.({ preventScroll: true }); } catch { /* ignora */ }
  lastFocus = null;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal();
});

const modalHeader = (title) => `
  <div class="mb-4 flex items-center justify-between">
    <h3 class="font-display text-xl">${esc(title)}</h3>
    <button data-close class="btn btn-ghost !p-2" aria-label="Fechar">${icon('x')}</button>
  </div>`;

function confirmDialog(message, { confirmLabel = 'Confirmar', danger = false, title = 'Tem certeza?' } = {}) {
  return new Promise((resolve) => {
    const root = openModal(`
      <h3 class="font-display text-xl">${esc(title)}</h3>
      <p class="mt-2 text-sm text-stone-600">${esc(message)}</p>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button id="cd-no" class="btn btn-soft" data-autofocus>Cancelar</button>
        <button id="cd-yes" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
      </div>`, { sheet: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    $('#cd-no', root).onclick = () => finish(false);
    $('#cd-yes', root).onclick = () => finish(true);
    $('[data-backdrop]', root).addEventListener('click', (e) => { if (e.target.hasAttribute('data-backdrop')) finish(false); });
  });
}

function promptDialog({ title, label, value = '', confirmLabel = 'Salvar', maxLength = 120 }) {
  return new Promise((resolve) => {
    const root = openModal(`
      <form id="pd-form">
        <h3 class="font-display text-xl">${esc(title)}</h3>
        <label class="label mt-4" for="pd-input">${esc(label)}</label>
        <input id="pd-input" class="input" maxlength="${maxLength}" value="${esc(value)}" required>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button type="button" id="pd-no" class="btn btn-soft">Cancelar</button>
          <button type="submit" class="btn btn-primary">${esc(confirmLabel)}</button>
        </div>
      </form>`, { sheet: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    $('#pd-no', root).onclick = () => finish(null);
    $('#pd-form', root).onsubmit = (e) => { e.preventDefault(); finish($('#pd-input', root).value.trim() || null); };
    $('[data-backdrop]', root).addEventListener('click', (e) => { if (e.target.hasAttribute('data-backdrop')) finish(null); });
  });
}

/* --- Imagem quebrada vira um quadro cinza (sem ícone feio do navegador) --- */
const BROKEN_IMG =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f5f5f4"/><path d="M14 46l12-14 8 9 6-7 10 12z" fill="#d6d3d1"/></svg>');
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && !t.dataset.broken) { t.dataset.broken = '1'; t.src = BROKEN_IMG; }
}, true);

window.addEventListener('offline', () => toast('Você está sem internet.', 'error'));
window.addEventListener('online', () => toast('Conexão restabelecida.', 'ok'));

/* ============================================================
   Estado
   ============================================================ */
const newGen = () => ({
  occasion: '', weather: '', style: '', customOccasion: '',
  result: null, history: [], pin: null, quota: null,
});
const state = {
  session: null, user: null, profile: null,
  clothes: [], outfits: [], loaded: false, loadedAt: 0,
  closetFilter: 'all', closetQuery: '', closetSort: 'category', draft: null, gen: newGen(), feedback: new Map(), people: null,
};

function resetState() {
  Object.assign(state, {
    session: null, user: null, profile: null, clothes: [], outfits: [],
    loaded: false, loadedAt: 0, closetFilter: 'all', closetQuery: '', closetSort: 'category', draft: null, gen: newGen(), feedback: new Map(), people: null,
  });
}

let loadPromise = null;
async function loadAll() {
  const uid = state.user.id;
  const [p, c, o] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    sb.from('clothes').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    sb.from('outfits').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  if (o.error) throw o.error;
  let profile = p.data;
  if (!profile) {
    const ins = await sb.from('profiles')
      .upsert({ id: uid, full_name: (state.user.email || '').split('@')[0] }).select().single();
    if (ins.error) throw ins.error;
    profile = ins.data;
  }
  state.profile = profile;
  state.clothes = c.data || [];
  state.outfits = o.data || [];
  state.loaded = true;
  state.loadedAt = Date.now();
}
async function ensureLoaded() {
  if (state.loaded) return;
  if (!loadPromise) loadPromise = loadAll().finally(() => { loadPromise = null; });
  await loadPromise;
}

const clothesById = () => new Map(state.clothes.map((c) => [c.id, c]));
const itemsOf = (outfit) => {
  const m = clothesById();
  return (outfit.items || []).map((id) => m.get(id)).filter(Boolean);
};
const shareUrl = (id) => `${location.origin}${location.pathname}#/share/${id}`;

/* --- Mensagens de erro amigáveis --- */
function errMsg(e) {
  const m = String(e?.message || e || '');
  const code = e?.code || '';
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network request failed/i.test(m)) {
    return 'Sem conexão com a internet. Verifique e tente de novo.';
  }
  if (code === 'PGRST205' || code === '42P01' || /relation .* does not exist|schema cache/i.test(m)) {
    return 'O banco ainda não está pronto (tabelas ausentes). Rode o schema.sql no Supabase — veja Perfil > Testar a IA.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(m)) {
    return 'Sem permissão para esta ação. Saia e entre de novo; se persistir, confira o schema.sql.';
  }
  if (/Limite de \d+ itens/i.test(m)) return m;
  if (code === '23514') return 'Algum campo ficou grande demais. Reduza o texto e tente de novo.';
  if (/JWT expired|invalid JWT|not authenticated/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  return m || 'Algo deu errado. Tente de novo.';
}

async function fnError(e) {
  try {
    const r = e?.context;
    if (r && typeof r.json === 'function') {
      const j = await r.json();
      if (j?.error) return j.error;
    }
  } catch { /* ignora */ }
  const msg = e?.message || '';
  if (/Failed to send|fetch|NetworkError|Load failed/i.test(msg)) {
    return 'Não consegui falar com a IA. Verifique a internet e se as Edge Functions foram publicadas (Perfil > Testar a IA).';
  }
  if (/non-2xx/i.test(msg)) return 'A IA devolveu um erro. Tente de novo em instantes.';
  return msg || 'Algo deu errado com a IA.';
}

/* ============================================================
   Layout: navegação inferior
   ============================================================ */
const NAV = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'closet', label: 'Guarda-roupa', icon: 'closet' },
  { id: 'feed', label: 'Feed', icon: 'users' },
  { id: 'create', label: 'Criar look', icon: 'sparkles' },
  { id: 'profile', label: 'Perfil', icon: 'user' },
];
function renderNav(active) {
  const nav = $('#bottomnav');
  updateBell(!!active);
  if (!active) { nav.classList.add('hidden'); return; }
  nav.classList.remove('hidden');
  nav.innerHTML = `<div class="mx-auto grid max-w-xl" style="grid-template-columns:repeat(${NAV.length},minmax(0,1fr))">
    ${NAV.map((n) => `
      <a href="#/${n.id}" class="flex flex-col items-center gap-1 py-2.5 text-[11px] ${n.id === active ? 'font-semibold text-stone-900' : 'text-stone-500'}" ${n.id === active ? 'aria-current="page"' : ''}>
        ${icon(n.icon, 'h-6 w-6')}<span>${n.label}</span>
      </a>`).join('')}
  </div>`;
}

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const TITLES = {
  home: 'Início', closet: 'Guarda-roupa', create: 'Criar look', profile: 'Perfil',
  login: 'Entrar', register: 'Criar conta', reset: 'Redefinir senha', outfit: 'Look',
  feed: 'Feed', sobre: 'Sobre o app', share: 'Look compartilhado', diagnostico: 'Testar a IA', onboarding: 'Bem-vinda(o)',
};

/* ============================================================
   Roteador
   ============================================================ */
let routeSeq = 0;
async function route() {
  const my = ++routeSeq;
  if (!sb) return renderConfigMissing();
  const hash = location.hash.startsWith('#/') ? location.hash.slice(2) : '';
  const [name = '', arg] = hash.split('/');
  window.scrollTo(0, 0);
  document.title = `${TITLES[name] || 'Smart Closet AI'} · Smart Closet AI`;

  // Rotas que funcionam com ou sem login
  if (name === 'share') { renderNav(null); return renderShare(arg); }
  if (name === 'diagnostico') { renderNav(state.session ? 'profile' : null); return renderDiagnostics(); }
  if (name === 'sobre') { renderNav(state.session ? 'profile' : null); return renderAbout(); }

  if (!state.session) {
    renderNav(null);
    if (name === 'register') return renderRegister();
    if (name === 'reset') return renderReset();
    if (name !== 'login') return go('#/login');
    return renderLogin();
  }

  if (name === 'update-password') { renderNav(null); return renderUpdatePassword(); }

  if (!state.loaded) {
    view().innerHTML = `<div class="mt-24 text-center text-sm text-stone-500">Abrindo seu closet…</div>`;
    setBusy(true, 'Abrindo seu closet…');
    try { await ensureLoaded(); }
    catch (e) { setBusy(false); if (my === routeSeq) renderFatal(e); return; }
    setBusy(false);
    if (my !== routeSeq) return;
  }

  if (!state.profile?.onboarded && name !== 'onboarding') return go('#/onboarding');

  switch (name) {
    case 'onboarding': renderNav(null); return renderOnboarding();
    case 'closet': renderNav('closet'); return arg === 'new' ? renderNewItem() : renderCloset();
    case 'create': renderNav('create'); return renderCreate();
    case 'feed': renderNav('feed'); return renderFeed();
    case 'profile': renderNav('profile'); return renderProfile();
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
      <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> com os dados do seu projeto (Settings → API Keys).</p>
      <p class="mt-3 text-sm text-stone-600">O passo a passo está no arquivo <b>SUPABASE_SETUP.md</b>.</p>
      ${window.supabase ? '' : '<p class="mt-3 text-sm text-red-700">Também não consegui carregar a biblioteca do Supabase. Verifique a internet.</p>'}
    </div>`;
}
function renderFatal(e) {
  view().innerHTML = `
    <div class="card mt-10 p-6">
      <h1 class="font-display text-2xl">Não consegui carregar seus dados</h1>
      <p class="mt-3 text-sm text-stone-600">${esc(errMsg(e))}</p>
      <div class="mt-5 grid gap-2">
        <button class="btn btn-primary" id="retry">Tentar de novo</button>
        <a href="#/diagnostico" class="btn btn-soft">Testar a IA</a>
        <button class="btn btn-ghost" id="out">Sair da conta</button>
      </div>
    </div>`;
  $('#retry').onclick = () => route();
  $('#out').onclick = () => sb.auth.signOut();
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

const pwInput = (id, autocomplete, min = 0) => `
  <div class="relative">
    <input id="${id}" type="password" required ${min ? `minlength="${min}"` : ''} autocomplete="${autocomplete}" class="input pr-24" placeholder="${min ? `Mínimo ${min} caracteres` : '••••••••'}">
    <button type="button" data-toggle-pw="${id}" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-stone-100">Mostrar</button>
  </div>`;
function bindPwToggles(root = document) {
  $$('[data-toggle-pw]', root).forEach((b) => {
    b.onclick = () => {
      const input = $('#' + b.dataset.togglePw, root);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Ocultar' : 'Mostrar';
    };
  });
}

function renderLogin(prefillEmail = '', notice = '') {
  view().innerHTML = authShell('Smart Closet AI', 'Seu guarda-roupa digital com estilista de IA', `
    ${notice ? `<p class="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">${esc(notice)}</p>` : ''}
    <form id="f" class="space-y-3">
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required autocomplete="email" class="input" placeholder="voce@email.com" value="${esc(prefillEmail)}"></div>
      <div><label class="label" for="pw">Senha</label>${pwInput('pw', 'current-password')}</div>
      <button class="btn btn-primary w-full" type="submit">Entrar</button>
    </form>
    <div id="resend-box" class="mt-3 hidden"></div>
    <div class="mt-5 flex items-center justify-between text-sm">
      <a href="#/reset" class="text-stone-500 underline-offset-2 hover:underline">Esqueci a senha</a>
      <a href="#/register" class="font-medium underline-offset-2 hover:underline">Criar conta</a>
    </div>`);
  bindPwToggles();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    setBusy(true, 'Entrando…');
    const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#pw').value });
    setBusy(false);
    if (error) {
      if (/Email not confirmed/i.test(error.message)) {
        toast('Confirme seu e-mail antes de entrar.', 'error');
        const box = $('#resend-box');
        box.classList.remove('hidden');
        box.innerHTML = `<button type="button" id="resend" class="btn btn-soft w-full">Reenviar e-mail de confirmação</button>`;
        $('#resend').onclick = () => resendConfirmation(email);
        return;
      }
      return toast(/Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : errMsg(error), 'error');
    }
    state.session = data.session; state.user = data.user;
    state.loaded = false;
    go('#/home');
  };
}

async function resendConfirmation(email) {
  if (!email) return toast('Digite seu e-mail.', 'error');
  setBusy(true, 'Reenviando…');
  const { error } = await sb.auth.resend({
    type: 'signup', email, options: { emailRedirectTo: location.origin + location.pathname },
  });
  setBusy(false);
  if (error) return toast(errMsg(error), 'error');
  toast('E-mail reenviado. Confira também o spam.', 'ok');
}

function renderRegister() {
  view().innerHTML = authShell('Criar conta', 'Leva menos de um minuto', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="name">Nome</label><input id="name" required maxlength="80" autocomplete="name" class="input" placeholder="Como quer ser chamada(o)?"></div>
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required autocomplete="email" class="input"></div>
      <div><label class="label" for="pw">Senha</label>${pwInput('pw', 'new-password', 8)}</div>
      <label class="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-3 text-xs leading-relaxed text-stone-600">
        <input id="lgpd" type="checkbox" required class="mt-0.5 h-4 w-4 shrink-0 accent-stone-900">
        <span>Li e concordo com os <button type="button" id="terms" class="font-medium text-stone-900 underline">Termos e Política de Privacidade</button>, inclusive o envio das fotos das peças ao Google Gemini para as sugestões da IA (obrigatório).</span>
      </label>
      <button class="btn btn-primary w-full" type="submit">Cadastrar</button>
      <p class="text-xs leading-relaxed text-stone-500">Suas fotos e dados ficam guardados no Supabase e só você os vê. Ao usar a IA, a foto da peça ou a lista de peças é enviada ao Google Gemini para gerar a sugestão.</p>
    </form>
    <p class="mt-5 text-center text-sm text-stone-500">Já tem conta? <a href="#/login" class="font-medium text-stone-900 underline-offset-2 hover:underline">Entrar</a></p>`);
  bindPwToggles();
  $('#terms').onclick = () => openTerms();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#lgpd').checked) return toast('Aceite os termos para criar a conta.', 'error');
    const email = $('#email').value.trim();
    setBusy(true, 'Criando conta…');
    const { data, error } = await sb.auth.signUp({
      email,
      password: $('#pw').value,
      options: { data: { full_name: $('#name').value.trim(), lgpd_consent_at: new Date().toISOString(), lgpd_consent_version: LGPD_VERSION }, emailRedirectTo: location.origin + location.pathname },
    });
    setBusy(false);
    if (error) {
      if (/already registered/i.test(error.message)) {
        toast('Este e-mail já tem conta. Entre ou redefina a senha.', 'error');
        return;
      }
      return toast(errMsg(error), 'error');
    }
    // E-mail já cadastrado (com confirmação ligada) volta sem identities
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return toast('Este e-mail já tem conta. Entre ou redefina a senha.', 'error');
    }
    if (data.session) { state.session = data.session; state.user = data.user; state.loaded = false; return go('#/onboarding'); }
    view().innerHTML = authShell('Confirme seu e-mail', 'Quase lá!', `
      <div class="card p-5 text-sm text-stone-600">
        Enviamos um link de confirmação para <b>${esc(email)}</b>. Depois de confirmar, é só entrar. Confira também a caixa de spam.
        <a href="#/login" class="btn btn-primary mt-4 w-full">Já confirmei — entrar</a>
        <button id="resend" class="btn btn-ghost mt-2 w-full">Reenviar e-mail</button>
      </div>`);
    $('#resend').onclick = () => resendConfirmation(email);
  };
}

function renderReset() {
  view().innerHTML = authShell('Redefinir senha', 'Enviaremos um link para o seu e-mail', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="email">E-mail</label><input id="email" type="email" required autocomplete="email" class="input"></div>
      <button class="btn btn-primary w-full" type="submit">Enviar link</button>
    </form>
    <p class="mt-5 text-center text-sm"><a href="#/login" class="text-stone-500 underline-offset-2 hover:underline">Voltar ao login</a></p>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Enviando…');
    const { error } = await sb.auth.resetPasswordForEmail($('#email').value.trim(), { redirectTo: location.origin + location.pathname });
    setBusy(false);
    if (error) return toast(errMsg(error), 'error');
    toast('Se o e-mail existir, o link foi enviado. Confira o spam.', 'ok');
  };
}

function renderUpdatePassword() {
  view().innerHTML = authShell('Nova senha', 'Escolha uma senha que você não use em outro lugar', `
    <form id="f" class="space-y-3">
      <div><label class="label" for="pw">Nova senha</label>${pwInput('pw', 'new-password', 8)}</div>
      <button class="btn btn-primary w-full" type="submit">Salvar senha</button>
    </form>`);
  bindPwToggles();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Salvando…');
    const { error } = await sb.auth.updateUser({ password: $('#pw').value });
    setBusy(false);
    if (error) return toast(errMsg(error), 'error');
    toast('Senha atualizada!', 'ok');
    go('#/home');
  };
}

/* ============================================================
   Onboarding
   ============================================================ */
function renderOnboarding() {
  const sel = new Set(state.profile?.style_preferences || []);
  let name = state.profile?.full_name || '';
  const paint = () => {
    view().innerHTML = `
      <div class="fade-up mx-auto mt-6 max-w-md">
        <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Bem-vinda(o)</p>
        <h1 class="mt-2 font-display text-3xl leading-tight">Como é o seu estilo?</h1>
        <p class="mt-2 text-sm text-stone-500">Escolha quantos quiser. A IA usa isso para montar looks mais a sua cara. Dá para mudar depois no Perfil.</p>
        <div class="mt-6">
          <label class="label" for="name">Seu nome</label>
          <input id="name" class="input" maxlength="80" value="${esc(name)}" placeholder="Seu nome">
        </div>
        <div class="mt-6 flex flex-wrap gap-2">
          ${PROFILE_STYLES.map((s) => `<button type="button" data-s="${esc(s)}" aria-pressed="${sel.has(s)}" class="chip ${sel.has(s) ? 'chip-on' : ''}">${esc(s)}</button>`).join('')}
        </div>
        <button id="done" class="btn btn-primary mt-8 w-full">Começar</button>
        <button id="skip" class="btn btn-ghost mt-2 w-full">Pular por agora</button>
      </div>`;
    $('#name').oninput = (e) => { name = e.target.value; };
    $$('[data-s]').forEach((b) => (b.onclick = () => {
      const v = b.dataset.s;
      sel.has(v) ? sel.delete(v) : sel.add(v);
      paint();
    }));
    const finish = async (withPrefs) => {
      setBusy(true, 'Salvando…');
      const patch = { onboarded: true };
      const meta = state.user?.user_metadata || {};
      if (!state.profile?.lgpd_consent_at && meta.lgpd_consent_at) {
        patch.lgpd_consent_at = meta.lgpd_consent_at;
        patch.lgpd_consent_version = meta.lgpd_consent_version || LGPD_VERSION;
      }
      if (withPrefs) { patch.full_name = name.trim() || state.profile.full_name; patch.style_preferences = [...sel]; }
      const { data, error } = await sb.from('profiles').update(patch).eq('id', state.user.id).select().single();
      setBusy(false);
      if (error) return toast(errMsg(error), 'error');
      state.profile = data;
      go('#/home');
    };
    $('#done').onclick = () => finish(true);
    $('#skip').onclick = () => finish(false);
  };
  paint();
}

/* ============================================================
   Look Card (colagem)
   ============================================================ */
const sortItems = (items) =>
  [...items].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

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

function lookCard(items, { editable = false } = {}) {
  if (!items.length) return '';
  return `<div class="rounded-[2rem] bg-gradient-to-b from-stone-100 to-stone-200 p-3">
    <div class="grid grid-cols-2 gap-2.5">
      ${layoutItems(items).map(({ it, span }) => `
        <figure class="relative flex items-center justify-center overflow-hidden rounded-2xl bg-white/85 p-3 ${span === 2 ? 'col-span-2 aspect-[2/1]' : 'aspect-square'}"
          ${editable ? `data-swap="${esc(it.id)}" role="button" tabindex="0" aria-label="Trocar ${esc(it.name || CATEGORIES[it.category])}"` : ''}>
          <img src="${esc(it.image_url)}" alt="${esc(it.name || CATEGORIES[it.category])}" loading="lazy" class="max-h-full max-w-full object-contain">
          <figcaption class="absolute bottom-1.5 left-3 text-[10px] uppercase tracking-wider text-stone-500">${CATEGORIES[it.category]}</figcaption>
          ${editable ? `<span class="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-stone-600 shadow-sm">${icon('swap', 'h-4 w-4')}</span>` : ''}
        </figure>`).join('')}
    </div></div>
    ${editable ? '<p class="mt-2 text-center text-xs text-stone-500">Toque em uma peça para trocá-la</p>' : ''}`;
}

function bindSwap(container, handler) {
  $$('[data-swap]', container).forEach((el) => {
    el.onclick = () => handler(el.dataset.swap);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(el.dataset.swap); } };
  });
}

const miniCollage = (items) => {
  const imgs = sortItems(items).slice(0, 4);
  if (!imgs.length) return `<div class="flex aspect-square items-center justify-center rounded-2xl bg-stone-100 text-stone-300">${icon('photo', 'h-8 w-8')}</div>`;
  return `<div class="grid aspect-square grid-cols-2 gap-1 overflow-hidden rounded-2xl bg-stone-100 p-1.5">
    ${imgs.map((i) => `<div class="flex items-center justify-center rounded-lg bg-white p-1"><img src="${esc(i.image_url)}" alt="" loading="lazy" class="max-h-full max-w-full object-contain"></div>`).join('')}
  </div>`;
};

/* Troca (ou remove) uma peça de um look. onApply(novaLista) recebe as peças. */
function openSwap(items, itemId, onApply) {
  const cur = items.find((i) => i.id === itemId);
  if (!cur) return;
  const used = new Set(items.map((i) => i.id));
  const options = state.clothes.filter((c) => c.category === cur.category && !used.has(c.id));
  const root = openModal(`
    ${modalHeader(`Trocar: ${CATEGORIES[cur.category]}`)}
    <div class="mb-4 flex items-center gap-3 rounded-2xl bg-stone-50 p-3">
      <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white p-1"><img src="${esc(cur.image_url)}" alt="" class="max-h-full max-w-full object-contain"></div>
      <div class="min-w-0 text-sm"><p class="truncate font-medium">${esc(cur.name || CATEGORIES[cur.category])}</p><p class="text-xs text-stone-500">peça atual</p></div>
    </div>
    ${options.length ? `
      <div class="grid grid-cols-3 gap-2">
        ${options.map((c) => `
          <button data-pick="${esc(c.id)}" class="rounded-2xl bg-stone-50 p-2 text-left ring-1 ring-stone-100">
            <div class="flex aspect-square items-center justify-center"><img src="${esc(c.image_url)}" alt="" loading="lazy" class="max-h-full max-w-full object-contain"></div>
            <p class="mt-1 truncate text-[11px] text-stone-600">${esc(c.name || CATEGORIES[c.category])}</p>
          </button>`).join('')}
      </div>` : `<p class="rounded-2xl bg-stone-100 p-4 text-sm text-stone-500">Você não tem outras peças desta categoria. <a href="#/closet/new" class="font-medium underline">Adicionar peça</a></p>`}
    ${items.length > 2 ? `<button id="sw-remove" class="btn btn-danger mt-4 w-full">${icon('trash')} Tirar esta peça do look</button>` : ''}`);
  $$('[data-pick]', root).forEach((b) => (b.onclick = () => {
    const next = state.clothes.find((c) => c.id === b.dataset.pick);
    closeModal();
    onApply(items.map((i) => (i.id === itemId ? next : i)));
  }));
  const rm = $('#sw-remove', root);
  if (rm) rm.onclick = () => { closeModal(); onApply(items.filter((i) => i.id !== itemId)); };
}

/* ============================================================
   Início
   ============================================================ */
function setupSteps() {
  const has = (cats) => state.clothes.some((c) => cats.includes(c.category));
  return [
    { done: has(['top', 'fullbody']), label: 'Cadastre uma parte de cima', href: '#/closet/new' },
    { done: has(['bottom', 'fullbody']), label: 'Cadastre uma parte de baixo', href: '#/closet/new' },
    { done: has(['shoes']), label: 'Cadastre um calçado', href: '#/closet/new' },
    { done: state.outfits.length > 0, label: 'Gere e salve seu primeiro look', href: '#/create' },
  ];
}

function renderHome() {
  const first = (state.profile?.full_name || '').split(' ')[0] || 'olá';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const empty = state.clothes.length === 0;
  const steps = setupSteps();
  const doneCount = steps.filter((s) => s.done).length;
  const canLook = state.clothes.length >= 2;

  view().innerHTML = `
    <div class="fade-up">
      <p class="text-sm text-stone-500">${greet},</p>
      <h1 class="font-display text-3xl">${esc(first)}</h1>

      <div class="mt-6 rounded-[2rem] bg-stone-900 p-6 text-white">
        <p class="text-xs uppercase tracking-widest text-stone-400">Estilista de IA</p>
        <h2 class="mt-2 font-display text-2xl leading-snug">${empty ? 'Comece cadastrando suas primeiras peças' : 'O que vamos vestir hoje?'}</h2>
        <div class="mt-5 flex flex-wrap gap-2">
          ${empty
            ? `<a href="#/closet/new" class="btn bg-white text-stone-900 hover:bg-stone-100">${icon('camera')} Adicionar peça</a>`
            : `<button id="quick" class="btn bg-white text-stone-900 hover:bg-stone-100" ${canLook ? '' : 'disabled'}>${icon('sparkles')} Look de hoje</button>
               <a href="#/create" class="btn bg-white/10 text-white hover:bg-white/20">Escolher ocasião</a>`}
        </div>
      </div>

      ${doneCount < steps.length ? `
        <div class="card mt-4 p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Primeiros passos</h2>
            <span class="text-xs text-stone-500">${doneCount}/${steps.length}</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100"><div class="h-full rounded-full bg-stone-900" style="width:${(doneCount / steps.length) * 100}%"></div></div>
          <ul class="mt-3 space-y-1.5">
            ${steps.map((s) => `
              <li>${s.done
                ? `<span class="flex items-center gap-2 py-1 text-sm text-stone-400 line-through"><span class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">${icon('check', 'h-3 w-3')}</span>${esc(s.label)}</span>`
                : `<a href="${s.href}" class="flex items-center gap-2 py-1 text-sm text-stone-800"><span class="h-5 w-5 rounded-full border border-stone-300"></span>${esc(s.label)}</a>`}</li>`).join('')}
          </ul>
        </div>` : ''}

      <div class="mt-4 grid grid-cols-2 gap-3">
        <a href="#/closet" class="card p-4"><p class="font-display text-3xl">${state.clothes.length}</p><p class="text-xs text-stone-500">peças no guarda-roupa</p></a>
        <div class="card p-4"><p class="font-display text-3xl">${state.outfits.length}</p><p class="text-xs text-stone-500">looks favoritos</p></div>
      </div>

      <h2 class="mb-3 mt-8 font-display text-xl">Looks favoritos</h2>
      ${state.outfits.length ? `
        <div class="grid grid-cols-2 gap-3">
          ${state.outfits.map((o) => `
            <a href="#/outfit/${esc(o.id)}" class="block">
              ${miniCollage(itemsOf(o))}
              <p class="mt-2 truncate text-sm font-medium">${esc(o.title)}</p>
              <p class="truncate text-xs text-stone-500">${esc(o.occasion || '')}${o.is_public ? ' · link público' : ''}</p>
            </a>`).join('')}
        </div>` : `<p class="rounded-2xl bg-stone-100 p-5 text-sm text-stone-500">Quando você salvar um look nos favoritos, ele aparece aqui.</p>`}
    </div>`;
  const q = $('#quick');
  if (q) q.onclick = quickLook;
}

/* ============================================================
   Guarda-roupa
   ============================================================ */
function filterClothes() {
  const f = state.closetFilter;
  const q = norm(state.closetQuery.trim());
  return state.clothes.filter((c) => {
    if (f !== 'all' && c.category !== f) return false;
    if (!q) return true;
    const hay = norm([c.name, CATEGORIES[c.category], ...(c.colors || []), ...(c.tags || [])].join(' '));
    return q.split(/\s+/).every((t) => hay.includes(t));
  });
}


function renderCloset() {
  const f = state.closetFilter;
  const total = state.clothes.length;
  const counts = categoryCounts();
  const cats = CAT_ORDER.filter((k) => counts[k]);
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-end justify-between gap-3">
        <div class="min-w-0">
          <h1 class="font-display text-3xl">Guarda-roupa</h1>
          <p class="mt-1 text-sm text-stone-500">${total
            ? `${total} ${total === 1 ? 'peça' : 'peças'} em ${cats.length} ${cats.length === 1 ? 'categoria' : 'categorias'}`
            : 'Cadastre suas peças para começar'}</p>
        </div>
        <a href="#/closet/new" class="btn btn-primary shrink-0 !px-4">${icon('plus', 'h-4 w-4')} Peça</a>
      </div>
      ${total ? `
        <div class="mt-5 flex gap-2">
          <div class="relative min-w-0 flex-1">
            <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400">${icon('search', 'h-4 w-4')}</span>
            <input id="q" type="search" class="input !pl-10" placeholder="Buscar nome, cor ou estilo" value="${esc(state.closetQuery)}" aria-label="Buscar peças">
          </div>
          <select id="sort" class="input !w-auto shrink-0 !py-2 text-sm" aria-label="Ordenar peças">
            <option value="category">Por categoria</option>
            <option value="recent">Mais recentes</option>
            <option value="name">Nome (A–Z)</option>
          </select>
        </div>
        <div class="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          ${[['all', 'Tudo', total], ...cats.map((k) => [k, CATEGORIES[k], counts[k]])].map(([k, v, n]) =>
            `<button data-f="${k}" aria-pressed="${f === k}" class="chip shrink-0 ${f === k ? 'chip-on' : ''}">${esc(v)} <span class="${f === k ? 'opacity-70' : 'text-stone-400'}">${n}</span></button>`).join('')}
        </div>` : ''}
      <p id="count" class="mt-3 text-xs text-stone-500"></p>
      <div id="grid"></div>
    </div>`;

  const paintGrid = () => {
    const filtered = state.closetFilter !== 'all' || state.closetQuery.trim();
    const list = sortClothes(filterClothes());
    $('#count').textContent = total && filtered ? `${list.length} de ${total} peças` : '';
    const grouped = total && !filtered && state.closetSort === 'category';
    $('#grid').innerHTML = !total || !list.length
      ? closetEmpty(total)
      : grouped ? closetSections(list)
      : `<div class="mt-4 grid grid-cols-2 gap-3">${list.map(clothCard).join('')}</div>`;
    $$('[data-id]', $('#grid')).forEach((b) => (b.onclick = () => openItemModal(b.dataset.id)));
    const clr = $('#clear-filters');
    if (clr) clr.onclick = () => { state.closetFilter = 'all'; state.closetQuery = ''; renderCloset(); };
  };
  paintGrid();
  $$('[data-f]').forEach((b) => (b.onclick = () => { state.closetFilter = b.dataset.f; renderCloset(); }));
  const q = $('#q');
  if (q) {
    let t;
    q.oninput = (e) => { state.closetQuery = e.target.value; clearTimeout(t); t = setTimeout(paintGrid, 120); };
  }
  const sort = $('#sort');
  if (sort) {
    sort.value = state.closetSort;
    sort.onchange = (e) => { state.closetSort = e.target.value; paintGrid(); };
  }
}

function categoryCounts() {
  const c = {};
  state.clothes.forEach((x) => { c[x.category] = (c[x.category] || 0) + 1; });
  return c;
}

// Peça com recorte é PNG (fundo removido). Foto antiga em JPEG ainda tem fundo.
const hasCutout = (c) => /\.png$/i.test(c.image_url || '');

function sortClothes(list) {
  const copy = [...list];
  if (state.closetSort === 'name') {
    copy.sort((a, b) => (a.name || CATEGORIES[a.category]).localeCompare(b.name || CATEGORIES[b.category], 'pt-BR'));
  } else if (state.closetSort === 'category') {
    copy.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  }
  return copy; // "recent": ordem do banco (mais novas primeiro)
}

function clothCard(c) {
  const title = c.name || CATEGORIES[c.category];
  const dots = (c.colors || []).slice(0, 3).map((v) =>
    `<span class="h-2.5 w-2.5 rounded-full ring-1 ring-stone-300" style="background:${COLORS[v] || '#d6d3d1'}"></span>`).join('');
  return `
    <button data-id="${esc(c.id)}" class="card overflow-hidden text-left transition active:scale-[0.98]">
      <div class="relative flex aspect-square items-center justify-center bg-stone-100 p-4">
        <img src="${esc(c.image_url)}" alt="${esc(title)}" loading="lazy" class="max-h-full max-w-full object-contain">
        ${hasCutout(c) ? '' : '<span class="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-stone-600">Sem recorte</span>'}
      </div>
      <div class="px-3 pb-3 pt-2.5">
        <p class="truncate text-sm font-medium text-stone-800">${esc(title)}</p>
        <div class="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
          <span class="truncate">${esc(CATEGORIES[c.category])}</span>
          ${dots ? `<span class="ml-auto flex shrink-0 gap-1">${dots}</span>` : ''}
        </div>
      </div>
    </button>`;
}

function closetSections(list) {
  return CAT_ORDER.map((k) => [k, list.filter((c) => c.category === k)])
    .filter(([, arr]) => arr.length)
    .map(([k, arr]) => `
      <section class="mt-7 first:mt-5">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="font-display text-xl">${esc(CATEGORIES[k])}</h2>
          <span class="text-xs text-stone-500">${arr.length}</span>
        </div>
        <div class="grid grid-cols-2 gap-3">${arr.map(clothCard).join('')}</div>
      </section>`).join('');
}

function closetEmpty(total) {
  if (total) return `
    <div class="mt-12 text-center">
      <p class="text-sm text-stone-500">Nenhuma peça encontrada com esse filtro.</p>
      <button id="clear-filters" class="btn btn-soft mt-4">Limpar filtros</button>
    </div>`;
  return `
    <div class="card mt-6 p-6">
      <p class="font-display text-2xl">Comece pela primeira peça</p>
      <ol class="mt-4 space-y-3 text-sm text-stone-600">
        <li class="flex gap-3"><span class="chip !px-2.5 !py-0.5 shrink-0">1</span><span>Fotografe uma peça estendida sobre um fundo liso.</span></li>
        <li class="flex gap-3"><span class="chip !px-2.5 !py-0.5 shrink-0">2</span><span>O app tira o fundo sozinho. Se sobrar algo, ajuste com o pincel.</span></li>
        <li class="flex gap-3"><span class="chip !px-2.5 !py-0.5 shrink-0">3</span><span>Salve e monte seu primeiro look.</span></li>
      </ol>
      <a href="#/closet/new" class="btn btn-primary mt-6 w-full">${icon('camera')} Adicionar primeira peça</a>
    </div>`;
}


/* --- formulário reutilizável (nova peça / edição) --- */
function chipRow(values, selected, attr, render = (v) => esc(v)) {
  return values.map((v) => `<button type="button" data-${attr}="${esc(v)}" aria-pressed="${selected.has(v)}" class="chip ${selected.has(v) ? 'chip-on' : ''}">${render(v)}</button>`).join('');
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

function mountItemForm(container, d) {
  const paint = () => {
    container.innerHTML = `
      <div class="space-y-5">
        <div><label class="label" for="i-name">Nome (opcional)</label>
          <input id="i-name" class="input" maxlength="80" value="${esc(d.name || '')}" placeholder="Ex.: Camisa social branca"></div>
        <div><span class="label">Categoria</span>
          <div class="flex flex-wrap gap-2">${Object.entries(CATEGORIES).map(([k, v]) =>
            `<button type="button" data-cat="${k}" aria-pressed="${d.category === k}" class="chip ${d.category === k ? 'chip-on' : ''}">${v}</button>`).join('')}</div></div>
        <div><span class="label">Cores predominantes</span>
          <div class="flex flex-wrap gap-2">${chipRow(Object.keys(COLORS), d.colors, 'color', (v) =>
            `<span class="h-3.5 w-3.5 rounded-full ring-1 ring-stone-300" style="background:${COLORS[v]}"></span>${esc(v)}`)}</div></div>
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

/* --- modal de detalhe/edição --- */
function openItemModal(id) {
  const item = state.clothes.find((c) => c.id === id);
  if (!item) return;
  const d = { name: item.name || '', category: item.category, colors: new Set(item.colors || []), tags: new Set(item.tags || []) };
  const root = openModal(`
    ${modalHeader('Peça')}
    <div class="mb-5 flex aspect-[4/3] items-center justify-center rounded-3xl bg-stone-50 p-4"><img src="${esc(item.image_url)}" alt="" class="max-h-full max-w-full object-contain"></div>
    <div class="mb-5 grid grid-cols-2 gap-2"><button id="recut" class="btn btn-soft">${icon('scissors')} Recortar fundo</button><button id="withit" class="btn btn-soft">${icon('sparkles')} Criar look</button></div>
    <div id="form"></div>
    <div class="mt-6 flex gap-3">
      <button id="del" class="btn btn-danger">${icon('trash')} Excluir</button>
      <button id="save" class="btn btn-primary flex-1">Salvar alterações</button>
    </div>`);
  mountItemForm($('#form', root), d);
  $('#recut', root).onclick = async () => {
    setBusy(true, 'Carregando a peça…');
    let src;
    try {
      const r = await fetch(item.image_url);
      if (!r.ok) throw new Error('Não consegui baixar a foto da peça.');
      src = await r.blob();
    } catch (e) { setBusy(false); return toast(errMsg(e), 'error'); }
    if (!/png/.test(src.type)) {
      setBusy(true, 'Recortando a peça… (na 1ª vez pode demorar)');
      try { src = (await removeBackground(src)).blob; }
      catch (e) { toast(errMsg(e) + ' Ajuste manualmente com o pincel.', 'error'); }
    }
    setBusy(false);
    const edited = await openCutoutEditor(src);
    if (!edited) return;
    setBusy(true, 'Salvando o recorte…');
    try {
      const path = `${state.user.id}/${crypto.randomUUID()}.png`;
      const up = await sb.storage.from('clothes').upload(path, edited, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
      if (up.error) throw up.error;
      const { data: pub } = sb.storage.from('clothes').getPublicUrl(path);
      const { data, error } = await sb.from('clothes').update({ image_url: pub.publicUrl, storage_path: path }).eq('id', id).select().single();
      if (error) { await sb.storage.from('clothes').remove([path]); throw error; }
      if (item.storage_path) await sb.storage.from('clothes').remove([item.storage_path]);
      Object.assign(item, data);
      setBusy(false); closeModal(); renderCloset(); toast('Recorte salvo', 'ok');
    } catch (e) { setBusy(false); toast(errMsg(e), 'error'); }
  };
  $('#withit', root).onclick = () => {
    state.gen.pin = id; state.gen.result = null;
    closeModal(); go('#/create');
  };
  $('#save', root).onclick = async () => {
    if (!d.category) return toast('Escolha a categoria.', 'error');
    setBusy(true, 'Salvando…');
    const { data, error } = await sb.from('clothes')
      .update({ name: d.name.trim() || null, category: d.category, colors: [...d.colors], tags: [...d.tags] })
      .eq('id', id).select().single();
    setBusy(false);
    if (error) return toast(errMsg(error), 'error');
    Object.assign(item, data);
    closeModal(); renderCloset(); toast('Peça atualizada', 'ok');
  };
  $('#del', root).onclick = async () => {
    const inLooks = state.outfits.filter((o) => (o.items || []).includes(id)).length;
    const ok = await confirmDialog(
      inLooks ? `Esta peça está em ${inLooks} look(s) salvo(s); ela sairá deles. Excluir mesmo?` : 'Esta peça será removida do seu guarda-roupa.',
      { confirmLabel: 'Excluir', danger: true, title: 'Excluir peça?' });
    if (!ok) return;
    setBusy(true, 'Excluindo…');
    const { error } = await sb.from('clothes').delete().eq('id', id);
    if (!error && item.storage_path) await sb.storage.from('clothes').remove([item.storage_path]);
    setBusy(false);
    if (error) return toast(errMsg(error), 'error');
    state.clothes = state.clothes.filter((c) => c.id !== id);
    state.outfits.forEach((o) => { o.items = (o.items || []).filter((x) => x !== id); });
    if (state.gen.pin === id) state.gen.pin = null;
    renderCloset(); toast('Peça excluída');
  };
}

/* ============================================================
   Imagens: redimensionar, remover fundo, recortar, base64
   ============================================================ */
const loadImg = (src, cors = true) => new Promise((res, rej) => {
  const i = new Image();
  if (cors) i.crossOrigin = 'anonymous';
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('Não consegui abrir esta foto. Tente outra (JPG ou PNG).'));
  i.src = src;
});
const canvasToBlob = (cv, type = 'image/jpeg', q = 0.88) => new Promise((r) => cv.toBlob(r, type, q));

async function resizeToBlob(fileOrBlob, max = 1200) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await loadImg(url, false);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return await canvasToBlob(cv, 'image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}

// Plano B simples (Canvas): remove fundo liso a partir das bordas por "flood fill".
async function simpleBgRemove(blob, tol = 38) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url, false);
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h); const px = im.data;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; });
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
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    g.putImageData(im, 0, 0);
    return await canvasToBlob(cv, 'image/png');
  } finally { URL.revokeObjectURL(url); }
}

// Recorta as bordas transparentes (a peça preenche melhor o quadro do look).
// Devolve { blob, opaque } onde opaque = fração de pixels visíveis.
async function autocrop(blob, pad = 0.06) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url, false);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, w, h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 24) {
          count++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const opaque = count / (w * h);
    if (x1 < 0) return { blob, opaque: 0 };
    const p = Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * pad);
    const sx = Math.max(0, x0 - p), sy = Math.max(0, y0 - p);
    const sw = Math.min(w, x1 + p + 1) - sx, sh = Math.min(h, y1 + p + 1) - sy;
    if (sw * sh > 0.92 * w * h) return { blob, opaque };
    const out = document.createElement('canvas'); out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
    return { blob: await canvasToBlob(out, 'image/png'), opaque };
  } finally { URL.revokeObjectURL(url); }
}

// Verifica se o fundo é liso: a maioria das cores nas bordas precisa ser parecida.
// Cama, lençol estampado, cabide ou tapete tendem a reprovar.
async function hasPlainBackground(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url, false);
    const k = Math.min(1, 200 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const border = [];
    const add = (x, y) => { const i = (y * w + x) * 4; border.push([px[i], px[i + 1], px[i + 2]]); };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    const mean = [0, 1, 2].map((c) => border.reduce((s, p) => s + p[c], 0) / border.length);
    const same = border.filter((p) => Math.abs(p[0] - mean[0]) + Math.abs(p[1] - mean[1]) + Math.abs(p[2] - mean[2]) < 60).length;
    return same / border.length >= 0.9;
  } finally { URL.revokeObjectURL(url); }
}

// Remoção de fundo: IA primeiro (funciona em cama, cabide e fundo colorido).
// O plano B por cor só roda se o fundo for liso; caso contrário a foto original é preservada.
async function removeBackground(blob) {
  let method = 'ia', out;
  try {
    const mod = await withTimeout(import('https://esm.sh/@imgly/background-removal@1.5.5'), 30000, 'timeout');
    const fn = mod.removeBackground || mod.default;
    out = await withTimeout(fn(blob, {
      output: { format: 'image/png' },
      progress: (key, cur, total) => {
        if (total) setBusyText(`Removendo o fundo… ${Math.min(99, Math.round((cur / total) * 100))}%`);
      },
    }), 150000, 'timeout');
  } catch (e) {
    console.warn('IA de fundo indisponível', e);
    const plain = await hasPlainBackground(blob);
    if (!plain) {
      throw new Error('Não consegui recortar a peça automaticamente: o fundo tem textura (cama, lençol, cabide). Salve a foto sem remover o fundo ou tente de novo com a peça bem visível.');
    }
    method = 'simples';
    setBusyText('Removendo o fundo (modo simples)…');
    out = await simpleBgRemove(blob);
  }
  let cropped = await autocrop(out);
  if (cropped.opaque < 0.03 && method === 'ia' && await hasPlainBackground(blob)) {
    // IA apagou quase tudo num fundo liso: tenta o modo simples antes de desistir
    cropped = await autocrop(await simpleBgRemove(blob));
    method = 'simples';
  }
  if (cropped.opaque < 0.03) {
    throw new Error('Não consegui separar a peça do fundo nesta foto. Salve sem remover o fundo ou tire outra foto com a peça bem visível.');
  }
  return { blob: cropped.blob, method };
}

async function blobToBase64Jpeg(blob, max = 768) {
  const small = await resizeToBlob(blob, max);
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ============================================================
   Nova peça
   ============================================================ */
function newDraft() {
  return { original: null, blob: null, previewUrl: null, name: '', category: null, colors: new Set(), tags: new Set(), bgRemoved: false, cutout: null, cutoutError: null };
}
function discardDraft() {
  if (state.draft?.previewUrl) URL.revokeObjectURL(state.draft.previewUrl);
  state.draft = null;
}

// Recorte da peça: roda sozinho ao escolher a foto. Se falhar, a foto original continua disponível.
async function cutoutDraft(d) {
  setBusy(true, 'Recortando a peça… (na 1ª vez pode demorar)');
  try {
    const { blob } = await removeBackground(d.original);
    d.cutout = blob; d.cutoutError = null;
    setPreview(d, blob); d.bgRemoved = true;
  } catch (e) {
    d.cutout = null; d.cutoutError = errMsg(e); d.bgRemoved = false;
    setPreview(d, d.original);
  }
  setBusy(false);
}

// Pincel para ajustar o recorte: "Apagar" tira o que sobrou do fundo, "Restaurar" devolve partes da peça.
// Resolve com um Blob PNG (já cortado nas bordas transparentes) ou null se cancelar.
async function openCutoutEditor(srcBlob) {
  const url = URL.createObjectURL(srcBlob);
  let img;
  try { img = await loadImg(url, false); }
  catch { toast('Não consegui abrir esta foto.', 'error'); return null; }
  finally { URL.revokeObjectURL(url); }
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  base.getContext('2d').drawImage(img, 0, 0, W, H);

  return await new Promise((resolve) => {
    const root = openModal(`
      ${modalHeader('Ajustar recorte')}
      <p class="text-sm text-stone-600">Arraste o dedo sobre a peça. <b>Apagar</b> tira o que sobrou do fundo; <b>Restaurar</b> devolve partes da peça.</p>
      <div class="checker mt-4 flex justify-center rounded-3xl p-2">
        <canvas id="ce" class="block max-h-[55vh] max-w-full touch-none"></canvas>
      </div>
      <div class="mt-4 grid grid-cols-3 gap-2">
        <button id="ce-erase" class="btn btn-primary !py-2">Apagar</button>
        <button id="ce-restore" class="btn btn-soft !py-2">Restaurar</button>
        <button id="ce-undo" class="btn btn-ghost !py-2">Desfazer</button>
      </div>
      <label class="mt-4 block text-sm text-stone-600">Tamanho do pincel
        <input id="ce-size" type="range" min="6" max="90" value="28" class="mt-1 w-full"></label>
      <div class="mt-5 grid grid-cols-2 gap-2">
        <button id="ce-cancel" class="btn btn-ghost">Cancelar</button>
        <button id="ce-ok" class="btn btn-primary">Usar este recorte</button>
      </div>`);

    const cv = $('#ce', root);
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(base, 0, 0);
    const history = [];
    let mode = 'erase', drawing = false, last = null;

    const setMode = (m) => {
      mode = m;
      $('#ce-erase', root).className = `btn ${m === 'erase' ? 'btn-primary' : 'btn-soft'} !py-2`;
      $('#ce-restore', root).className = `btn ${m === 'restore' ? 'btn-primary' : 'btn-soft'} !py-2`;
    };
    const radius = () => (Number($('#ce-size', root).value) / 2) * (W / cv.getBoundingClientRect().width);
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    };
    const dab = (x, y, r) => {
      g.save();
      if (mode === 'erase') {
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      } else {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
        g.drawImage(base, 0, 0, W, H);
      }
      g.restore();
    };
    const line = (a, b, r) => {
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, r * 0.4)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        dab(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r);
      }
    };

    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      history.push(g.getImageData(0, 0, W, H));
      if (history.length > 12) history.shift();
      cv.setPointerCapture(e.pointerId);
      drawing = true; last = pt(e);
      dab(last[0], last[1], radius());
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pt(e);
      line(last, p, radius());
      last = p;
    });
    const end = () => { drawing = false; last = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    setMode('erase');
    $('#ce-erase', root).onclick = () => setMode('erase');
    $('#ce-restore', root).onclick = () => setMode('restore');
    $('#ce-undo', root).onclick = () => {
      const prev = history.pop();
      if (prev) g.putImageData(prev, 0, 0); else toast('Nada para desfazer.');
    };
    $('#ce-cancel', root).onclick = () => { closeModal(); resolve(null); };
    $('#ce-ok', root).onclick = async () => {
      const out = await canvasToBlob(cv, 'image/png');
      const cropped = await autocrop(out);
      if (cropped.opaque < 0.02) return toast('A peça ficou vazia. Use "Restaurar" para devolver partes dela.', 'error');
      closeModal(); resolve(cropped.blob);
    };
  });
}

function renderNewItem() {
  if (!state.draft) state.draft = newDraft();
  const d = state.draft;
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="#/closet" id="cancel-new" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="font-display text-3xl">Nova peça</h1>
      </div>

      ${d.blob ? `
        <div class="mt-5 flex aspect-square items-center justify-center rounded-3xl p-4 ${d.bgRemoved && d.blob !== d.original ? 'checker' : 'bg-stone-100'}">
          <img src="${d.previewUrl}" alt="Prévia da peça" class="max-h-full max-w-full object-contain">
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button id="rmbg" class="btn btn-soft">${icon('scissors')} Recortar de novo</button>
          <button id="adjust" class="btn btn-soft">${icon('scissors')} Ajustar recorte</button>
          <button id="ai" class="btn btn-soft col-span-2">${icon('sparkles')} Preencher com IA</button>
          ${d.cutout && d.blob !== d.cutout ? `<button id="use-cut" class="btn btn-ghost col-span-2">Usar o recorte</button>` : ''}
          ${d.original && d.blob !== d.original ? `<button id="restore" class="btn btn-ghost col-span-2">Usar foto original</button>` : ''}
          <button id="other" class="btn btn-ghost col-span-2">Trocar foto</button>
        </div>
        ${d.cutoutError ? `<p class="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">${esc(d.cutoutError)}</p>` : ''}
        <p class="mt-1 text-center text-xs text-stone-500">“Preencher com IA” envia a foto ao Google Gemini para sugerir categoria e cores.</p>` : `
        <p class="mt-3 text-sm text-stone-500">Dica: estique a peça sobre um chão ou parede lisos, com boa luz. Em cama com estampa, o recorte pode pedir ajuste com o pincel.</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button id="cam" class="card flex flex-col items-center gap-2 py-10 text-stone-700">${icon('camera', 'h-8 w-8')}<span class="text-sm font-medium">Tirar foto</span></button>
          <button id="gal" class="card flex flex-col items-center gap-2 py-10 text-stone-700">${icon('photo', 'h-8 w-8')}<span class="text-sm font-medium">Galeria</span></button>
        </div>`}

      <input id="file-cam" type="file" accept="image/*" capture="environment" class="hidden">
      <input id="file-gal" type="file" accept="image/*" class="hidden">

      ${d.blob ? `<div id="form" class="mt-6"></div>
        <div class="mt-6 grid gap-2">
          <button id="save" class="btn btn-primary w-full">Salvar no guarda-roupa</button>
          <button id="save-more" class="btn btn-soft w-full">Salvar e adicionar outra</button>
        </div>` : ''}
    </div>`;

  const pick = (file) => file && onPick(file);
  $('#file-cam').onchange = (e) => pick(e.target.files[0]);
  $('#file-gal').onchange = (e) => pick(e.target.files[0]);
  $('#cancel-new').onclick = discardDraft;
  if ($('#cam')) { $('#cam').onclick = () => $('#file-cam').click(); $('#gal').onclick = () => $('#file-gal').click(); }
  if (!d.blob) return;

  $('#other').onclick = () => $('#file-gal').click();
  mountItemForm($('#form'), d);

  $('#rmbg').onclick = async () => { await cutoutDraft(d); renderNewItem(); };
  $('#adjust').onclick = async () => {
    const edited = await openCutoutEditor(d.blob);
    if (!edited) return;
    d.cutout = edited; d.cutoutError = null; d.bgRemoved = true;
    setPreview(d, edited);
    renderNewItem();
  };
  const useCut = $('#use-cut');
  if (useCut) useCut.onclick = () => { setPreview(d, d.cutout); d.bgRemoved = true; renderNewItem(); };
  const restore = $('#restore');
  if (restore) restore.onclick = () => { setPreview(d, d.original); d.bgRemoved = false; renderNewItem(); };

  $('#ai').onclick = async () => {
    setBusy(true, 'A IA está analisando a peça…');
    try {
      const image_base64 = await blobToBase64Jpeg(d.blob);
      const { data, error } = await withTimeout(
        sb.functions.invoke('analyze-clothing', { body: { image_base64, mime_type: 'image/jpeg' } }),
        45000, 'A IA demorou demais. Tente de novo.');
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

  $('#save').onclick = () => saveItem(false);
  $('#save-more').onclick = () => saveItem(true);
}

function setPreview(d, blob) {
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
  d.blob = blob; d.previewUrl = URL.createObjectURL(blob);
}

async function onPick(file) {
  setBusy(true, 'Preparando a foto…');
  let d;
  try {
    d = state.draft || (state.draft = newDraft());
    const resized = await resizeToBlob(file, 1200);
    d.original = resized; d.cutout = null; d.cutoutError = null; d.bgRemoved = false;
    setPreview(d, resized);
  } catch (e) {
    toast(errMsg(e), 'error'); setBusy(false); renderNewItem(); return;
  }
  setBusy(false);
  await cutoutDraft(d);
  renderNewItem();
  if (d.cutout) toast('Peça recortada. Confira a prévia antes de salvar.', 'ok');
  else toast('Não consegui recortar sozinho. Use "Ajustar recorte" ou salve a foto original.', 'error');
}

async function saveItem(addAnother) {
  const d = state.draft;
  if (!d?.blob) return toast('Escolha uma foto primeiro.', 'error');
  if (!d.category) {
    toast('Escolha a categoria da peça.', 'error');
    $('#form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  setBusy(true, 'Salvando…');
  let path = null;
  try {
    const ext = d.blob.type === 'image/png' ? 'png' : 'jpg';
    path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
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
    discardDraft();
    setBusy(false);
    toast('Peça adicionada!', 'ok');
    if (addAnother) { state.draft = newDraft(); renderNewItem(); window.scrollTo(0, 0); }
    else go('#/closet');
    return;
  } catch (e) { toast(errMsg(e), 'error'); }
  setBusy(false);
}

/* ============================================================
   Criar look (AI Stylist)
   ============================================================ */
function wardrobeGaps() {
  const has = (cats) => state.clothes.some((c) => cats.includes(c.category));
  const gaps = [];
  if (!has(['top', 'fullbody'])) gaps.push('uma parte de cima');
  if (!has(['bottom', 'fullbody'])) gaps.push('uma parte de baixo');
  if (!has(['shoes'])) gaps.push('um calçado');
  return gaps;
}

function renderCreate() {
  const g = state.gen;
  const prefs = state.profile?.style_preferences || [];
  const r = g.result;
  const pinned = g.pin ? state.clothes.find((c) => c.id === g.pin) : null;
  if (g.pin && !pinned) g.pin = null;
  const gaps = wardrobeGaps();

  view().innerHTML = `
    <div class="fade-up">
      <h1 class="font-display text-3xl">Criar look</h1>
      <p class="mt-1 text-sm text-stone-500">Diga a ocasião e o clima; a IA monta com as suas peças.</p>

      ${state.clothes.length < 2 ? `
        <div class="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Cadastre pelo menos 2 peças para a IA montar looks. <a href="#/closet/new" class="font-medium underline">Adicionar peça</a></div>`
      : gaps.length ? `
        <div class="mt-4 rounded-2xl bg-stone-100 p-4 text-sm text-stone-600">Dica: com ${gaps.join(', ')} os looks ficam mais completos. <a href="#/closet/new" class="font-medium underline">Adicionar peça</a></div>` : ''}

      ${pinned ? `
        <div class="mt-4 flex items-center gap-3 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-1"><img src="${esc(pinned.image_url)}" alt="" class="max-h-full max-w-full object-contain"></div>
          <p class="min-w-0 flex-1 text-sm">Look com <b class="font-medium">${esc(pinned.name || CATEGORIES[pinned.category])}</b></p>
          <button id="unpin" class="btn btn-ghost !p-2" aria-label="Remover peça fixa">${icon('x')}</button>
        </div>` : ''}

      <div class="mt-5 space-y-5">
        <div><span class="label">Ocasião</span>
          <div class="flex flex-wrap gap-2">
            ${OCCASIONS.map((o) => `<button data-occ="${esc(o)}" aria-pressed="${g.occasion === o}" class="chip ${g.occasion === o ? 'chip-on' : ''}">${esc(o)}</button>`).join('')}
          </div>
          <input id="occ-custom" class="input mt-2" maxlength="120" placeholder="Ou descreva: ex. casamento na praia" value="${esc(g.customOccasion)}" aria-label="Descrever a ocasião">
        </div>
        <div><span class="label">Clima</span>
          <div class="flex flex-wrap gap-2">
            ${WEATHERS.map((w) => { const on = g.weather === w.id || g.weather.startsWith(w.id + ' '); return `<button data-w="${w.id}" aria-pressed="${on}" class="chip ${on ? 'chip-on' : ''}">${w.label}</button>`; }).join('')}
            <button id="geo" class="chip">${icon('pin', 'h-4 w-4')} Usar minha localização</button>
          </div>
          ${g.weather && !WEATHERS.some((w) => w.id === g.weather) ? `<p class="mt-2 text-xs text-stone-500">Clima atual: ${esc(g.weather)}</p>` : ''}
        </div>
        ${prefs.length ? `<div><span class="label">Estilo (opcional)</span>
          <div class="flex flex-wrap gap-2">${prefs.map((s) => `<button data-st="${esc(s)}" aria-pressed="${g.style === s}" class="chip ${g.style === s ? 'chip-on' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
      </div>

      <button id="gen" class="btn btn-primary mt-6 w-full" ${state.clothes.length < 2 ? 'disabled' : ''}>${icon('sparkles')} ${r ? 'Gerar outro look' : 'Gerar look'}</button>
      ${g.quota ? `<p class="mt-2 text-center text-xs text-stone-500">${g.quota.used} de ${g.quota.limit} looks de IA usados nas últimas 24h</p>` : ''}

      ${r ? `
        <div class="fade-up mt-8" id="result">
          <div id="result-card">${lookCard(r.items, { editable: true })}</div>
          <h2 class="mt-5 font-display text-2xl">${esc(r.title)}</h2>
          <p class="mt-1 text-sm text-stone-600">${esc(r.description)}</p>
          ${r.tips ? `<p class="mt-3 rounded-2xl bg-stone-100 p-3 text-sm text-stone-600"><b>Dica:</b> ${esc(r.tips)}</p>` : ''}
          ${r.missing ? `<div class="mt-3 rounded-2xl border border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(r.missing)}</div>` : ''}
          <div id="social-bar" class="mt-5"></div>
          <div class="mt-5 grid grid-cols-2 gap-2">
            <button id="fav" class="btn ${r.saved_id ? 'btn-primary' : 'btn-soft'}">${icon(r.saved_id ? 'check' : 'heart')} ${r.saved_id ? 'Nos favoritos' : 'Salvar nos Favoritos'}</button>
            <button id="share" class="btn btn-soft">${icon('share')} Compartilhar</button>
          </div>
          <button id="tryon" class="btn btn-soft mt-2 w-full">${icon('sparkles')} Prévia do look</button>
        </div>` : ''}
    </div>`;

  $$('[data-occ]').forEach((b) => (b.onclick = () => { g.occasion = g.occasion === b.dataset.occ ? '' : b.dataset.occ; g.customOccasion = ''; renderCreate(); }));
  $('#occ-custom').oninput = (e) => { g.customOccasion = e.target.value; if (e.target.value && g.occasion) { g.occasion = ''; $$('[data-occ]').forEach((b) => { b.classList.remove('chip-on'); b.setAttribute('aria-pressed', 'false'); }); } };
  $$('[data-w]').forEach((b) => (b.onclick = () => { g.weather = g.weather === b.dataset.w ? '' : b.dataset.w; renderCreate(); }));
  $$('[data-st]').forEach((b) => (b.onclick = () => { g.style = g.style === b.dataset.st ? '' : b.dataset.st; renderCreate(); }));
  $('#geo').onclick = () => useLocationWeather();
  $('#gen').onclick = generateLook;
  const unpin = $('#unpin');
  if (unpin) unpin.onclick = () => { g.pin = null; renderCreate(); };
  if (r) {
    $('#fav').onclick = toggleFavorite;
    $('#share').onclick = shareGenerated;
    $('#tryon').onclick = () => openLookPreview(r.items);
    bindSwap($('#result-card'), (itemId) => openSwap(r.items, itemId, applyGeneratedItems));
    hydrateSocialBar(r.saved_id || null);
  }
}

async function applyGeneratedItems(newItems) {
  const r = state.gen.result;
  r.items = newItems;
  if (r.saved_id) {
    const { error } = await sb.from('outfits').update({ items: newItems.map((i) => i.id) }).eq('id', r.saved_id);
    if (error) toast(errMsg(error), 'error');
    else {
      const o = state.outfits.find((x) => x.id === r.saved_id);
      if (o) o.items = newItems.map((i) => i.id);
      toast('Look atualizado', 'ok');
    }
  }
  renderCreate();
}

async function useLocationWeather(silent = false) {
  if (!navigator.geolocation) { if (!silent) toast('Seu navegador não permite localização.', 'error'); return; }
  setBusy(true, 'Buscando o clima…');
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
    const { latitude: la, longitude: lo } = pos.coords;
    const r = await withTimeout(
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,precipitation,weather_code&timezone=auto`),
      10000, 'timeout');
    const j = await r.json();
    const t = Math.round(j.current.temperature_2m);
    const code = j.current.weather_code;
    const rain = j.current.precipitation > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    const base = t <= 15 ? 'frio' : t <= 24 ? 'ameno' : 'quente';
    state.gen.weather = `${base} (${t}°C${rain ? ', com chuva' : ''})`;
    if (!silent) toast(`Clima: ${t}°C${rain ? ' com chuva' : ''}`, 'ok');
  } catch (e) {
    if (!silent) {
      toast(e?.code === 1 ? 'Permissão de localização negada. Escolha o clima manualmente.' : 'Não consegui obter o clima. Escolha manualmente.', 'error');
    }
  }
  setBusy(false);
  if (!silent) renderCreate();
}

async function quickLook() {
  if (state.clothes.length < 2) { toast('Cadastre pelo menos 2 peças primeiro.', 'error'); return go('#/closet/new'); }
  const g = state.gen;
  if (!g.occasion && !g.customOccasion.trim()) g.occasion = 'Dia a dia';
  g.pin = null;
  await useLocationWeather(true);
  go('#/create');
  await sleep(50);
  await generateLook();
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
    const { data, error } = await withTimeout(
      sb.functions.invoke('stylist', {
        body: { occasion, weather: g.weather, style: g.style, avoid: g.history.slice(-4), must_include: g.pin ? [g.pin] : [] },
      }), 45000, 'A IA demorou demais. Tente de novo.');
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const byId = clothesById();
    const items = (data.item_ids || []).map((id) => byId.get(id)).filter(Boolean);
    if (!items.length) throw new Error('A IA não achou peças compatíveis. Tente de novo ou cadastre mais peças.');
    g.result = { title: data.title, description: data.description, tips: data.tips, missing: data.missing_suggestions, items, occasion, saved_id: null };
    g.quota = data.quota || g.quota;
    g.history.push(items.map((i) => i.id).sort().join(','));
  } catch (e) { toast(await fnError(e), 'error'); }
  setBusy(false);
  renderCreate();
  $('#result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      r.saved_id = null; toast('Removido dos favoritos');
    } else { await saveGenerated(); toast('Look salvo nos favoritos!', 'ok'); }
  } catch (e) { toast(errMsg(e), 'error'); }
  setBusy(false); renderCreate();
}

async function shareGenerated() {
  setBusy(true, 'Preparando…');
  try {
    const wasSaved = !!state.gen.result.saved_id;
    const id = await saveGenerated();
    setBusy(false);
    if (!wasSaved) toast('Look salvo nos favoritos', 'ok');
    await openShare(id);
  } catch (e) { setBusy(false); toast(errMsg(e), 'error'); }
  renderCreate();
}

/* ============================================================
   Detalhe de look salvo
   ============================================================ */
function renderOutfitDetail(id) {
  const o = state.outfits.find((x) => x.id === id);
  if (!o) { toast('Look não encontrado.', 'error'); return go('#/home'); }
  const items = itemsOf(o);
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="#/home" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="min-w-0 flex-1 truncate font-display text-2xl">${esc(o.title)}</h1>
        <button id="rename" class="btn btn-ghost !p-2" aria-label="Renomear look">${icon('pencil')}</button>
      </div>
      <div class="mt-4" id="detail-card">${items.length ? lookCard(items, { editable: true }) : '<p class="rounded-2xl bg-stone-100 p-5 text-sm text-stone-500">As peças deste look foram removidas do guarda-roupa.</p>'}</div>
      ${o.occasion ? `<p class="mt-4 text-xs uppercase tracking-wide text-stone-500">${esc(o.occasion)}</p>` : ''}
      <p class="mt-1 text-sm text-stone-600">${esc(o.description || '')}</p>
      ${o.missing_suggestions ? `<div class="mt-3 rounded-2xl border border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(o.missing_suggestions)}</div>` : ''}
      <div id="social-bar" class="mt-4"></div>
      <p class="mt-4 text-xs text-stone-500">${o.is_public ? 'Link público ativo: quem tem o link vê este look.' : 'Este look é privado.'}</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button id="share" class="btn btn-primary" ${items.length ? '' : 'disabled'}>${icon('share')} Compartilhar</button>
        <button id="del" class="btn btn-danger">${icon('trash')} Excluir</button>
      </div>
      <button id="tryon" class="btn btn-soft mt-2 w-full" ${items.length ? '' : 'disabled'}>${icon('sparkles')} Prévia do look</button>
      ${o.is_public ? `<button id="unshare" class="btn btn-ghost mt-2 w-full text-sm">Desativar link público</button>` : ''}
    </div>`;
  $('#share').onclick = () => openShare(id);
  hydrateSocialBar(id);
  $('#tryon').onclick = () => openLookPreview(items);
  $('#rename').onclick = async () => {
    const t = await promptDialog({ title: 'Renomear look', label: 'Nome do look', value: o.title });
    if (!t || t === o.title) return;
    const { error } = await sb.from('outfits').update({ title: t }).eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    o.title = t; renderOutfitDetail(id); toast('Nome atualizado', 'ok');
  };
  bindSwap($('#detail-card'), (itemId) => openSwap(items, itemId, async (newItems) => {
    const { error } = await sb.from('outfits').update({ items: newItems.map((i) => i.id) }).eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    o.items = newItems.map((i) => i.id);
    renderOutfitDetail(id); toast('Look atualizado', 'ok');
  }));
  const un = $('#unshare');
  if (un) un.onclick = async () => {
    const { error } = await sb.from('outfits').update({ is_public: false }).eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    o.is_public = false; renderOutfitDetail(id); toast('Link público desativado', 'ok');
  };
  $('#del').onclick = async () => {
    if (!(await confirmDialog('Este look sairá dos seus favoritos e o link público (se houver) deixará de funcionar.', { confirmLabel: 'Excluir', danger: true, title: 'Excluir look?' }))) return;
    const { error } = await sb.from('outfits').delete().eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    state.outfits = state.outfits.filter((x) => x.id !== id);
    if (state.gen.result?.saved_id === id) state.gen.result.saved_id = null;
    toast('Look excluído'); go('#/home');
  };
}

/* ============================================================
   Feedback do look (gostei / não gostei / vou usar) e feed social
   ============================================================ */
const FEED_PAGE = 20;
let feedState = null;

// @apelido válido, null (vazio) ou false (inválido)
function handleValue() {
  const raw = ($('#handle')?.value || '').trim().toLowerCase().replace(/^@/, '');
  if (!raw) return null;
  return /^[a-z0-9_.]{3,20}$/.test(raw) ? raw : false;
}

// Look gerado pela IA ainda não salvo: salva antes de registrar a avaliação.
async function resolveLookId(id) {
  if (id) return id;
  const r = state.gen.result;
  if (!r) throw new Error('Gere um look primeiro.');
  if (!r.saved_id) {
    setBusy(true, 'Salvando look…');
    try { await saveGenerated(); }
    catch (e) { setBusy(false); toast(errMsg(e), 'error'); throw e; }
    setBusy(false);
    toast('Look salvo nos favoritos para registrar sua avaliação.', 'ok');
    if (location.hash.startsWith('#/create')) renderCreate();
  }
  return r.saved_id;
}

async function loadFeedback(id) {
  const { data } = await sb.from('outfit_feedback').select('rating, will_wear').eq('outfit_id', id).maybeSingle();
  state.feedback.set(id, data ? { rating: data.rating, will_wear: !!data.will_wear } : { rating: null, will_wear: false });
}

function socialBarHtml(id) {
  const fb = (id && state.feedback.get(id)) || {};
  const o = id ? state.outfits.find((x) => x.id === id) : null;
  const vis = o?.feed_visibility || 'off';
  const visLabel = vis === 'everyone' ? 'No feed: todos' : vis === 'selected' ? 'No feed: só selecionados' : 'Compartilhar no feed';
  return `<div class="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
    <p class="text-xs font-medium uppercase tracking-wide text-stone-500">O que você achou deste look?</p>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <button data-fb="1" aria-pressed="${fb.rating === 1}" class="chip justify-center !px-2 ${fb.rating === 1 ? 'chip-on' : ''}">${icon('thumb', 'h-4 w-4')} Gostei</button>
      <button data-fb="-1" aria-pressed="${fb.rating === -1}" class="chip justify-center !px-2 ${fb.rating === -1 ? 'chip-on' : ''}">${icon('thumb', 'h-4 w-4 rotate-180')} Não gostei</button>
      <button data-wear aria-pressed="${!!fb.will_wear}" class="chip justify-center !px-2 ${fb.will_wear ? 'chip-on' : ''}">${icon('check', 'h-4 w-4')} Vou usar</button>
    </div>
    <button data-feed class="btn btn-soft mt-2 w-full !py-2.5 text-sm">${icon('users', 'h-4 w-4')} ${visLabel}</button>
  </div>`;
}

function bindSocialBar(id) {
  const root = $('#social-bar');
  if (!root) return;
  $$('[data-fb]', root).forEach((b) => (b.onclick = async () => {
    const lid = await resolveLookId(id).catch(() => null);
    if (lid) setFeedback(lid, { rating: Number(b.dataset.fb) });
  }));
  const w = $('[data-wear]', root);
  if (w) w.onclick = async () => {
    const lid = await resolveLookId(id).catch(() => null);
    if (lid) setFeedback(lid, { will_wear: !state.feedback.get(lid)?.will_wear });
  };
  const f = $('[data-feed]', root);
  if (f) f.onclick = async () => {
    const lid = await resolveLookId(id).catch(() => null);
    if (lid) openFeedSheet(lid);
  };
}

function redrawBar(id) {
  const el = $('#social-bar');
  if (!el) return;
  el.innerHTML = socialBarHtml(id);
  bindSocialBar(id);
}

async function hydrateSocialBar(id) {
  if (id) await loadFeedback(id);
  redrawBar(id);
}

async function setFeedback(lid, patch) {
  const cur = state.feedback.get(lid) || { rating: null, will_wear: false };
  const next = { ...cur, ...patch };
  if ('rating' in patch && patch.rating === cur.rating) next.rating = null; // segundo toque desfaz
  const { error } = await sb.from('outfit_feedback').upsert({
    user_id: state.user.id, outfit_id: lid, rating: next.rating, will_wear: !!next.will_wear,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,outfit_id' });
  if (error) return toast(errMsg(error), 'error');
  state.feedback.set(lid, next);
  if ('rating' in patch && next.rating) toast('Obrigado! Isso ajuda a IA a entender o seu gosto.', 'ok');
  redrawBar(lid);
}

function openFeedSheet(lid) {
  const o = state.outfits.find((x) => x.id === lid);
  const cur = o?.feed_visibility || 'off';
  const opts = [
    ['off', 'Não compartilhar', 'Só você vê este look.'],
    ['everyone', 'Todos', 'Qualquer pessoa com conta, exceto quem você bloqueou.'],
    ['selected', 'Só pessoas selecionadas', 'Apenas quem está na sua lista de permissão (Perfil > Pessoas).'],
  ];
  const root = openModal(`
    ${modalHeader('Mostrar no feed')}
    <p class="mt-1 text-sm text-stone-600">Escolha quem pode ver este look no feed.</p>
    <div class="mt-4 space-y-2">
      ${opts.map(([v, t, d]) => `<button data-vis="${v}" aria-pressed="${cur === v}" class="w-full rounded-2xl p-4 text-left ring-1 ${cur === v ? 'ring-2 ring-stone-900 bg-stone-50' : 'ring-stone-200 bg-white'}">
        <span class="block text-sm font-medium">${t}</span><span class="mt-0.5 block text-xs text-stone-500">${d}</span></button>`).join('')}
    </div>
    ${!state.profile?.handle ? '<p class="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">Defina seu @apelido em Perfil para aparecer no feed.</p>' : ''}
  `);
  $$('[data-vis]', root).forEach((b) => (b.onclick = async () => {
    const v = b.dataset.vis;
    if (v !== 'off' && !state.profile?.handle) return toast('Defina seu @apelido em Perfil primeiro.', 'error');
    const { error } = await sb.from('outfits').update({ feed_visibility: v }).eq('id', lid);
    if (error) return toast(errMsg(error), 'error');
    if (o) o.feed_visibility = v;
    closeModal();
    toast(v === 'off' ? 'Look fora do feed' : 'Look publicado no feed', 'ok');
    route();
  }));
}

/* --- Pessoas: listas de permissão e de bloqueio --- */
async function renderPeopleBox() {
  const box = $('#people-box');
  if (!box) return;
  const { data, error } = await sb.rpc('my_people');
  if (!box.isConnected) return;
  if (error) { box.innerHTML = `<p class="text-sm text-red-700">${esc(errMsg(error))}</p>`; return; }
  const rows = Array.isArray(data) ? data : [];
  state.people = rows;
  const group = (kind, title, help) => {
    const list = rows.filter((r) => r.kind === kind);
    return `<div class="rounded-2xl bg-white p-3 ring-1 ring-stone-200">
      <p class="text-sm font-medium">${title}</p><p class="mt-0.5 text-xs text-stone-500">${help}</p>
      <div class="mt-2 flex flex-wrap gap-2">${list.length
        ? list.map((r) => `<span class="chip">@${esc(r.handle || '')} <button data-rm="${esc(r.target_id)}" data-kind="${kind}" class="ml-1 text-stone-500" aria-label="Remover @${esc(r.handle || '')}">${icon('x', 'h-3.5 w-3.5')}</button></span>`).join('')
        : '<span class="text-xs text-stone-400">Ninguém ainda</span>'}</div>
      <button data-add="${kind}" class="btn btn-soft mt-3 w-full !py-2 text-sm">Adicionar @apelido</button>
    </div>`;
  };
  box.innerHTML = group('allow', 'Lista de permissão', 'Quem vê os looks marcados como "Só pessoas selecionadas".')
    + group('block', 'Lista de bloqueio', 'Essas pessoas não veem seus looks e você não vê os delas.');
  $$('[data-add]', box).forEach((b) => (b.onclick = () => addPerson(b.dataset.add)));
  $$('[data-rm]', box).forEach((b) => (b.onclick = () => removePerson(b.dataset.rm, b.dataset.kind)));
}

async function addPerson(kind) {
  const raw = await promptDialog({ title: 'Adicionar pessoa', label: '@apelido da pessoa', value: '', confirmLabel: 'Adicionar', maxLength: 25 });
  if (!raw) return;
  const { data, error } = await sb.rpc('find_user_by_handle', { p_handle: raw.trim() });
  if (error) return toast(errMsg(error), 'error');
  if (!data) return toast('Não encontramos esse @apelido.', 'error');
  const { error: e2 } = await sb.from('user_lists').insert({ owner_id: state.user.id, target_id: data.id, kind });
  if (e2 && e2.code !== '23505') return toast(errMsg(e2), 'error');
  if (kind === 'block') {
    await sb.from('user_lists').delete().eq('owner_id', state.user.id).eq('target_id', data.id).eq('kind', 'allow');
  }
  toast(`@${data.handle} adicionado`, 'ok');
  renderPeopleBox();
}

async function removePerson(target, kind) {
  const { error } = await sb.from('user_lists').delete()
    .eq('owner_id', state.user.id).eq('target_id', target).eq('kind', kind);
  if (error) return toast(errMsg(error), 'error');
  renderPeopleBox();
}

/* --- Feed --- */
async function renderFeed() {
  feedState = { items: [], more: false };
  view().innerHTML = `<div class="fade-up">
    <h1 class="font-display text-3xl">Feed</h1>
    <p class="mt-1 text-sm text-stone-500">Looks que outras pessoas compartilharam com você.</p>
    <div id="feed-list" class="mt-5 space-y-5"><p class="text-sm text-stone-500">Carregando…</p></div>
  </div>`;
  await loadFeedPage(0);
}

async function loadFeedPage(offset) {
  const { data, error } = await sb.rpc('feed_looks', { p_limit: FEED_PAGE, p_offset: offset });
  if (!$('#feed-list')) return;
  if (error) { $('#feed-list').innerHTML = `<p class="rounded-2xl bg-red-50 p-4 text-sm text-red-700">${esc(errMsg(error))}</p>`; return; }
  const rows = Array.isArray(data) ? data : [];
  feedState.items.push(...rows);
  feedState.more = rows.length === FEED_PAGE;
  paintFeed();
}

function paintFeed() {
  const list = $('#feed-list');
  if (!list) return;
  if (!feedState.items.length) {
    list.innerHTML = `<div class="rounded-[2rem] bg-white p-6 text-center ring-1 ring-stone-200">
      <p class="font-display text-xl">Nada no feed por enquanto</p>
      <p class="mt-2 text-sm text-stone-500">Quando alguém compartilhar um look com você, ele aparece aqui. Você também pode compartilhar os seus em um look salvo.</p>
      <a href="#/create" class="btn btn-primary mt-4">Criar um look</a></div>`;
    return;
  }
  list.innerHTML = feedState.items.map(feedCardHtml).join('')
    + (feedState.more ? '<button id="feed-more" class="btn btn-soft w-full">Carregar mais</button>' : '');
  $$('[data-like]', list).forEach((b) => (b.onclick = () => toggleFeedLike(b.dataset.like)));
  $$('[data-more]', list).forEach((b) => (b.onclick = () => openFeedMenu(b.dataset.more)));
  const more = $('#feed-more');
  if (more) more.onclick = () => loadFeedPage(feedState.items.length);
}

function feedCardHtml(l) {
  const handle = l.owner_handle ? `@${esc(l.owner_handle)}` : esc(l.owner_name || 'Alguém');
  const initial = esc((l.owner_name || l.owner_handle || '?').slice(0, 1).toUpperCase());
  const likes = Number(l.likes) || 0;
  const heartStyle = l.liked ? 'style="color:#f43f5e;fill:#f43f5e"' : '';
  return `<article class="overflow-hidden rounded-[2rem] bg-white shadow-sm ring-1 ring-stone-100">
    <header class="flex items-center gap-3 px-4 pb-3 pt-4">
      <div class="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 text-sm font-medium text-stone-600" style="width:40px;height:40px">${l.owner_avatar ? `<img src="${esc(l.owner_avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : initial}</div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">${handle}</p>
        <p class="truncate text-xs text-stone-500">${l.occasion ? `${esc(l.occasion)} · ` : ''}${esc(timeAgoPt(l.created_at))}</p>
      </div>
      <button data-more="${esc(l.id)}" class="btn btn-ghost !p-2" aria-label="Opções do look">${icon('dots', 'h-5 w-5')}</button>
    </header>
    <div>${miniCollage(l.items || [])}</div>
    <div class="px-4 pb-4 pt-3">
      <button data-like="${esc(l.id)}" aria-pressed="${!!l.liked}" aria-label="${l.liked ? 'Descurtir' : 'Curtir'}" class="-ml-1 inline-flex items-center gap-2 rounded-full px-1 py-1 text-sm">
        ${icon('heart', `h-7 w-7 ${l.liked ? '' : 'text-stone-800'}`).replace('<svg ', `<svg ${heartStyle} `)}
        <span class="font-semibold">${likes} ${likes === 1 ? 'curtida' : 'curtidas'}</span>
      </button>
      <p class="mt-2 text-sm"><span class="font-semibold">${handle}</span> ${esc(l.title)}</p>
      ${l.description ? `<p class="mt-1 line-clamp-2 text-sm text-stone-600">${esc(l.description)}</p>` : ''}
    </div>
  </article>`;
}

function openFeedMenu(id) {
  const l = feedState.items.find((x) => x.id === id);
  if (!l) return;
  const who = l.owner_handle ? `@${l.owner_handle}` : 'esta pessoa';
  const mine = state.outfits.some((x) => x.id === id);
  const actions = mine
    ? `<button data-act="unshare" class="btn btn-soft w-full justify-start">${icon('users')} Tirar do feed</button>
       <button data-act="delete" class="btn btn-soft w-full justify-start text-red-700">${icon('trash')} Apagar este look</button>`
    : `<button data-act="block" class="btn btn-soft w-full justify-start">${icon('x')} Bloquear ${esc(who)}</button>
       <button data-act="report" class="btn btn-soft w-full justify-start">${icon('flag')} Denunciar este look</button>`;
  const root = openModal(`${modalHeader(mine ? 'Seu look' : 'Opções do look')}
    <div class="space-y-2">${actions}</div>`);
  const on = (act, fn) => { const b = $(`[data-act="${act}"]`, root); if (b) b.onclick = () => { closeModal(); fn(id); }; };
  on('block', blockFeedOwner);
  on('report', reportFeedLook);
  on('unshare', unshareOutfit);
  on('delete', deleteOwnOutfit);
}

/* --- Ações sobre os próprios looks (feed e perfil) --- */
async function unshareOutfit(id) {
  const { error } = await sb.from('outfits').update({ feed_visibility: 'off' }).eq('id', id);
  if (error) return toast(errMsg(error), 'error');
  const o = state.outfits.find((x) => x.id === id);
  if (o) o.feed_visibility = 'off';
  toast('Look tirado do feed', 'ok');
  route();
}

async function deleteOwnOutfit(id) {
  const o = state.outfits.find((x) => x.id === id);
  const t = o?.title ? `«${o.title}»` : 'este look';
  if (!(await confirmDialog(`Apagar ${t} para sempre? Ele some do feed e dos seus favoritos, e o link público deixa de funcionar. Não dá para desfazer.`, { confirmLabel: 'Apagar', danger: true, title: 'Apagar look?' }))) return;
  const { error } = await sb.from('outfits').delete().eq('id', id);
  if (error) return toast(errMsg(error), 'error');
  state.outfits = state.outfits.filter((x) => x.id !== id);
  if (state.gen.result?.saved_id === id) state.gen.result.saved_id = null;
  toast('Look apagado', 'ok');
  route();
}

function mySharedHtml() {
  const mine = state.outfits.filter((o) => o.feed_visibility && o.feed_visibility !== 'off');
  if (!mine.length) return '<p class="rounded-2xl bg-stone-50 p-3 text-xs text-stone-500">Nenhum look publicado no feed.</p>';
  return mine.map((o) => `<div class="flex items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">${esc(o.title || 'Look')}</p>
        <p class="text-xs text-stone-500">${o.feed_visibility === 'everyone' ? 'Visível para todos' : 'Só pessoas selecionadas'}</p>
      </div>
      <button data-unshare="${esc(o.id)}" class="btn btn-soft !py-1.5 text-xs">Tirar do feed</button>
      <button data-delete-look="${esc(o.id)}" aria-label="Apagar look" class="btn btn-ghost !p-2 text-red-700">${icon('trash', 'h-4 w-4')}</button>
    </div>`).join('');
}

async function toggleFeedLike(id) {
  const l = feedState.items.find((x) => x.id === id);
  if (!l) return;
  const want = !l.liked;
  l.liked = want; l.likes += want ? 1 : -1; paintFeed();
  const { data, error } = await sb.rpc('toggle_like', { p_outfit: id, p_like: want });
  if (error) {
    l.liked = !want; l.likes += want ? -1 : 1; paintFeed();
    return toast(errMsg(error), 'error');
  }
  l.likes = data.likes; l.liked = data.liked; paintFeed();
}

async function blockFeedOwner(id) {
  const l = feedState.items.find((x) => x.id === id);
  const who = l?.owner_handle ? `@${l.owner_handle}` : 'esta pessoa';
  if (!(await confirmDialog(`Você não verá mais os looks de ${who}, e ${who} não verá os seus. Você pode desbloquear em Perfil > Pessoas.`, { confirmLabel: 'Bloquear', danger: true, title: 'Bloquear pessoa?' }))) return;
  const { error } = await sb.rpc('block_feed_owner', { p_outfit: id });
  if (error) return toast(errMsg(error), 'error');
  toast('Pessoa bloqueada', 'ok');
  renderFeed();
}

async function reportFeedLook(id) {
  if (!(await confirmDialog('Este look vai sumir do seu feed. A equipe do app pode analisar a denúncia.', { confirmLabel: 'Denunciar', danger: true, title: 'Denunciar look?' }))) return;
  const { error } = await sb.from('outfit_reports').insert({ outfit_id: id, reason: 'Denúncia no feed' });
  if (error && error.code !== '23505') return toast(errMsg(error), 'error');
  feedState.items = feedState.items.filter((x) => x.id !== id);
  paintFeed();
  toast('Obrigado. Este look foi ocultado para você.', 'ok');
}

/* ============================================================
   Notificações (sino): avisa quando alguém curte um look seu.
   "Silenciar" desliga só o aviso na tela; as curtidas continuam no sino.
   ============================================================ */
const notif = { items: [], seen: null, channel: null, timer: null, openUnread: new Set() };

function timeAgoPt(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 604800) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function updateBell(show) {
  const b = $('#bell');
  if (!b) return;
  b.classList.toggle('hidden', !show);
  b.classList.toggle('flex', !!show);
  if (show && state.session) { ensureNotifications(); paintBell(); }
  else stopNotifications();
}

function paintBell() {
  const b = $('#bell');
  if (!b) return;
  const unread = notif.items.filter((n) => !n.read_at).length;
  const muted = !!state.profile?.notify_muted;
  $('#bell-icon', b).innerHTML = icon(muted ? 'bellOff' : 'bell', 'h-5 w-5');
  const badge = $('#bell-badge', b);
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
  b.setAttribute('aria-label', `Notificações${unread ? `, ${unread} não lidas` : ''}${muted ? ', alertas silenciados' : ''}`);
}

async function ensureNotifications() {
  if (notif.started || !state.session) return;
  notif.started = true;
  // Tempo real (entrega imediata). Se não estiver disponível, o intervalo abaixo ainda atualiza.
  try {
    if (typeof sb.channel === 'function') {
      notif.channel = sb.channel(`notif-${state.user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` },
          () => refreshNotifications({ alert: true }))
        .subscribe();
    }
  } catch { notif.channel = null; }
  clearInterval(notif.timer);
  notif.timer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshNotifications({ alert: true });
  }, 60000);
  await refreshNotifications({ alert: false });
}

function stopNotifications() {
  if (notif.channel) { try { sb.removeChannel(notif.channel); } catch { /* ignora */ } }
  notif.channel = null; notif.started = false;
  clearInterval(notif.timer); notif.timer = null;
  notif.items = []; notif.seen = null;
}

async function refreshNotifications({ alert = false } = {}) {
  if (!state.session) return;
  const { data, error } = await sb.rpc('my_notifications', { p_limit: 30 });
  if (error || !Array.isArray(data)) return;
  const firstLoad = notif.seen === null;
  const fresh = firstLoad ? [] : data.filter((n) => !notif.seen.has(n.id) && !n.read_at);
  notif.seen = new Set(data.map((n) => n.id));
  notif.items = data;
  paintBell();
  if (alert && fresh.length) announceLikes(fresh);
  if ($('#notif-sheet')) paintNotifSheet();
}

function announceLikes(list) {
  if (state.profile?.notify_muted) return; // silenciado: sem aviso, mas segue no sino
  const first = list[0];
  const who = first.actor_handle ? `@${first.actor_handle}` : (first.actor_name || 'Alguém');
  const msg = list.length === 1
    ? `${who} curtiu seu look${first.outfit_title ? ` «${first.outfit_title}»` : ''}`
    : `${list.length} pessoas curtiram seus looks`;
  toast(msg, 'ok');
  try { navigator.vibrate?.(80); } catch { /* ignora */ }
}

function notifSheetHtml() {
  const muted = !!state.profile?.notify_muted;
  const rows = notif.items.length ? notif.items.map((n) => {
    const who = n.actor_handle ? `@${esc(n.actor_handle)}` : esc(n.actor_name || 'Alguém');
    const av = n.actor_avatar
      ? `<img src="${esc(n.actor_avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`
      : esc((n.actor_name || n.actor_handle || '?').slice(0, 1).toUpperCase());
    const isNew = notif.openUnread.has(n.id);
    return `<button data-notif="${esc(n.outfit_id)}" class="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-stone-50 ${isNew ? 'bg-stone-100' : ''}">
      <span class="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-200 text-sm font-medium text-stone-600" style="width:40px;height:40px">${av}</span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm"><span class="font-semibold">${who}</span> curtiu seu look</span>
        <span class="block truncate text-xs text-stone-500">${esc(n.outfit_title || 'Look')} · ${esc(timeAgoPt(n.created_at))}</span>
      </span>
    </button>`;
  }).join('') : '<p class="rounded-2xl bg-stone-50 p-4 text-center text-sm text-stone-500">Nenhuma curtida ainda. Compartilhe um look no feed para receber curtidas.</p>';
  return `
    <div class="mb-4 flex items-center justify-between">
      <h3 class="font-display text-xl">Notificações</h3>
      <button data-close class="btn btn-ghost !p-2" aria-label="Fechar">${icon('x')}</button>
    </div>
    <label class="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-stone-50 p-4">
      <span class="min-w-0">
        <span class="block text-sm font-medium">Avisar quando curtirem</span>
        <span class="block text-xs text-stone-500">${muted
          ? 'Silenciado: não aparece aviso na tela, mas as curtidas continuam aqui no sino.'
          : 'Aparece um aviso na tela sempre que alguém curtir um dos seus looks.'}</span>
      </span>
      <input id="notif-alerts" type="checkbox" class="h-6 w-11 shrink-0 accent-stone-900" ${muted ? '' : 'checked'}>
    </label>
    <div class="mt-4 space-y-1">${rows}</div>`;
}

function paintNotifSheet() {
  const box = $('#notif-sheet');
  if (!box) return;
  box.innerHTML = notifSheetHtml();
  $$('[data-close]', box).forEach((b) => (b.onclick = closeModal));
  $('#notif-alerts', box).onchange = (e) => setNotifyMuted(!e.target.checked);
  $$('[data-notif]', box).forEach((b) => (b.onclick = () => { closeModal(); go(`#/outfit/${b.dataset.notif}`); }));
}

async function openNotifications() {
  if (!state.session) return;
  const unreadIds = notif.items.filter((n) => !n.read_at).map((n) => n.id);
  notif.openUnread = new Set(unreadIds); // mantém o destaque nesta abertura
  openModal(`<div id="notif-sheet"></div>`);
  paintNotifSheet();
  if (!unreadIds.length) return;
  const now = new Date().toISOString();
  const { error } = await sb.from('notifications').update({ read_at: now }).in('id', unreadIds);
  if (error) return toast(errMsg(error), 'error');
  notif.items.forEach((n) => { if (unreadIds.includes(n.id)) n.read_at = now; });
  paintBell();
}

async function setNotifyMuted(muted) {
  const { error } = await sb.from('profiles').update({ notify_muted: muted }).eq('id', state.user.id);
  if (error) {
    paintNotifSheet();
    return toast(errMsg(error), 'error');
  }
  state.profile = { ...state.profile, notify_muted: muted };
  paintBell();
  paintNotifSheet();
  toast(muted ? 'Avisos silenciados. As curtidas continuam no sino.' : 'Avisos de curtida ativados.', 'ok');
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
  g.fillStyle = '#fff'; rr(g, x, y, size, size, 22); g.fill();
  if (typeof window.qrcode !== 'function') return false;
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); const pad = 18; const cell = (size - pad * 2) / n;
  g.fillStyle = '#1c1917';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x + pad + c * cell, y + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
  return true;
}

async function renderStoryCanvas(title, occasion, items, url) {
  try {
    await Promise.all([
      document.fonts.load('600 76px Fraunces'), document.fonts.load('600 26px Inter'),
      document.fonts.load('500 32px Inter'), document.fonts.load('400 30px Inter'),
    ]);
  } catch { /* usa a fonte reserva */ }
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
  const y = 232 + (tl.length - 1) * 86 + 56;
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
    const x = M + col * (colW + gap); const w = l.span === 2 ? W - M * 2 : colW; const yy = top + row * (tileH + gap);
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
  const hasQR = drawQR(g, url, M, qy, qs);
  g.fillStyle = '#1c1917'; g.font = '600 42px Fraunces, Georgia, serif';
  g.fillText('Veja o look completo', M + qs + 40, qy + 100);
  g.fillStyle = '#78716c'; g.font = '400 30px Inter, system-ui, sans-serif';
  g.fillText(hasQR ? 'Aponte a câmera para o QR Code' : 'Abra o link compartilhado', M + qs + 40, qy + 150);
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
  } catch (e) { setBusy(false); return toast(errMsg(e), 'error'); }
  setBusy(false);

  const imgUrl = URL.createObjectURL(blob);
  const file = new File([blob], 'meu-look.png', { type: 'image/png' });
  const root = openModal(`
    ${modalHeader('Compartilhar look')}
    <img src="${imgUrl}" alt="Card 9:16 do look" class="mx-auto max-h-[48vh] rounded-2xl shadow-md">
    <p class="mt-4 break-all rounded-2xl bg-stone-100 p-3 text-xs text-stone-600">${esc(url)}</p>
    <p class="mt-2 text-xs text-stone-500">Quem tiver o link vê só as peças deste look e o seu primeiro nome.</p>
    <div class="mt-4 grid grid-cols-2 gap-2">
      <button id="sh-native" class="btn btn-primary">${icon('share')} Compartilhar</button>
      <a id="sh-dl" class="btn btn-soft" href="${imgUrl}" download="meu-look.png">${icon('download')} Baixar Story</a>
      <button id="sh-copy" class="btn btn-soft col-span-2">Copiar link</button>
      <button id="sh-private" class="btn btn-ghost col-span-2 text-sm">Desativar link público</button>
    </div>`);
  const close = () => URL.revokeObjectURL(imgUrl);
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
  $('[data-backdrop]', root).addEventListener('click', (e) => { if (e.target.hasAttribute('data-backdrop')) close(); });

  $('#sh-native', root).onclick = async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: o.title, text: `${o.title} — meu look no Smart Closet AI`, url });
      else if (navigator.share) await navigator.share({ title: o.title, text: o.title, url });
      else { await navigator.clipboard.writeText(url); toast('Link copiado!', 'ok'); }
    } catch (e) { if (e?.name !== 'AbortError') toast('Não foi possível abrir o compartilhamento.', 'error'); }
  };
  $('#sh-copy', root).onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado!', 'ok'); }
    catch { toast('Copie o link manualmente.', 'error'); }
  };
  $('#sh-private', root).onclick = async () => {
    const { error } = await sb.from('outfits').update({ is_public: false }).eq('id', outfitId);
    if (error) return toast(errMsg(error), 'error');
    o.is_public = false; close(); closeModal(); toast('O link público foi desativado.', 'ok');
    if (location.hash.startsWith('#/outfit/')) renderOutfitDetail(outfitId);
  };
}

/* ============================================================
   Look público (sem login)
   ============================================================ */
async function renderShare(id) {
  view().innerHTML = `<div class="mt-20 text-center text-sm text-stone-500">Carregando look…</div>`;
  const uuid = /^[0-9a-f-]{36}$/i.test(id || '') ? id : null;
  if (!uuid) return renderShareMissing();
  const { data, error } = await sb.rpc('get_public_outfit', { p_outfit_id: uuid });
  if (error || !data) return renderShareMissing(error);
  document.title = `${data.title} · Smart Closet AI`;
  view().innerHTML = `
    <div class="fade-up mx-auto max-w-md">
      <p class="text-center text-xs font-semibold uppercase tracking-widest text-stone-500">Smart Closet AI</p>
      <h1 class="mt-3 text-center font-display text-3xl">${esc(data.title)}</h1>
      ${data.owner_name ? `<p class="mt-1 text-center text-sm text-stone-500">por ${esc(data.owner_name)}${data.occasion ? ` · ${esc(data.occasion)}` : ''}</p>` : ''}
      <div class="mt-6">${lookCard(data.items || [])}</div>
      <p class="mt-5 text-sm text-stone-600">${esc(data.description || '')}</p>
      ${data.missing_suggestions ? `<div class="mt-3 rounded-2xl border border-dashed border-stone-300 p-3 text-sm text-stone-600"><b>Para completar:</b> ${esc(data.missing_suggestions)}</div>` : ''}
      <a href="${state.session ? '#/home' : '#/register'}" class="btn btn-primary mt-8 w-full">${state.session ? 'Ir para o meu closet' : 'Criar meu guarda-roupa digital'}</a>
    </div>`;
}
function renderShareMissing(error) {
  const schemaProblem = error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || ''));
  view().innerHTML = `
    <div class="card mx-auto mt-16 max-w-sm p-6 text-center">
      <h1 class="font-display text-2xl">Look indisponível</h1>
      <p class="mt-2 text-sm text-stone-500">${schemaProblem ? 'O servidor ainda não está configurado para links públicos.' : 'O link pode ter sido desativado por quem compartilhou.'}</p>
      <a href="#/login" class="btn btn-primary mt-5">Conhecer o app</a>
    </div>`;
}

/* ============================================================
   Perfil
   ============================================================ */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (location.hash === '#/profile') renderProfile(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('App instalado!', 'ok'); });
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

function renderProfile() {
  const p = state.profile;
  const sel = new Set(p.style_preferences || []);
  let name = p.full_name || '';
  const initials = (p.full_name || state.user.email || '?').trim().slice(0, 1).toUpperCase();
  const counts = Object.keys(CATEGORIES).map((k) => [k, state.clothes.filter((c) => c.category === k).length]).filter(([, n]) => n);
  const canInstall = !!deferredInstall && !isStandalone();
  const iosHint = isIOS() && !isStandalone();
  const theme = currentTheme();

  const paint = () => {
    view().innerHTML = `
      <div class="fade-up">
        <h1 class="font-display text-3xl">Perfil</h1>
        <div class="mt-5 flex items-center gap-4">
          <button id="avatar" class="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-stone-200 ring-2 ring-white" aria-label="Trocar foto de perfil">
            ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" class="h-full w-full object-cover">` : `<span class="flex h-full w-full items-center justify-center font-display text-3xl text-stone-500">${esc(initials)}</span>`}
          </button>
          <div class="min-w-0"><p class="truncate font-medium">${esc(p.full_name || '')}</p><p class="truncate text-sm text-stone-500">${esc(state.user.email)}</p></div>
          <input id="avatar-file" type="file" accept="image/*" class="hidden">
        </div>

        ${counts.length ? `<div class="mt-5 flex flex-wrap gap-2">${counts.map(([k, n]) => `<span class="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">${n} ${esc(CATEGORIES[k].toLowerCase())}</span>`).join('')}</div>` : ''}

        <div class="mt-6"><span class="label">Tema do app</span>
          <div class="grid grid-cols-5 gap-2">${THEMES.map((t) => `<button data-theme-pick="${t.id}" aria-pressed="${t.id === theme}" class="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2 ring-1 ${t.id === theme ? 'ring-2 ring-stone-900' : 'ring-stone-200'}"><span class="h-8 w-8 rounded-full ring-1 ring-black/10" style="background:${t.swatch}"></span><span class="text-[11px] leading-tight text-stone-600">${esc(t.name)}</span></button>`).join('')}</div>
        </div>

        <div class="mt-6"><label class="label" for="name">Nome</label><input id="name" class="input" maxlength="80" value="${esc(name)}"></div>
        <div class="mt-5"><label class="label" for="handle">@apelido (para o feed)</label>
          <input id="handle" class="input" maxlength="25" value="${esc(p.handle || '')}" placeholder="ex.: julio.look" autocapitalize="off" autocomplete="off">
          <p class="mt-1 text-xs text-stone-500">Use letras minúsculas, números, ponto ou _. Outras pessoas encontram você por ele.</p></div>
        <div class="mt-5"><span class="label">Preferências de estilo</span>
          <div class="flex flex-wrap gap-2">${PROFILE_STYLES.map((s) => `<button data-s="${esc(s)}" aria-pressed="${sel.has(s)}" class="chip ${sel.has(s) ? 'chip-on' : ''}">${esc(s)}</button>`).join('')}</div></div>
        <button id="save" class="btn btn-primary mt-6 w-full">Salvar perfil</button>

        <div class="mt-8"><span class="label">Pessoas</span>
          <p class="mb-3 text-xs text-stone-500">Controle quem pode ver os seus looks no feed.</p>
          <div id="people-box" class="space-y-3"><p class="text-sm text-stone-500">Carregando…</p></div></div>

        <div class="mt-8"><span class="label">Minhas publicações</span>
          <p class="mb-3 text-xs text-stone-500">Looks que você mostra no feed. Você pode tirá-los do feed ou apagá-los.</p>
          <div class="space-y-2">${mySharedHtml()}</div></div>
        <div class="mt-8 space-y-2">
          ${canInstall ? `<button id="install" class="btn btn-soft w-full">${icon('download')} Instalar o app</button>` : ''}
          ${iosHint ? `<p class="rounded-2xl bg-stone-100 p-3 text-xs text-stone-600">Para instalar no iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>` : ''}
          <a href="#/sobre" class="btn btn-soft w-full">Sobre o app</a>
          <a href="#/diagnostico" class="btn btn-soft w-full">Testar a IA</a>
          <button id="chpw" class="btn btn-soft w-full">Alterar senha</button>
          <button id="out" class="btn btn-ghost w-full">Sair da conta</button>
          <p class="pt-3 text-center text-xs text-stone-400">Smart Closet AI · versão ${esc(APP_VERSION)}</p>
        </div>

        <div class="mt-8 rounded-2xl border border-stone-200 p-4">
          <h2 class="text-sm font-semibold">Privacidade</h2>
          <p class="mt-1 text-xs leading-relaxed text-stone-500">Suas fotos e looks ficam no Supabase e só você os acessa (links públicos só existem para os looks que você compartilhar). Fotos e listas de peças vão ao Google Gemini apenas quando você usa os recursos de IA.</p>
          <button id="wipe" class="mt-3 text-xs font-medium text-red-700 underline-offset-2 hover:underline">Apagar todas as minhas peças e looks</button>
          <button id="delacc" class="mt-3 block text-xs font-medium text-red-700 underline-offset-2 hover:underline">Excluir minha conta</button>
          ${CONTACT_EMAIL ? `<p class="mt-3 text-xs text-stone-500">Dúvidas sobre seus dados: <a class="underline" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>` : ''}
        </div>
      </div>`;
    $$('[data-s]').forEach((b) => (b.onclick = () => { name = $('#name').value; toggle(sel, b.dataset.s); p.full_name = name; paint(); }));
    $$('[data-unshare]').forEach((b) => (b.onclick = () => unshareOutfit(b.dataset.unshare)));
    $$('[data-delete-look]').forEach((b) => (b.onclick = () => deleteOwnOutfit(b.dataset.deleteLook)));
    $$('[data-theme-pick]').forEach((b) => (b.onclick = () => { name = $('#name').value; applyTheme(b.dataset.themePick); paint(); }));
    $('#save').onclick = async () => {
      const hv = handleValue();
      if (hv === false) return toast('Use de 3 a 20 letras minúsculas, números, ponto ou _.', 'error');
      setBusy(true, 'Salvando…');
      const { data, error } = await sb.from('profiles').update({ full_name: $('#name').value.trim(), style_preferences: [...sel], handle: hv }).eq('id', state.user.id).select().single();
      setBusy(false);
      if (error?.code === '23505') return toast('Esse @apelido já está em uso. Escolha outro.', 'error');
      if (error) return toast(errMsg(error), 'error');
      state.profile = data; Object.assign(p, data); toast('Perfil salvo', 'ok');
    };
    $('#out').onclick = async () => { await sb.auth.signOut(); };
    renderPeopleBox();
    const inst = $('#install');
    if (inst) inst.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; renderProfile(); };
    $('#chpw').onclick = openChangePassword;
    $('#wipe').onclick = wipeData;
    $('#delacc').onclick = deleteAccount;
    $('#avatar').onclick = () => $('#avatar-file').click();
    $('#avatar-file').onchange = async (e) => {
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
      } catch (err) { toast(errMsg(err), 'error'); }
      setBusy(false); paint();
    };
  };
  paint();
}

function openChangePassword() {
  const root = openModal(`
    ${modalHeader('Alterar senha')}
    <form id="cp" class="space-y-3">
      <div><label class="label" for="cp-pw">Nova senha</label>${pwInput('cp-pw', 'new-password', 8)}</div>
      <button class="btn btn-primary w-full" type="submit">Salvar senha</button>
    </form>`);
  bindPwToggles(root);
  $('#cp', root).onsubmit = async (e) => {
    e.preventDefault();
    setBusy(true, 'Salvando…');
    const { error } = await sb.auth.updateUser({ password: $('#cp-pw', root).value });
    setBusy(false);
    if (error) return toast(errMsg(error), 'error');
    closeModal(); toast('Senha atualizada!', 'ok');
  };
}


async function deleteAccount() {
  const root = openModal(`
    ${modalHeader('Excluir sua conta?')}
    <p class="text-sm text-stone-600">Isso apaga <b>sua conta, peças, looks, fotos e imagens geradas</b>. Não dá para desfazer.</p>
    <label class="label mt-4" for="del-in">Digite EXCLUIR para confirmar</label>
    <input id="del-in" class="input" autocomplete="off" autocapitalize="characters">
    <button id="del-go" class="btn btn-danger mt-4 w-full" disabled>Excluir minha conta</button>`);
  const input = $('#del-in', root), go_ = $('#del-go', root);
  input.oninput = () => { go_.disabled = input.value.trim().toUpperCase() !== 'EXCLUIR'; };
  go_.onclick = async () => {
    closeModal();
    setBusy(true, 'Excluindo sua conta…');
    try {
      const { data, error } = await sb.functions.invoke('delete-account', { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await sb.auth.signOut();
      setBusy(false);
      toast('Conta excluída. Até logo.', 'ok');
    } catch (e) { setBusy(false); toast(await fnError(e), 'error'); }
  };
}

async function wipeData() {
  const root = openModal(`
    ${modalHeader('Apagar tudo?')}
    <p class="text-sm text-stone-600">Isso apaga <b>todas as suas peças, fotos e looks</b>. Sua conta continua existindo. Não dá para desfazer.</p>
    <label class="label mt-4" for="wipe-in">Digite APAGAR para confirmar</label>
    <input id="wipe-in" class="input" autocomplete="off" autocapitalize="characters">
    <button id="wipe-go" class="btn btn-danger mt-4 w-full" disabled>Apagar definitivamente</button>`);
  const input = $('#wipe-in', root), go_ = $('#wipe-go', root);
  input.oninput = () => { go_.disabled = input.value.trim().toUpperCase() !== 'APAGAR'; };
  go_.onclick = async () => {
    closeModal();
    setBusy(true, 'Apagando…');
    try {
      const uid = state.user.id;
      for (const bucket of ['clothes', 'avatars', 'body-photos', 'tryon']) {
        const { data: files } = await sb.storage.from(bucket).list(uid, { limit: 1000 });
        if (files?.length) await sb.storage.from(bucket).remove(files.map((f) => `${uid}/${f.name}`));
      }
      const o = await sb.from('outfits').delete().eq('user_id', uid);
      if (o.error) throw o.error;
      const c = await sb.from('clothes').delete().eq('user_id', uid);
      if (c.error) throw c.error;
      await sb.from('profiles').update({ avatar_url: null, body_photo_path: null, lgpd_consent_at: null, lgpd_consent_version: null }).eq('id', uid);
      if (state.profile) Object.assign(state.profile, { body_photo_path: null, lgpd_consent_at: null, lgpd_consent_version: null });
      state.clothes = []; state.outfits = []; state.gen = newGen();
      if (state.profile) state.profile.avatar_url = null;
      toast('Tudo apagado.', 'ok');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false); renderProfile();
  };
}

/* ============================================================
   Limpeza de dados antigos (foto de modelo, legado)
   ============================================================ */
/* ============================================================
   Sobre o app (pública, com ou sem login)
   ============================================================ */
function renderAbout() {
  const back = state.session ? '#/profile' : '#/login';
  const card = 'rounded-3xl bg-white p-5 ring-1 ring-stone-200';
  const features = [
    'Guarda-roupa com recorte automático das peças',
    'Looks montados pela IA para cada ocasião e clima',
    'Prévia do look, feita no seu aparelho',
    'Avaliação dos looks, que ajuda a IA a entender o seu gosto',
    'Feed para compartilhar looks com quem você escolher',
    'Compartilhamento por cartão ou por link',
  ];
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="${back}" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="font-display text-3xl">Sobre</h1>
      </div>

      <div class="mt-8 flex flex-col items-center text-center">
        <div class="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-stone-900 text-white shadow-sm">${icon('closet', 'h-10 w-10')}</div>
        <p class="mt-4 font-display text-2xl">Smart Closet AI</p>
        <p class="mt-1 text-sm text-stone-500">Seu guarda-roupa digital com estilista de IA</p>
        <p class="mt-2 text-xs text-stone-400">Versão ${esc(APP_VERSION)}</p>
      </div>

      <div class="mt-8 space-y-4">
        <section class="${card}">
          <h2 class="text-sm font-semibold">O que é</h2>
          <p class="mt-2 text-sm leading-relaxed text-stone-600">Cadastre as peças do seu guarda-roupa, monte looks para cada ocasião e clima e receba sugestões feitas com as suas próprias roupas.</p>
        </section>

        <section class="${card}">
          <h2 class="text-sm font-semibold">Recursos</h2>
          <ul class="mt-3 space-y-3 text-sm text-stone-600">
            ${features.map((f) => `<li class="flex items-start gap-3"><span class="mt-0.5 shrink-0 text-stone-900">${icon('check', 'h-4 w-4')}</span><span>${esc(f)}</span></li>`).join('')}
          </ul>
        </section>

        <section class="${card}">
          <h2 class="text-sm font-semibold">Privacidade</h2>
          <p class="mt-2 text-sm leading-relaxed text-stone-600">Seus dados são seus. Você pode apagar peças, looks e a conta a qualquer momento.</p>
          <button id="about-terms" class="btn btn-soft mt-4 w-full">Termos e Política de Privacidade</button>
        </section>

        <section class="${card}">
          <h2 class="text-sm font-semibold">Contato e suporte</h2>
          <p class="mt-2 text-sm text-stone-600">Dúvidas, sugestões ou problemas? Fale com a gente.</p>
          <p class="mt-2 break-all text-sm font-medium text-stone-900">${esc(CONTACT_EMAIL)}</p>
          <a href="mailto:${esc(CONTACT_EMAIL)}?subject=Smart%20Closet%20AI" class="btn btn-primary mt-4 w-full">Enviar e-mail</a>
        </section>
      </div>

      <p class="mt-10 text-center text-xs leading-relaxed text-stone-400">
        Desenvolvido por <span class="font-medium text-stone-600">Julio Gonzales</span><br>
        © ${new Date().getFullYear()} · Todos os direitos reservados
      </p>
    </div>`;
  $('#about-terms').onclick = () => openTerms();
}

function openTerms() {
  const root = openModal(`
    ${modalHeader('Termos e privacidade')}
    <div class="space-y-3 text-sm leading-relaxed text-stone-600">${TERMS_HTML}</div>
    <button id="terms-ok" class="btn btn-primary mt-5 w-full">Entendi</button>`);
  $('#terms-ok', root).onclick = () => closeModal();
}

/* ============================================================
   Prévia do look: monta as peças umas sobre as outras, centralizadas.
   Usa só os recortes do guarda-roupa (fundo removido). Não usa foto de pessoa e não chama IA.
   ============================================================ */
const LOOK_WIDTH = { outerwear: 0.76, top: 0.62, fullbody: 0.72, bottom: 0.58, shoes: 0.46 };
const LOOK_STACK = ['outerwear', 'top', 'fullbody', 'bottom', 'shoes'];

// Tenta carregar com CORS (permite salvar a imagem); se o servidor não enviar o cabeçalho, carrega sem ele.
const loadAny = (url) => loadImg(url, true).catch(() => loadImg(url, false));

async function composeOutfit(items) {
  const loaded = await Promise.all(items.map(async (it) => {
    try { return { it, img: await loadAny(it.image_url) }; } catch { return null; }
  }));
  const pieces = loaded.filter(Boolean);
  if (!pieces.length) throw new Error('Não consegui carregar as fotos das peças. Verifique a internet e tente de novo.');

  const W = 1080, H = 1350;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fbfaf8'); bg.addColorStop(1, '#ebe8e3');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const main = pieces
    .filter((p) => LOOK_WIDTH[p.it.category])
    .sort((a, b) => LOOK_STACK.indexOf(a.it.category) - LOOK_STACK.indexOf(b.it.category))
    .map((p) => {
      const w = W * LOOK_WIDTH[p.it.category];
      return { ...p, w, h: w * p.img.naturalHeight / p.img.naturalWidth };
    });
  const acc = pieces.filter((p) => !LOOK_WIDTH[p.it.category]);

  const shadow = (on, blur = 36, dy = 14) => {
    g.shadowColor = on ? 'rgba(28,25,23,0.22)' : 'transparent';
    g.shadowBlur = on ? blur : 0; g.shadowOffsetY = on ? dy : 0;
  };

  if (main.length) {
    const GAP = H * 0.015;
    const total = main.reduce((s, p) => s + p.h, 0) + GAP * (main.length - 1);
    const k = Math.min(1, (H * 0.84) / total);
    let y = (H - total * k) / 2;
    g.save();
    for (const p of main) {
      const w = p.w * k, h = p.h * k;
      shadow(true);
      g.drawImage(p.img, (W - w) / 2, y, w, h);
      y += h + GAP * k;
    }
    g.restore();
  }

  // Acessórios: pequena coluna no canto direito, de baixo para cima.
  // Se só houver acessórios, eles ficam lado a lado no centro.
  if (acc.length) {
    g.save();
    if (main.length) {
      let y = H * 0.9;
      for (const p of acc) {
        const w = W * 0.2, h = w * p.img.naturalHeight / p.img.naturalWidth;
        y -= h;
        shadow(true, 22, 8);
        g.drawImage(p.img, W * 0.84 - w / 2, y, w, h);
        y -= H * 0.02;
      }
    } else {
      const w = W * 0.3, gap = W * 0.04;
      const total = acc.length * w + (acc.length - 1) * gap;
      acc.forEach((p, i) => {
        const h = w * p.img.naturalHeight / p.img.naturalWidth;
        shadow(true, 22, 8);
        g.drawImage(p.img, (W - total) / 2 + i * (w + gap), (H - h) / 2, w, h);
      });
    }
    g.restore();
  }
  return cv;
}

async function openLookPreview(items) {
  if (!items?.length) return toast('Escolha pelo menos uma peça.', 'error');
  const root = openModal(`
    ${modalHeader('Prévia do look')}
    <p class="text-sm text-stone-600">As peças do look montadas uma sobre a outra, em fundo claro, com os recortes do seu guarda-roupa.</p>
    <div id="look-box" class="mt-4 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-3xl bg-stone-100"><div class="skeleton h-full w-full"></div></div>
    <div class="mt-4 grid grid-cols-2 gap-2">
      <button id="look-again" class="btn btn-ghost">Montar de novo</button>
      <a id="look-save" class="btn btn-primary hidden">Salvar imagem</a>
    </div>`);
  const draw = async () => {
    const box = $('#look-box', root), save = $('#look-save', root);
    box.innerHTML = '<div class="skeleton h-full w-full"></div>';
    save.classList.add('hidden');
    try {
      const cv = await composeOutfit(items);
      cv.className = 'h-full w-full object-contain';
      box.innerHTML = ''; box.appendChild(cv);
      canvasToBlob(cv, 'image/jpeg', 0.92).then((blob) => {
        if (!blob || !save.isConnected) return;
        save.href = URL.createObjectURL(blob);
        save.download = 'look-smart-closet.jpg';
        save.classList.remove('hidden');
      }).catch(() => {});
    } catch (e) {
      box.innerHTML = `<p class="p-6 text-center text-sm text-stone-600">${esc(errMsg(e))}</p>`;
    }
  };
  $('#look-again', root).onclick = draw;
  draw();
}

/* ============================================================
   Testar a IA (única verificação na tela de diagnóstico)
   ============================================================ */
async function testAI() {
  if (!state.session) return toast('Entre na conta para testar a IA.', 'error');
  setBusy(true, 'Testando a IA…');
  try {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1e3a8a'; g.fillRect(34, 24, 60, 80);
    const b64 = cv.toDataURL('image/jpeg', 0.8).split(',')[1];
    const { data, error } = await withTimeout(
      sb.functions.invoke('analyze-clothing', { body: { image_base64: b64, mime_type: 'image/jpeg' } }), 45000, 'A IA demorou demais.');
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast('A IA respondeu corretamente!', 'ok');
  } catch (e) {
    const m = await fnError(e);
    // "não consegui identificar" significa que a IA respondeu: a cadeia toda funciona
    if (/identificar uma peça/i.test(m)) toast('A IA está funcionando (respondeu à foto de teste).', 'ok');
    else toast(m, 'error');
  }
  setBusy(false);
}

async function renderDiagnostics() {
  view().innerHTML = `
    <div class="fade-up">
      <div class="flex items-center gap-2">
        <a href="${state.session ? '#/profile' : '#/login'}" class="btn btn-ghost !p-2" aria-label="Voltar">${icon('x')}</a>
        <h1 class="font-display text-3xl">Testar a IA</h1>
      </div>
      <p class="mt-2 text-sm text-stone-500">Envia uma foto de teste para a IA e confere se ela responde. Cada teste usa 1 análise do seu limite diário.</p>
      <div class="card mt-6 p-5">
        ${state.session
          ? `<p class="text-sm text-stone-600">Quando quiser, toque no botão abaixo.</p>
             <button id="d-ai" class="btn btn-primary mt-4 w-full">${icon('sparkles')} Testar a IA agora</button>`
          : `<p class="text-sm text-stone-600">Entre na sua conta para testar a IA.</p>
             <a href="#/login" class="btn btn-primary mt-4 w-full">Entrar</a>`}
      </div>
    </div>`;
  const ai = $('#d-ai');
  if (ai) ai.onclick = testAI;
}

/* ============================================================
   Inicialização
   ============================================================ */
async function init() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('hashchange', route);
  $('#bell')?.addEventListener('click', openNotifications);
  if (!sb) return route();

  // O listener precisa existir ANTES de getSession(): é ele que recebe o
  // evento PASSWORD_RECOVERY gerado ao abrir o link do e-mail.
  sb.auth.onAuthStateChange((event, session) => {
    state.session = session; state.user = session?.user ?? null;
    // não chamar o Supabase dentro do callback (pode travar): adia o trabalho
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { go('#/update-password'); }
      else if (event === 'SIGNED_OUT') { resetState(); go('#/login'); }
      else if (event === 'SIGNED_IN' && !state.loaded && !loadPromise && location.hash !== '#/update-password') route();
    }, 0);
  });

  const { data } = await sb.auth.getSession();
  state.session = data.session; state.user = data.session?.user ?? null;

  if (IS_RECOVERY_LINK && state.session) { history.replaceState(null, '', '#/update-password'); }
  if (AUTH_LINK_ERROR) {
    history.replaceState(null, '', '#/login');
    await route();
    toast(AUTH_LINK_ERROR, 'error');
    return;
  }
  if (!state.session && /access_token=/.test(INITIAL_HASH)) history.replaceState(null, '', '#/login');
  else if (/^#(access_token|type)=/.test(INITIAL_HASH) && state.session) history.replaceState(null, '', '#/home');

  route();

  // Atualiza os dados ao voltar para o app depois de um tempo (outro aparelho pode ter mudado algo)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.session) refreshNotifications({ alert: true });
    if (document.visibilityState !== 'visible' || !state.session || !state.loaded) return;
    if (Date.now() - state.loadedAt < 120000) return;
    try {
      await loadAll();
      if ($('#modal-root').innerHTML) return;
      if (location.hash === '#/home' || location.hash === '#/closet') route();
    } catch { /* silencioso */ }
  });
}
init();
