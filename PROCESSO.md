# PROCESSO.md

> Registrado no momento em que acontece, não reconstruído no fim.
>
> **Este arquivo tem lacunas marcadas com `>>>`. Elas são minhas para preencher
> — ninguém pode responder por mim onde eu não confio no que entreguei.**

## Ferramentas usadas

| Ferramenta | Para quê |
|---|---|
| Claude (chat) | Arquitetura, esqueleto do pipeline, exportadores, testes |
| _(completar)_ | |

## Diário

### Dia 1 — esqueleto, contrato de API, exportadores

Ordem deliberada: contrato de API e Docker **antes** dos extratores. Com um
extrator devolvendo vazio, o ciclo inteiro (`POST` → `202` → polling → `PUT` →
download nos três formatos) já roda de ponta a ponta. Deixar o `docker compose`
para o fim é como o `tesseract` acaba faltando na imagem justo no dia da
entrega.

**Onde o agente errou:**

1. **Vazamento de caminho interno na mensagem de erro.** O `catch` do pipeline
   repassava `e.message` direto para o campo `erro` da API. Num PDF corrompido
   isso devolvia ao cliente a saída crua do poppler, com o caminho absoluto do
   arquivo no servidor. Peguei rodando o smoke test com um PDF quebrado de
   propósito e lendo a resposta — não apareceu em nenhum teste unitário, porque
   nenhum teste unitário olha para o texto de uma mensagem de erro. Virou a
   função `mensagemLegivel()`: detalhe técnico no log, versão legível para o
   cliente.

### Dia 2 — interface de revisão

Feita antes dos extratores porque só depende do contrato de API, que já estava
pronto, e porque os PDFs de exemplo ainda não estavam em mãos.

**Onde o agente errou (continuação):**

2. **Caminho estático errado, UI em 404.** O `express.static` apontava para
   `../public` a partir de `__dirname`. Depois do build `__dirname` é
   `dist/src`, então o caminho resolvia para `dist/public`, que não existe. A
   API inteira respondia 200 e só a página inicial dava 404 — nenhum teste
   pegaria, porque nenhum teste pede a raiz. Achei rodando `curl localhost:3000/`
   no smoke test.

3. **Motivo do aviso perdido quando o vermelho ganhava.** A consolidação
   trocava o aviso inteiro pelo mais grave, então uma linha com data impossível
   E batidas ímpares mostrava só a data. O revisor corrigiria a data, veria a
   linha virar amarela e não saberia o que ainda estava errado. Reescrevi para
   a cor mais grave ganhar e os motivos se acumularem, e adicionei o teste que
   faltava.

### Dia 3 — pesquisa do domínio, perfis de layout, extração genérica

Antes de escrever o parser, li o produto real da Quick Filler. Duas coisas
mudaram a arquitetura:

- O fluxo do produto pede que o usuário **escolha o modelo** do cartão no
  upload, e a base tem mais de mil modelos catalogados. O campo `tipo` do
  desafio é a versão reduzida disso.
- O consumidor final é perito/calculista trabalhista, e o número transcrito
  vira verba em laudo. Isso justifica dinheiro como string BR e o `?` no lugar
  do chute — não são preciosismo do enunciado, são o custo real do erro.

Conclusão: o trabalho recorrente não é escrever um parser, é adicionar um
layout. Refiz os dois extratores como registro de perfis, cada um com
`reconhece()` e `ler()`. Adicionar layout = acrescentar um objeto.

**Onde o agente errou (continuação):**

4. **Linha de cabeçalho virando dia, e o ano virando batida.** O parser do
   cartão pegava qualquer linha com data. A linha `Período: 01/05/2019 a
   31/05/2019` virou um dia, e o `2019` solto depois da data virou a batida
   `20:19`. Ou seja: inventou um registro e inventou um horário — exatamente
   as duas coisas que o enunciado chama de pior resultado possível. Achei
   rodando o extrator contra um cartão sintético que eu mesmo montei com
   cabeçalho, antes de ter os PDFs reais em mãos. Corrigido com duas regras:
   linha com duas datas é intervalo, não dia; e token igual ao ano da própria
   linha não é batida.

### Dia 4 — calibração contra os PDFs reais

Rodei os extratores contra os oito exemplos antes de escrever qualquer perfil
novo. Os dois erros abaixo só apareceram por causa disso: nenhum teste
sintético que eu tinha escrito os pegaria, porque eu tinha inventado os
documentos sintéticos a partir das minhas próprias suposições.

**Onde o agente errou (continuação):**

5. **A coluna "Jornada" virando batida.** No SIPON, todo dia tem um `08:00`
   impresso na coluna Jornada, que é a carga horária contratada — inclusive em
   domingos e feriados sem trabalho nenhum. O perfil genérico varria os
   horários da linha e inventava uma entrada às 08:00 em cada um desses dias.
   Um mês inteiro de batidas fabricadas, todas plausíveis. Percebi comparando
   linha a linha com o PDF: o dia 1 é domingo e aparecia com batida.

6. **Lixo plausível na ficha financeira.** `payroll-01` tem RENDIMENTOS,
   DESCONTOS e RESULTADOS lado a lado — três registros por linha física. O
   perfil vertical pontuava 0,65, achava que reconhecia, e produzia 58 "bases"
   com o nome de uma verba colado no valor de outra. Este é exatamente o
   resultado que o enunciado chama de pior possível, e ele saiu bem formatado
   e convincente. Corrigido com uma guarda: se muitas linhas têm três ou mais
   valores monetários, o perfil devolve 0 e o documento é recusado.

### Dia 5 — OCR de verdade e primeiro perfil escaneado

Rodei o OCR contra os escaneados pela primeira vez. Até aqui o caminho
`pdftoppm` -> `tesseract` estava escrito e nunca tinha sido executado.

**Onde o agente errou (continuação):**

7. **O mapeamento arquivo -> layout estava trocado.** A tabela de layouts
   tinha sido montada pela ordem em que os PDFs apareceram, e não abrindo cada
   um. O `time-card-02` não era o cartão tabular, era o Banco do Brasil.
   Corrigi rodando `pdftotext` e OCR em cada arquivo e lendo as primeiras
   linhas.

8. **Linhas sumindo em silêncio.** No perfil do Banco do Brasil, os dias cujo
   número o OCR não leu vêm como `?? ???`. A regex terminava em `\b`, e "?"
   não é caractere de palavra: não existe fronteira depois dele, e a linha era
   descartada. Quatro dias de 31 desapareciam da página sem aviso nenhum — o
   pior tipo de erro aqui, porque é silencioso. Achei contando as linhas de
   saída (27) contra os dias do mês (31).

9. **O traço da faixa não sobrevive ao OCR.** O layout imprime
   `09:00 - 18:00` e o Tesseract perde o traço. O perfil dependia dele para
   parear entrada e saída, e lia zero batidas no documento para o qual tinha
   sido escrito. Refeito para parear pela ordem dos horários na linha.

>>> 10. _(anotar o próximo no momento em que acontecer)_

>>> **O que reescrevi à mão, e por quê:**
> _(anotar de verdade. Se nada foi reescrito, isso também é uma resposta — mas
> depois da sessão ao vivo de 40 min estendendo esta solução para um layout
> novo, é uma resposta cara.)_

---

## Perguntas do enunciado

### 1. Três decisões em que havia mais de uma resposta razoável

As cinco estão em `SOLUCAO.md` com o raciocínio. As três que eu defenderia
primeiro: detecção de escaneado por volume de texto (e por página, não por
documento), alocação de batidas por `kind` em vez de posição, e ausência de
banco.

>>> _(revisar se essas continuam sendo as três depois que os extratores
> estiverem prontos — a decisão mais interessante do projeto provavelmente
> ainda não foi tomada.)_

### 2. O que quebra primeiro em produção

A fila em memória. Se o processo cai ou a plataforma recicla o container, o que
estava na fila se perde e a transcrição fica presa em `processando` para
sempre, sem ninguém para marcá-la como `erro`. Não há retry, não há dead
letter, não há reconciliação no boot. Numa versão real seria BullMQ + Redis,
com o status derivado do job e não gravado à parte.

O segundo é a concorrência: o OCR a 300 dpi é caro em CPU, e com
`CONCORRENCIA=2` num free tier de 0,5 vCPU a fila cresce mais rápido do que
esvazia se chegarem vários PDFs longos juntos.

### 3. Onde eu não confio no que entreguei

>>> _(a resposta honesta só existe depois dos extratores. Candidatos prováveis:
> o corte de 80 caracteres para detectar escaneado, escolhido no olho e não
> medido contra os exemplos; e a confiança do Tesseract como critério de `?`,
> que ainda não foi calibrada contra nenhum documento real.)_
