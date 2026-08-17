import ExcelJS from 'exceljs';
import type { Tabela } from './tabela';

export type Formato = 'xlsx' | 'csv' | 'json';

export const FORMATOS: Formato[] = ['xlsx', 'csv', 'json'];

// Cores literais do enunciado.
const AZUL_CABECALHO = 'FF173772';
const AMARELO = 'FFFFF3CD';
const VERMELHO = 'FFF8D7DA';
const BORDA_VERMELHA = 'FFDC3545';

export async function renderXlsx(tabela: Tabela): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transcrição');

  const cabecalho = ws.addRow(tabela.colunas);
  cabecalho.eachCell((celula) => {
    celula.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celula.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: AZUL_CABECALHO },
    };
  });

  tabela.linhas.forEach((valores, indice) => {
    const linha = ws.addRow(valores);
    const aviso = tabela.avisos.get(indice);
    if (!aviso) return;

    const cor = aviso.severidade === 'vermelho' ? VERMELHO : AMARELO;
    linha.eachCell({ includeEmpty: true }, (celula) => {
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
    });

    if (aviso.severidade === 'vermelho') {
      const primeira = linha.getCell(1);
      primeira.border = {
        ...(primeira.border ?? {}),
        left: { style: 'medium', color: { argb: BORDA_VERMELHA } },
      };
    }

    // O motivo vai como comentário: fica auditável sem virar coluna, já que o...
    linha.getCell(1).note = aviso.motivo;
  });

  ws.columns.forEach((coluna) => {
    coluna.width = Math.max(10, Math.min(28, (coluna.header?.length ?? 10) + 4));
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function escaparCsv(valor: string): string {
  return /[",;\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function renderCsv(tabela: Tabela): Buffer {
  // Separador ";" e BOM: é o que o Excel em pt-BR abre sem passar pelo assistente...
  const linhas = [tabela.colunas, ...tabela.linhas]
    .map((l) => l.map(escaparCsv).join(';'))
    .join('\r\n');
  return Buffer.from('\uFEFF' + linhas, 'utf8');
}

export function renderJson(tabela: Tabela): Buffer {
  const corpo = {
    colunas: tabela.colunas,
    linhas: tabela.linhas,
    // Destaques viajam junto porque no json não existe cor de célula.
    destaques: [...tabela.avisos.entries()].map(([linha, aviso]) => ({
      linha,
      severidade: aviso.severidade,
      motivo: aviso.motivo,
    })),
  };
  return Buffer.from(JSON.stringify(corpo, null, 2), 'utf8');
}

export async function renderizar(
  tabela: Tabela,
  formato: Formato,
): Promise<{ buffer: Buffer; contentType: string; extensao: string }> {
  switch (formato) {
    case 'xlsx':
      return {
        buffer: await renderXlsx(tabela),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extensao: 'xlsx',
      };
    case 'csv':
      return {
        buffer: renderCsv(tabela),
        contentType: 'text/csv; charset=utf-8',
        extensao: 'csv',
      };
    case 'json':
      return {
        buffer: renderJson(tabela),
        contentType: 'application/json; charset=utf-8',
        extensao: 'json',
      };
  }
}
