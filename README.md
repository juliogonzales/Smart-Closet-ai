# Smart Closet AI

Guarda-roupa digital com estilista de IA. PWA estático (HTML + JS + Tailwind via CDN) hospedado no GitHub Pages, com Supabase (Auth, Postgres + RLS, Storage, Edge Functions) e Gemini/OpenAI.

**Site:** https://juliogonzales.github.io/Smart-Closet-ai/

## Recursos
- Cadastro/login, recuperação de senha e onboarding de estilo
- Upload de peças (câmera/galeria), remoção de fundo, preenchimento automático por IA
- Guarda-roupa com busca e filtros; edição e exclusão
- Looks por ocasião e clima (inclusive pela sua localização), com sugestão textual do que falta
- Trocar peças do look, fixar uma peça, favoritos
- Cartão 9:16 para Stories, link público e QR Code
- Perfil, troca de senha, apagar dados, limite diário de IA por usuário
- "Vestir na pessoa": gera uma imagem sua vestindo o look (foto de modelo + consentimento LGPD)
- Tela de diagnóstico em `#/diagnostico`

## Estrutura
- `index.html`, `js/app.js`, `js/config.js`, `sw.js`, `manifest.webmanifest`, `icons/`
- `supabase/schema.sql` — tabelas, RLS, buckets, RPC (rode no SQL Editor)
- `supabase/migrations/002_tryon.sql` — foto de modelo, consentimento LGPD e buckets privados
- `supabase/functions/tryon` — geração da imagem "vestir na pessoa"
- `docs/TERMOS_LGPD.md` — texto do termo de consentimento (revisar com advogado)
- `supabase/functions/stylist` e `analyze-clothing` — Edge Functions de IA

## Configuração
Veja `DEPLOY_GITHUB_PAGES.md` (publicação) e `SUPABASE_SETUP.md` (banco e chaves). A chave em `js/config.js` é pública (publishable/anon); chaves de IA ficam só nos Secrets das Edge Functions.
