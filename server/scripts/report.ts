/**
 * Отчёт об импортированных данных и записях, требующих проверки (Markdown), по текущему состоянию базы.
 *   npm run report -- ../docs/IMPORT_REPORT.md
 */
import fs from 'node:fs';
import { bootstrap } from '../src/bootstrap.ts';
import { all, json } from '../src/db/db.ts';
import { categories } from '../src/domain/categories.ts';
import { computeQuality, ISSUE_TYPES } from '../src/services/quality.ts';

bootstrap();
const out = process.argv[2] ?? 'IMPORT_REPORT.md';
const cats = categories();
const L: string[] = [];
const p = (s = '') => L.push(s);
const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

p('# Отчёт об импорте исходных данных');
p();
p(`Сформирован автоматически по содержимому базы: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Atyrau' })} (время Атырау).`);
p();
p('## 1. Импортированные файлы');
p();
p('| № импорта | Файл | Лист | Формат | Записей в файле | Новых | Ошибок разбора | Статус |');
p('|---|---|---|---|---|---|---|---|');
const imports = all(`SELECT i.*, s.file_name FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE i.status = 'applied' ORDER BY i.id`);
for (const i of imports) {
  const s = json<any>(i.summary, {});
  p(`| ${i.id} | ${esc(i.file_name)} | ${esc(i.sheet_name)} | ${esc(s.profileName)} | ${s.total} | ${s.new} | ${s.invalid} | применён |`);
}
p();
p('## 2. Объекты в базе по разделам');
p();
p('| Раздел | Записей | С полными обязательными полями |');
p('|---|---|---|');
const q = computeQuality([...cats.keys()]);
for (const c of q.completeness) p(`| ${esc(c.name)} | ${c.total} | ${c.complete} |`);
p(`| **Итого** | **${q.totals.objects}** | |`);
p();
p('Каждая запись хранит ссылку на исходный файл, лист и номер строки Excel, а также исходную строку без изменений.');
p();
p('## 3. Сверка с итогами, указанными в самих файлах');
p();
p('| Файл | Итог | В файле | По строкам | Результат |');
p('|---|---|---|---|---|');
for (const t of q.controlTotals) p(`| ${esc(t.file_name)} | ${esc(t.label)} | ${t.stated == null ? "—" : +Number(t.stated).toFixed(3)} ${t.unit} | ${t.computed ?? '—'} ${t.unit} | ${t.match ? 'совпадает' : 'расхождение. ' + esc(t.note ?? '')} |`);
p();
p('## 4. Замечания к структуре файлов');
p();
for (const i of imports) {
  const issues = json<any[]>(i.file_issues, []);
  if (!issues.length) continue;
  p(`**${esc(i.file_name)}**`);
  p();
  for (const m of issues) p(`- ${m.level === 'warning' ? '⚠️' : m.level === 'error' ? '❌' : 'ℹ️'} ${m.text}`);
  p();
}
p('## 5. Записи, требующие проверки');
p();
p(`Объектов с предупреждениями: **${q.totals.needsReview}**, из них с незаполненными обязательными полями: **${q.totals.incomplete}**.`);
p();
p('| Проверка | Замечаний | Объектов |');
p('|---|---|---|');
for (const s of q.summary) p(`| ${s.label} | ${s.count} | ${s.objects} |`);
p();
const byType = (t: string) => q.issues.filter((i) => i.type === t);
const section = (t: string, limit = 400) => {
  const list = byType(t);
  if (!list.length) return;
  p(`### ${ISSUE_TYPES[t]} (${list.length})`);
  p();
  p('| ID | Наименование | Раздел | Замечание |');
  p('|---|---|---|---|');
  for (const i of list.slice(0, limit)) p(`| ${i.uid ?? '—'} | ${esc(i.name)} | ${esc(cats.get(i.category ?? '')?.short_name ?? '')} | ${esc(i.message)} |`);
  if (list.length > limit) p(`| … | ещё ${list.length - limit} | | |`);
  p();
};
for (const t of ['missing_required', 'suspicious_value', 'code_conflict', 'import_warning', 'duplicate', 'unlinked', 'address_format', 'value_variants']) section(t);
p('## 6. Автоматические связи между записями разных файлов');
p();
p('| Тип связи | Предложено | Подтверждено | Отклонено |');
p('|---|---|---|---|');
for (const r of all(`SELECT relation, sum(status='suggested') s, sum(status='confirmed') c, sum(status='rejected') r FROM object_links GROUP BY relation`)) {
  p(`| ${r.relation} | ${r.s} | ${r.c} | ${r.r} |`);
}
p();
p('Связи построены по номерам ТП/ПС/РП в наименованиях линий и по совпадению нормализованных адресов. Все автоматические связи имеют статус «предложена» и подтверждаются сотрудником в карточке объекта.');
fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log(`Отчёт записан: ${out}`);
