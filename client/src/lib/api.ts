/** Клиент API. Все запросы идут на тот же сайт; cookie сессии — httpOnly, недоступна из JS. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = (status: number, code?: string) => void;
const listeners = new Set<Listener>();
export function onAuthProblem(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'zhkh',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status, data?.code);
    if (res.status === 401 || data?.code === 'MUST_CHANGE_PASSWORD') listeners.forEach((l) => l(res.status, data?.code));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body ?? {}),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form),
};

/** Скачивание файла (экспорт Excel и т.п.) с сохранением имени из заголовка. */
export async function download(url: string): Promise<void> {
  const res = await fetch(`/api${url}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'zhkh' } });
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch { /* не JSON */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) ?? cd.match(/filename="([^"]+)"/);
  const name = m ? decodeURIComponent(m[1]) : 'download';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)) continue;
    p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
