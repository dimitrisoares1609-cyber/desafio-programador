/** Tipos do contrato de saída. */

export type TipoDocumento = 'cartao-ponto' | 'holerite';

export const TIPOS_VALIDOS: TipoDocumento[] = ['cartao-ponto', 'holerite'];

// ---------- Cartão de ponto ----------

export interface Batida {
  kind: 'IN' | 'OUT';
  time_raw: string;
  time_hhmm: string;
}

export interface Dia {
  date_raw: string;
  punches: Batida[];
}

export interface PaginaCartao {
  page: number;
  days: Dia[];
}

export interface ValorCartaoPonto {
  pages: PaginaCartao[];
}

// ---------- Holerite ----------

export interface Verba {
  code: string;
  label: string;
  reference: string;
  value: string;
}

export interface BaseTotal {
  label: string;
  value: string;
}

export interface PaginaHolerite {
  page: number;
  year: string;
  month: string;
  fields: Verba[];
  bases: BaseTotal[];
}

export interface ValorHolerite {
  pages: PaginaHolerite[];
}

export type ValorTranscricao = ValorCartaoPonto | ValorHolerite;

// ---------- Estado da transcrição ----------

export type StatusTranscricao = 'processando' | 'concluido' | 'erro';

export interface Transcricao {
  id: string;
  tipo: TipoDocumento;
  status: StatusTranscricao;
  erro: string | null;
  value: ValorTranscricao | null;
  /** Interno — nunca sai na resposta da API. */
  caminhoPdf?: string;
  criadoEm: number;
}

/** A forma exata que o GET devolve. */
export function respostaApi(t: Transcricao) {
  return {
    id: t.id,
    tipo: t.tipo,
    status: t.status,
    erro: t.erro,
    value: t.status === 'concluido' ? t.value : null,
  };
}
