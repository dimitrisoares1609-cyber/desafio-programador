import { extratorPara } from '../extratores';
import * as store from '../armazenamento/store';
import { extrairPaginas } from './paginas';
import type { Transcricao } from '../tipos';

/** O pipeline não sabe qual é o tipo do documento. */
export async function processar(id: string): Promise<void> {
  const t = await store.ler(id);
  if (!t || !t.caminhoPdf) return;

  try {
    const paginas = await extrairPaginas(t.caminhoPdf);
    const value = extratorPara(t.tipo).extrair(paginas);

    const ocr = paginas.filter((p) => p.origem === 'ocr').length;
    // Log sem PII: id, tipo e contagens.
    console.log(
      `[pipeline] ${id} tipo=${t.tipo} paginas=${paginas.length} ocr=${ocr}`,
    );

    await store.gravar({ ...t, status: 'concluido', erro: null, value });
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    const mensagem = mensagemLegivel(bruto);
    // O detalhe técnico fica no log do servidor; o cliente recebe só a versão legível.
    console.error(`[pipeline] ${id} falhou: ${bruto.slice(0, 200)}`);
    await store.gravar({ ...t, status: 'erro', erro: mensagem, value: null });
  }
}

/** Traduz a falha para algo que o usuário entende, sem devolver caminho de arquivo,... */
function mensagemLegivel(bruto: string): string {
  if (/excede o limite/.test(bruto)) return bruto;
  if (/trailer|xref|Syntax Error|damaged/i.test(bruto)) {
    return 'O PDF está corrompido ou não pôde ser lido';
  }
  if (/ENOENT|not found/i.test(bruto)) {
    return 'Falha interna ao processar o documento';
  }
  return 'Não foi possível processar este PDF';
}

export function atualizarValor(
  t: Transcricao,
  value: unknown,
): Transcricao {
  return { ...t, value: value as Transcricao['value'] };
}
