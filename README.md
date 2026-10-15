# Smart Closet AI

Guarda-roupa digital com estilista de IA. PWA mobile-first, 100% estático no **GitHub Pages**, com backend no **Supabase** (Auth, Postgres, Storage, Edge Functions) e IA via **Gemini** ou **OpenAI**.

## Recursos

- Login, cadastro e redefinição de senha (Supabase Auth) + onboarding de estilo
- Upload por câmera ou galeria, remoção de fundo (IA no navegador, com plano B em Canvas)
- Cadastro por categoria, cores, estação e estilo — com "Preencher com IA" (visão)
- Gerador de looks por ocasião + clima (manual ou geolocalização via Open-Meteo)
- Sugestão textual quando faltam peças no acervo
- Look Card, favoritos, card 9:16 para Story e link público com QR Code
- Bottom navigation (Início, Guarda-roupa, Criar Look, Perfil), instalável como app

## Estrutura

```
index.html                 casca da SPA (Tailwind CDN)
js/app.js                  toda a lógica (rotas por hash)
js/config.js               URL e chave pública do Supabase
sw.js / manifest.webmanifest / icons/   PWA
supabase/schema.sql        tabelas, RLS, buckets, função de look público
supabase/functions/stylist/          Edge Function: monta o look
supabase/functions/analyze-clothing/ Edge Function: lê a foto da peça
.github/workflows/deploy.yml         deploy no GitHub Pages
.env.example               variáveis (frontend x Edge Functions)
SUPABASE_SETUP.md          passo a passo do Supabase  <-- comece por aqui
```

## Rodar localmente

```bash
# 1) preencha js/config.js
# 2) sirva a pasta (módulos ES exigem http, não file://)
python3 -m http.server 8000
# abra http://localhost:8000
```

## Deploy no GitHub Pages

1. Suba o código para um repositório (branch `main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. Configure o Supabase (veja `SUPABASE_SETUP.md`) e preencha `js/config.js` **ou** crie as *Variables* `SUPABASE_URL` e `SUPABASE_ANON_KEY` em **Settings → Secrets and variables → Actions**.
4. Push na `main` → o workflow publica em `https://USUARIO.github.io/REPO/`.
5. Adicione essa URL em **Authentication → URL Configuration** no Supabase.

## Observações

- Roteamento por hash (`#/home`) para funcionar no GitHub Pages sem configuração extra.
- Offline: o shell do app é cacheado, mas Tailwind/fontes vêm de CDN; sem internet a aparência pode degradar. Para uso offline completo, compile o Tailwind e hospede as fontes localmente.
- Troque o modelo de IA pelas variáveis `GEMINI_MODEL` / `OPENAI_MODEL` nos Secrets das funções, sem mexer no código.
