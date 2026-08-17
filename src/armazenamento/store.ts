import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config';
import type { Transcricao } from '../tipos';

/** Armazenamento em disco: um JSON de metadados + o PDF, por transcrição. */

function dirTranscricao(id: string): string {
  return path.join(config.dataDir, id);
}

function arquivoMeta(id: string): string {
  return path.join(dirTranscricao(id), 'meta.json');
}

export function novoId(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export async function iniciar(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function salvarPdf(id: string, buffer: Buffer): Promise<string> {
  await fs.mkdir(dirTranscricao(id), { recursive: true });
  const destino = path.join(dirTranscricao(id), 'original.pdf');
  await fs.writeFile(destino, buffer);
  return destino;
}

export async function gravar(t: Transcricao): Promise<void> {
  await fs.mkdir(dirTranscricao(t.id), { recursive: true });
  // Grava em arquivo temporário e renomeia: evita ler um JSON pela metade se o...
  const tmp = arquivoMeta(t.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(t));
  await fs.rename(tmp, arquivoMeta(t.id));
}

export async function ler(id: string): Promise<Transcricao | null> {
  // Barra travessia de path: o id vem da URL.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return null;
  try {
    const bruto = await fs.readFile(arquivoMeta(id), 'utf8');
    return JSON.parse(bruto) as Transcricao;
  } catch {
    return null;
  }
}

/** Apaga tudo que passou da janela de retenção. */
export async function limpar(): Promise<number> {
  const limite = Date.now() - config.retencaoHoras * 3600_000;
  let removidos = 0;
  let entradas: string[];
  try {
    entradas = await fs.readdir(config.dataDir);
  } catch {
    return 0;
  }
  for (const id of entradas) {
    const t = await ler(id);
    if (t && t.criadoEm < limite) {
      await fs.rm(dirTranscricao(id), { recursive: true, force: true });
      removidos++;
    }
  }
  return removidos;
}

export function agendarLimpeza(): NodeJS.Timeout {
  const timer = setInterval(() => {
    limpar().catch((e) => console.error('[limpeza] falhou:', e.message));
  }, 3600_000);
  timer.unref();
  return timer;
}
