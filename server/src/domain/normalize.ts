/**
 * Нормализация текста, адресов, чисел и технических обозначений.
 * Нормализованные значения используются ТОЛЬКО для поиска и сопоставления —
 * исходные значения всегда сохраняются без изменений.
 *
 * Важно: в JavaScript `\b` не работает с кириллицей, поэтому границы слов
 * задаются через (?<![\p{L}\d]) и (?![\p{L}\d]).
 */

const KZ_FOLD: Record<string, string> = {
  'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и', 'ё': 'е', 'э': 'е',
};

/** Нижний регистр, казахские буквы → русские аналоги, сжатие пробелов. */
export function fold(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/[әғқңөұүһіёэ]/g, (c) => KZ_FOLD[c])
    .replace(/[ \s]+/g, ' ')
    .trim();
}

/** Значение пустое: null, пустая строка, «-», «—». */
export function isBlank(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === '' || s === '-' || s === '—' || s === '–';
}

/** Очистка строки: обрезка и сжатие пробелов, без изменения содержания. */
export function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[ \s]+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * Разбор числа из ячейки. Поддерживает «37,284,579.64», «28 276 602,48», «1,383», «4.000».
 * Одиночная запятая — десятичный разделитель (принято в РК).
 */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[ \s]/g, '');
  if (s === '' || s === '-') return null;
  if (!/^[-+]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas && dots) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (commas > 1) {
    s = s.replace(/,/g, '');
  } else if (commas === 1) {
    s = s.replace(',', '.');
  } else if (dots > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Целое число, если значение — число без дробной части. */
export function parseInt0(v: unknown): number | null {
  const n = parseNumber(v);
  return n != null && Number.isInteger(n) ? n : null;
}

/** Первый четырёхзначный год (1800–2100) в строке. */
export function parseYear(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/(?<!\d)(18|19|20)\d{2}(?!\d)/);
  if (!m) return null;
  const y = Number(m[0]);
  return y >= 1800 && y <= 2100 ? y : null;
}

// ─────────────────────────── Адреса ───────────────────────────

const L = String.raw`(?<![\p{L}\d])`;
const R = String.raw`(?![\p{L}\d])`;

/** Регулярное выражение для отдельного слова. */
function word(src: string): RegExp {
  return new RegExp(L + '(?:' + src + ')' + R, 'gu');
}

const ADDRESS_NOISE: RegExp[] = [
  /\([^)]*\)?/g,                                   // пояснения в скобках: «(лифт)», «(2 жеделсаты)»
  /кап\.?\s*ремонт\)?/g,
  /\d+\s*-?\s*й?\s*-?\s*подъезд/g,
  /подъезд/g,
  /кошеси/g,                                        // көшесі (в т.ч. слитно: «Владимирскийкөшесі»)
  word('коше'),
  new RegExp(L + String.raw`[ым]\s*[./]\s*а` + R, 'gu'), // ы.а, ы/а, м/а (шағын аудан)
  new RegExp(L + String.raw`(?:ул|мкр|пр|пос|с|п|г)\.\s*`, 'gu'), // «ул.», «мкр.», «п.», «с.»
  word('уй'), word('дом'), word('улица'), word('ул'), word('мкр'), word('микрорайон'),
  word('пр'), word('проспект'), word('жк'), word('пос'), word('поселок'), word('село'),
  /№/g, word('лифт'), word(String.raw`жеделсат\p{L}*`),
];

const ADDRESS_SYNONYMS: [RegExp, string][] = [
  [word(String.raw`вокзал\s+маны`), 'привокзальный'],
  [word('вокзал'), 'привокзальный'],
  [word(String.raw`прив\s*/\s*й`), 'привокзальный'],
  [word(String.raw`атырау\s+каласы`), ''],
];

const SETTLEMENT_RE = new RegExp(String.raw`^(?:п\.|пос|село|с\.|с\s|аул)|` + L + 'село' + R, 'u');

const VOWEL_END = /[аеиоуыэюяйь]$/;

/** Основа слова: отбрасываем конечные гласные/«й» (Абая ≈ Абай, Сатпаева ≈ Сатпаев) и берём 5 первых букв. */
export function stem(w0: string): string {
  let w = w0;
  while (w.length > 3 && VOWEL_END.test(w)) w = w.slice(0, -1);
  return w.slice(0, 5);
}

export interface AddressParts {
  /** Ключ здания: «улица/мкр + номер дома», null — если номер дома не найден. */
  buildingKey: string | null;
  /** Ключ территории (улица или микрорайон без номера дома). */
  areaKey: string | null;
  street: string | null;
  house: string | null;
  isSettlement: boolean;
}

/** Токены адреса после нормализации. Числа и буквенные индексы домов («25 а» → «25а») объединяются. */
function addressTokens(raw: string): string[] {
  let s = fold(raw);
  for (const [re, rep] of ADDRESS_SYNONYMS) s = s.replace(re, rep);
  for (const re of ADDRESS_NOISE) s = s.replace(re, ' ');
  s = s.replace(/[«»"'`,;:]/g, ' ').replace(/[-–—]/g, ' ').replace(/\.(?!\d)/g, ' ');
  s = s.replace(/(\d)\s+([а-я])(?=\s|$)/g, '$1$2'); // «48 д» → «48д»
  s = s.replace(/([а-я]{2,})(\d)/g, '$1 $2');        // «авангард2» → «авангард 2»
  return s.split(/\s+/).filter(Boolean);
}

export function parseAddress(raw: unknown): AddressParts {
  const empty: AddressParts = { buildingKey: null, areaKey: null, street: null, house: null, isSettlement: false };
  const src = clean(raw);
  if (!src) return empty;
  const isSettlement = SETTLEMENT_RE.test(fold(src));
  const tokens = addressTokens(src).map((t) => (/^\d/.test(t) ? t : stem(t))).filter((t) => t !== '');
  if (!tokens.length) return { ...empty, isSettlement };
  // номер дома — последний числовой токен
  let houseIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d/.test(tokens[i])) { houseIdx = i; break; }
  }
  const hasLetters = tokens.some((t) => /^[а-яa-z]/.test(t));
  if (houseIdx <= 0 || !hasLetters) {
    const areaKey = tokens.join(' ');
    return { ...empty, areaKey, street: areaKey, isSettlement };
  }
  // «курмангазы 1а блок 6» — номер дома включает блок
  let houseStart = houseIdx;
  if (houseIdx >= 2 && tokens[houseIdx - 1] === 'блок' && /^\d/.test(tokens[houseIdx - 2])) houseStart = houseIdx - 2;
  const areaTokens = tokens.slice(0, houseStart);
  if (!areaTokens.some((t) => /^[а-яa-z]/.test(t))) {
    const areaKey = tokens.join(' ');
    return { ...empty, areaKey, street: areaKey, isSettlement };
  }
  const house = tokens.slice(houseStart).join(' ');
  const areaKey = areaTokens.join(' ');
  return { buildingKey: `${areaKey} ${house}`, areaKey, street: areaKey, house, isSettlement };
}

/** Ключ территории для «места нахождения» энергообъекта (микрорайон, посёлок, ориентир). */
export function parseArea(raw: unknown): { areaKey: string | null; isSettlement: boolean } {
  const src = clean(raw);
  if (!src) return { areaKey: null, isSettlement: false };
  const isSettlement = SETTLEMENT_RE.test(fold(src));
  const tokens = addressTokens(src).map((t) => (/^\d/.test(t) ? t : stem(t)));
  return { areaKey: tokens.length ? tokens.join(' ') : null, isSettlement };
}

/** Отображаемое название улицы/микрорайона из адреса здания: «Авангард-2, 13» → «Авангард-2». */
export function streetDisplay(raw: string): string {
  const s = raw.replace(/[,\s]*(?:дом\s*)?(?:№\s*)?\d+\s*[а-яa-z]?(?:\s*,?\s*блок.*)?\s*$/iu, '').trim();
  return s || raw;
}

// ─────────────────────── Электротехнические обозначения ───────────────────────

/** Обозначения напряжения («10/0,4кВ», «110/35/10 кВ»), чтобы не путать их с номерами ТП. «кВА» не затрагивается. */
const VOLTAGE_RE = /\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*\s*к\s*[вb](?![а-яёa-z])\.?/gi;

export function extractVoltage(name: string): string | null {
  const m = name.match(/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*)\s*к\s*[вb](?![а-яёa-z])/i);
  return m ? m[1].replace(/\s+/g, '').replace('.', ',') : null;
}

export function stripVoltage(name: string): string {
  return name.replace(VOLTAGE_RE, ' ');
}

const TP_TYPE_RE = /(?<![А-Я])(БКТПНГ|БКТПН|БКТП|КТПНГ|КТПГ|КТПН|КТП|ЗТП|КРУН|ТП)(?![А-Я])/;

export interface TpInfo {
  equipmentType: string | null;
  code: string | null;
}

/** «КТПнГ-84/8» → {КТПНГ, 84/8}; «ТП-10/0,4 кВ №23» → {ТП, 23}; «ТП 005/1» → {ТП, 005/1}. */
export function parseTpName(name: string): TpInfo {
  const s = stripVoltage(name).toUpperCase();
  const t = s.match(TP_TYPE_RE);
  const rest = t ? s.slice(t.index! + t[0].length) : s;
  const c = rest.match(/(\d+(?:\s*\/\s*\d+)?)/);
  return {
    equipmentType: t ? t[1] : null,
    code: c ? c[1].replace(/\s+/g, '') : null,
  };
}

/** Номер РП / ПС из наименования: «РП-10/0,4кВ №32» → 32, «110/10кВ ПС-51 «Нурсая»» → 51. */
export function parseUnitCode(name: string, prefix: 'РП' | 'ПС'): string | null {
  const s = stripVoltage(name).toUpperCase();
  const m = s.match(new RegExp(prefix + String.raw`\s*-?\s*№?\s*(\d+)`));
  if (m) return m[1];
  const n = s.match(/№\s*(\d+)/);
  return n ? n[1] : null;
}

/** Все ссылки на ТП/КТП в наименовании линии: «между КТПН-550/3 до КТПН-550/4» → [550/3, 550/4]. */
export function findTpRefs(name: string): string[] {
  const s = stripVoltage(name).toUpperCase();
  const out: string[] = [];
  const re = /(?:Б?КТП[А-Я]*|ЗТП|ТП)\s*[-–№\s]*\s*№?\s*(\d+\s*\/\s*\d+)/g;
  for (const m of s.matchAll(re)) {
    const code = m[1].replace(/\s+/g, '');
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** Номера жилых домов в наименовании кабеля: «КЛ-0,4кВ ж/д №19, №17 от ТП 22/1» → [19, 17]. */
export function findHouseRefs(name: string): string[] {
  const m = name.match(/ж\/д\s*(.*)$/i);
  if (!m) return [];
  const tail = m[1].split(/\s+от\s+/i)[0];
  const out: string[] = [];
  for (const h of tail.matchAll(/№\s*(\d+)\s*-?\s*([а-я])?(?![\d])/gi)) out.push(h[1] + (h[2] ? h[2].toLowerCase() : ''));
  return out;
}

/** Ссылки на подстанции: «ПС-100 Ф-637», «от ПС-17». */
export function findPsRefs(name: string): string[] {
  const s = stripVoltage(name).toUpperCase();
  const out: string[] = [];
  for (const m of s.matchAll(/(?<![А-Я])ПС\s*-?\s*№?\s*(\d+)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Ссылки на распределительные пункты: «до РП-21», «до РП-36.». */
export function findRpRefs(name: string): string[] {
  const s = stripVoltage(name).toUpperCase();
  const out: string[] = [];
  for (const m of s.matchAll(/(?<![А-Я])РП\s*-?\s*№?\s*(\d+)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Номера фидеров 6/10/35 кВ: «Ф№196Ш», «Фидер №207 «Д»», «ф 467», «Ф 013 Ф016», «ф.190». */
export function findFeeders(name: string): string[] {
  const s = stripVoltage(name).toUpperCase().replace(/[«»"]/g, ' ');
  const out: string[] = [];
  const re = /(?<![А-Я])Ф(?:ИДЕР)?\s*\.?\s*(?:№\s*)?-?\s*(\d{2,4})(?:\s*([ДШЦ])(?![А-Я]))?/g;
  for (const m of s.matchAll(re)) {
    const code = m[1] + (m[2] ?? '');
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export interface PowerInfo {
  count: number | null;
  unitKva: number | null;
  totalKva: number | null;
  ambiguous: boolean;
}

/** Мощность трансформаторов: «2-х 16000кВа» → 2×16000; «630 кВа» → 1×630; «2х400,630» → неоднозначно. */
export function parsePower(v: unknown): PowerInfo {
  const res: PowerInfo = { count: null, unitKva: null, totalKva: null, ambiguous: false };
  if (v == null || String(v).trim() === '') return res;
  if (typeof v === 'number') return { count: 1, unitKva: v, totalKva: v, ambiguous: false };
  let s = fold(v).replace(/(\d)\s*-\s*х/g, '$1х').replace(/\s+/g, '');
  s = s.replace(/к?в?[аaя]$/, '').replace(/кв$/, '');
  const m = s.match(/^(?:(\d+)[хx×*])?(\d+)$/);
  if (!m) return { ...res, ambiguous: true };
  const count = m[1] ? Number(m[1]) : 1;
  const unit = Number(m[2]);
  return { count, unitKva: unit, totalKva: count * unit, ambiguous: false };
}

/** Текст для полнотекстового поиска. */
export function searchText(parts: unknown[]): string {
  return fold(parts.filter((p) => p != null && p !== '').map(String).join(' | '));
}
