import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente com a chave pública (anon). O RLS do banco limita o que ela pode fazer:
// leitura de produtos e inserção de contatos. A chave service_role nunca entra aqui.
export function criarClienteSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chaveAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !chaveAnon) {
    throw new Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja .env.example).",
    );
  }

  return createClient(url, chaveAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
