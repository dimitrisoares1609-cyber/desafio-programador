import type { PerfilLayout } from '../layouts';
import type { Batida, Dia } from '../../tipos';
import { horaPlausivel, normalizarHora } from '../cartaoPonto';

/** SIPON — "FOLHA DE FREQUENCIA - SISTEMA DE PONTO ELETRONICO". */

const RE_CABECALHO = /^\s*Dia\s+Semana\s+Jornada\s+Entrada\s+Saida/i;
const RE_DIA = /^\s*(\d{1,2})\s*-\s*[A-ZÇ]{3}\b/;

interface Colunas {
  entrada: number;
  saida: number;
  fimSaida: number;
}

function acharColunas(linhas: string[]): Colunas | null {
  const cab = linhas.find((l) => RE_CABECALHO.test(l));
  if (!cab) return null;
  const entrada = cab.indexOf('Entrada');
  const saida = cab.indexOf('Saida');
  const ocorrencia = cab.search(/Ocorrencia/i);
  if (entrada < 0 || saida < 0) return null;
  return { entrada, saida, fimSaida: ocorrencia > 0 ? ocorrencia : saida + 12 };
}

/** Fatia com folga: valor alinhado à direita começa antes da coluna nominal. */
function fatiar(linha: string, de: number, ate: number): string {
  const FOLGA = 3;
  return linha.slice(Math.max(0, de - FOLGA), ate + FOLGA);
}

/** Devolve o texto ORIGINAL da fatia — o `_raw` do enunciado. */
function horaEm(trecho: string): string | null {
  const m = trecho.match(/\b([\d?]{1,2}:[\d?]{2})\b/);
  if (!m) return null;
  return horaPlausivel(normalizarHora(m[1])) ? m[1] : null;
}

/** time_raw guarda o que estava impresso e time_hhmm o que foi interpretado. */
function batida(bruto: string, kind: Batida['kind']): Batida {
  return { kind, time_raw: bruto, time_hhmm: normalizarHora(bruto) };
}

export const perfilSipon: PerfilLayout<Dia[]> = {
  nome: 'cartao-sipon',

  reconhece(texto) {
    if (!/SISTEMA\s+DE\s+PONTO\s+ELETRONICO/i.test(texto)) return 0;
    if (!/SIPON/i.test(texto)) return 0.6;
    return acharColunas(texto.split('\n')) ? 1 : 0.7;
  },

  ler(texto) {
    const linhas = texto.split('\n');
    const cols = acharColunas(linhas);
    if (!cols) return [];

    const dias: Dia[] = [];
    let atual: Dia | null = null;

    for (const linha of linhas) {
      if (RE_CABECALHO.test(linha)) continue;

      const marcador = linha.match(RE_DIA);
      const entrada = horaEm(fatiar(linha, cols.entrada, cols.saida));
      const saida = horaEm(fatiar(linha, cols.saida, cols.fimSaida));

      if (marcador) {
        // O documento às vezes repete o número do dia na linha de continuação.
        if (!atual || atual.date_raw !== marcador[1]) {
          atual = { date_raw: marcador[1], punches: [] };
          dias.push(atual);
        }
      } else if (!atual) {
        continue; // linha antes do primeiro dia (cabeçalho do documento)
      }

      if (entrada) atual!.punches.push(batida(entrada, 'IN'));
      if (saida) atual!.punches.push(batida(saida, 'OUT'));
    }
    return dias;
  },
};
