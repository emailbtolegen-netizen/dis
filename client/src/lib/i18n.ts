/**
 * Строки интерфейса. Основной язык — русский; казахский добавляется заполнением словаря kk
 * (ключи без перевода показываются на русском). Переключатель языка — в меню пользователя.
 */
const ru = {
  appName: 'ЦИС ЖКХ г. Атырау',
  appFullName: 'Цифровая информационная система ЖКХ города Атырау',
  appSubtitle: 'Единая цифровая база объектов и инженерной инфраструктуры',
  'menu.dashboard': 'Главная панель',
  'menu.registry': 'Реестр объектов',
  'menu.housing': 'Жилищный фонд',
  'menu.energy': 'Электрохозяйство',
  'menu.energyOverview': 'Обзор и итоги',
  'menu.feeders': 'Фидеры',
  'menu.utilities': 'Инженерные сети',
  'menu.addresses': 'Адресный справочник',
  'menu.map': 'Карта объектов',
  'menu.quality': 'Качество данных',
  'menu.admin': 'Администрирование',
  'menu.import': 'Импорт Excel',
  'menu.imports': 'История импорта',
  'menu.users': 'Пользователи',
  'menu.roles': 'Роли и права',
  'menu.categories': 'Справочники',
  'menu.audit': 'Журнал действий',
  'menu.backups': 'Резервные копии',
  'menu.settings': 'Настройки',
  'header.search': 'Поиск: адрес, ТП, фидер, наименование, идентификатор…',
  'header.updated': 'База обновлена',
  'user.changePassword': 'Сменить пароль',
  'user.logout': 'Выйти',
  'user.language': 'Язык',
};

type Key = keyof typeof ru;
const kk: Partial<Record<Key, string>> = {
  'menu.dashboard': 'Басты панель',
  'menu.registry': 'Нысандар тізілімі',
  'user.logout': 'Шығу',
};

const dict = { ru, kk } as const;
export type Lang = keyof typeof dict;

let lang: Lang = (() => {
  try {
    return (localStorage.getItem('zhkh_lang') as Lang) || 'ru';
  } catch {
    return 'ru';
  }
})();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem('zhkh_lang', l);
  } catch { /* недоступно хранилище */ }
}

export function t(key: Key): string {
  return (dict[lang] as Partial<Record<Key, string>>)[key] ?? ru[key];
}
