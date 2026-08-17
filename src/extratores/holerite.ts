import type { PaginaTexto } from '../pipeline/paginas';
import type { BaseTotal, PaginaHolerite, ValorHolerite, Verba } from '../tipos';
import {
  ErroLayoutDesconhecido,
  escolherPerfil,
  type PerfilLayout,
} from './layouts';

/** A decisão central deste extrator é fields[] vs bases[]:  fields[] = SOMENTE as... */

export interface PaginaLida {
  year: string;
  month: string;
  fields: Verba[];
  bases: BaseTotal[];
}

// Valor monetário brasileiro, com "?" nas posições ilegíveis.
const RE_DINHEIRO = /-?[\d?]{1,3}(?:\.[\d?]{3})*,[\d?]{2}/;
const RE_DINHEIRO_FIM = new RegExp(RE_DINHEIRO.source + '\\s*[DC]?\\s*$');
const RE_COMPETENCIA = /\b([\d?]{2})\s*[\/.-]\s*([\d?]{4})\b/;

/** A seção de bases começa aqui. */
const RE_INICIO_BASES =
  /(base\s*(de\s*)?(c[áa]lculo|inss|ir|irrf|fgts)|sal[.\s]*contr|total\s*(de\s*)?(venc|desc)|valor\s*l[íi]quido|l[íi]quido\s*a\s*receber|dep[óo]sito\s*fgts)/i;

export function valorMonetarioValido(v: string): boolean {
  return new RegExp('^' + RE_DINHEIRO.source + '$').test(v.trim());
}

export function mesValido(mes: string): boolean {
  if (mes.includes('?')) return true;
  return /^\d{2}$/.test(mes) && Number(mes) >= 1 && Number(mes) <= 12;
}

export function lerCompetencia(texto: string): { year: string; month: string } {
  // Procura perto da palavra "competência" antes de aceitar qualquer MM/AAAA: a...
  const rotulada = texto.match(
    new RegExp('compet[êe]ncia\\D{0,20}' + RE_COMPETENCIA.source, 'i'),
  );
  const m = rotulada ?? texto.match(RE_COMPETENCIA);
  if (!m) return { year: '????', month: '??' };
  const mes = m[1];
  // Mês 13 é erro de leitura, não competência.
  return { month: mesValido(mes) ? mes : '??', year: m[2] };
}

/** Separa todos os pares "rótulo: valor" de uma mesma linha do rodapé de bases. */
export function separarPares(linha: string): BaseTotal[] {
  // Um rótulo começa por letra, vai até os dois pontos, e é seguido de um valor.
  const re = new RegExp('([A-Za-zÀ-ÿ][^:]*?)\\s*:\\s*(' + RE_DINHEIRO.source + ')', 'g');
  const pares: BaseTotal[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha))) {
    const label = m[1].replace(/[.:\s]+$/, '').trim();
    if (label) pares.push({ label, value: m[2] });
  }
  return pares;
}

/** Lê uma linha da seção de bases: pares rotulados, ou rótulo seguido de valores soltos. */
function lerBasesDaLinha(linha: string, pares: BaseTotal[]): BaseTotal[] {
  if (pares.length > 0) return pares;
  const valores = linha.match(new RegExp(RE_DINHEIRO.source, 'g')) ?? [];
  const primeiro = valores[0];
  if (!primeiro) return [];
  const label = linha.slice(0, linha.indexOf(primeiro)).replace(/[.:\s]+$/, '').trim();
  if (!label) return [];
  return valores.map((v) => ({ label, value: v }));
}

// ---------- Perfil genérico ----------

/** Demonstrativo vertical: tabela de verbas linha a linha, seção de bases abaixo. */
export const perfilVertical: PerfilLayout<PaginaLida> = {
  nome: 'holerite-vertical-generico',

  reconhece(texto) {
    // Guarda contra layout multi-coluna (ficha financeira: RENDIMENTOS, DESCONTOS e...
    const linhasComMoeda = texto
      .split('\n')
      .map((l) => (l.match(new RegExp(RE_DINHEIRO.source, 'g')) ?? []).length)
      .filter((n) => n > 0);
    if (linhasComMoeda.length >= 5) {
      const multi = linhasComMoeda.filter((n) => n >= 3).length / linhasComMoeda.length;
      if (multi > 0.3) return 0;
    }

    // Mesma armadilha em duas colunas: Proventos à esquerda e Descontos à direita,...
    const RE_SEGUNDA_TABELA = new RegExp(
      '^[^:]*?' + RE_DINHEIRO.source + '\\s{4,}[A-Za-zÀ-ÿ]{3,}',
    );
    const lado = texto.split('\n').filter((l) => RE_SEGUNDA_TABELA.test(l)).length;
    if (lado >= 3) return 0;

    let p = 0;
    if (/demonstrativo|recibo\s*de\s*pagamento|holerite|contra[- ]?cheque/i.test(texto)) p += 0.35;
    if (/vencimento|provento|desconto/i.test(texto)) p += 0.25;
    if (RE_INICIO_BASES.test(texto)) p += 0.25;
    if (/inss|fgts|irrf/i.test(texto)) p += 0.15;
    return Math.min(p, 1);
  },

  ler(texto) {
    const linhas = texto.split('\n');
    const fields: Verba[] = [];
    const bases: BaseTotal[] = [];
    let naSecaoDeBases = false;

    for (const linha of linhas) {
      const limpa = linha.trim();
      if (!limpa) continue;

      // A fronteira é encontrada uma vez e não volta atrás: depois que a seção de...
      if (!naSecaoDeBases && RE_INICIO_BASES.test(limpa)) naSecaoDeBases = true;

      // Rodapé de bases: pares "rótulo: valor" na mesma linha, ou a linha de Total/Líquido.
      // Só vale depois que a tabela de verbas começou (fields > 0), nunca no cabeçalho.
      const pares = separarPares(limpa);
      const territorioRodape = fields.length > 0;
      const linhaDeTotais =
        territorioRodape && /^(total|l[íi]q[uü]ido)\b/i.test(limpa) && RE_DINHEIRO.test(limpa);

      if (naSecaoDeBases || (territorioRodape && pares.length > 0) || linhaDeTotais) {
        for (const b of lerBasesDaLinha(limpa, pares)) bases.push(b);
        continue;
      }

      const dinheiro = limpa.match(RE_DINHEIRO_FIM);
      if (!dinheiro) continue;
      const value = dinheiro[0].replace(/\s*[DC]\s*$/, '').trim();

      const antes = limpa.slice(0, limpa.length - dinheiro[0].length).trim();
      if (!antes) continue;

      // Código da verba: dígitos isolados no começo da linha.
      const comCodigo = antes.match(/^(\d{2,6})\s+(.*)$/);
      const code = comCodigo ? comCodigo[1] : '';
      let descricao = comCodigo ? comCodigo[2] : antes;

      // Coluna numérica extra entre a descrição e o valor ("Base / Saldo / Benefício").
      let reference = '';
      const comColunaExtra = descricao.match(
        new RegExp('^(.*?)\\s{2,}(' + RE_DINHEIRO.source + ')\\s*$'),
      );
      if (comColunaExtra && comColunaExtra[1].trim()) {
        descricao = comColunaExtra[1];
        reference = comColunaExtra[2];
      }

      // Coluna de referência (QTDE/REF): número solto no fim da descrição.
      const comRef = descricao.match(/^(.*?)\s+([\d?]+(?:[.,][\d?]+)?)\s*$/);
      if (!reference && comRef && comRef[1].replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3) {
        descricao = comRef[1];
        reference = comRef[2];
      }

      const label = descricao.replace(/[.:\s]+$/, '').trim();
      if (!label) continue;
      fields.push({ code, label, reference, value });
    }

    return { ...lerCompetencia(texto), fields, bases };
  },
};

/** Adicionar um layout novo = acrescentar um objeto aqui. */
export const perfisHolerite: PerfilLayout<PaginaLida>[] = [perfilVertical];

// ---------- Extrator ----------

export function extrairHolerite(paginas: PaginaTexto[]): ValorHolerite {
  const pages: PaginaHolerite[] = [];
  let algumReconhecido = false;

  for (const p of paginas) {
    const { perfil } = escolherPerfil(perfisHolerite, p.texto);
    if (perfil) {
      algumReconhecido = true;
      pages.push({ page: p.page, ...perfil.ler(p.texto, p.page) });
    } else {
      // Página não reconhecida CONTINUA na saída, vazia — vira "página vazia" no aviso...
      pages.push({ page: p.page, year: '????', month: '??', fields: [], bases: [] });
    }
  }

  if (!algumReconhecido) throw new ErroLayoutDesconhecido('holerite');
  return { pages };
}
