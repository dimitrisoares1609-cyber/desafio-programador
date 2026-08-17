import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config';

const exec = promisify(execFile);

export type OrigemTexto = 'camada-texto' | 'ocr';

export interface PaginaTexto {
  /** 1-indexado, como o contrato de saída exige. */
  page: number;
  texto: string;
  origem: OrigemTexto;
}

/** O Tesseract devolve uma confiança de 0 a 100 para cada palavra que leu. */
export const CONFIANCA_MINIMA = 70;

/** Heurística de "esta página tem camada de texto útil?". */
const MIN_CARACTERES_CAMADA_TEXTO = 80;

export function temCamadaTextoUtil(texto: string): boolean {
  const uteis = texto.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').length;
  return uteis >= MIN_CARACTERES_CAMADA_TEXTO;
}

async function contarPaginas(pdf: string): Promise<number> {
  const { stdout } = await exec('pdfinfo', [pdf]);
  const m = stdout.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error('não foi possível ler o número de páginas do PDF');
  return Number(m[1]);
}

async function textoDaPagina(pdf: string, pagina: number): Promise<string> {
  // -layout preserva o alinhamento em colunas, que é o que permite localizar as...
  const { stdout } = await exec('pdftotext', [
    '-layout',
    '-f', String(pagina),
    '-l', String(pagina),
    pdf,
    '-',
  ]);
  return stdout;
}

interface PalavraOcr {
  texto: string;
  conf: number;
  linha: number;
  esquerda: number;
  largura: number;
}

/** Lê o TSV do Tesseract, que traz uma linha por palavra com a confiança. */
function lerTsv(tsv: string): PalavraOcr[] {
  // \r?\n: em alguns ambientes (Windows) o Tesseract emite TSV com \r\n, e o \r
  // grudado em "text" quebraria o indexOf do cabeçalho.
  const linhas = tsv.split(/\r?\n/);
  const cab = linhas[0].split('\t');
  const iConf = cab.indexOf('conf');
  const iTexto = cab.indexOf('text');
  const iEsq = cab.indexOf('left');
  const iLarg = cab.indexOf('width');
  const iTopo = cab.indexOf('top');
  if (iConf < 0 || iTexto < 0) return [];

  const palavras: PalavraOcr[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split('\t');
    const texto = (c[iTexto] ?? '').trim();
    if (!texto) continue;
    palavras.push({
      texto,
      conf: Number(c[iConf]),
      linha: Math.round(Number(c[iTopo]) / 12), // agrupa por faixa vertical
      esquerda: Number(c[iEsq]),
      largura: Number(c[iLarg]),
    });
  }
  return palavras;
}

/** Remonta o texto da página preservando as colunas. */
function remontarTexto(palavras: PalavraOcr[]): string {
  if (palavras.length === 0) return '';

  // Largura média de um caractere, para converter pixels em colunas de texto.
  const larguras = palavras
    .filter((p) => p.texto.length > 0)
    .map((p) => p.largura / p.texto.length)
    .sort((a, b) => a - b);
  const larguraChar = larguras[Math.floor(larguras.length / 2)] || 10;

  const porLinha = new Map<number, PalavraOcr[]>();
  for (const p of palavras) {
    const lista = porLinha.get(p.linha) ?? [];
    lista.push(p);
    porLinha.set(p.linha, lista);
  }

  const saida: string[] = [];
  for (const chave of [...porLinha.keys()].sort((a, b) => a - b)) {
    const daLinha = porLinha.get(chave)!.sort((a, b) => a.esquerda - b.esquerda);
    let linha = '';
    for (const p of daLinha) {
      const coluna = Math.round(p.esquerda / larguraChar);
      if (coluna > linha.length) linha += ' '.repeat(coluna - linha.length);
      else if (linha.length > 0) linha += ' ';
      linha += p.conf < CONFIANCA_MINIMA ? '?'.repeat(p.texto.length) : p.texto;
    }
    saida.push(linha);
  }
  return saida.join('\n');
}

async function ocrDaPagina(pdf: string, pagina: number): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-ocr-'));
  try {
    const prefixo = path.join(tmp, 'pag');
    // 300 dpi é o mínimo em que o Tesseract lê holerite matricial de forma estável.
    await exec('pdftoppm', [
      '-r', '300',
      '-gray',
      '-f', String(pagina),
      '-l', String(pagina),
      '-png',
      pdf,
      prefixo,
    ]);
    const arquivos = (await fs.readdir(tmp)).filter((f) => f.endsWith('.png'));
    if (arquivos.length === 0) throw new Error('rasterização não produziu imagem');
    const imagem = path.join(tmp, arquivos[0]);
    // tsv em vez de texto puro: é o formato que traz a confiança por palavra e a...
    const { stdout } = await exec('tesseract', [
      imagem,
      'stdout',
      '-l', process.env.TESSERACT_LANG ?? 'por',
      '--psm', '6',
      'tsv',
    ], { maxBuffer: 32 * 1024 * 1024 });
    return remontarTexto(lerTsv(stdout));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Devolve o texto de cada página, caindo para OCR quando a página não tem camada de... */
export async function extrairPaginas(pdf: string): Promise<PaginaTexto[]> {
  const total = await contarPaginas(pdf);
  if (total > config.maxPaginas) {
    throw new Error(
      `PDF com ${total} páginas excede o limite de ${config.maxPaginas}`,
    );
  }

  const paginas: PaginaTexto[] = [];
  for (let p = 1; p <= total; p++) {
    const embutido = await textoDaPagina(pdf, p);
    if (temCamadaTextoUtil(embutido)) {
      paginas.push({ page: p, texto: embutido, origem: 'camada-texto' });
    } else {
      paginas.push({ page: p, texto: await ocrDaPagina(pdf, p), origem: 'ocr' });
    }
  }
  return paginas;
}
