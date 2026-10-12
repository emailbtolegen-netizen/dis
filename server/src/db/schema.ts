/**
 * Схема базы данных. Каждая миграция применяется один раз (номер хранится в PRAGMA user_version).
 * Новые изменения структуры добавляются только новым элементом массива — старые не редактируются.
 */
export const migrations: string[] = [
  /* 1: базовая структура */ `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',   -- JSON: список прав
  sections    TEXT NOT NULL DEFAULT '["*"]', -- JSON: доступные направления (домены) или "*"
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  login                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name            TEXT NOT NULL,
  position             TEXT,
  password_hash        TEXT NOT NULL,
  role_id              INTEGER NOT NULL REFERENCES roles(id),
  is_active            INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,               -- SHA-256 от токена (сам токен в БД не хранится)
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE categories (
  code          TEXT PRIMARY KEY,
  domain        TEXT NOT NULL,                 -- housing | energy | utilities | other
  name          TEXT NOT NULL,
  name_kk       TEXT,
  short_name    TEXT,
  description   TEXT,
  uid_prefix    TEXT NOT NULL,
  fields        TEXT NOT NULL DEFAULT '[]',    -- JSON: описание полей категории
  sort          INTEGER NOT NULL DEFAULT 100,
  is_public     INTEGER NOT NULL DEFAULT 0,
  public_fields TEXT NOT NULL DEFAULT '[]',
  is_system     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_files (
  id          INTEGER PRIMARY KEY,
  file_name   TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size        INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE imports (
  id             INTEGER PRIMARY KEY,
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  sheet_name     TEXT NOT NULL,
  profile        TEXT NOT NULL,
  options        TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'preview', -- preview | applied | rolled_back | discarded
  summary        TEXT NOT NULL DEFAULT '{}',
  file_issues    TEXT NOT NULL DEFAULT '[]',
  control_totals TEXT NOT NULL DEFAULT '[]',
  backup_name    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  applied_by     INTEGER REFERENCES users(id),
  applied_at     TEXT,
  rolled_back_by INTEGER REFERENCES users(id),
  rolled_back_at TEXT,
  rollback_report TEXT
);

CREATE TABLE import_rows (
  id          INTEGER PRIMARY KEY,
  import_id   INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_no      INTEGER,
  category    TEXT,
  natural_key TEXT,
  action      TEXT NOT NULL,      -- new | changed | unchanged | invalid | missing
  decision    TEXT NOT NULL DEFAULT 'apply', -- apply | skip
  object_id   INTEGER,
  data        TEXT,               -- JSON: разобранная запись
  before      TEXT,               -- JSON: состояние объекта до применения
  diff        TEXT,               -- JSON: [{field,label,old,new}]
  messages    TEXT NOT NULL DEFAULT '[]',
  dup_group   TEXT,               -- метка группы возможных дубликатов в файле
  manual_edit INTEGER NOT NULL DEFAULT 0, -- объект менялся вручную после последнего импорта
  applied     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_import_rows_import ON import_rows(import_id, action);

CREATE TABLE addresses (
  id         INTEGER PRIMARY KEY,
  norm_key   TEXT NOT NULL UNIQUE,    -- нормализованный ключ (b:... здание, a:... территория)
  kind       TEXT NOT NULL,           -- building | area
  display    TEXT NOT NULL,
  area_key   TEXT,                    -- для зданий: ключ улицы/микрорайона
  street     TEXT,
  house      TEXT,
  is_settlement INTEGER NOT NULL DEFAULT 0,
  lat        REAL,
  lon        REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_addresses_area ON addresses(area_key);

CREATE TABLE objects (
  id             INTEGER PRIMARY KEY,
  uid            TEXT NOT NULL UNIQUE,
  category       TEXT NOT NULL REFERENCES categories(code),
  name           TEXT NOT NULL,
  code           TEXT,               -- диспетчерский номер (ТП 84/8, РП-22, ПС-49 ...)
  address_raw    TEXT,               -- адрес / место нахождения как в источнике
  address_id     INTEGER REFERENCES addresses(id),
  status         TEXT,
  balance_holder TEXT,
  year_built     INTEGER,
  voltage        TEXT,               -- класс напряжения, как указан (например «10/0,4»)
  power_kva      REAL,               -- суммарная мощность трансформаторов, кВА (рассчитана из исходной записи)
  length_km      REAL,
  lat            REAL,
  lon            REAL,
  attrs          TEXT NOT NULL DEFAULT '{}', -- JSON: поля, специфичные для категории
  raw            TEXT,               -- JSON: исходная строка Excel без изменений
  issues         TEXT NOT NULL DEFAULT '[]', -- JSON: замечания, выявленные при импорте
  notes          TEXT,
  is_public      INTEGER NOT NULL DEFAULT 0,
  natural_key    TEXT,               -- ключ сопоставления при повторном импорте
  source_file_id INTEGER REFERENCES source_files(id),
  source_sheet   TEXT,
  source_row     INTEGER,
  source_import_id INTEGER REFERENCES imports(id),
  search_text    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by     INTEGER REFERENCES users(id),
  updated_via    TEXT NOT NULL DEFAULT 'import',  -- import | manual | rollback
  deleted_at     TEXT,
  deleted_by     INTEGER REFERENCES users(id),
  delete_reason  TEXT
);
CREATE INDEX ix_objects_category ON objects(category, deleted_at);
CREATE INDEX ix_objects_nkey ON objects(category, natural_key);
CREATE INDEX ix_objects_code ON objects(code);
CREATE INDEX ix_objects_address ON objects(address_id);

CREATE TABLE object_links (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL,
  method     TEXT NOT NULL,          -- auto:tp-code | auto:ps-code | auto:address | manual
  confidence REAL,
  status     TEXT NOT NULL DEFAULT 'suggested', -- suggested | confirmed | rejected
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  UNIQUE (from_id, to_id, relation)
);
CREATE INDEX ix_links_to ON object_links(to_id);

CREATE TABLE change_log (
  id        INTEGER PRIMARY KEY,
  object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  import_id INTEGER REFERENCES imports(id),
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,   -- create | update | delete | restore | import_create | import_update | rollback
  changes   TEXT NOT NULL DEFAULT '[]',
  reason    TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_change_log_object ON change_log(object_id, at);

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id),
  user_login TEXT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  details   TEXT,
  ip        TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_audit_at ON audit_log(at);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY,
  object_id     INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  description   TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
`,
];
