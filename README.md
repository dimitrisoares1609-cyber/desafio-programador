# Transcrição de holerites e cartões de ponto

Aplicação web que recebe um PDF, transcreve o conteúdo, permite revisar numa
tabela ao lado do documento original e baixar a planilha.

Desafio técnico Quick Filler.

## Rodar

```bash
docker compose up --build
```

Aplicação em `http://localhost:3000`.

Sem Docker (precisa de `poppler-utils` e `tesseract-ocr` + `tesseract-ocr-por`
instalados):

```bash
npm install
npm run build
npm start
```

## Testes

```bash
npm test
```

## API

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/transcricoes` | Recebe o PDF e o tipo. Responde `202` com o id |
| `GET` | `/api/transcricoes/:id` | Status e resultado |
| `PUT` | `/api/transcricoes/:id` | Grava as correções da revisão |
| `GET` | `/api/transcricoes/:id/planilha?formato=xlsx\|csv\|json` | Baixa a planilha |
| `GET` | `/healthz` | Saúde da aplicação |

Dois endpoints extras servem a interface e não fazem parte do contrato:
`GET /api/transcricoes/:id/tabela` e `GET /api/transcricoes/:id/pdf`.

## Estrutura

```
src/
  api/           rotas e validação de upload
  fila/          fila em memória
  pipeline/      leitura das páginas (texto ou OCR) e orquestração
  extratores/    leitura por tipo de documento
    perfis/      um arquivo por layout
  avisos/        avisos derivados (funcão pura sobre o resultado)
  planilha/      montagem da tabela e exportação
public/          interface de revisão
saidas/          planilhas geradas dos exemplos
```

Para suportar um layout novo, basta criar um arquivo em `src/extratores/perfis/`
e adicioná-lo à lista do extrator correspondente. Nada mais muda.

## Documentação

- [`SOLUCAO.md`](SOLUCAO.md) — arquitetura, decisões, segurança e limitações
- [`PROCESSO.md`](PROCESSO.md) — uso de IA no desenvolvimento
