import { avisosPara, type Aviso } from '../avisos';
import type {
  Batida,
  TipoDocumento,
  ValorCartaoPonto,
  ValorHolerite,
  ValorTranscricao,
} from '../tipos';

/** Modelo intermediário de tabela. */
export interface Tabela {
  colunas: string[];
  linhas: string[][];
  avisos: Map<number, Aviso>;
  /** Paralelo a `linhas`: para cada célula, onde ela mora dentro do `value`. */
  refs: RefCelula[][];
}

export type RefCelula =
  | { tipo: 'nao-editavel' }
  | { tipo: 'data'; p: number; d: number }
  | { tipo: 'batida'; p: number; d: number; slot: number; punchIndex: number | null }
  | { tipo: 'competencia'; p: number; campo: 'month' | 'year' }
  | { tipo: 'verba'; p: number; label: string; fieldIndex: number | null };

/** Distribui as batidas nas colunas Entrada N / Saída N respeitando o `kind`. */
export interface SlotBatida {
  valor: string;
  /** Índice da batida dentro de `punches` — a interface precisa dele para editar. */
  punchIndex: number;
}

export function alocarBatidasComIndice(
  punches: Batida[],
): (SlotBatida | null)[] {
  const slots: (SlotBatida | null)[] = [];
  let i = 0;
  punches.forEach((p, punchIndex) => {
    const paridadeDesejada = p.kind === 'IN' ? 0 : 1;
    while (i % 2 !== paridadeDesejada) {
      slots[i] = null;
      i++;
    }
    slots[i] = { valor: p.time_hhmm, punchIndex };
    i++;
  });
  return slots;
}

export function alocarBatidas(punches: Batida[]): (string | null)[] {
  return alocarBatidasComIndice(punches).map((s) => (s ? s.valor : null));
}

function tabelaCartaoPonto(valor: ValorCartaoPonto): Tabela {
  // Achata mantendo de onde cada linha veio, para o ref saber o caminho.
  const dias: { p: number; d: number; date_raw: string; slots: (SlotBatida | null)[] }[] = [];
  valor.pages.forEach((pagina, p) => {
    pagina.days.forEach((dia, d) => {
      dias.push({
        p,
        d,
        date_raw: dia.date_raw,
        slots: alocarBatidasComIndice(dia.punches),
      });
    });
  });

  // Tantos pares quantos o dia com mais batidas exigir.
  const maxSlots = dias.reduce((m, x) => Math.max(m, x.slots.length), 0);
  const pares = Math.ceil(maxSlots / 2);

  const colunas = ['Data'];
  for (let i = 1; i <= pares; i++) colunas.push(`Entrada ${i}`, `Saída ${i}`);

  const linhas: string[][] = [];
  const refs: RefCelula[][] = [];

  for (const dia of dias) {
    const celulas = [dia.date_raw];
    const refsLinha: RefCelula[] = [{ tipo: 'data', p: dia.p, d: dia.d }];
    for (let s = 0; s < pares * 2; s++) {
      const slot = dia.slots[s];
      celulas.push(slot?.valor ?? '');
      refsLinha.push({
        tipo: 'batida',
        p: dia.p,
        d: dia.d,
        slot: s,
        punchIndex: slot ? slot.punchIndex : null,
      });
    }
    linhas.push(celulas);
    refs.push(refsLinha);
  }

  return { colunas, linhas, refs, avisos: avisosPara('cartao-ponto', valor) };
}

function tabelaHolerite(valor: ValorHolerite): Tabela {
  // União de todos os labels de fields, na ordem de PRIMEIRA APARIÇÃO no documento.
  const labels: string[] = [];
  for (const pagina of valor.pages) {
    for (const f of pagina.fields) {
      if (!labels.includes(f.label)) labels.push(f.label);
    }
  }

  const colunas = ['Pág.', 'Mês', 'Ano', ...labels];

  const linhas: string[][] = [];
  const refs: RefCelula[][] = [];

  valor.pages.forEach((pagina, p) => {
    const porLabel = new Map<string, { value: string; indice: number }>();
    pagina.fields.forEach((f, indice) => {
      // Se a mesma verba aparece duas vezes na página, guarda a primeira.
      if (!porLabel.has(f.label)) porLabel.set(f.label, { value: f.value, indice });
    });

    linhas.push([
      String(pagina.page),
      pagina.month,
      pagina.year,
      ...labels.map((l) => porLabel.get(l)?.value ?? ''),
    ]);

    refs.push([
      { tipo: 'nao-editavel' }, // Pág. vem do PDF, não se corrige na tabela
      { tipo: 'competencia', p, campo: 'month' },
      { tipo: 'competencia', p, campo: 'year' },
      ...labels.map(
        (l): RefCelula => ({
          tipo: 'verba',
          p,
          label: l,
          fieldIndex: porLabel.get(l)?.indice ?? null,
        }),
      ),
    ]);
  });

  return { colunas, linhas, refs, avisos: avisosPara('holerite', valor) };
}

export function montarTabela(
  tipo: TipoDocumento,
  valor: ValorTranscricao,
): Tabela {
  return tipo === 'cartao-ponto'
    ? tabelaCartaoPonto(valor as ValorCartaoPonto)
    : tabelaHolerite(valor as ValorHolerite);
}
