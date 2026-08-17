import type { PerfilLayout } from '../layouts';
import type { PaginaLida } from '../holerite';
import type { BaseTotal } from '../../tipos';

/** Recibo de Pagamento com Proventos à esquerda e Descontos à direita, na mesma linha. */

// Valor monetário BR, com "?" nas posições ilegíveis.
const RE_DINHEIRO = /-?[\d?]{1,3}(?:\.[\d?]{3})*,[\d?]{2}/;
const RE_DINHEIRO_G = new RegExp(RE_DINHEIRO.source, 'g');
const RE_DESCRICAO = /Descri[çc][ãa]o/i;

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', 'março': '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
  outubro: '10', novembro: '11', dezembro: '12',
};

/** Total/base, não verba, quando o rótulo fala em provento, desconto ou líquido. */
function ehBase(label: string): boolean {
  return /provento|desconto|l[íi]quido/i.test(label);
}

/** Índice da n-ésima ocorrência de um padrão numa linha (-1 se não houver). */
function indiceNa(linha: string, re: RegExp, n: number): number {
  const g = new RegExp(re.source, 'gi');
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = g.exec(linha))) {
    if (++i === n) return m.index;
  }
  return -1;
}

/** Lê "DESCRIÇÃO ... VALOR" de um lado da linha; o valor fica no fim do lado. */
function lerCelula(lado: string): BaseTotal | null {
  const valores = lado.match(RE_DINHEIRO_G);
  if (!valores) return null;
  const value = valores[valores.length - 1];
  const label = lado.slice(0, lado.lastIndexOf(value)).replace(/\s+/g, ' ').trim();
  if (!label) return null;
  return { label, value };
}

/** Rodapé de bases em duas linhas: rótulos em cima, valores embaixo, em colunas. */
function parearFundo(rotulos: string, valores: string): BaseTotal[] {
  const rot = rotulos.trim().split(/\s{2,}/).filter(Boolean);
  const val = valores.match(RE_DINHEIRO_G) ?? [];
  // Só pareia se as duas linhas têm o mesmo número de colunas — senão não arrisco.
  if (rot.length === 0 || rot.length !== val.length) return [];
  return rot.map((r, i) => ({ label: r.replace(/\s+/g, ' ').trim(), value: val[i] }));
}

/** Competência vem por nome do mês ("SETEMBRO/2019"), não como MM/AAAA. */
function lerCompetencia(texto: string): { year: string; month: string } {
  const m = texto.match(/([A-Za-zçÇ]{3,})\s*\/\s*(\d{4})/);
  if (m) {
    const nome = m[1].toLowerCase();
    if (MESES[nome]) return { month: MESES[nome], year: m[2] };
  }
  return { year: '????', month: '??' };
}

export const perfilReciboPagamento: PerfilLayout<PaginaLida> = {
  nome: 'holerite-recibo-pagamento',

  reconhece(texto) {
    // Marca do layout: sub-cabeçalho com DUAS tabelas (dois "Descrição" ou dois "Valor").
    const doisLados = texto.split('\n').some(
      (l) =>
        (l.match(/Descri[çc][ãa]o/gi) ?? []).length >= 2 ||
        (l.match(/\bValor\b/gi) ?? []).length >= 2,
    );
    if (!doisLados) return 0;
    let p = 0;
    if (/recibo\s+de\s+pagamento/i.test(texto)) p += 0.5;
    if (/proventos/i.test(texto) && /descontos/i.test(texto)) p += 0.4;
    return Math.min(p, 1);
  },

  ler(texto) {
    // Só o PRIMEIRO recibo da página: os dois são vias idênticas (ver SOLUCAO.md).
    const partes = texto.split(/Recibo\s+de\s+Pagamento/i);
    const corpo = partes.length >= 2 ? partes[1] : texto;

    const linhas = corpo.split('\n');
    const subCab = linhas.find((l) => (l.match(/Descri[çc][ãa]o/gi) ?? []).length >= 2);
    const competencia = lerCompetencia(corpo);
    if (!subCab) return { ...competencia, fields: [], bases: [] };

    const corte = indiceNa(subCab, RE_DESCRICAO, 2); // coluna onde começa Descontos
    if (corte < 0) return { ...competencia, fields: [], bases: [] };

    const provVerbas: BaseTotal[] = [], descVerbas: BaseTotal[] = [];
    const provBases: BaseTotal[] = [], descBases: BaseTotal[] = [];
    let fundoBases: BaseTotal[] = [];
    let rotulosFundo = '';

    for (let i = linhas.indexOf(subCab) + 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l.trim()) continue;
      const temDinheiro = RE_DINHEIRO.test(l);
      const temLetra = /[A-Za-zÀ-ÿ]/.test(l);

      // Linha só de números em colunas = valores do rodapé de bases (rótulos vieram acima).
      if (temDinheiro && !temLetra) {
        fundoBases = parearFundo(rotulosFundo, l);
        break;
      }
      // Linha só de texto = candidata a rótulos do rodapé de bases.
      if (!temDinheiro) {
        if (temLetra) rotulosFundo = l;
        continue;
      }
      // Linha da tabela: corta nos dois lados e lê cada um.
      const esq = lerCelula(l.slice(0, corte));
      const dir = lerCelula(l.slice(corte));
      if (esq) (ehBase(esq.label) ? provBases : provVerbas).push(esq);
      if (dir) (ehBase(dir.label) ? descBases : descVerbas).push(dir);
    }

    // fields[] soma os dois lados na ordem do documento: proventos, depois descontos.
    const fields = [...provVerbas, ...descVerbas].map((v) => ({
      code: '', label: v.label, reference: '', value: v.value,
    }));
    const bases = [...provBases, ...descBases, ...fundoBases];
    return { ...competencia, fields, bases };
  },
};
