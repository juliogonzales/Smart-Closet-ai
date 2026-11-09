# Configurar o Supabase (passo a passo, pelo celular)

Este guia assume um projeto novo. Se o seu projeto já existe, veja a seção "Atualização" no fim.

## 1. Banco de dados
1. Supabase > **SQL Editor > New query**.
2. Abra o `supabase/schema.sql` do zip, copie tudo e toque em **Run**.
3. Rode também `supabase/migrations/002_tryon.sql` (foto de modelo, consentimento LGPD e buckets privados), no mesmo jeito.
4. Na última consulta de cada arquivo, as linhas de verificação devem aparecer como `true`.

## 2. Chaves e endereço
1. **Project Settings > API Keys**: copie a *Project URL* e a *Publishable key* (`sb_publishable_...`).
2. Cole essas duas no `js/config.js` do repositório. Nunca use a chave `service_role` ou `sb_secret_` no app.
3. **Authentication > URL Configuration**: *Site URL* e *Redirect URLs* = `https://juliogonzales.github.io/Smart-Closet-ai/`.

## 3. Chaves de IA (Secrets)
Em **Edge Functions > Secrets**, crie:

| Nome | Valor | Obrigatório |
|---|---|---|
| `GEMINI_API_KEY` | sua chave do Google AI Studio | sim |
| `GEMINI_MODEL` | `gemini-3.8-flash` (ou o modelo de texto que funciona na sua conta) | não, mas recomendado |
| `TRYON_MODEL` | modelo de geração de imagem disponível na sua conta (ex.: `gemini-2.5-flash-image`) | só para "vestir na pessoa" |
| `AI_PROVIDER` | `gemini` (ou `openai`) | não |
| `STYLIST_DAILY_LIMIT` | `40` | não |
| `ANALYZE_DAILY_LIMIT` | `60` | não |
| `TRYON_DAILY_LIMIT` | `10` | não |

Se usar OpenAI: `AI_PROVIDER=openai` e `OPENAI_API_KEY`.

## 4. Funções
Em **Edge Functions**, crie três funções, cada uma colando o código do zip:

| Nome da função | Arquivo do zip |
|---|---|
| `stylist` | `supabase/functions/stylist/index.ts` |
| `analyze-clothing` | `supabase/functions/analyze-clothing/index.ts` |
| `tryon` | `supabase/functions/tryon/index.ts` |
| `delete-account` | `supabase/functions/delete-account/index.ts` |

Em cada uma, **desligue o "Verify JWT"**. Não é preciso criar nenhum Secret para a `delete-account`: a chave de serviço já vem do próprio Supabase. A verificação do usuário já é feita dentro do código.

Atenção: o nome precisa ser exatamente esse. Se existir uma função com outro nome que aponte para o mesmo código, apague-a.

## 5. Teste
1. Abra o site, entre e vá em Perfil > **Verificar conexão e configuração**.
2. Todos os itens devem estar OK. A geração de imagem só fica OK depois que o `TRYON_MODEL` estiver configurado e a conta do Google tiver cota.

## Atualização (projeto que já existe)
- Rode de novo `supabase/schema.sql` inteiro. É seguro repetir.
- Rode `supabase/migrations/002_tryon.sql`, se ainda não rodou.
- Republique `stylist`, `analyze-clothing` e `tryon` com o código do zip, e crie a `delete-account` (Verify JWT desligado).
