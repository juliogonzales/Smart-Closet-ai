# Configurar o Supabase (passo a passo, pelo celular)

1. **Banco:** Supabase > SQL Editor > New query. Cole todo o conteúdo de `supabase/schema.sql` e toque em Run. A última consulta mostra uma tabela de verificação: tudo deve vir `true`. Pode rodar de novo sem problema.
2. **Chaves:** Project Settings > **API Keys**. Copie a *Publishable key* (`sb_publishable_...`) e a URL do projeto para `js/config.js`.
3. **Autenticação:** Authentication > URL Configuration. Em *Site URL* coloque `https://juliogonzales.github.io/Smart-Closet-ai/` e adicione a mesma URL em *Redirect URLs*.
4. **Secrets:** Edge Functions > Secrets. Crie `GEMINI_API_KEY` (e opcionalmente `AI_PROVIDER`, `GEMINI_MODEL`, `STYLIST_DAILY_LIMIT`, `ANALYZE_DAILY_LIMIT`).
5. **Funções:** Edge Functions > Deploy a new function > Via Editor. Crie `stylist` colando `supabase/functions/stylist/index.ts` e `analyze-clothing` colando `supabase/functions/analyze-clothing/index.ts`. Desligue *Verify JWT* em ambas (a verificação é feita dentro do código).
6. **Teste:** abra o app, entre e vá em Perfil > *Verificar conexão e configuração* (`#/diagnostico`). Cada item mostra OK ou o que corrigir.
