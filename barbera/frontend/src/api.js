// Cliente HTTP mínimo. A sessão vive num cookie HTTP-only, então toda chamada
// vai com credentials: 'include' e nenhum token passa pelo JavaScript.
const BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function messageFrom(data) {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return 'Confira os dados preenchidos.';
  return 'Algo deu errado. Tente novamente.';
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, messageFrom(data));
  return data;
}

// Datas no fuso do navegador: toISOString() converteria para UTC e, à noite,
// "hoje" viraria amanhã.
export function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const money = (v) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const longDate = (iso) =>
  parseIso(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export const shortDate = (iso) =>
  parseIso(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

export function isUpcoming(b) {
  return b.status === 'confirmed' && `${b.date}T${b.time}` >= `${isoDate(new Date())}T${new Date().toTimeString().slice(0, 5)}`;
}
