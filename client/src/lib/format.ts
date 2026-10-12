/** Форматирование: даты из UTC в местное время Атырау, числа по-русски. */

const TZ = 'Asia/Atyrau';

export function fmtDateTime(utc: string | null | undefined): string {
  if (!utc) return '—';
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return utc;
  return d.toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(utc: string | null | undefined): string {
  if (!utc) return '—';
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleDateString('ru-RU', { timeZone: TZ });
}

export function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₸';
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
