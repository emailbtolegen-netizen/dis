/**
 * Интеграционные тесты API на реальных исходных файлах.
 * Используется отдельный временный каталог данных — рабочая база не затрагивается.
 *   npm test
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import XLSX from 'xlsx';

const SRC = path.resolve(import.meta.dirname, '..', '..', '..');
const FILES = {
  mkd: path.join(SRC, 'МЖД 1240 2025 жыл0313115516 (2).xlsx'),
  energy: path.join(SRC, 'Список энергообъектов за 2026  ЖКХ (2).xlsx'),
  thermo: path.join(SRC, 'Таблица КСК 2020-2024 г!!!!!.xlsx'),
};
const LIFTS = path.join(SRC, 'Лифты города Атырау 2022-1.xlsx');
const haveFiles = Object.values(FILES).every((f) => fs.existsSync(f));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhkh-test-'));
process.env.DATA_DIR = tmp;
process.env.BACKUP_INTERVAL_HOURS = '0';

let server: Server;
let base = '';
let svc: typeof import('../src/import/service.ts');
let db: typeof import('../src/db/db.ts');

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; raw?: boolean } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + '/api' + url, {
      method,
      headers: {
        ...(opts.csrf === false ? {} : { 'X-Requested-With': 'zhkh' }),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    if (opts.raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  get(u: string) { return this.req('GET', u); }
  post(u: string, b: unknown = {}, o = {}) { return this.req('POST', u, b, o); }
  patch(u: string, b: unknown) { return this.req('PATCH', u, b); }
}

const admin = new Client();
const ADMIN_PW = 'Admin-test-12345';

before(async () => {
  const { bootstrap } = await import('../src/bootstrap.ts');
  const { createApp } = await import('../src/app.ts');
  const auth = await import('../src/auth/auth.ts');
  db = await import('../src/db/db.ts');
  svc = await import('../src/import/service.ts');
  bootstrap();
  const role = db.get(`SELECT id FROM roles WHERE code = 'admin'`)!;
  db.run('INSERT INTO users(login, full_name, password_hash, role_id) VALUES(?,?,?,?)', 'admin', 'Админ', auth.hashPassword(ADMIN_PW), role.id);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (haveFiles) {
    for (const f of Object.values(FILES)) {
      const id = svc.storeSourceFile(fs.readFileSync(f), path.basename(f), null);
      const info = svc.inspectSourceFile(id);
      svc.applyImport(svc.createPreview(id, info.sheets[0].name, info.sheets[0].detected.code, {}, null), null);
    }
  }
});

after(() => {
  server?.close();
  db?.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('импорт исходных файлов: число записей совпадает с аудитом', { skip: !haveFiles }, () => {
  const counts = Object.fromEntries(db.all('SELECT category, count(*) n FROM objects WHERE deleted_at IS NULL GROUP BY category').map((r) => [r.category, r.n]));
  assert.deepEqual(counts, { mkd: 1239, thermo: 75, el_ps: 8, el_rp: 46, el_tp: 569, el_vl: 698, el_kl: 663 });
  // у каждой записи есть ссылка на файл, лист и строку
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE source_file_id IS NULL OR source_row IS NULL`), 0);
});

test('вход: неверный пароль, блокировка после 5 попыток', async () => {
  const c = new Client();
  db.run(`INSERT INTO users(login, full_name, password_hash, role_id) SELECT 'locktest', 'Тест', password_hash, role_id FROM users WHERE login = 'admin'`);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/auth/login', { login: 'locktest', password: 'wrong-password-1' })).status, 401);
  assert.equal((await c.post('/auth/login', { login: 'locktest', password: ADMIN_PW })).status, 423);
  assert.equal((await admin.post('/auth/login', { login: 'admin', password: ADMIN_PW })).status, 200);
});

test('защита: без сессии 401, без заголовка X-Requested-With — 403, чужой Origin — 403', async () => {
  assert.equal((await new Client().get('/objects')).status, 401);
  assert.equal((await admin.post('/admin/backups', {}, { csrf: false })).status, 403);
  const res = await fetch(base + '/api/admin/backups', { method: 'POST', headers: { Cookie: admin.cookie, 'X-Requested-With': 'zhkh', Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('роль «Пользователь»: смена временного пароля, только просмотр, конфиденциальные поля скрыты', { skip: !haveFiles }, async () => {
  const roles = (await admin.get('/admin/roles')).body.roles;
  const viewerRole = roles.find((r: any) => r.code === 'viewer');
  assert.equal((await admin.post('/admin/users', { login: 'viewer1', full_name: 'Просмотр', role_id: viewerRole.id, password: 'Temp-pass-123' })).status, 201);
  const v = new Client();
  assert.equal((await v.post('/auth/login', { login: 'viewer1', password: 'Temp-pass-123' })).status, 200);
  assert.equal((await v.get('/objects')).body.code, 'MUST_CHANGE_PASSWORD');
  assert.equal((await v.post('/auth/change-password', { current: 'Temp-pass-123', next: 'Viewer-pass-456' })).status, 200);
  const list = await v.get('/objects?category=thermo&pageSize=5');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.every((o: any) => o.attrs.contact === null && o.hidden_fields.includes('contact')));
  const uid = list.body.items[0].uid;
  assert.equal((await v.patch(`/objects/${uid}`, { core: { notes: 'x' }, reason: 'тест' })).status, 403);
  assert.equal((await v.req('GET', '/objects/export?category=mkd', undefined, { raw: true })).status, 403);
  assert.equal((await v.get('/admin/users')).status, 403);
  // поиск по телефону не находит запись для пользователя без права на конфиденциальные поля
  const contact = String(db.get(`SELECT json_extract(attrs, '$.contact') c FROM objects WHERE category = 'thermo' AND json_extract(attrs, '$.contact') IS NOT NULL`)!.c);
  assert.equal((await v.get('/search?q=' + encodeURIComponent(contact))).body.total, 0);
});

test('поиск: номер ТП, фидер, адрес на казахском', { skip: !haveFiles }, async () => {
  const r = await admin.get('/search?q=' + encodeURIComponent('ТП 84/8'));
  assert.ok(r.body.groups.find((g: any) => g.category === 'el_tp').items.some((i: any) => i.name === 'КТПнГ-84/8'));
  const f = await admin.get('/search?q=' + encodeURIComponent('фидер 207'));
  assert.ok(f.body.groups.some((g: any) => g.category === 'el_vl'));
  const a = await admin.get('/search?q=' + encodeURIComponent('Сәтпаев 23'));
  assert.ok(a.body.total > 0);
});

test('редактирование: обязательна причина, изменения попадают в историю', { skip: !haveFiles }, async () => {
  const o = (await admin.get('/objects?category=el_tp&q=' + encodeURIComponent('84/8'))).body.items[0];
  assert.equal((await admin.patch(`/objects/${o.uid}`, { core: { lat: 47.1, lon: 51.9 } })).status, 400);
  assert.equal((await admin.patch(`/objects/${o.uid}`, { core: { lat: 99, lon: 51.9 }, reason: 'координаты' })).status, 400);
  const ok = await admin.patch(`/objects/${o.uid}`, { core: { lat: 47.1, lon: 51.9 }, reason: 'Координаты по обследованию' });
  assert.equal(ok.body.changes, 2);
  const card = (await admin.get(`/objects/${o.uid}`)).body;
  assert.equal(card.history[0].action, 'update');
  assert.equal(card.history[0].reason, 'Координаты по обследованию');
  assert.equal((await admin.get('/map')).body.points.length, 1);
});

test('повторный импорт изменённого файла: отчёт, ручные правки, применение и откат', { skip: !haveFiles }, async () => {
  // ручное изменение дома, который затем изменится и в файле
  const target = (await admin.get('/objects?category=mkd&q=' + encodeURIComponent('Ауезова, 2'))).body.items.find((i: any) => i.name === 'Ауезова, 2');
  await admin.patch(`/objects/${target.uid}`, { core: { notes: 'проверено' }, reason: 'ручная правка' });
  // изменённая копия файла: площадь в строке 4, удалена строка 6, добавлен новый дом
  const wb = XLSX.read(fs.readFileSync(FILES.mkd));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  rows[3][4] = 999.99;   // Ауезова, 1
  rows[4][4] = 1000.5;   // Ауезова, 2 (изменён вручную)
  rows.splice(5, 1);     // Ауезова, 10
  rows.splice(10, 0, [9999, 'Тестовая, 1', 2025, 0, 500, 10, 3, 'монолит', 'бар', 'ТЭЦ', 'бар', 'бар', 'бар', null, null, 'жоқ', '-']);
  const nwb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nwb, XLSX.utils.aoa_to_sheet(rows), wb.SheetNames[0]);
  const buf = XLSX.write(nwb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)]), 'mkd-v2.xlsx');
  const up = await admin.req('POST', '/admin/imports/upload', fd);
  assert.equal(up.status, 201);
  assert.equal(up.body.sheets[0].detected.code, 'mkd');
  const pv = await admin.post('/admin/imports/preview', { sourceFileId: up.body.sourceFile.id, sheet: up.body.sheets[0].name, profile: 'mkd' });
  const imp = (await admin.get(`/admin/imports/${pv.body.id}`)).body;
  assert.equal(imp.summary.new, 1);
  assert.equal(imp.summary.changed, 2);
  assert.equal(imp.summary.missing, 1);
  assert.equal(imp.summary.manualConflicts, 1);
  const changed = (await admin.get(`/admin/imports/${pv.body.id}/rows?action=changed`)).body.items;
  assert.equal(changed.find((r: any) => r.manual_edit).decision, 'skip');
  const before = (await admin.get('/objects?category=mkd&q=' + encodeURIComponent('Ауезова, 1'))).body.items.find((i: any) => i.name === 'Ауезова, 1');
  const applied = await admin.post(`/admin/imports/${pv.body.id}/apply`);
  assert.equal(applied.body.created, 1);
  assert.equal(applied.body.updated, 1);
  assert.ok(applied.body.backupName);
  const after1 = (await admin.get(`/objects/${before.uid}`)).body.object;
  assert.equal(after1.attrs.area_m2, 999.99);
  // объект, отсутствующий в новом файле, не удалён
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE name = 'Ауезова, 10' AND deleted_at IS NULL`), 1);
  // ручная правка не перезаписана
  assert.equal((await admin.get(`/objects/${target.uid}`)).body.object.attrs.area_m2, 984.7);
  // откат
  const rb = await admin.post(`/admin/imports/${pv.body.id}/rollback`);
  assert.equal(rb.body.deleted, 1);
  assert.equal((await admin.get(`/objects/${before.uid}`)).body.object.attrs.area_m2, before.attrs.area_m2);
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE name = 'Тестовая, 1' AND deleted_at IS NULL`), 0);
});

test('экспорт в Excel с учётом фильтра', { skip: !haveFiles }, async () => {
  const f = encodeURIComponent(JSON.stringify({ voltage_class: ['6/10 кВ'] }));
  const r = await admin.req('GET', `/objects/export?category=el_vl&f=${f}`, undefined, { raw: true });
  assert.equal(r.status, 200);
  const wb = XLSX.read(r.buf);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Объекты']);
  assert.equal(rows.length, 112);
});

test('резервная копия и восстановление', { skip: !haveFiles }, async () => {
  const b = await admin.post('/admin/backups');
  assert.equal(b.status, 201);
  const o = (await admin.get('/objects?category=el_ps')).body.items[0];
  await admin.patch(`/objects/${o.uid}`, { core: { notes: 'после копии' }, reason: 'проверка восстановления' });
  assert.equal((await admin.post(`/admin/backups/${b.body.name}/restore`, { confirm: 'нет' })).status, 400);
  const r = await admin.post(`/admin/backups/${b.body.name}/restore`, { confirm: 'ВОССТАНОВИТЬ' });
  assert.equal(r.status, 200);
  assert.equal((await admin.get(`/objects/${o.uid}`)).body.object.notes, null);
});

test('публичная версия по умолчанию выключена; включается только для разрешённых полей', { skip: !haveFiles }, async () => {
  const pub = new Client();
  assert.equal((await pub.get('/public/info')).status, 404);
  await admin.req('PUT', '/admin/settings', { public_enabled: true, categories: [{ code: 'thermo', is_public: true, public_fields: ['address_raw', 'contact', 'program_year'] }] });
  const info = (await pub.get('/public/info')).body;
  assert.deepEqual(info.categories[0].fields.map((f: any) => f.key), ['address_raw', 'program_year']);
  const list = (await pub.get('/public/objects?category=thermo')).body;
  assert.ok(list.items.every((i: any) => !('contact' in i)));
  assert.equal((await pub.get('/public/objects?category=mkd')).status, 404);
});

test('лифты МЖД: полный перенос, сверка итогов, привязка к домам без создания дубликатов', { skip: !haveFiles || !fs.existsSync(LIFTS) }, async () => {
  const mkdBefore = db.scalar<number>(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`);
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(fs.readFileSync(LIFTS))]), 'lifts.xlsx');
  const up = await admin.req('POST', '/admin/imports/upload', fd);
  assert.equal(up.body.sheets[0].detected.code, 'lifts');
  const pv = await admin.post('/admin/imports/preview', { sourceFileId: up.body.sourceFile.id, sheet: up.body.sheets[0].name, profile: 'lifts' });
  const imp = (await admin.get(`/admin/imports/${pv.body.id}`)).body;
  // 214 строк с домами + строка «Всего» (контрольные итоги, не объект)
  assert.equal(imp.summary.new, 214);
  assert.equal(imp.summary.invalid, 0);
  assert.ok(imp.control_totals.length === 6 && imp.control_totals.every((t: any) => t.match), 'итоги «Всего» совпадают с суммой строк');
  await admin.post(`/admin/imports/${pv.body.id}/apply`);
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd_lifts' AND deleted_at IS NULL`), 214);
  assert.equal(db.scalar(`SELECT sum(json_extract(attrs, '$.lifts_total')) FROM objects WHERE category = 'mkd_lifts'`), 712);
  // новые дома МЖД не созданы
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`), mkdBefore);
  const linked = db.scalar<number>(`SELECT count(DISTINCT from_id) FROM object_links WHERE relation = 'lift_building'`);
  assert.ok(linked >= 170, `привязано ${linked}`);
  // строки с несколькими домами не привязываются автоматически
  assert.equal(db.scalar(`SELECT count(*) FROM object_links l JOIN objects o ON o.id = l.from_id WHERE l.relation = 'lift_building' AND json_extract(o.attrs, '$.multi_address') = 'да'`), 0);
  // карточка МЖД показывает лифты дома; исходный текст сохранён
  const house = db.get(`SELECT m.uid FROM object_links l JOIN objects m ON m.id = l.to_id JOIN objects o ON o.id = l.from_id WHERE l.relation = 'lift_building' AND o.address_raw = 'ул.Молдагалиева, дом 5'`)!;
  const card = (await admin.get(`/objects/${house.uid}`)).body;
  assert.ok(card.lifts.length >= 2, 'по дому две строки файла (2022 и 2024) — не объединены');
  const old = card.lifts.find((l: any) => l.attrs.note === 'требуется кап.ремонт');
  assert.equal(old.status, 'Все лифты не работают');
  assert.equal(old.attrs.attention, 'Требуется кап. ремонт');
  assert.equal(old.attrs.condition_raw, 'пассажирский лифт не работает, закрыт');
  // фильтр по состоянию и поиск по адресу
  const broken = (await admin.get('/objects?category=mkd_lifts&f=' + encodeURIComponent(JSON.stringify({ status: ['Все лифты не работают'] })))).body;
  assert.ok(broken.total > 0 && broken.items.every((i: any) => i.status === 'Все лифты не работают'));
  assert.ok((await admin.get('/objects?category=mkd_lifts&q=' + encodeURIComponent('Алмагуль 17'))).body.total >= 1);
  // несвязанные записи выделены для проверки
  const q = (await admin.get('/quality?type=unlinked&category=mkd_lifts&pageSize=500')).body;
  assert.equal(q.issues.total, 214 - linked);
});

const SRC_DIR = fs.existsSync(SRC) ? fs.readdirSync(SRC) : [];
/** Имена файлов могут быть в разной нормализации Unicode (й = и + ˘) — ищем по NFC. */
const findSrc = (needle: string) => {
  const f = SRC_DIR.find((n) => n.normalize('NFC').includes(needle.normalize('NFC')));
  return f ? path.join(SRC, f) : null;
};
const NEW_FILES = {
  yards100: findSrc('100 ДВОР'),
  yards150: findSrc('150 дворов'),
  green: findSrc('Инвентаризация_зеленых'),
  repair: findSrc('список на 2026'),
};

async function importAll(file: string) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(fs.readFileSync(file))]), path.basename(file));
  const up = await admin.req('POST', '/admin/imports/upload', fd);
  const out: any[] = [];
  for (const sh of up.body.sheets) {
    if (sh.detected.code === 'generic') continue;
    const pv = await admin.post('/admin/imports/preview', { sourceFileId: up.body.sourceFile.id, sheet: sh.name, profile: sh.detected.code });
    const imp = (await admin.get(`/admin/imports/${pv.body.id}`)).body;
    await admin.post(`/admin/imports/${pv.body.id}/apply`);
    out.push({ sheet: sh.name, profile: sh.detected.code, summary: imp.summary, totals: imp.control_totals });
  }
  return out;
}

test('дворы, капремонт 2026, насаждения, дороги: полный перенос и сверка итогов', { skip: !haveFiles || Object.values(NEW_FILES).some((f) => !f) }, async () => {
  const mkdBefore = db.scalar<number>(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`);
  const r100 = await importAll(NEW_FILES.yards100!);
  assert.deepEqual(r100.map((r) => [r.sheet, r.profile, r.summary.new]), [['2022', 'road_needs', 21], ['2022 (2)', 'road_needs', 18], ['Детальная таблица', 'yard_contracts', 21]]);
  // ошибки исходного файла выявлены: «ИТОГО» листа 2022 и итог освоения SHEBERBUILD
  assert.ok(r100[0].totals.some((t: any) => t.match === false && /ИТОГО/.test(t.label) && /не включены/.test(t.note)));
  assert.ok(r100[2].totals.some((t: any) => t.match === false && /SHEBERBUILD/.test(t.label)));
  const r150 = await importAll(NEW_FILES.yards150!);
  assert.deepEqual(r150.map((r) => r.summary.new), [100, 50, 57, 50, 17]);
  assert.ok(r150.every((r) => r.summary.missing === 0), 'листы одного формата не считаются «отсутствующими» друг для друга');
  const rg = await importAll(NEW_FILES.green!);
  assert.equal(rg[0].summary.new, 89);
  assert.ok(rg[0].totals.every((t: any) => t.match));
  const rr = await importAll(NEW_FILES.repair!);
  assert.equal(rr[0].summary.new, 112);
  assert.ok(rr[0].totals.length === 6 && rr[0].totals.every((t: any) => t.match), 'итоги и подпись «67 лифт / 45 СМР» совпадают');
  // новые дома МЖД не создаются
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`), mkdBefore);
  // привязка к МЖД и вкладка «Ремонт и благоустройство»
  assert.ok(db.scalar<number>(`SELECT count(DISTINCT from_id) FROM object_links WHERE relation = 'repair_building'`) >= 80);
  assert.ok(db.scalar<number>(`SELECT count(DISTINCT to_id) FROM object_links WHERE relation = 'yard_building'`) >= 300);
  const house = db.get(`SELECT m.uid FROM object_links l JOIN objects m ON m.id = l.to_id WHERE l.relation = 'repair_building' LIMIT 1`)!;
  const card = (await admin.get(`/objects/${house.uid}`)).body;
  assert.ok(card.programs.some((p: any) => p.category === 'capital_repair'));
  // повторный импорт тех же файлов — без дубликатов
  const again = await importAll(NEW_FILES.yards150!);
  assert.ok(again.every((r) => r.summary.new === 0 && r.summary.missing === 0 && r.summary.unchanged === r.summary.total));
});

test('карта аварийных домов (HTML): извлечение данных без выполнения скриптов, статусы, координаты, карта, главная панель', { skip: !haveFiles || !findSrc('karta-avariynyh') }, async () => {
  const mkdBefore = db.scalar<number>(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`);
  const r = await importAll(findSrc('karta-avariynyh')!);
  assert.deepEqual(r.map((x) => [x.sheet, x.profile, x.summary.new, x.summary.invalid]), [['HOUSES', 'mkd_emergency', 88, 0]]);
  const st = Object.fromEntries(db.all(`SELECT status, count(*) n, sum(lat IS NOT NULL AND lon IS NOT NULL) c FROM objects WHERE category = 'mkd_emergency' GROUP BY status`).map((x) => [x.status, [x.n, x.c]]));
  assert.deepEqual(st, { 'Аварийный (признан, есть заключение)': [68, 68], 'Ветхий (заключения нет или назначен капремонт)': [20, 20] });
  assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd' AND deleted_at IS NULL`), mkdBefore);
  assert.ok(db.scalar<number>(`SELECT count(DISTINCT from_id) FROM object_links WHERE relation = 'emergency_building'`) >= 75);
  const map = (await admin.get('/map')).body;
  assert.equal(map.points.filter((p: any) => p.category === 'mkd_emergency').length, 88);
  const d = (await admin.get('/dashboard')).body;
  assert.deepEqual([d.totals.emergency.available, d.totals.emergency.count, d.totals.emergency.dilapidated], [true, 68, 20]);
  // тот же перечень в виде таблицы Excel (лист «тізім») обновляет те же записи, а не создаёт дубли
  const xls = findSrc('АВАР 88');
  if (xls) {
    const rx = await importAll(xls);
    assert.deepEqual(rx.map((x) => [x.profile, x.summary.total, x.summary.new, x.summary.invalid, x.summary.missing]), [['mkd_emergency', 88, 0, 0, 0]]);
    assert.ok(rx[0].totals.length === 2 && rx[0].totals.every((t: any) => t.match === false && /строк выше/.test(t.note)), 'ошибочный итог «Барлығы» выявлен');
    assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd_emergency' AND deleted_at IS NULL`), 88);
    const st2 = Object.fromEntries(db.all(`SELECT status, count(*) n FROM objects WHERE category = 'mkd_emergency' GROUP BY status`).map((x) => [x.status, x.n]));
    assert.deepEqual(st2, { 'Аварийный (признан, есть заключение)': 68, 'Ветхий (заключения нет или назначен капремонт)': 20 });
    assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd_emergency' AND json_extract(attrs, '$.address_ru') IS NOT NULL`), 88, 'поля карты не затёрты');
    assert.equal(db.scalar(`SELECT count(*) FROM objects WHERE category = 'mkd_emergency' AND json_extract(attrs, '$.conclusion') GLOB '[0-9][0-9][0-9][0-9]-*'`), 0, 'даты в формате дд.мм.гггг');
  }
  // HTML без встроенных данных и таблиц — понятная ошибка, а не падение
  const fd = new FormData();
  fd.append('file', new Blob(['<!doctype html><html><body><script>alert(1)</script></body></html>']), 'empty.html');
  const up = await admin.req('POST', '/admin/imports/upload', fd);
  assert.equal(up.status, 400);
});
