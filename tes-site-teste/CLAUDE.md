# Protótipo de teste do site da TES Tecnologia

Versão de teste do site https://tes.com.br/ fora do WordPress, para mostrar ao time
como ficaria com os erros corrigidos. **Não substitui o site oficial e não pode ser indexada.**

Stack: Next.js (App Router) + TypeScript estrito + Tailwind, Supabase (Postgres), Vercel (só preview).
Antes de escrever código Next.js, leia o guia correspondente em `node_modules/next/dist/docs/` (ver @AGENTS.md).

## Regras de escopo (obrigatórias)

1. **Não alterar nenhuma especificação de produto.** Ficha técnica, modelo, número, garantia e
   datasheet são copiados **literalmente** do site atual, inclusive erros e divergências.
   Algo estranho numa ficha → não corrigir, registrar em `AVISOS-PARA-O-TIME.md`.
2. **Não criar páginas, seções ou conteúdo novos.** Só as páginas que já existem hoje
   (nada de casos de sucesso, órgãos públicos, WhatsApp, blog novo, página de locação).
3. **PDFs de especificação são os originais**: link direto para `https://tes.com.br/wp-content/uploads/...`.
   Não baixar, editar nem recriar PDFs.
4. **Imagens**: URLs originais de `tes.com.br/wp-content/uploads/...` via `next/image`. Não editar imagens.
5. Pode mudar: links quebrados/trocados, nomes duplicados de página, organização do menu, rodapé,
   erros de digitação em textos de interface **fora das fichas**, SEO técnico (alt, title,
   meta description, sitemap, dados estruturados).
6. **Na dúvida se algo é "especificação" ou "estrutura", trate como especificação e pergunte.**
7. Sem conteúdo inventado: se uma página não puder ser lida, pedir o conteúdo ao responsável.

## Decisões já tomadas

- "Saber mais" da TES MIT Série R2 continua enviando `produto=TES MIT SERIE R`.
- "As Tela Interativa ViewSonic®" fica como está (não mexer por enquanto).
- Galeria "Interatividade para todos os ambientes": imagens sem link; "VER OS PRODUTOS" rola até a grade.
- Teste do formulário roda contra o Supabase **local** (`npm run db:start`).

## Segurança

- Só a chave `anon` vai para o cliente e para a Vercel. A `service_role` nunca vai para o front nem para o Git.
- RLS ligado em todas as tabelas: `linhas_produto`/`produtos` só leitura para `anon`; `contatos` só `insert`.
- `.env*` fica fora do Git (exceto `.env.example`, sem valores).

## Comandos

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck`
- `npm run test` (Vitest) · `npm run test:e2e` (Playwright, sobe o build de produção)
- `npm run db:start` (Supabase local, precisa de Docker) · `npm run db:reset` (aplica migrations + seed)

Rodar `npm run test` e `npm run test:e2e` antes de cada deploy.

## Estilo

Visual próximo ao atual (mesmas cores e logo), só mais limpo; não é redesign. Responsivo.
Componentes pequenos, sem bibliotecas desnecessárias. Comentários e textos de interface em pt-BR.
