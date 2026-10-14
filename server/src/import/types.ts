import type { CoreField } from '../domain/categories.ts';

export type Level = 'error' | 'warning' | 'info';

export interface Msg {
  level: Level;
  text: string;
  field?: string;
}

export interface ParsedRecord {
  /** Номер строки в Excel (как видит пользователь, с 1). */
  rowNo: number;
  category: string | null;
  /** Ключ сопоставления без порядкового суффикса. */
  baseKey: string;
  /** Ключ сопоставления (с суффиксом #N, если ключ повторяется в файле). */
  naturalKey: string;
  core: Partial<Record<CoreField, string | number | null>>;
  attrs: Record<string, unknown>;
  /** Исходная строка: «заголовок столбца» → значение ячейки без изменений. */
  raw: Record<string, unknown>;
  messages: Msg[];
  valid: boolean;
  dupGroup?: string;
}

export interface ControlTotal {
  label: string;
  category: string | null;
  filter?: Record<string, string>;
  measure: 'count' | 'length_km' | 'area_m2' | 'sum';
  /** Для measure = 'sum': суммируемое поле attrs. */
  field?: string;
  stated: number | null;
  statedRaw: string;
  computed: number | null;
  unit: string;
  rowNo?: number;
  match: boolean | null;
  note?: string;
}

export interface ParseResult {
  profile: string;
  profileName: string;
  sheet: string;
  records: ParsedRecord[];
  fileIssues: Msg[];
  controlTotals: ControlTotal[];
}

export interface Sheet {
  name: string;
  /** Строки листа; rows[i] соответствует строке Excel firstRow + i. */
  rows: unknown[][];
  firstRow: number;
}

export interface GenericOptions {
  headerRow: number;
  category: string;
  /** Индекс столбца → назначение: core-поле, «attr:ключ» или «skip». */
  mapping: Record<string, string>;
  /** Поля, из которых строится ключ сопоставления (по умолчанию name + address_raw). */
  keyFields?: string[];
}

export interface Profile {
  code: string;
  name: string;
  detect(sheet: Sheet): boolean;
  parse(sheet: Sheet, options?: any): ParseResult;
}
