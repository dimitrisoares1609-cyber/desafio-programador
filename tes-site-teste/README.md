# TES Tecnologia — protótipo de teste do site

Versão de teste do site https://tes.com.br/ com os erros corrigidos e a estrutura organizada.
**Não é o site oficial** e não deve ser indexada (robots bloqueado e `X-Robots-Tag: noindex` em todas as rotas).

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencha a URL e a chave anon do Supabase
npm run dev                  # http://localhost:3000
```

## Variáveis de ambiente

| Variável | Onde | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` e Vercel | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` e Vercel | Chave pública (anon) |
| `SUPABASE_TEST_SERVICE_ROLE_KEY` | só `.env.test.local` | Teste do formulário contra o Supabase **local** |

A chave `service_role` do projeto na nuvem nunca vai para o front, para a Vercel nem para o Git.

## Banco (migrations e seed)

- Migrations em `supabase/migrations/`, seed em `supabase/seed.sql`.
- **Local** (precisa de Docker): `npm run db:start` e depois `npm run db:reset` (aplica migrations + seed).
- **Nuvem**: `npx supabase link --project-ref <ref>` e `npx supabase db push`; para o seed, rode
  `supabase/seed.sql` no SQL Editor do painel.

## Testes

```bash
npm run test      # Vitest
npm run test:e2e  # Playwright (faz build de produção e sobe o servidor)
```

Rode os dois antes de cada deploy. Se o Chromium já estiver instalado na máquina, aponte
`PLAYWRIGHT_CHROMIUM_PATH` para ele em vez de rodar `playwright install`.

## Documentos

- `CLAUDE.md` — regras de escopo do protótipo.
- `AVISOS-PARA-O-TIME.md` — o que foi encontrado no site atual e **não** foi alterado.
- `CORRECOES.md` — cada correção, o que foi feito e qual teste prova.
