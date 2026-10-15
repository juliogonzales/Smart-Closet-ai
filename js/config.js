// Configuração pública do frontend.
// A chave "anon"/"publishable" do Supabase é PÚBLICA por design (a segurança vem do RLS).
// NUNCA coloque aqui a service_role key nem chaves de IA — essas ficam nos Secrets das Edge Functions.
//
// Opção A: edite os dois valores abaixo e faça commit.
// Opção B: deixe como está e defina as Variables SUPABASE_URL e SUPABASE_ANON_KEY no GitHub
//          (o workflow de deploy gera este arquivo automaticamente).

export const CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'SUA_CHAVE_ANON_OU_PUBLISHABLE',
};
