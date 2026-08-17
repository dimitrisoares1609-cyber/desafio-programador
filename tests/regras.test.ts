import test from 'node:test';
import assert from 'node:assert/strict';

import { alocarBatidas, montarTabela } from '../src/planilha/tabela';
import { avisosHolerite, avisosCartaoPonto, consolidar } from '../src/avisos';
import { pareceUmPdf, valuePlausivel } from '../src/api/validacao';
import { normalizarHora } from '../src/extratores/cartaoPonto';
import type { ValorCartaoPonto, ValorHolerite } from '../src/tipos';

/** Oito testes, escolhidos pelo mesmo critério: cada um cobre um caso em que eu erraria... */

test('dia que começa com SAÍDA não joga a saída na coluna Entrada 1', () => {
  const slots = alocarBatidas([
    { kind: 'OUT', time_raw: '02:10', time_hhmm: '02:10' },
    { kind: 'IN', time_raw: '22:00', time_hhmm: '22:00' },
  ]);
  assert.equal(slots[0], null); // Entrada 1 fica vazia, e isso é a informação
  assert.equal(slots[1], '02:10');
  assert.equal(slots[2], '22:00');
});

test('batidas ímpares geram aviso amarelo e não somem da planilha', () => {
  const valor: ValorCartaoPonto = {
    pages: [
      {
        page: 1,
        days: [
          {
            date_raw: '21/05/2019',
            punches: [
              { kind: 'IN', time_raw: '08:25', time_hhmm: '08:25' },
              { kind: 'OUT', time_raw: '12:00', time_hhmm: '12:00' },
              { kind: 'IN', time_raw: '13:00', time_hhmm: '13:00' },
            ],
          },
        ],
      },
    ],
  };
  const avisos = consolidar(avisosCartaoPonto(valor));
  assert.equal(avisos.get(0)?.severidade, 'amarelo');
  assert.match(avisos.get(0)!.motivo, /ímpares/);
});

test('dia sem batida continua sendo uma linha da planilha', () => {
  const valor: ValorCartaoPonto = {
    pages: [
      {
        page: 1,
        days: [
          { date_raw: '21/05/2019', punches: [{ kind: 'IN', time_raw: '08:00', time_hhmm: '08:00' }] },
          { date_raw: '22/05/2019', punches: [] },
        ],
      },
    ],
  };
  const tabela = montarTabela('cartao-ponto', valor);
  assert.equal(tabela.linhas.length, 2);
  assert.equal(tabela.linhas[1][0], '22/05/2019');
});

test('vermelho ganha de amarelo na mesma linha', () => {
  const mapa = consolidar([
    { linha: 3, severidade: 'amarelo', motivo: 'incerteza' },
    { linha: 3, severidade: 'vermelho', motivo: 'não sequencial' },
  ]);
  assert.equal(mapa.get(3)?.severidade, 'vermelho');
});

test('dezembro → janeiro é consecutivo; competência ilegível não quebra a cadeia', () => {
  const valor: ValorHolerite = {
    pages: [
      { page: 1, year: '2020', month: '12', fields: [{ code: '', label: 'Salário Base', reference: '', value: '1.000,00' }], bases: [] },
      { page: 2, year: '????', month: '??', fields: [], bases: [] },
      { page: 3, year: '2021', month: '01', fields: [{ code: '', label: 'Salário Base', reference: '', value: '1.000,00' }], bases: [] },
    ],
  };
  const avisos = consolidar(avisosHolerite(valor));
  // A página 3 compara com a 1, não com a 2 ilegível — logo, é sequencial.
  assert.equal(avisos.get(2)?.severidade, undefined);
  // A página 2 é vazia: amarelo, não vermelho.
  assert.equal(avisos.get(1)?.severidade, 'amarelo');
});

test('bases não viram colunas da planilha de holerite', () => {
  const valor: ValorHolerite = {
    pages: [
      {
        page: 1,
        year: '2020',
        month: '01',
        fields: [
          { code: '0010', label: 'Salário Base', reference: '220,00', value: '2.389,77' },
          { code: '0998', label: 'INSS', reference: '', value: '262,87' },
        ],
        bases: [
          { label: 'Base INSS', value: '2.545,68' },
          { label: 'Valor Líquido', value: '2.282,81' },
        ],
      },
    ],
  };
  const tabela = montarTabela('holerite', valor);
  assert.deepEqual(tabela.colunas, ['Pág.', 'Mês', 'Ano', 'Salário Base', 'INSS']);
  assert.ok(!tabela.colunas.includes('Base INSS'));
  assert.ok(!tabela.colunas.includes('Valor Líquido'));
});

test('colunas do holerite seguem a ordem de primeira aparição, não a alfabética', () => {
  const valor: ValorHolerite = {
    pages: [
      { page: 1, year: '2020', month: '01', fields: [{ code: '', label: 'Zelador', reference: '', value: '1,00' }], bases: [] },
      { page: 2, year: '2020', month: '02', fields: [{ code: '', label: 'Adicional', reference: '', value: '2,00' }], bases: [] },
    ],
  };
  const tabela = montarTabela('holerite', valor);
  assert.deepEqual(tabela.colunas.slice(3), ['Zelador', 'Adicional']);
  assert.equal(tabela.linhas[0][4], ''); // verba que não aparece na página fica vazia
});

test('txt renomeado para .pdf é recusado; PUT malformado também', () => {
  assert.equal(pareceUmPdf(Buffer.from('isto é um texto qualquer')), false);
  assert.equal(pareceUmPdf(Buffer.from('%PDF-1.7\n...')), true);
  assert.equal(valuePlausivel('holerite', { pages: [{ page: 1 }] }), false);
  assert.equal(valuePlausivel('holerite', { pages: [{ page: 1, fields: [], bases: [] }] }), true);
});

test('normalizar hora preserva o "?" em vez de chutar o dígito', () => {
  assert.equal(normalizarHora('0?:25'), '0?:25');
  assert.equal(normalizarHora('0825'), '08:25');
  assert.equal(normalizarHora('8:25'), '08:25');
});

test('cor mais grave ganha, mas nenhum motivo é perdido', () => {
  const mapa = consolidar([
    { linha: 0, severidade: 'amarelo', motivo: 'batidas ímpares' },
    { linha: 0, severidade: 'vermelho', motivo: 'data impossível' },
    { linha: 0, severidade: 'amarelo', motivo: 'caractere incerto' },
  ]);
  assert.equal(mapa.get(0)?.severidade, 'vermelho');
  assert.match(mapa.get(0)!.motivo, /batidas ímpares/);
  assert.match(mapa.get(0)!.motivo, /data impossível/);
  assert.match(mapa.get(0)!.motivo, /caractere incerto/);
});

// ---------- Extração ----------

import { extrairCartaoPonto } from '../src/extratores/cartaoPonto';
import { extrairHolerite, separarPares } from '../src/extratores/holerite';
import { ErroLayoutDesconhecido } from '../src/extratores/layouts';
import type { PaginaTexto } from '../src/pipeline/paginas';

const pag = (texto: string): PaginaTexto[] => [{ page: 1, texto, origem: 'camada-texto' }];

test('linha de período no cabeçalho não vira um dia', () => {
  const dias = extrairCartaoPonto(pag(`
CARTAO DE PONTO   ENTRADA SAIDA
Periodo: 01/05/2019 a 31/05/2019
21/05/2019  08:25  18:25
22/05/2019  08:30  18:00
23/05/2019
`)).pages[0].days;
  assert.equal(dias.length, 3);
  assert.equal(dias[0].date_raw, '21/05/2019');
});

test('o ano da data não vira a batida 20:19', () => {
  const dias = extrairCartaoPonto(pag(`
CARTAO DE PONTO ENTRADA SAIDA
21/05/2019 2019 08:25 18:25
22/05/2019 08:00 17:00
23/05/2019 08:00 17:00
`)).pages[0].days;
  assert.deepEqual(dias[0].punches.map((p) => p.time_hhmm), ['08:25', '18:25']);
});

test('holerite separa verbas de bases pela seção, não pelo nome', () => {
  const p = extrairHolerite(pag(`
DEMONSTRATIVO DE PAGAMENTO
Competencia: 01/2020
COD DESCRICAO          REF     VENCIMENTOS  DESCONTOS
0010 Salario Base     220,00      2.389,77
0998 INSS                                     262,87
Base INSS                         2.545,68
Valor Liquido                     2.193,81
`)).pages[0];
  assert.deepEqual(p.fields.map((f) => f.label), ['Salario Base', 'INSS']);
  assert.deepEqual(p.bases.map((b) => b.label), ['Base INSS', 'Valor Liquido']);
  assert.equal(p.month, '01');
  assert.equal(p.fields[0].value, '2.389,77'); // string BR, não float
});

test('competência com mês 13 é erro de leitura, não data', () => {
  const p = extrairHolerite(pag(`
RECIBO DE PAGAMENTO  vencimentos descontos
Competencia: 13/2020
0010 Salario Base  220,00  1.000,00
Total Vencimentos          1.000,00
`)).pages[0];
  assert.equal(p.month, '??');
  assert.equal(p.year, '2020');
});

test('documento de layout desconhecido é recusado, não transcrito como lixo', () => {
  assert.throws(
    () => extrairHolerite(pag('lista de compras: arroz, feijao, farinha')),
    ErroLayoutDesconhecido,
  );
});

// ---------- Perfis reais ----------

import { perfilSipon } from '../src/extratores/perfis/sipon';
import { perfilVertical } from '../src/extratores/holerite';

const SIPON = [
  '    Dia Semana   Jornada   Entrada    Saida      Ocorrencia         Qtde',
  '      1 - DOM     08:00',
  '      2 - SEG     08:00     09:03     14:05      HE-BCO DE HORAS    00:13',
  '                            15:12     18:36      HE-REMUNERADA      00:13',
  '     17 - TER     08:00     09:09     13:01      HE-BCO DE HORAS    00:13',
  '     17 - TER     08:00     14:16     18:50      HE-REMUNERADA      00:13',
].join('\n');

test('SIPON: a coluna Jornada não vira batida', () => {
  const dias = perfilSipon.ler(SIPON, 1);
  // Domingo sem trabalho tem jornada 08:00 impressa, mas nenhuma batida.
  assert.equal(dias[0].date_raw, '1');
  assert.deepEqual(dias[0].punches, []);
});

test('SIPON: linha de continuação e dia repetido não viram dias novos', () => {
  const dias = perfilSipon.ler(SIPON, 1);
  assert.equal(dias.length, 3); // dias 1, 2 e 17 — não 6 linhas
  assert.deepEqual(dias[1].punches.map((p) => p.time_hhmm), ['09:03', '14:05', '15:12', '18:36']);
  assert.deepEqual(dias[2].punches.map((p) => p.time_hhmm), ['09:09', '13:01', '14:16', '18:50']);
});

test('SIPON: a coluna Qtde (00:13) não vira batida', () => {
  const dias = perfilSipon.ler(SIPON, 1);
  assert.ok(!dias.some((d) => d.punches.some((p) => p.time_hhmm === '00:13')));
});

test('layout multi-coluna não é reconhecido pelo perfil vertical', () => {
  // Ficha financeira: RENDIMENTOS, DESCONTOS e RESULTADOS lado a lado.
  const ficha = [
    'FICHAFINANCEIRA-PERIODO:2017/04 a 2025/03',
    '   R E N D I M E N T O S        DESCONTOS          RESULTADOS',
    '   REMUNERAÇÃOMES    969,73   290 VA Func   30,67  BASEINSS   1.260,65',
    '   DIAS/HORASTRAB    146,67   491 Seguro     2,40  BASEIRF      780,62',
    '40 Reembolso VR      360,00   499 Vale Ref  36,00  BASEFGTS   1.260,65',
    '91 Hr Adic Pericul   290,92   511 INSS     100,85  VALORFGTS    100,85',
    '   TOT.RENDIMENTOS 1.620,65   561 IRF        0,00  LIQUIDO    1.392,55',
  ].join('\n');
  assert.equal(perfilVertical.reconhece(ficha), 0);
});

import { perfilBancoDoBrasil } from '../src/extratores/perfis/bancoDoBrasil';
import { perfilReciboPagamento } from '../src/extratores/perfis/reciboPagamento';

const BB = [
  '   Dia     Entrada Saida     Intervalo 1    Intervalo 2',
  '            ?????        ??????',
  '        ?? ???  Feriado                                    610  100  N',
  '        17 SEG     12:00  18:15    15:00  15:15            610  276',
  '        19QUA      ?????  18:00    12:00  13:00      2,0   610  378',
].join('\n');

test('BB: intervalo é pausa — saída no início e entrada no fim', () => {
  const dias = perfilBancoDoBrasil.ler(BB, 1);
  const dia17 = dias.find((d) => d.date_raw === '17')!;
  assert.deepEqual(
    dia17.punches.map((p) => p.kind + ' ' + p.time_hhmm),
    ['IN 12:00', 'OUT 15:00', 'IN 15:15', 'OUT 18:15'],
  );
});

test('BB: dia que o OCR não leu continua sendo uma linha, não some', () => {
  const dias = perfilBancoDoBrasil.ler(BB, 1);
  const incerto = dias.find((d) => d.date_raw === '??');
  assert.ok(incerto, 'a linha do dia ilegível precisa existir na saída');
  assert.deepEqual(incerto!.punches, []); // "Feriado" não tem batida
});

test('BB: horário ilegível vira ??:?? em vez de sumir', () => {
  const dias = perfilBancoDoBrasil.ler(BB, 1);
  const dia19 = dias.find((d) => d.date_raw === '19')!;
  assert.equal(dia19.punches[0].time_hhmm, '??:??');
  assert.equal(dia19.punches.length, 4);
});

test('BB: o logo ilegível do topo não vira uma linha de dia', () => {
  const dias = perfilBancoDoBrasil.ler(BB, 1);
  assert.equal(dias.length, 3); // dias ??, 17 e 19 — não 4
});

test('BB: a coluna HE (2,0) não vira batida', () => {
  const dias = perfilBancoDoBrasil.ler(BB, 1);
  assert.ok(!dias.some((d) => d.punches.some((p) => p.time_raw === '2,0')));
});

test('holerite de duas tabelas lado a lado é recusado, não lido errado', () => {
  // Recibo com Proventos à esquerda e Descontos à direita, na mesma linha.
  const recibo = [
    'Recibo de Pagamento   Referencia SETEMBRO/2019',
    'Descricao      Qtde  Valor        Descricao          Qtde  Valor',
    'SALARIO             953,36        INSS MES                 200,43',
    'DSR COMISSAO        173,68        DESC ASS MEDICA            5,00',
    'REMUNERACAO       1.100,00        VALE REFEICAO              6,00',
    'TOTAL DE PROVENTOS 2.227,04       TOTAL DE DESCONTOS       211,43',
  ].join('\n');
  assert.equal(perfilVertical.reconhece(recibo), 0);
});

test('rodapé de bases rotulado não faz o perfil vertical desistir', () => {
  const comRodape = [
    'DEMONSTRATIVO DE PAGAMENTO MENSAL',
    'Periodo : 10/2019',
    'Cod. Descricao            Unidade   Proventos   Descontos',
    '0105 Dias Trabalhados       30,00    1.678,61',
    '2007 Horas Extras 100%       5,00       76,30',
    'Base I.N.S.S. :   1.967,07    F.G.T.S. do Mes :   157,37',
    'Base I.R.R.F. :   1.790,04    Base FGTS:        1.967,07',
    'Dep. I.R.R.F. :       0,00    Base I.R.R.F. 13o.:  21,20',
  ].join('\n');
  assert.ok(perfilVertical.reconhece(comRodape) > 0.35);
});

test('data no meio da linha é cabeçalho, não um dia', () => {
  const dias = extrairCartaoPonto(pag([
    'Cartao de Ponto                    Pagina 1 de 38',
    'Secao: 001.12.2.01.TMT.2.02.01.043       Data:  09/03/2026',
    'Data      Ent1  Sai1  Ent2  Sai2',
    '16/12/2019  SEG  07:00d 12:00d 13:00d 17:00d',
    '17/12/2019  TER  06:59d 12:00d 13:00d 16:59d',
    '21/12/2019  SAB',
  ].join('\n'))).pages[0].days;
  assert.equal(dias.length, 3);
  assert.equal(dias[0].date_raw, '16/12/2019');
  assert.deepEqual(dias[0].punches.map((p) => p.time_hhmm), ['07:00', '12:00', '13:00', '17:00']);
  assert.deepEqual(dias[2].punches, []);
});

// ---------- Tarefa 1: bases no rodapé com vários pares por linha ----------

test('separarPares quebra os vários "rótulo: valor" da mesma linha física', () => {
  const pares = separarPares('Base I.N.S.S. :   1.967,07     F.G.T.S. do Mes :   157,37');
  assert.deepEqual(pares, [
    { label: 'Base I.N.S.S', value: '1.967,07' },
    { label: 'F.G.T.S. do Mes', value: '157,37' },
  ]);
});

test('rodapé de 3 pares por linha vira 3 bases, sem poluir as verbas (payroll-02)', () => {
  const p = perfilVertical.ler([
    'Verba Nome Base Valor',
    '010 VENCIMENTO PADRAO-VP        3.059,94',
    'Remuneracao Funcao Vl. Ref.:  5.017,04 Proventos Retidos:  0,00 Proventos Bruto:  6.188,63',
  ].join('\n'), 1);
  assert.deepEqual(p.fields.map((f) => f.label), ['VENCIMENTO PADRAO-VP']);
  assert.deepEqual(p.bases, [
    { label: 'Remuneracao Funcao Vl. Ref', value: '5.017,04' },
    { label: 'Proventos Retidos', value: '0,00' },
    { label: 'Proventos Bruto', value: '6.188,63' },
  ]);
});

test('linha com dois pares não vira uma base poluída, e Total/Líquido entram (payroll-03)', () => {
  const p = perfilVertical.ler([
    'Cod Descricao Unidade Proventos Descontos',
    '0105 Dias Trabalhados   30,00   1.678,61',
    'Total                    1.967,07   859,46',
    'Liquido                  1.107,61',
    'Base I.N.S.S. :  1.967,07   F.G.T.S. do Mes :  157,37',
    'Dep. I.R.R.F. :  0,00       Base FGTS:  1.967,07',
  ].join('\n'), 1);
  assert.deepEqual(p.bases.map((b) => b.label + '=' + b.value), [
    'Total=1.967,07', 'Total=859,46', 'Liquido=1.107,61',
    'Base I.N.S.S=1.967,07', 'F.G.T.S. do Mes=157,37',
    'Dep. I.R.R.F=0,00', 'Base FGTS=1.967,07',
  ]);
  // A regressão que motivou a tarefa: a linha "Dep. IRRF / Base FGTS" era UMA base só.
  assert.ok(!p.bases.some((b) => b.label.includes('Dep') && b.label.includes('Base FGTS')));
});

test('par "rótulo: valor" no cabeçalho (antes das verbas) não vira base', () => {
  const p = perfilVertical.ler([
    'DEMONSTRATIVO DE PAGAMENTO',
    'Salario Base :  1.678,61   Grupo : F',
    '0105 Dias Trabalhados   30,00   1.678,61',
    'Base INSS   1.967,07',
  ].join('\n'), 1);
  assert.ok(!p.bases.some((b) => b.label.startsWith('Salario Base')));
  assert.deepEqual(p.fields.map((f) => f.label), ['Dias Trabalhados']);
  assert.deepEqual(p.bases, [{ label: 'Base INSS', value: '1.967,07' }]);
});

// ---------- Tarefa 2: Recibo de Pagamento com Proventos/Descontos lado a lado ----------

// esq preenche a coluna da esquerda até a col 45; a de Descontos começa exatamente ali.
const col = (esq: string, dir: string): string => esq.padEnd(45) + dir;
const RECIBO = [
  '            Recibo de Pagamento',
  '   Referencia   SETEMBRO/2019   MENSAL   1/1',
  col('        Proventos', 'Descontos'),
  col('   Descrição      Qtde   Valor', 'Descrição      Qtde   Valor'),
  col('   SALARIO                953,36', 'INSS MES              200,43'),
  col('   DSR COMISSAO          173,68', 'VALE REFEICAO          6,00'),
  col('   TOTAL DE PROVENTOS  2.227,04', 'TOTAL DE DESCONTOS   211,43'),
  col('', 'LIQUIDO A RECEBER    2.015,61'),
  '   Salario Base       Base INSS        FGTS Mes',
  '      1.300,00         2.227,04         178,16',
].join('\n');

test('recibo: reconhece as duas tabelas lado a lado; layout vertical não', () => {
  assert.ok(perfilReciboPagamento.reconhece(RECIBO) > 0.35);
  // uma tabela só (Proventos/Descontos como colunas de valor) não é este layout
  assert.equal(
    perfilReciboPagamento.reconhece('DEMONSTRATIVO\nCod Descricao Proventos Descontos\n0105 Dias 1,00'),
    0,
  );
});

test('recibo: corta na coluna de Descontos e soma proventos depois descontos', () => {
  const p = perfilReciboPagamento.ler(RECIBO, 1);
  assert.equal(p.month, '09');
  assert.equal(p.year, '2019');
  assert.deepEqual(p.fields.map((f) => f.label), ['SALARIO', 'DSR COMISSAO', 'INSS MES', 'VALE REFEICAO']);
  assert.deepEqual(p.fields.map((f) => f.value), ['953,36', '173,68', '200,43', '6,00']);
  // totais e o rodapé de bases vão para bases[], não para fields[]
  assert.ok(!p.fields.some((f) => /total/i.test(f.label)));
  assert.deepEqual(p.bases.map((b) => b.label + '=' + b.value), [
    'TOTAL DE PROVENTOS=2.227,04', 'TOTAL DE DESCONTOS=211,43', 'LIQUIDO A RECEBER=2.015,61',
    'Salario Base=1.300,00', 'Base INSS=2.227,04', 'FGTS Mes=178,16',
  ]);
});

test('recibo: dois recibos na mesma página — lê só o primeiro', () => {
  const p = perfilReciboPagamento.ler(RECIBO + '\n' + RECIBO, 1);
  assert.deepEqual(p.fields.map((f) => f.label), ['SALARIO', 'DSR COMISSAO', 'INSS MES', 'VALE REFEICAO']);
});

// ---------- Tarefa 3: cartão mecânico ilegível (time-card-04) ----------

test('cartão em que o OCR só devolve "?" é recusado, não inventado', () => {
  // Espelha o time-card-04: matriz borrada sobre grade, quase tudo ilegível.
  const ilegivel = [
    '   ??? ?????? | ????? | ?????? | ????? | ??????? | Saida ???',
    '    ?     ? ?   ?  ?  ?',
    '     ???    ???? ?? ?? ??',
    '   ?  ????  ??? ?? ??   ?',
    '     ??? ?? ??? ?? ?? ??',
  ].join('\n');
  assert.throws(() => extrairCartaoPonto(pag(ilegivel)), ErroLayoutDesconhecido);
});

// ---------- Tarefa 4: ficha financeira multi-mês (payroll-01) ----------

test('ficha financeira com vários meses por página é recusada, não colapsada', () => {
  // Três colunas (RENDIMENTOS/DESCONTOS/RESULTADOS) e um bloco por mês.
  const ficha = [
    'FICHA FINANCEIRA - PERIODO: 2017/04 a 2025/03',
    '   R E N D I M E N T O S        DESCONTOS          RESULTADOS',
    'Folha Normal   Mes: abr-17',
    '   REMUNERACAO MES      969,73   290 VA Func   30,67  BASE INSS   1.260,65',
    '   DIAS/HORAS TRAB      146,67   491 Seguro     2,40  BASE IRF      780,62',
    '40 Reembolso VR         360,00   499 Vale Ref  36,00  BASE FGTS   1.260,65',
    '91 Hr Adic Pericul      290,92   511 INSS     100,85  VALOR FGTS    100,85',
    '   TOT.RENDIMENTOS    1.620,65   561 IRF        0,00  LIQUIDO     1.392,55',
    'Folha Normal   Mes: mai-17',
    '   REMUNERACAO MES    1.454,59   290 VA Func   46,00  BASE INSS   2.064,79',
  ].join('\n');
  assert.throws(() => extrairHolerite(pag(ficha)), ErroLayoutDesconhecido);
});
