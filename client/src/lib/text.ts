const KZ: Record<string, string> = { 'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и', 'ё': 'е', 'э': 'е' };

/** Нормализация для поиска: нижний регистр, казахские буквы → русские (как на сервере). */
export function fold(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[әғқңөұүһіёэ]/g, (c) => KZ[c]).replace(/\s+/g, ' ').trim();
}
