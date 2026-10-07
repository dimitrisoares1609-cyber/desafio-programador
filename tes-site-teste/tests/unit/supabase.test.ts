import { afterEach, describe, expect, it, vi } from "vitest";
import { criarClienteSupabase } from "@/lib/supabase";

describe("criarClienteSupabase", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("falha com mensagem clara quando faltam as variáveis", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => criarClienteSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("cria o cliente quando as variáveis existem", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-de-teste");
    expect(criarClienteSupabase()).toBeDefined();
  });
});
