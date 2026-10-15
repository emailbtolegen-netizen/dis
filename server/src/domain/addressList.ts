/**
 * Разбор строки со списком домов в отдельные адреса для привязки к МЖД:
 *   «Авангард-4 №3,4»            → Авангард-4, 3 · Авангард-4, 4
 *   «Датов №35А, №35Б В Г»       → Датов, 35А · 35Б · 35В · 35Г
 *   «дома №27-33»                → 27 … 33 (диапазон до 30 домов)
 *   «Өтемісұлы №9-Абай №95,97А»  → Өтемісұлы, 9 · Абай, 95 · Абай, 97А
 *   «Авангард-2 21/22»           → 21 · 22 (второе число больше — это список)
 *   «Абилхайр хан 70/1»          → 70/1 (второе число меньше — это номер дома)
 * Результат используется только для предложения связей; исходный адрес хранится без изменений.
 */

export interface HouseList {
  houses: string[];
  /** Последняя улица в строке — может служить улицей по умолчанию для следующих строк. */
  street: string | null;
}

const SEPARATORS = new Set([',', ';', '\n', 'және', 'и', '-', '–']);

function normalize(raw: string): string {
  return raw
    .replace(/\([^)]*\)?/g, ' ')                                         // (0,55 га), (ЖК …)
    .replace(/,?\s*\d+(?:\s*-\s*\d+)?\s*блок\p{L}*/giu, ' ')              // «87, 1-2 блок»
    .replace(/блок\p{L}*\s*[\dа-яёa-z](?:\s*,\s*[\dа-яёa-z](?![\p{L}\d]))*/giu, ' ') // «блок Б,В,Г»
    .replace(/(авангард|привокзальный|вокзал маңы|вокзал|нурсая|нұрсая)\s*-?\s*(\d+[а-яa-z]?)\s*(?:мкр\.?|ы\.а\.?)/giu, '$1-$2') // «Авангард 4мкр»
    .replace(/(\p{L})[\s-]*(\d+[а-яa-z]?)\s*,?\s*(?=(?:дом|д\.|дома)(?![\p{L}]))/gu, '$1-$2 ') // «Привокзальный 5, дом» → «Привокзальный-5 дом»
    .replace(/(?<![\p{L}])(?:дома|дом|д\.|үй|домов)(?![\p{L}])/giu, ' ')
    .replace(/(?<![\p{L}])д(?=\s*№)/giu, ' ')
    .replace(/№/g, ' ');
}

type Token = { t: 'word' | 'num' | 'sep'; v: string };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const re = /(\d+(?:\s*[а-яёәғқңөұүһіa-z](?![\p{L}]))?(?:\s*\/\s*\d+[а-яa-z]?)?)|([\p{L}](?:[\p{L}.]|-(?=\p{L}))*(?:-\d+[а-яёa-z]?(?![\d/]))?)|([,;\n–-])/giu;
  for (const m of s.matchAll(re)) {
    if (m[1]) out.push({ t: 'num', v: m[1].replace(/\s+/g, '').toUpperCase() });
    else if (m[2]) {
      const w = m[2];
      if (/^(және|и)$/i.test(w)) out.push({ t: 'sep', v: w });
      else out.push({ t: 'word', v: w });
    } else if (m[3]) out.push({ t: 'sep', v: m[3] });
  }
  return out;
}

export function expandHouses(raw: string | null | undefined, defaultStreet: string | null = null): HouseList {
  if (!raw) return { houses: [], street: defaultStreet };
  const tokens = tokenize(normalize(raw));
  const houses: string[] = [];
  let street = defaultStreet;
  let pending: string[] = [];
  let lastNum: string | null = null;
  let prevSep: string | null = null;
  const emit = (n: string) => {
    if (!street) return;
    const h = `${street}, ${n}`;
    if (!houses.includes(h)) houses.push(h);
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'sep') {
      prevSep = tk.v;
      continue;
    }
    if (tk.t === 'word') {
      // одиночная буква после номера — литера дома: «35Б В Г», «16а,б»
      if (tk.v.length === 1 && lastNum && pending.length === 0) {
        const base = lastNum.match(/^\d+/)![0];
        emit(base + tk.v.toUpperCase());
        continue;
      }
      pending.push(tk.v);
      continue;
    }
    // номер
    if (pending.length) {
      // «мкр.Нурсая, ул.Т.Жумагалиева 21» — улица точнее микрорайона
      const idx = pending.reduce((acc, w, k) => (/^(ул|пр|проспект|улица)(\.|$)/i.test(w) ? k : acc), 0);
      street = pending.slice(idx).join(' ');
      pending = [];
    }
    const n = tk.v;
    const slash = n.match(/^(\d+)([а-яa-z]?)\/(\d+)([а-яa-z]?)$/i);
    if (slash && Number(slash[3]) > Number(slash[1])) {
      // «21/22», «31/33/35» — список домов
      const parts = tokens[i].v.split('/');
      for (const p of parts) emit(p);
      lastNum = parts[parts.length - 1];
      prevSep = null;
      continue;
    }
    // диапазон «27-33», «25-25А»
    if (prevSep && /^[-–]$/.test(prevSep) && lastNum && /^\d+$/.test(lastNum)) {
      const a = Number(lastNum);
      const bm = n.match(/^(\d+)/);
      const b = bm ? Number(bm[1]) : NaN;
      if (Number.isFinite(b) && b > a && b - a <= 30 && /^\d+$/.test(n)) {
        for (let k = a + 1; k <= b; k++) emit(String(k));
        lastNum = n;
        prevSep = null;
        continue;
      }
    }
    emit(n);
    lastNum = n;
    prevSep = null;
  }
  return { houses, street };
}
