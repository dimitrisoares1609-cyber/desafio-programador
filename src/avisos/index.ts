import type {
  TipoDocumento,
  ValorCartaoPonto,
  ValorHolerite,
  ValorTranscricao,
} from '../tipos';

/** Avisos são DERIVADOS, nunca armazenados. */

export type Severidade = 'amarelo' | 'vermelho';

export interface Aviso {
  /** Índice da linha na ordem do documento, 0-indexado. */
  linha: number;
  severidade: Severidade;
  motivo: string;
}

/** Vermelho ganha de amarelo quando os dois valem para a mesma linha. */
export function consolidar(avisos: Aviso[]): Map<number, Aviso> {
  const motivos = new Map<number, string[]>();
  const severidades = new Map<number, Severidade>();

  for (const a of avisos) {
    // A COR mais grave ganha, mas os MOTIVOS se acumulam.
    if (severidades.get(a.linha) !== 'vermelho') {
      severidades.set(a.linha, a.severidade);
    }
    const lista = motivos.get(a.linha) ?? [];
    if (!lista.includes(a.motivo)) lista.push(a.motivo);
    motivos.set(a.linha, lista);
  }

  const porLinha = new Map<number, Aviso>();
  for (const [linha, lista] of motivos) {
    porLinha.set(linha, {
      linha,
      severidade: severidades.get(linha)!,
      motivo: lista.join('; '),
    });
  }
  return porLinha;
}

function contemIncerteza(...valores: string[]): boolean {
  return valores.some((v) => v.includes('?'));
}

// ---------- Cartão de ponto ----------

interface DataQuebrada {
  dia: number;
  mes: number;
  ano: number;
}

export function parseData(raw: string): DataQuebrada | null {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : 0;
  if (mes < 1 || mes > 12) return null;
  const ultimoDia = ano ? new Date(ano, mes, 0).getDate() : 31;
  if (dia < 1 || dia > ultimoDia) return null;
  return { dia, mes, ano };
}

function emDias(d: DataQuebrada): number {
  return Math.floor(Date.UTC(d.ano || 2000, d.mes - 1, d.dia) / 86_400_000);
}

export function avisosCartaoPonto(valor: ValorCartaoPonto): Aviso[] {
  const avisos: Aviso[] = [];
  let linha = 0;
  let anterior: DataQuebrada | null = null;

  for (const pagina of valor.pages) {
    for (const dia of pagina.days) {
      if (dia.punches.length % 2 !== 0) {
        avisos.push({
          linha,
          severidade: 'amarelo',
          motivo: `Batidas ímpares (${dia.punches.length}) — falta uma entrada ou uma saída`,
        });
      }

      const incerto = contemIncerteza(
        dia.date_raw,
        ...dia.punches.flatMap((p) => [p.time_raw, p.time_hhmm]),
      );
      if (incerto) {
        avisos.push({
          linha,
          severidade: 'amarelo',
          motivo: 'Caractere não lido com segurança nesta linha',
        });
      }

      const atual = parseData(dia.date_raw);
      if (!atual) {
        // Data que não existe no calendário é erro de leitura, não data.
        avisos.push({
          linha,
          severidade: 'vermelho',
          motivo: `Data impossível ou ilegível: "${dia.date_raw}"`,
        });
      } else {
        if (anterior && emDias(atual) - emDias(anterior) !== 1) {
          avisos.push({
            linha,
            severidade: 'vermelho',
            motivo: `Data não sequencial — a linha anterior legível é ${String(anterior.dia).padStart(2, '0')}/${String(anterior.mes).padStart(2, '0')}`,
          });
        }
        anterior = atual;
      }
      linha++;
    }
  }
  return avisos;
}

// ---------- Holerite ----------

export function avisosHolerite(valor: ValorHolerite): Aviso[] {
  const avisos: Aviso[] = [];
  let anterior: { ano: number; mes: number } | null = null;

  valor.pages.forEach((pagina, linha) => {
    if (pagina.fields.length === 0 && pagina.bases.length === 0) {
      avisos.push({
        linha,
        severidade: 'amarelo',
        motivo: 'Página vazia — a página existe no PDF mas nenhum dado saiu dela',
      });
    }

    const incerto = contemIncerteza(
      pagina.year,
      pagina.month,
      ...pagina.fields.flatMap((f) => [f.code, f.label, f.reference, f.value]),
      ...pagina.bases.flatMap((b) => [b.label, b.value]),
    );
    if (incerto) {
      avisos.push({
        linha,
        severidade: 'amarelo',
        motivo: 'Caractere não lido com segurança nesta página',
      });
    }

    const legivel =
      /^\d{4}$/.test(pagina.year) &&
      /^\d{2}$/.test(pagina.month) &&
      Number(pagina.month) >= 1 &&
      Number(pagina.month) <= 12;

    if (legivel) {
      const atual = { ano: Number(pagina.year), mes: Number(pagina.month) };
      if (anterior) {
        const meses = (atual.ano - anterior.ano) * 12 + (atual.mes - anterior.mes);
        // Dezembro → janeiro conta como consecutivo, o que a conta em meses já resolve...
        if (meses !== 1) {
          avisos.push({
            linha,
            severidade: 'vermelho',
            motivo: `Mês não sequencial — a competência legível anterior é ${String(anterior.mes).padStart(2, '0')}/${anterior.ano}`,
          });
        }
      }
      // Só avança a cadeia com competência legível: página ilegível não quebra a...
      anterior = atual;
    }
  });
  return avisos;
}

export function avisosPara(
  tipo: TipoDocumento,
  valor: ValorTranscricao,
): Map<number, Aviso> {
  const brutos =
    tipo === 'cartao-ponto'
      ? avisosCartaoPonto(valor as ValorCartaoPonto)
      : avisosHolerite(valor as ValorHolerite);
  return consolidar(brutos);
}
