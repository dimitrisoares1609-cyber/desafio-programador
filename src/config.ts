import path from 'node:path';

function num(nome: string, padrao: number): number {
  const v = process.env[nome];
  if (!v) return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

export const config = {
  porta: num('PORT', 3000),
  /** Onde ficam PDFs e JSONs. */
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'dados'),
  /** Limite duro de upload. */
  maxUploadMb: num('MAX_UPLOAD_MB', 20),
  /** Retenção: tudo é apagado depois desse prazo. */
  retencaoHoras: num('RETENCAO_HORAS', 24),
  /** Quantos PDFs processam em paralelo. */
  concorrencia: num('CONCORRENCIA', 2),
  /** Teto de páginas por PDF — evita que um arquivo gigante trave a fila. */
  maxPaginas: num('MAX_PAGINAS', 60),
};
