import { all, get, run, json } from '../db/db.ts';

export type FieldType = 'text' | 'number' | 'int' | 'enum' | 'yesno';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Поле хранится в отдельном столбце objects (а не в attrs). */
  core?: boolean;
  unit?: string;
  /** Исходный заголовок столбца Excel. */
  source?: string;
  confidential?: boolean;
  filter?: boolean;
  required?: boolean;
  /** Показывать в таблице реестра по умолчанию. */
  table?: boolean;
  /** Отображаемые расшифровки исходных значений (исходное значение не меняется). */
  valueMap?: Record<string, string>;
  hint?: string;
}

export interface CategoryDef {
  code: string;
  domain: string;
  name: string;
  short_name: string;
  description: string;
  uid_prefix: string;
  sort: number;
  fields: FieldDef[];
}

export const DOMAINS: Record<string, { name: string; sort: number }> = {
  housing: { name: 'Жилищный фонд', sort: 1 },
  energy: { name: 'Электрические сети и электрохозяйство', sort: 2 },
  utilities: { name: 'Инженерные сети и коммунальная инфраструктура', sort: 3 },
  improvement: { name: 'Благоустройство и озеленение', sort: 4 },
  roads: { name: 'Дорожная инфраструктура', sort: 5 },
  other: { name: 'Прочие объекты', sort: 9 },
};

/** Поля, которые хранятся в отдельных столбцах таблицы objects. */
export const CORE_FIELDS = [
  'name', 'code', 'address_raw', 'status', 'balance_holder', 'year_built', 'voltage', 'power_kva', 'length_km', 'lat', 'lon', 'notes',
] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

export const CORE_LABELS: Record<CoreField, string> = {
  name: 'Наименование',
  code: 'Номер / код',
  address_raw: 'Адрес / местоположение',
  status: 'Состояние / статус',
  balance_holder: 'Балансовая принадлежность',
  year_built: 'Год постройки',
  voltage: 'Напряжение, кВ',
  power_kva: 'Мощность, кВА',
  length_km: 'Протяжённость, км',
  lat: 'Широта',
  lon: 'Долгота',
  notes: 'Примечания',
};

const YESNO: Record<string, string> = { 'бар': 'Есть', 'жоқ': 'Нет', 'жок': 'Нет', 'есть': 'Есть', 'нет': 'Нет' };

const core = (key: CoreField, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label: CORE_LABELS[key],
  type: ['year_built'].includes(key) ? 'int' : ['power_kva', 'length_km', 'lat', 'lon'].includes(key) ? 'number' : 'text',
  core: true,
  ...extra,
});

const energyCommon = (sourceUnit: string): FieldDef[] => [
  { key: 'section', label: 'Раздел перечня', type: 'enum', filter: true, hint: 'Заголовок раздела в исходном перечне' },
  { key: 'unit', label: 'Ед. измерения', type: 'text', source: 'Ед. измерения', hint: sourceUnit },
  { key: 'no_in_list', label: '№ п/п в перечне', type: 'text', source: '№ п/п' },
];

/** Сведения, извлечённые из наименований линий (для связей с ТП/ПС/РП и жилыми домами). */
const lineRefFields: FieldDef[] = [
  { key: 'rp_refs', label: 'РП в наименовании', type: 'text' },
  { key: 'house_refs', label: 'Жилые дома (ж/д №) в наименовании', type: 'text' },
  { key: 'subgroup', label: 'Подзаголовок перечня (улица)', type: 'text', hint: 'Строка-подзаголовок перед группой кабелей к жилым домам' },
  { key: 'length_as_text', label: 'Протяжённость записана текстом', type: 'yesno', hint: 'В Excel значение хранилось как текст и не входило в формулы-итоги', valueMap: { 'true': 'Да' } },
];

const lineFields: FieldDef[] = [
  core('name', { required: true, table: true }),
  { key: 'voltage_class', label: 'Класс напряжения', type: 'enum', filter: true, table: true },
  core('length_km', { required: true, table: true, source: 'Мощность Тр-р (для линий — протяжённость)', unit: 'км' }),
  core('address_raw', { label: 'Место нахождения', table: true, filter: true, source: 'Место нахождение' }),
  { key: 'tp_refs', label: 'ТП в наименовании', type: 'text', table: true, hint: 'Номера ТП/КТП, найденные в наименовании линии' },
  { key: 'feeders', label: 'Фидер(ы)', type: 'text', table: true, filter: true, hint: 'Номера фидеров, найденные в наименовании' },
  { key: 'ps_refs', label: 'ПС в наименовании', type: 'text' },
  ...lineRefFields,
  core('voltage'),
  core('balance_holder', { filter: true }),
  core('status', { filter: true }),
  ...energyCommon('км'),
  core('lat'), core('lon'), core('notes'),
];

export const SYSTEM_CATEGORIES: CategoryDef[] = [
  {
    code: 'mkd',
    domain: 'housing',
    name: 'Многоквартирные жилые дома (МЖД)',
    short_name: 'МЖД',
    description: 'Реестр многоквартирных жилых домов г. Атырау (файл «МЖД 1240 2025»).',
    uid_prefix: 'MKD',
    sort: 10,
    fields: [
      core('address_raw', { label: 'Адрес', required: true, table: true, source: 'Қала' }),
      core('year_built', { required: true, table: true, filter: true, source: 'жылы' }),
      { key: 'floors', label: 'Этажность', type: 'text', table: true, filter: true, required: true, source: 'Қабаттар саны' },
      { key: 'apartments', label: 'Количество квартир', type: 'int', table: true, required: true, source: 'Пәтерлер саны' },
      { key: 'area_m2', label: 'Площадь', type: 'number', unit: 'м²', table: true, required: true, source: 'квадрат метр' },
      { key: 'wall_material', label: 'Материал стен', type: 'enum', table: true, filter: true, source: 'қабырға' },
      { key: 'heating', label: 'Отопление', type: 'enum', table: true, filter: true, source: 'орт.жылыту',
        valueMap: { 'ТЭЦ': 'ТЭЦ (центральное)', 'ЖҚ': 'ЖҚ (котельная)', 'пәтер ЖК': 'Поквартирный котёл', 'пәтер ЖҚ': 'Поквартирный котёл', 'жеке қазан': 'Собственная котельная' } },
      { key: 'water_plastic', label: 'Водопровод (пластик)', type: 'yesno', filter: true, source: 'су құбыры (пластик)', valueMap: YESNO },
      { key: 'sewer', label: 'Канализация', type: 'enum', filter: true, source: 'кәріз желісі', valueMap: { ...YESNO, 'септик': 'Септик' } },
      { key: 'gas', label: 'Газ', type: 'yesno', filter: true, source: 'газ', valueMap: YESNO },
      { key: 'hot_water', label: 'Горячая вода', type: 'yesno', filter: true, source: 'ыстық су', valueMap: YESNO },
      { key: 'elevators', label: 'Лифт', type: 'text', filter: true, source: 'лифт', valueMap: YESNO, hint: 'Число — количество лифтов' },
      { key: 'intercom', label: 'Домофон', type: 'int', source: 'домофон', hint: 'Значение из столбца «домофон» (число)' },
      { key: 'electric_stove', label: 'Электроплита', type: 'text', source: 'электр плита', valueMap: YESNO },
      { key: 'repair_year', label: 'Год ремонта', type: 'text', filter: true, source: 'жөндеуден өткен жылы' },
      { key: 'management', label: 'Форма управления (КСК/ПИК/ОСИ)', type: 'enum', table: true, filter: true, source: 'КПТҮ басқару нысаны' },
      { key: 'col_r', label: 'Столбец R (без заголовка)', type: 'text', source: '(столбец R без заголовка)', hint: 'Значение без заголовка в исходном файле — требует уточнения' },
      core('status', { filter: true }),
      core('balance_holder'),
      core('lat'), core('lon'), core('notes'),
    ],
  },
  {
    code: 'mkd_lifts',
    domain: 'housing',
    name: 'Лифты многоквартирных жилых домов (МЖД)',
    short_name: 'Лифты МЖД',
    description: 'Сведения о лифтах домов по файлу «Лифты города Атырау 2022». Одна запись — одна строка файла по дому; привязка к карточке МЖД — на вкладке «Связи» и в карточке дома.',
    uid_prefix: 'LFT',
    sort: 11,
    fields: [
      core('address_raw', { label: 'Адрес дома', required: true, table: true, source: 'Адрес дома' }),
      core('status', { label: 'Состояние (обобщённо)', table: true, filter: true, hint: 'Определено по столбцам «Состояние лифтов» и «Лифты, находящиеся в нерабочем состоянии»; исходный текст — в поле «Состояние лифтов»' }),
      { key: 'condition_raw', label: 'Состояние лифтов (исходный текст)', type: 'text', table: true, source: 'Состояние лифтов' },
      { key: 'note', label: 'Примечание', type: 'text', table: true, source: 'Примечание' },
      { key: 'attention', label: 'Требует внимания', type: 'enum', table: true, filter: true, hint: 'Выделено из исходных формулировок: кап. ремонт, модернизация, срок эксплуатации, демонтаж' },
      { key: 'lifts_total', label: 'Общее кол-во лифтов', type: 'int', table: true, required: true, source: 'Общее кол-во лифтов' },
      { key: 'lifts_passenger', label: 'Пассажирских', type: 'int', table: true, source: 'Пассажирских' },
      { key: 'lifts_freight', label: 'Грузопассажирских', type: 'int', table: true, source: 'Грузопассажирских' },
      { key: 'lifts_broken', label: 'Не работают (всего)', type: 'int', table: true, filter: true, source: 'Лифты, находящиеся в нерабочем состоянии' },
      { key: 'broken_passenger', label: 'Не работают: пассажирские', type: 'int', source: 'Пассажирские (нерабочие)' },
      { key: 'broken_freight', label: 'Не работают: грузопассажирские', type: 'int', source: 'Грузопассажирские (нерабочие)' },
      { key: 'floors', label: 'Кол-во этажей', type: 'text', filter: true, source: 'Кол-во этажей' },
      { key: 'entrances', label: 'Кол-во подъездов', type: 'int', source: 'Кол-во подъездов' },
      { key: 'ramp', label: 'Пандус', type: 'yesno', filter: true, hint: 'Отмечено, если пандус упомянут в столбце «Состояние лифтов»', valueMap: { 'есть': 'Есть' } },
      { key: 'modernization_year', label: 'Год модернизации', type: 'int', filter: true, hint: 'Из примечания вида «модернизация в 2013 году»' },
      { key: 'management_org', label: 'Орган управления (организация)', type: 'enum', table: true, filter: true, hint: 'Название, выделенное из исходного текста' },
      { key: 'management_raw', label: 'Орган управления объектом кондоминиума (исходный текст)', type: 'text', confidential: true, source: 'Орган управления объектом кондоминиума' },
      { key: 'service_company', label: 'Обслуживающая организация', type: 'enum', table: true, filter: true, hint: 'Название, выделенное из исходного текста' },
      { key: 'service_raw', label: 'Организация, обслуживающая лифты (исходный текст)', type: 'text', confidential: true, source: 'Наименования организаций, обслуживающие лифты' },
      { key: 'multi_address', label: 'Несколько домов в одной строке', type: 'yesno', filter: true, valueMap: { 'да': 'Да' }, hint: 'Такие строки не привязываются к МЖД автоматически' },
      { key: 'no_in_list', label: '№ в файле', type: 'text', source: '№' },
      core('name', { label: 'Наименование записи' }),
      core('notes'),
    ],
  },
  {
    code: 'thermo',
    domain: 'housing',
    name: 'Термомодернизация МЖД (КСК/ПИК), 2020–2024',
    short_name: 'Термомодернизация',
    description: 'Дома, прошедшие ремонт по программе термомодернизации (файл «Таблица КСК 2020-2024»).',
    uid_prefix: 'TM',
    sort: 20,
    fields: [
      core('address_raw', { label: 'Адрес дома', required: true, table: true, source: 'Мекен жайы (терможаңғырту бойынша жөндеуден өткен үй)' }),
      { key: 'program_year', label: 'Год программы', type: 'int', table: true, filter: true, required: true, source: 'Жылы' },
      { key: 'org_name', label: 'КСК / ПИК (наименование, руководитель)', type: 'text', table: true, filter: true, source: 'Пәтер иелерінің кооперативтері атауы' },
      { key: 'contact', label: 'Контакт (из столбца «ЖСН/БСН…»)', type: 'text', confidential: true, source: 'ЖСН/БСН, Басшысының аты-жөні, Заңды мекен жайы', hint: 'В исходном столбце указаны номера телефонов, а не ИИН/БИН' },
      { key: 'amount_kzt', label: 'Выделенные средства', type: 'number', unit: '₸', table: true, required: true, source: 'Бөлінген қаражат' },
      { key: 'amount_raw', label: 'Средства (как в источнике)', type: 'text' },
      core('status', { label: 'Статус работ', table: true, filter: true }),
      { key: 'work_status_raw', label: 'Статус (исходный текст)', type: 'text', source: 'Шағымдар туралы ақпарат (фактически — статус работ)' },
      { key: 'row_in_year', label: '№ в году', type: 'int' },
      core('notes'),
    ],
  },
  {
    code: 'el_ps',
    domain: 'energy',
    name: 'Питающие центры — подстанции ПС 35–110 кВ',
    short_name: 'ПС',
    description: 'Подстанции 35/110 кВ из перечня энергообъектов 2026 г.',
    uid_prefix: 'PS',
    sort: 30,
    fields: [
      core('name', { required: true, table: true }),
      core('code', { label: 'Номер ПС', table: true }),
      core('voltage', { table: true, filter: true }),
      { key: 'power_raw', label: 'Мощность Тр-р (как в источнике)', type: 'text', table: true, source: 'Мощность Тр-р' },
      { key: 'transformers', label: 'Кол-во трансформаторов', type: 'int' },
      { key: 'transformer_kva', label: 'Мощность одного Тр-р', type: 'number', unit: 'кВА' },
      core('power_kva', { label: 'Суммарная мощность', unit: 'кВА', table: true, required: true }),
      core('address_raw', { label: 'Место нахождения', table: true, filter: true, source: 'Место нахождение' }),
      core('balance_holder', { filter: true }),
      core('status', { filter: true }),
      ...energyCommon('к-т'),
      core('lat'), core('lon'), core('notes'),
    ],
  },
  {
    code: 'el_rp',
    domain: 'energy',
    name: 'Распределительные пункты РП 6/10 кВ',
    short_name: 'РП',
    description: 'Распределительные пункты на балансе ЖКХ г. Атырау.',
    uid_prefix: 'RP',
    sort: 31,
    fields: [
      core('name', { required: true, table: true }),
      core('code', { label: 'Номер РП', table: true }),
      core('status', { table: true, filter: true }),
      { key: 'list_group', label: 'Группа в перечне', type: 'int', hint: '1 — первая группа (недействующие и РП-27), 2 — основной список' },
      { key: 'power_raw', label: 'Мощность Тр-р (как в источнике)', type: 'text', table: true, source: 'Мощность Тр-р' },
      { key: 'transformers', label: 'Кол-во трансформаторов', type: 'int' },
      { key: 'transformer_kva', label: 'Мощность одного Тр-р', type: 'number', unit: 'кВА' },
      core('power_kva', { label: 'Суммарная мощность', unit: 'кВА', table: true, required: true }),
      core('address_raw', { label: 'Место нахождения', table: true, filter: true, source: 'Место нахождение' }),
      core('voltage', { filter: true }),
      core('balance_holder', { filter: true }),
      ...energyCommon('к-т'),
      core('lat'), core('lon'), core('notes'),
    ],
  },
  {
    code: 'el_tp',
    domain: 'energy',
    name: 'Трансформаторные подстанции ТП / КТП / КТПН 6/10/0,4 кВ',
    short_name: 'ТП/КТП',
    description: 'ТП, КТП, КТПН, КТПНГ, БКТП на балансе ЖКХ.',
    uid_prefix: 'TP',
    sort: 32,
    fields: [
      core('name', { required: true, table: true }),
      { key: 'equipment_type', label: 'Тип оборудования', type: 'enum', table: true, filter: true, hint: 'Определён по наименованию (ТП, КТП, КТПН, КТПНГ, БКТП, ЗТП)' },
      core('code', { label: 'Номер ТП', table: true }),
      { key: 'power_raw', label: 'Мощность Тр-р (как в источнике)', type: 'text', table: true, source: 'Мощность Тр-р' },
      { key: 'transformers', label: 'Кол-во трансформаторов', type: 'int', filter: true },
      { key: 'transformer_kva', label: 'Мощность одного Тр-р', type: 'number', unit: 'кВА', filter: true },
      core('power_kva', { label: 'Суммарная мощность', unit: 'кВА', table: true, required: true }),
      core('address_raw', { label: 'Место нахождения', table: true, filter: true, source: 'Место нахождение', required: true }),
      { key: 'feeders', label: 'Фидер (из наименования)', type: 'text', filter: true },
      core('voltage', { filter: true }),
      core('balance_holder', { filter: true }),
      core('status', { filter: true }),
      ...energyCommon('к-т'),
      core('lat'), core('lon'), core('notes'),
    ],
  },
  {
    code: 'el_vl',
    domain: 'energy',
    name: 'Воздушные линии ВЛ 0,4–35 кВ',
    short_name: 'ВЛ',
    description: 'Воздушные линии электропередачи (ВЛ-0,4 кВ, ВЛ-6/10 кВ, ВЛ-35 кВ).',
    uid_prefix: 'VL',
    sort: 33,
    fields: lineFields,
  },
  {
    code: 'el_kl',
    domain: 'energy',
    name: 'Кабельные линии КЛ 0,4–110 кВ',
    short_name: 'КЛ',
    description: 'Кабельные линии (КЛ-0,4 кВ, КЛ-6/10 кВ, КЛ-110 кВ).',
    uid_prefix: 'KL',
    sort: 34,
    fields: lineFields,
  },
  {
    code: 'capital_repair',
    domain: 'housing',
    name: 'Капитальный ремонт МЖД: план на 2026 год',
    short_name: 'Капремонт 2026',
    description: 'Список жилых домов, подлежащих капитальному ремонту в 2026 году по Концепции развития ЖКИ (файл «список на 2026»). Одна запись — строка списка (дом, подъезд или вид работ).',
    uid_prefix: 'CR',
    sort: 21,
    fields: [
      core('address_raw', { label: 'Адрес (как в списке)', required: true, table: true, source: 'Адрес' }),
      { key: 'work_type', label: 'Вид работ', type: 'enum', table: true, filter: true, hint: 'Выделено из пояснения в адресе: лифт, капремонт, кровля, СМР' },
      { key: 'entrance', label: 'Подъезд', type: 'text', table: true, hint: 'Номер подъезда, если указан в адресе' },
      { key: 'smr_kzt', label: 'Сметный расчёт строительства (СМР)', type: 'number', unit: '₸', table: true, required: true, source: 'Сметный расчет строительства (СМР)' },
      { key: 'author_kzt', label: 'Авторский надзор', type: 'number', unit: '₸', table: true, source: 'Авторский надзор' },
      { key: 'tech_kzt', label: 'Технический надзор', type: 'number', unit: '₸', table: true, source: 'Технический надзор' },
      { key: 'total_kzt', label: 'Всего', type: 'number', unit: '₸', table: true, required: true, source: 'Всего' },
      { key: 'program_year', label: 'Год программы', type: 'int', filter: true },
      { key: 'no_in_list', label: '№ в списке', type: 'text', source: '№' },
      core('name', { label: 'Наименование записи' }),
      core('notes'),
    ],
  },
  {
    code: 'yard_contracts',
    domain: 'improvement',
    name: 'Благоустройство дворов: договоры и освоение 2022–2026',
    short_name: 'Дворы: договоры',
    description: 'Сводная таблица по объектам благоустройства дворовых территорий (файл «100 ДВОР…», лист «Детальная таблица»): по каждому лоту — подрядчик, технический и авторский надзор, стоимость и освоение по годам.',
    uid_prefix: 'YC',
    sort: 60,
    fields: [
      core('name', { label: 'Объект (лот)', required: true, table: true, source: 'Наименование объектов' }),
      { key: 'role', label: 'Роль в лоте', type: 'enum', table: true, filter: true, hint: 'По порядку строк лота, как в заголовке «Подрядчик, технадзор, авторский надзор»' },
      { key: 'company', label: 'Организация', type: 'enum', table: true, filter: true, source: 'Подрядчик, технадзор, авторский надзор' },
      { key: 'contract', label: '№ и дата договора', type: 'text', table: true, source: '№ и дата заключения договоров' },
      { key: 'group', label: 'Группа (итог по подрядчику)', type: 'enum', filter: true, hint: 'Из строки «ИТОГО, ТОО …» под лотами' },
      { key: 'project_status', label: 'Состояние ПСД (из наименования)', type: 'enum', filter: true },
      { key: 'cost_before', label: 'Стоимость до корректировки', type: 'number', unit: 'тыс. ₸', table: true, source: 'Общая стоимость до корректировки, тыс.тенге' },
      { key: 'cost_after', label: 'Стоимость после корректировки', type: 'number', unit: 'тыс. ₸', table: true, required: true, source: 'Общая стоимость после корректировки, тыс.тенге' },
      { key: 'spent_2022', label: 'Освоено 2022', type: 'number', unit: 'тыс. ₸' },
      { key: 'spent_2023', label: 'Освоено 2023', type: 'number', unit: 'тыс. ₸' },
      { key: 'spent_2024', label: 'Освоено 2024', type: 'number', unit: 'тыс. ₸' },
      { key: 'spent_2025', label: 'Освоено 2025', type: 'number', unit: 'тыс. ₸' },
      { key: 'spent_2026', label: 'Освоено 2026', type: 'number', unit: 'тыс. ₸' },
      { key: 'spent_total', label: 'Освоено 2022–2026', type: 'number', unit: 'тыс. ₸', table: true, source: 'Освоено на 2022-2026 годах, тыс.тенге' },
      { key: 'remaining', label: 'Необходимо для завершения', type: 'number', unit: 'тыс. ₸', table: true, source: 'Необходимо для завершения' },
      { key: 'yards_count', label: 'Кол-во дворов (лот)', type: 'int', table: true, source: 'Кол-во дворов' },
      { key: 'houses_count', label: 'Кол-во домов (графа «Домов»)', type: 'int', source: 'Домов' },
      { key: 'addresses', label: 'Адреса домов по проекту', type: 'text', source: 'Адреса домов по проекту' },
      { key: 'houses_list', label: 'Дома (разбор адресов)', type: 'text', hint: 'Отдельные дома, выделенные из адресов для привязки к МЖД' },
      { key: 'lot_no', label: '№ лота', type: 'text', source: '№' },
      core('notes'),
    ],
  },
  {
    code: 'yards_approved',
    domain: 'improvement',
    name: 'Дворы: утверждённый перечень благоустройства',
    short_name: 'Дворы: перечень',
    description: 'Утверждённый перечень дворовых территорий (файл «Утвержденный список 150 дворов», лист «Лист1»): адрес, площадь, отметки согласования.',
    uid_prefix: 'YA',
    sort: 61,
    fields: [
      core('address_raw', { label: 'Адрес (Мекен-жайы)', required: true, table: true, source: 'Мекен-жайы' }),
      { key: 'area_raw', label: 'Площадь (как в источнике)', type: 'text', table: true, source: 'көлемі' },
      { key: 'area_ha', label: 'Площадь', type: 'number', unit: 'га', table: true, required: true },
      { key: 'npc_zem', label: 'НПЦзем', type: 'text', table: true, filter: true, source: 'НПЦ-зем' },
      { key: 'land_relations', label: 'Городские земельные отношения', type: 'text', table: true, filter: true, source: 'Қалалық жер қатынастары' },
      { key: 'housing_inspection', label: 'Городская жилищная инспекция', type: 'text', table: true, filter: true, source: 'Қалалық тұрғын үй инспекциясы' },
      { key: 'houses_list', label: 'Дома (разбор адреса)', type: 'text', hint: 'Отдельные дома, выделенные из адреса для привязки к МЖД' },
      { key: 'houses_count', label: 'Домов в адресе', type: 'int' },
      { key: 'no_in_list', label: '№', type: 'text', source: '№' },
      core('name', { label: 'Наименование записи' }),
      core('notes'),
    ],
  },
  {
    code: 'yards_design',
    domain: 'improvement',
    name: 'Дворы: перечни адресов проектных организаций',
    short_name: 'Дворы: проектирование',
    description: 'Перечни адресов по благоустройству дворовых территорий по проектным организациям (ТОО «Шымгорпроект», «ЛМ Транспроект», «Редлайн ПРО») и лист «НЕ РЕАЛИЗОВАННЫЕ ДВОРА».',
    uid_prefix: 'YD',
    sort: 62,
    fields: [
      core('address_raw', { label: 'Адрес', required: true, table: true, source: 'Наименование' }),
      { key: 'design_org', label: 'Проектная организация', type: 'enum', table: true, filter: true },
      core('status', { label: 'Отметка', table: true, filter: true, hint: '«Не реализован» — для адресов с листа «НЕ РЕАЛИЗОВАННЫЕ ДВОРА»' }),
      { key: 'list_part', label: 'Часть перечня', type: 'enum', filter: true, hint: 'В листе перечень разбит на части повторяющимся заголовком организации' },
      { key: 'remark', label: 'Примечание', type: 'text', source: 'Примечание' },
      { key: 'houses_list', label: 'Дома (разбор адреса)', type: 'text' },
      { key: 'houses_count', label: 'Домов в адресе', type: 'int' },
      { key: 'sheet', label: 'Лист', type: 'enum', filter: true },
      { key: 'no_in_list', label: '№', type: 'text', source: '№' },
      core('name', { label: 'Наименование записи' }),
      core('notes'),
    ],
  },
  {
    code: 'green_inventory',
    domain: 'improvement',
    name: 'Зелёные насаждения: инвентаризация на 01.12.2025',
    short_name: 'Зелёные насаждения',
    description: 'Отчёт об инвентаризации зелёных насаждений г. Атырау: существующие насаждения по породам и новая посадка за 2025 год.',
    uid_prefix: 'GR',
    sort: 63,
    fields: [
      core('name', { label: 'Порода дерева / кустарника', required: true, table: true, source: 'Порода дерева/кустарника' }),
      { key: 'record_type', label: 'Раздел отчёта', type: 'enum', table: true, filter: true },
      { key: 'quantity', label: 'Количество', type: 'int', unit: 'шт.', table: true, required: true, source: 'Количество, шт' },
      { key: 'kind', label: 'Вид насаждения', type: 'enum', table: true, filter: true, source: 'Вид насаждения' },
      core('status', { label: 'Состояние', table: true, filter: true, source: 'Состояние' }),
      { key: 'survival_pct', label: 'Приживаемость', type: 'number', unit: '%', table: true, source: 'Приживаемость, %' },
      { key: 'remark', label: 'Примечания', type: 'text', source: 'Примечания' },
      { key: 'locality', label: 'Город / район', type: 'enum', filter: true, source: 'Наименование города, района' },
      { key: 'no_in_list', label: '№', type: 'text', source: '№' },
      core('notes'),
    ],
  },
  {
    code: 'road_needs',
    domain: 'roads',
    name: 'Дорожная инфраструктура: потребность на 2022 год',
    short_name: 'Дороги: потребность 2022',
    description: 'Потребность на развитие дорожной инфраструктуры по Атырауской области для уточнения республиканского бюджета на 2022 год (листы «2022» и «2022 (2)» файла «100 ДВОР…»). Включает объекты районов области.',
    uid_prefix: 'RD',
    sort: 70,
    fields: [
      core('name', { label: 'Наименование трансферта (объекта)', required: true, table: true, source: 'Наименование трансфертов' }),
      { key: 'sheet', label: 'Версия (лист)', type: 'enum', table: true, filter: true },
      { key: 'ministry', label: 'Администратор программы', type: 'enum', table: true, filter: true },
      { key: 'total_cost', label: 'Общая стоимость', type: 'number', unit: 'тыс. ₸', table: true, required: true, source: 'Общая стоимость, тыс.тенге' },
      { key: 'before_rb', label: 'До 2022 года: РБ', type: 'number', unit: 'тыс. ₸', source: 'До 2022 года — РБ' },
      { key: 'before_mb', label: 'До 2022 года: МБ', type: 'number', unit: 'тыс. ₸', source: 'До 2022 года — МБ' },
      { key: 'y2022', label: '2022 год', type: 'number', unit: 'тыс. ₸', table: true, source: '2022 год (лист «2022»)' },
      { key: 'prelim_done', label: 'Предварительно отработано', type: 'number', unit: 'тыс. ₸', source: 'Предвар. отработано' },
      { key: 'alloc_2022_rb', label: 'Выделено на 2022: РБ', type: 'number', unit: 'тыс. ₸', source: 'выделено на 2022 год — РБ (лист «2022 (2)»)' },
      { key: 'alloc_2022_mb', label: 'Выделено на 2022: МБ', type: 'number', unit: 'тыс. ₸', source: 'выделено на 2022 год — МБ' },
      { key: 'additional_rb_2022', label: 'Из РБ дополнительно требуется на 2022', type: 'number', unit: 'тыс. ₸', table: true, source: 'Из РБ дополнительно требуется на 2022 год' },
      { key: 'in_city', label: 'Объект в г. Атырау', type: 'yesno', filter: true, valueMap: { 'да': 'Да', 'нет': 'Нет' }, hint: 'Определено по наименованию (упоминание «г.Атырау» / «городе Атырау»)' },
      { key: 'no_in_list', label: '№', type: 'text', source: '№' },
      core('notes'),
    ],
  },
  ...(
    [
      ['water', 'Водоснабжение', 'WS', 50],
      ['sewer', 'Канализация и водоотведение', 'SW', 51],
      ['heat', 'Тепловые сети', 'HN', 52],
      ['lighting', 'Наружное освещение', 'LT', 53],
      ['comms', 'Прочие инженерные коммуникации', 'EC', 54],
    ] as const
  ).map(([code, name, prefix, sort]): CategoryDef => ({
    code,
    domain: 'utilities',
    name,
    short_name: name,
    description: 'В загруженных файлах нет реестра объектов этого направления. Раздел готов к наполнению вручную или импортом.',
    uid_prefix: prefix,
    sort,
    fields: [
      core('name', { required: true, table: true }),
      core('code', { table: true }),
      core('address_raw', { table: true, filter: true, required: true }),
      core('status', { table: true, filter: true }),
      core('balance_holder', { filter: true }),
      core('year_built', { table: true }),
      core('length_km', { table: true }),
      core('lat'), core('lon'), core('notes'),
    ],
  })),
];

export interface Category extends Omit<CategoryDef, 'fields'> {
  fields: FieldDef[];
  name_kk: string | null;
  is_public: number;
  public_fields: string[];
  is_system: number;
}

export function seedCategories(): void {
  for (const c of SYSTEM_CATEGORIES) {
    const exists = get('SELECT code FROM categories WHERE code = ?', c.code);
    if (exists) {
      // системные описания полей обновляются вместе с кодом; пользовательские настройки (публичность) сохраняются
      run('UPDATE categories SET domain=?, name=?, short_name=?, description=?, fields=?, sort=? WHERE code=?',
        c.domain, c.name, c.short_name, c.description, JSON.stringify(c.fields), c.sort, c.code);
    } else {
      run('INSERT INTO categories(code, domain, name, short_name, description, uid_prefix, fields, sort, is_system) VALUES(?,?,?,?,?,?,?,?,1)',
        c.code, c.domain, c.name, c.short_name, c.description, c.uid_prefix, JSON.stringify(c.fields), c.sort);
    }
  }
}

let cache: Map<string, Category> | null = null;

export function invalidateCategories(): void {
  cache = null;
}

export function categories(): Map<string, Category> {
  if (!cache) {
    cache = new Map();
    for (const r of all('SELECT * FROM categories ORDER BY sort, name')) {
      cache.set(r.code, { ...r, fields: json(r.fields, []), public_fields: json(r.public_fields, []) } as unknown as Category);
    }
  }
  return cache;
}

export function category(code: string): Category | undefined {
  return categories().get(code);
}

export function fieldLabel(cat: Category | undefined, key: string): string {
  const f = cat?.fields.find((x) => x.key === key);
  if (f) return f.label;
  if ((CORE_LABELS as Record<string, string>)[key]) return (CORE_LABELS as Record<string, string>)[key];
  return key;
}
