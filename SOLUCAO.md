# SOLUCAO.md

> Documento vivo — atualizado a cada bloco de trabalho, não escrito no fim.

## Como rodar

```bash
docker compose up --build
# aplicação em http://localhost:3000
curl http://localhost:3000/healthz
```

Sem Docker:

```bash
npm install
npm run build
npm start
```

Requer `poppler-utils` e `tesseract-ocr` + `tesseract-ocr-por` no PATH. O
Dockerfile já instala ambos.

### Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./dados` | Onde ficam PDFs e transcrições |
| `MAX_UPLOAD_MB` | `20` | Limite duro de upload |
| `RETENCAO_HORAS` | `24` | Janela de retenção |
| `CONCORRENCIA` | `2` | PDFs processados em paralelo |
| `MAX_PAGINAS` | `60` | Teto de páginas por PDF |

Não há segredo nenhum no projeto: a aplicação não usa serviço externo.

---

## O domínio, e por que ele decide a arquitetura

A saída deste sistema não é um relatório: é insumo de cálculo pericial
trabalhista. Quem consome é perito ou calculista, e o número transcrito vira
verba em laudo. Isso explica três exigências do enunciado que, fora desse
contexto, pareceriam preciosismo:

- **Dinheiro é string em formato BR.** A planilha é importada por softwares de
  cálculo; converter para float perde o formato original e introduz
  arredondamento em cima de valor que vai a juízo.
- **`?` vale mais que um chute.** Um valor errado com aparência de certo
  atravessa a revisão e chega ao laudo. Um `?` é visto e corrigido.
- **Ordem do documento, nunca ordenada.** Ordenar esconde exatamente o sinal
  que os avisos de "não sequencial" existem para revelar.

E explica a decisão de arquitetura mais importante daqui: **o trabalho
recorrente neste domínio não é escrever um parser, é adicionar um layout.**

## Arquitetura

Um pipeline, dois extratores, N perfis de layout.

```
upload → valida → fila → [worker] → páginas (texto ou OCR) → Extrator → value
                                                                   ↓
                              UI de revisão ← GET/PUT → montarTabela → xlsx|csv|json
```

Só duas coisas variam por tipo de documento:

- `src/extratores/*` — a leitura, atrás da interface `Extrator`
- `src/planilha/tabela.ts` — a forma da tabela

**Dentro de cada extrator há um registro de perfis de layout**
(`src/extratores/layouts.ts`). Cada perfil declara `reconhece(texto) → 0..1` e
`ler(texto)`. Quem lê a página é o perfil mais confiante.

Adicionar um layout novo é acrescentar um objeto a um array. Não se edita o
parser, não se mexe no pipeline, não se toca na interface, e nenhum layout
existente corre risco de regressão. Foi montado assim de propósito: é a forma
do problema real, e é a operação que a extensão para um layout novo exige.

Pontuação em vez de booleano porque layouts parecidos coexistem — com booleano,
o primeiro do array ganharia, e a ordem da lista viraria regra de negócio
invisível.

**Nenhum perfil reconheceu?** A transcrição é recusada com `status: "erro"` e
mensagem legível, em vez de devolver lixo bem formatado. Página isolada não
reconhecida continua na saída, vazia, e cai no aviso de "página vazia" — que é
o que o revisor precisa ver.

Upload, fila, status, correção, download, Docker e interface são escritos uma
vez e não sabem qual é o tipo.

**Avisos são derivados.** `src/avisos/index.ts` é uma função pura sobre o
`value`, chamada tanto pela interface quanto pela exportação. Nenhum aviso é
campo do JSON. Manter uma única implementação é o que impede que a cor da tela
e a cor da planilha divirjam.

**Os três formatos renderizam a mesma `Tabela`.** `xlsx`, `csv` e `json` saem do
mesmo modelo intermediário, então não existe caminho de código onde um formato
recebe uma correção e o outro não.

---

## Decisões com mais de uma resposta razoável

**1. Detecção de página escaneada por volume de texto, não por "veio vazio".**
PDFs escaneados às vezes trazem um cabeçalho vetorial de duas palavras com o
resto em imagem. Testar `texto === ''` trataria essas páginas como legíveis e
devolveria transcrição quase em branco. O corte é ≥80 caracteres alfanuméricos,
e a decisão é **por página**, não por documento — existe PDF misto.
_Risco:_ uma página real com muito pouco texto vai para o OCR sem precisar.
Custa tempo, não corretude.

**2. Alocação de batidas por `kind`, não por posição.** Num dia que começa com
uma SAÍDA (virada de noite, ou entrada não registrada), alocar por posição
jogaria a saída na coluna `Entrada 1` — valor errado com cara de certo, que é o
pior resultado possível segundo o próprio enunciado. Alocando por `kind`, a
`Entrada 1` fica vazia e o buraco aparece.

**3. Sem banco de dados.** O dado só precisa sobreviver entre o envio e o
download, e a retenção é apagar em 24h. Um Postgres seria infra sem problema
correspondente. _Custo assumido:_ a solução presume instância única. Escalar
horizontalmente exigiria storage compartilhado e fila externa.

**4. Data impossível entra no aviso vermelho.** `38/07` não é data — é erro de
leitura. Ela não quebra a cadeia de sequência (a próxima data legível compara
com a anterior legível), mas a linha é marcada. O enunciado lista quatro avisos e este é um
sub-caso do "data não sequencial".

**6. Dois endpoints fora do contrato para a interface.** `GET /:id/tabela` e
`GET /:id/pdf`. O contrato obrigatório não foi tocado — estes existem para a
tela de revisão não reimplementar a montagem de colunas e os avisos em
JavaScript. O front recebe a tabela pronta mais um `ref` por célula dizendo
onde ela mora dentro do `value`, e faz só a escrita indexada. Toda a derivação
continua no servidor, num lugar só. _Alternativa descartada:_ calcular tudo no
navegador, que duplicaria as regras e faria a cor da tela divergir da cor do
xlsx na primeira mudança.

**7. A cor mais grave ganha, mas os motivos se acumulam.** Uma linha com data
impossível E batidas ímpares fica vermelha. Se o motivo da ímpar sumisse, o
revisor corrigiria a data, veria a linha ficar amarela e não saberia por quê.

**8. Recusar em vez de adivinhar.** Documento cujo layout nenhum perfil
reconhece vira erro explícito. É a alternativa cara — dá zero de precisão
naquele arquivo — mas neste domínio uma recusa custa uma revisão manual e um
número errado custa um laudo.

**9. Incerteza por palavra no OCR, não por caractere.** O Tesseract devolve
confiança por palavra. Abaixo de 70 eu marco todos os caracteres daquela
palavra com `?`, porque não sei qual deles ele errou. É mais grosseiro do que
o enunciado pede. A alternativa seria comparar duas passagens de OCR caractere
a caractere; não implementei por tempo e por preferir entregar algo que eu
consigo explicar inteiro.

**5. `?` sobrevive à normalização.** `normalizarHora("0?:25")` devolve
`"0?:25"`, não `"08:25"`. Resolver o dígito na normalização é exatamente o
chute que o critério de honestidade penaliza.

---

## Ambiguidades do enunciado e a decisão que tomei

Três pontos em que o enunciado admite mais de uma leitura. Registro a escolha e
o motivo em vez de deixar implícito.

**1. Um dia que ocupa duas linhas físicas.** No SIPON o par da manhã e o da
tarde ficam em linhas separadas, às vezes repetindo o número do dia. O
enunciado diz "um item por linha do documento". Optei por um item por DIA, com
as quatro batidas juntas, porque é o que produz a planilha `Entrada 1 / Saída 1
/ Entrada 2 / Saída 2` que o próprio enunciado descreve. Um item por linha
física geraria dois "dias" com a mesma data e o aviso de data não sequencial
dispararia em metade do documento.

**2. `date_raw` quando a linha não traz a data completa.** No SIPON e no Banco
do Brasil a linha traz só o número do dia; mês e ano estão no cabeçalho da
página. Segui a regra ao pé da letra — "exatamente como está impressa, sem
normalizar" — e gravo `"1"`, `"02"`. Compor a data com o cabeçalho seria
inventar informação que não está na linha, e o campo se chama `_raw`
justamente para guardar o impresso.

**3. Dois demonstrativos na mesma página.** Alguns holerites trazem dois
documentos por página do PDF. O contrato tem um `year`/`month` e um `fields[]`
por página, então mesclar dois de **competências diferentes** misturaria dados
e continua recusado. O `payroll-04` é o caso benigno: os dois são **vias
idênticas** do mesmo recibo (via do empregado e via do empregador), então o
perfil `holerite-recibo-pagamento` lê só o primeiro — leitura completa, sem
duplicar nem misturar. Se um dia as duas vias divergirem, ler a primeira ainda
é a escolha honesta.

## Segurança e privacidade

- **Limite de upload:** `MAX_UPLOAD_MB` (padrão 20 MB), rejeitado com `413`.
  Um arquivo por requisição.
- **Validação de PDF:** assinatura `%PDF-` procurada no primeiro KB dos bytes.
  Extensão e `Content-Type` vêm do cliente e não são considerados. `.txt`
  renomeado para `.pdf` é recusado com `400`.
- **Arquivo corrompido:** vira `status: "erro"` com mensagem legível. A saída
  crua do poppler traz o caminho absoluto do arquivo e **não** é repassada ao
  cliente — fica só no log do servidor.
- **PDF gigante:** teto de `MAX_PAGINAS` páginas, verificado antes de começar a
  rasterizar.
- **Uploads simultâneos:** fila com concorrência limitada (`CONCORRENCIA`). O
  `POST` responde `202` na hora; nada de pesado roda dentro do request.
- **Sem PII nos logs:** o log traz método, rota com id mascarado, status e
  contagem de páginas. Nome de arquivo fica fora de propósito — holerite
  costuma chegar como `FULANO_DE_TAL_CPF.pdf`. Nenhum valor transcrito é logado.
- **Retenção:** PDF e transcrição são apagados `RETENCAO_HORAS` após o envio
  (padrão 24h), por varredura horária. Volume nomeado do Docker, não bind mount,
  para os PDFs não caírem na árvore do repositório por acidente.
- Container roda como usuário não-root.

---

## A interface

HTML/CSS/JS puro em `public/index.html`, sem build step — o container só
precisa servir um arquivo estático, e a complexidade poupada foi para a
extração. A paleta é ancorada no `#173772` do cabeçalho da planilha: tela e
xlsx usam as mesmas cores, para o revisor não reaprender o significado de
amarelo e vermelho ao abrir o arquivo.

- Envio com tipo, e progresso com polling de intervalo crescente (600ms → 3s)
- Tabela editável seguindo exatamente as colunas da planilha do tipo
- Motivo do aviso escrito por extenso abaixo da linha, não só a cor
- Célula com `?` ganha marca própria: a incerteza é por caractere, e a linha
  inteira amarela não diz qual campo a máquina não leu
- PDF ao lado, servido inline
- Salvar redesenha a partir do servidor, então corrigir uma data recolore a
  linha sem a regra existir no front

**Limitação conhecida:** inserir várias batidas novas na mesma linha antes de
salvar pode deixá-las fora de ordem, porque os índices só são recalculados no
redesenho. Salvar entre as inserções resolve.

## Inventário dos layouts dos exemplos

Cada arquivo é um layout distinto. Nenhum parser único cobre os oito — o que
confirma a aposta na arquitetura de perfis.

| Arquivo | Layout | Camada de texto | Perfil | Estado |
|---|---|---|---|---|
| `time-card-01` | SIPON — Folha de Frequência | sim | `cartao-sipon` | lê correto |
| `time-card-02` | Banco do Brasil — Ponto Eletrônico | **nao** | `cartao-banco-do-brasil` | lê correto via OCR |
| `time-card-03` | Cartão de Ponto tabular (sufixos `c`/`d`) | **nao** | genérico | saída incompleta |
| `time-card-04` | Cartão mecânico, mês manuscrito, quinzenas | **nao** | — | recusado |
| `payroll-01` | Ficha financeira multi-coluna | sim | — | recusado de propósito |
| `payroll-02` | Declaração de Remuneração (MÊS + ACERTO) | sim | genérico | lê correto (verbas + bases) |
| `payroll-03` | Demonstrativo de Pagamento Mensal | sim | genérico | lê correto (verbas + bases) |
| `payroll-04` | Recibo de Pagamento, dois por página | **só o carimbo** | `holerite-recibo-pagamento` | lê o 1º recibo de cada página |

Cinco dos oito são escaneados ou quase — o enunciado avisou, e é mesmo assim
que a maior parte do material chega.

### O caso que valida a heurística de detecção

`payroll-04` é imagem pura, mas **tem** camada de texto: 62 caracteres do
carimbo do PJe (`Fls.: 316`, `Assinado eletronicamente por... Juntado em...`).
Testar `texto === ''` classificaria a página como digital e devolveria uma
transcrição vazia sem nenhum aviso. O corte por volume de caracteres pega o
caso. Ficou em 80 caracteres, e os 62 do carimbo entram com margem estreita —
é uma das coisas em que menos confio, porque o carimbo varia de tamanho entre
tribunais.

## Onde a extração é frágil hoje

Os perfis genéricos (`cartao-tabular-generico`, `holerite-vertical-generico`)
são o ponto de partida, não a resposta final. Dois casos já conhecidos:

- **Manuscrito.** O produto real lê cartão de ponto escrito à mão; o Tesseract
  é ruim nisso. Um cartão manuscrito hoje sai majoritariamente como `?`, o que
  é o comportamento correto — honesto e revisável — mas é precisão baixa.
- **Colunas por posição.** Confirmado nos exemplos: o SIPON tem uma coluna
  "Jornada" com um `08:00` que não é batida, e uma coluna "Qtde" com `00:13`
  que é duração de hora extra. O perfil genérico inventava uma entrada às
  08:00 em todo domingo e feriado do mês. O perfil `cartao-sipon` resolve
  localizando `Entrada` e `Saida` pelo cabeçalho e fatiando por posição.
- **Ficha financeira multi-coluna** (`payroll-01`): três registros diferentes
  por linha física. O perfil vertical pontuava 0,65 e colava o nome de uma
  verba no valor de outra. Hoje é recusado por uma guarda explícita — uma
  entrega vazia e honesta em vez de 58 linhas de lixo plausível.

### Bases no rodapé com vários pares por linha (payroll-02 e payroll-03)

As bases e totais ficam num rodapé onde a mesma linha física traz dois ou três
pares `rótulo: valor` (ex.: `Base I.N.S.S. : 1.967,07   F.G.T.S. do Mês : 157,37`).
O parser lia um valor por linha, então `payroll-02` devolvia zero bases e
`payroll-03` uma só (com o rótulo poluído). A função `separarPares` quebra todos
os pares da linha; o rótulo terminado em `:` é o que distingue rodapé de verba
(a tabela de verbas não usa dois pontos antes do valor). As linhas `Total` e
`Líquido`, que não têm dois pontos, entram como bases só depois que a tabela de
verbas começou — nunca no cabeçalho.

### Recibo de Pagamento em duas colunas (payroll-04)

Layout com Proventos à esquerda e Descontos à direita na mesma linha física. O
perfil `holerite-recibo-pagamento` acha a coluna onde a tabela de Descontos
começa (o segundo `Descrição` do sub-cabeçalho — a palavra "Descontos" é
centralizada e não marca o início da coluna), corta cada linha ali e lê os dois
lados. `fields[]` soma primeiro os proventos, depois os descontos; totais
(`TOTAL DE PROVENTOS/DESCONTOS`, `LÍQUIDO A RECEBER`) e o rodapé de bases
(Salário Base, Base INSS, FGTS do Mês…) vão para `bases[]`. É escaneado, então
descrições saem com a primeira letra comida pela grade (`OTAL`, `ALE`,
`????????`) — os **valores**, que é o que importa no cálculo, saem corretos.
Onde o mês não é legível, a competência fica `??/????` em vez de chutada.

### Correção de portabilidade no OCR (linha do TSV)

O Tesseract emite o TSV com `\r\n` em alguns ambientes; o `lerTsv` fazia
`split('\n')` e o `\r` grudava em `text`, quebrando o `indexOf` do cabeçalho e
zerando a leitura de OCR fora do Linux. Passou a `split(/\r?\n/)` — sem efeito
no Docker (alvo), mas destrava rodar e validar o OCR em qualquer sistema.

### Cartão mecânico ilegível (time-card-04) — recusa medida

Cartão de ponto mecânico, matricial borrado sobre grade colorida, mês
manuscrito, dividido em 1ª/2ª quinzena com colunas MANHÃ/TARDE/EXTRA. Rodei o
OCR a 300 dpi nas 5 páginas e medi: **76% a 96% dos caracteres saem como `?`** e
o total de dígitos legíveis nas cinco páginas juntas é **seis**. Um cartão é
essencialmente dígitos (dias 1–31 e horários HH:MM); sem dígitos não há o que
transcrever. O único texto estável é a palavra "Saida" de um cabeçalho.

Mantido recusado (`ErroLayoutDesconhecido`), como manda o critério de
honestidade: inventar horários a partir de tinta borrada seria o pior resultado
possível neste domínio. O mês manuscrito no cabeçalho não é sequer tentado — o
Tesseract não lê manuscrito, e chutar "abril" seria fabricar competência.

### Ficha financeira multi-mês (payroll-01) — recusa por contrato

Bônus do enunciado. A ficha traz três colunas lado a lado (RENDIMENTOS,
DESCONTOS, RESULTADOS) e, dentro delas, **um bloco por mês** ("Folha Normal /
Mês: abr-17"): são ~19 competências por página do PDF (período 2017/04 a
2025/03). Cortar as três colunas é a parte fácil e dá para fazer. O que trava é
o **contrato de saída**: `PaginaHolerite` tem um único `year`/`month`, e o
`extrairHolerite` produz **uma entrada por página do PDF**. Encaixar 19 meses aí
só teria dois caminhos, ambos ruins:

1. **Colapsar tudo num `fields[]` só** — "REMUNERAÇÃO MES" apareceria 19 vezes
   sem dizer de qual mês. Isso é exatamente o dado plausível e errado que o
   projeto recusa em toda parte.
2. **Fazer um perfil devolver N entradas por página** — mudaria a assinatura de
   `ler()` e o laço do `extrairHolerite`, quebrando a invariante central
   ("adicionar layout = só criar um perfil, nada mais muda") que o enunciado
   pede para manter, e ainda esbarraria na montagem da tabela e nos avisos, que
   assumem uma competência por página.

Então fica recusado de propósito, e a decisão é o próprio ponto: honrar o
contrato e a arquitetura vale mais do que arrancar este exemplo à força.

## Testes

Quinze testes, escolhidos por um critério só: **cada um cobre um caso em que a
solução erraria em silêncio.** Dia sem batida que some da planilha, saída
alocada como entrada, `bases` virando coluna, dezembro→janeiro marcado como
não sequencial, `?` resolvido no chute, `.txt` aceito como PDF. Nenhum testa
que uma função devolve um array.

---

## O que ficou de fora

_(preencher no fechamento — cortes conscientes e o porquê)_

## Onde a leitura é mais fraca que a outra

_(preencher depois de rodar contra os exemplos: os dois tipos pesam igual, e
reconhecer a assimetria conta a favor)_
