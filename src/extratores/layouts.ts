/** Registro de perfis de layout. */

export interface PerfilLayout<T> {
  /** Identificador legível — aparece no log e na mensagem de erro. */
  nome: string;
  /** Quão bem este perfil reconhece a página, de 0 a 1. */
  reconhece(texto: string): number;
  /** Lê a página. */
  ler(texto: string, page: number): T;
}

/** Abaixo disso, nenhum perfil realmente reconheceu a página. */
export const LIMIAR_RECONHECIMENTO = 0.35;

export class ErroLayoutDesconhecido extends Error {
  constructor(public readonly tipo: string) {
    super(
      'Não reconheci o layout deste documento. ' +
        'A transcrição foi recusada em vez de devolver dados possivelmente errados.',
    );
    this.name = 'ErroLayoutDesconhecido';
  }
}

export interface Escolha<T> {
  perfil: PerfilLayout<T> | null;
  pontuacao: number;
}

export function escolherPerfil<T>(
  perfis: PerfilLayout<T>[],
  texto: string,
): Escolha<T> {
  let melhor: PerfilLayout<T> | null = null;
  let pontuacao = 0;
  for (const perfil of perfis) {
    const p = perfil.reconhece(texto);
    if (p > pontuacao) {
      pontuacao = p;
      melhor = perfil;
    }
  }
  return pontuacao >= LIMIAR_RECONHECIMENTO
    ? { perfil: melhor, pontuacao }
    : { perfil: null, pontuacao };
}
