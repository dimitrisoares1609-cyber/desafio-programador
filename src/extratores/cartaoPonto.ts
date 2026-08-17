import type { PaginaTexto } from '../pipeline/paginas';
import type { Batida, Dia, PaginaCartao, ValorCartaoPonto } from '../tipos';
import {
  ErroLayoutDesconhecido,
  escolherPerfil,
  type PerfilLayout,
} from './layouts';
import { perfilSipon } from './perfis/sipon';
import { perfilBancoDoBrasil } from './perfis/bancoDoBrasil';

/** Regras que valem para QUALQUER perfil de cartão de ponto:  1. */

// ---------- Normalização ----------

export function normalizarHora(bruto: string): string {
  const limpo = bruto.trim();
  // O "?" sobrevive à normalização: se o dígito não deu para ler, ele continua...
  const m = limpo.match(/^(\d|\?)?(\d|\?)[:.hH]?(\d|\?)(\d|\?)$/);
  if (!m) return limpo;
  const [, h1 = '0', h2, m1, m2] = m;
  return `${h1}${h2}:${m1}${m2}`;
}

export function horaPlausivel(hhmm: string): boolean {
  if (hhmm.includes('?')) return true; // incerto não é o mesmo que impossível
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** Alterna IN/OUT pela posição, que é o padrão do cartão de ponto. */
export function inferirKind(indice: number): Batida['kind'] {
  return indice % 2 === 0 ? 'IN' : 'OUT';
}

const RE_DATA = /\b(\d{2}|\?\d|\d\?)[\/.-](\d{2}|\?\d|\d\?)(?:[\/.-](\d{2,4}))?\b/;
// O sufixo opcional é uma letra de marcação que alguns relógios imprimem colada...
const RE_HORA = /(?:^|\s|\+)([\d?]{1,2}[:.hH][\d?]{2})[a-z]?(?=\s|$)/g;

// ---------- Perfil genérico ----------

/** Cartão tabular: uma linha por dia, começando pela data, com as batidas na mesma linha. */
export const perfilTabular: PerfilLayout<Dia[]> = {
  nome: 'cartao-tabular-generico',

  reconhece(texto) {
    const linhas = texto.split('\n');
    const comData = linhas.filter((l) => RE_DATA.test(l)).length;
    if (comData < 3) return 0;

    // Sinais de cabeçalho de cartão de ponto.
    const cabecalho = /entrada|sa[ií]da|marca[çc][ãa]o|batida|ponto|jornada/i.test(texto);
    const proporcao = Math.min(comData / 15, 1);
    return Math.min(0.3 * proporcao + (cabecalho ? 0.5 : 0.2) + 0.2, 1);
  },

  ler(texto) {
    const dias: Dia[] = [];
    for (const linha of texto.split('\n')) {
      const todasAsDatas = linha.match(new RegExp(RE_DATA.source, 'g')) ?? [];
      // Linha com duas datas é intervalo de cabeçalho ("Período: 01/05 a 31/05"), não...
      if (todasAsDatas.length !== 1) continue;

      const data = linha.match(RE_DATA)!;
      // A data de uma linha de dia vem no começo da linha.
      if (data.index! > 14) continue;
      // Só considera horários DEPOIS da data, para a própria data não virar batida.
      const resto = linha.slice(data.index! + data[0].length);
      const brutos = [...resto.matchAll(RE_HORA)].map((m) => m[1]);
      const ano = data[3];

      const punches: Batida[] = [];
      for (const bruto of brutos) {
        // "2019" solto depois da data é o ano transbordando de uma coluna, não a batida...
        if (ano && bruto === ano) continue;
        const hhmm = normalizarHora(bruto);
        if (!horaPlausivel(hhmm)) continue; // 25:70 é erro de leitura, não batida
        punches.push({ kind: inferirKind(punches.length), time_raw: bruto, time_hhmm: hhmm });
      }
      dias.push({ date_raw: data[0], punches });
    }
    return dias;
  },
};

/** Adicionar um layout novo = acrescentar um objeto aqui. */
export const perfisCartaoPonto: PerfilLayout<Dia[]>[] = [perfilSipon, perfilBancoDoBrasil, perfilTabular];

// ---------- Extrator ----------

export function extrairCartaoPonto(paginas: PaginaTexto[]): ValorCartaoPonto {
  const pages: PaginaCartao[] = [];
  let algumReconhecido = false;

  for (const p of paginas) {
    const { perfil } = escolherPerfil(perfisCartaoPonto, p.texto);
    if (perfil) {
      algumReconhecido = true;
      pages.push({ page: p.page, days: perfil.ler(p.texto, p.page) });
    } else {
      // Página que nenhum perfil reconheceu continua na saída, vazia.
      pages.push({ page: p.page, days: [] });
    }
  }

  if (!algumReconhecido) throw new ErroLayoutDesconhecido('cartao-ponto');
  return { pages };
}
