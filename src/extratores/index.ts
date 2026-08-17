import type { PaginaTexto } from '../pipeline/paginas';
import type { TipoDocumento, ValorTranscricao } from '../tipos';
import { extrairCartaoPonto } from './cartaoPonto';
import { extrairHolerite } from './holerite';

/** A ÚNICA coisa que varia entre cartão de ponto e holerite na leitura. */
export interface Extrator {
  extrair(paginas: PaginaTexto[]): ValorTranscricao;
}

const extratores: Record<TipoDocumento, Extrator> = {
  'cartao-ponto': { extrair: extrairCartaoPonto },
  holerite: { extrair: extrairHolerite },
};

export function extratorPara(tipo: TipoDocumento): Extrator {
  return extratores[tipo];
}
