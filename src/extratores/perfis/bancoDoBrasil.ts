import type { PerfilLayout } from '../layouts';
import type { Batida, Dia } from '../../tipos';
import { horaPlausivel, normalizarHora } from '../cartaoPonto';

/** Banco do Brasil — "PONTO ELETRÔNICO / Relatório Mensal". */

const RE_CABECALHO = /^\s*Dia\s+Entrada\s+Sa[ií]da/im;
/** "01 SAB", "04TER", e também "?? */
const RE_DIA = /^\s*([\d?]{2})( *)([A-ZÇ?]{3})(?=\s|$)/;
/** Horário do documento, ou uma marca de ilegível do tamanho de um horário. */
const RE_HORA = /[\d?]{1,2}:[\d?]{2}|\?{5}/g;

/** No máximo jornada (2) + três intervalos (6). */
const MAX_HORARIOS = 8;

function batida(bruto: string, kind: Batida['kind']): Batida | null {
  // "?????" é um horário que o OCR não leu.
  const texto = /^\?+$/.test(bruto) ? '??:??' : bruto;
  const hhmm = normalizarHora(texto);
  if (!horaPlausivel(hhmm)) return null;
  return { kind, time_raw: texto, time_hhmm: hhmm };
}

export const perfilBancoDoBrasil: PerfilLayout<Dia[]> = {
  nome: 'cartao-banco-do-brasil',

  reconhece(texto) {
    // Os padrões são frouxos de propósito: este layout chega escaneado, e o OCR...
    let p = 0;
    if (/PONTO/i.test(texto) && /ELETR[OÔ]NICO/i.test(texto)) p += 0.4;
    if (/Relat[oóeéô]rio\s+Mensal/i.test(texto)) p += 0.2;
    if (/Descanso\s+Semanal|Sem\s+Registro\s+de\s+Ponto/i.test(texto)) p += 0.3;
    if (RE_CABECALHO.test(texto)) p += 0.3;
    return Math.min(p, 1);
  },

  ler(texto) {
    const dias: Dia[] = [];

    for (const linha of texto.split('\n')) {
      if (RE_CABECALHO.test(linha)) continue;
      const marcador = linha.match(RE_DIA);
      if (!marcador) continue;
      // "?????" do logo ilegível no topo também casa "??
      if (marcador[1] === '??' && marcador[2] === '') continue;

      const resto = linha.slice(marcador[0].length);
      const horarios = (resto.match(RE_HORA) ?? []).slice(0, MAX_HORARIOS);

      // As colunas impressas são [Entrada, Saída, Intervalo 1, Intervalo 2, Intervalo 3].
      const emOrdem =
        horarios.length >= 2
          ? [horarios[0], ...horarios.slice(2), horarios[1]]
          : horarios;

      const punches: Batida[] = [];
      for (const bruto of emOrdem) {
        const b = batida(bruto, punches.length % 2 === 0 ? 'IN' : 'OUT');
        if (b) punches.push(b);
      }

      dias.push({ date_raw: marcador[1], punches });
    }
    return dias;
  },
};
