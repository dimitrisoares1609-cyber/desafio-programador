import { TIPOS_VALIDOS, type TipoDocumento } from '../tipos';

/** Um .txt renomeado para .pdf não pode virar transcrição. */
export function pareceUmPdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  // A assinatura %PDF- pode não estar no offset 0: a spec permite lixo antes do...
  const inicio = buffer.subarray(0, 1024).toString('latin1');
  return inicio.includes('%PDF-');
}

export function tipoValido(valor: unknown): valor is TipoDocumento {
  return typeof valor === 'string' && TIPOS_VALIDOS.includes(valor as TipoDocumento);
}

/** Valida o formato do `value` recebido no PUT antes de substituir a transcrição. */
export function valuePlausivel(tipo: TipoDocumento, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const pages = (value as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return false;

  return pages.every((p: unknown) => {
    if (!p || typeof p !== 'object') return false;
    const pagina = p as Record<string, unknown>;
    if (typeof pagina.page !== 'number') return false;
    if (tipo === 'cartao-ponto') return Array.isArray(pagina.days);
    return Array.isArray(pagina.fields) && Array.isArray(pagina.bases);
  });
}
