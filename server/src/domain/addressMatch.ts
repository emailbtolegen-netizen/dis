/**
 * Поиск дома МЖД по адресу из других файлов (например, файла лифтов).
 * Используется только для предложения связей: ключи адресного справочника не меняет,
 * поэтому повторный импорт ранее загруженных файлов не затрагивается.
 *
 * Сопоставление двухступенчатое:
 *  1) точный ключ адреса (как в адресном справочнике);
 *  2) «свободный» ключ — одинаковая очистка ОБЕИХ сторон: без названий ЖК/БЦ, пояснений в скобках,
 *     инициалов, с приведением вариантов написания улиц.
 */
import { fold, parseAddress } from './normalize.ts';

export interface MatchCandidate {
  key: string;
  kind: 'exact' | 'loose' | 'loose-no-block';
  confidence: number;
  note: string;
}

/** В строке перечислено несколько домов: «23,35,27», «42/2, 42», «39Е, 39К», «16а,б», «(6 домов…)». */
export function isMultiAddress(raw: string): boolean {
  if (/\d+\s*домов/i.test(raw)) return true;
  const s = raw.replace(/\([^)]*\)/g, ' ');
  return /\d+\s*[а-яёa-z]?(?:\/\d+)?\s*,\s*(?:\d|[а-яёa-z](?![а-яёa-z]))/iu.test(s);
}

/** Варианты написания одной улицы, встречающиеся в исходных файлах. */
const STREET_SYNONYMS: [RegExp, string][] = [
  [/уалиханов/g, 'валиханов'],
  [/аб[уи]л?\s*ха[йи]?ы?р\s*хан\p{L}*/gu, 'абулхаирхан'],
  [/бибитшилик/g, 'бейбитшилик'],
  [/сарыарк/g, 'сары-арк'],
  [/отемисулы|утемисулы|утемисов\p{L}*/gu, ' '],
];

/** Свободный ключ здания; null — если номер дома не выделяется. */
export function looseBuildingKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = fold(raw)
    .replace(/[«"“][^»"”]*[»"”]/g, ' ')                        // «Номад», "Нью Сити"
    .replace(/\([^)]*\)/g, ' ')                                 // (общежитие), (подъезды 1, 2)
    .replace(/(?<![\p{L}])(жк|бц|кожд|гостиница)(?![\p{L}])/gu, ' ')
    .replace(/(?<![\p{L}])\p{L}\.\s*(?=\p{L}{2})/gu, ' ');      // инициалы: «т.жумагалиева» → «жумагалиева»
  for (const [re, rep] of STREET_SYNONYMS) s = s.replace(re, rep);
  // «мкр.нурсая, ул.габдиева, дом 47» → «ул.габдиева, дом 47»: улица точнее микрорайона
  const street = s.match(/(?:^|[,\s])((?:ул|пр|проспект|улица)\.?\s*[^,\d]+,?\s*(?:дом\s*)?№?\s*\d.*)$/u);
  if (street && street.index && street.index > 0) s = street[1];
  const key = parseAddress(s).buildingKey;
  if (!key) return null;
  // отбрасываем слова после последнего номера: «азатт 68 номад» → «азатт 68»
  const tokens = key.split(' ');
  let last = tokens.length - 1;
  while (last > 0 && !/^\d/.test(tokens[last])) last--;
  return tokens.slice(0, last + 1).join(' ');
}

/** Кандидаты для поиска по убыванию достоверности. Для строк с несколькими домами — пусто. */
export function buildingMatchKeys(raw: string | null | undefined): MatchCandidate[] {
  if (!raw || isMultiAddress(raw)) return [];
  const out: MatchCandidate[] = [];
  const exact = parseAddress(raw).buildingKey;
  if (exact) out.push({ key: exact, kind: 'exact', confidence: 0.85, note: 'Совпадение нормализованного адреса' });
  const loose = looseBuildingKey(raw);
  if (loose) {
    out.push({ key: loose, kind: 'loose', confidence: 0.75, note: 'Совпадение адреса после удаления названия ЖК, инициалов, пояснений и приведения написания улицы — требует проверки' });
    if (loose.includes(' блок ')) out.push({ key: loose.split(' блок ')[0], kind: 'loose-no-block', confidence: 0.5, note: 'Совпадение адреса без учёта номера блока — требует проверки' });
  }
  return out;
}
