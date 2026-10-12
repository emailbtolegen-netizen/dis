// Пробный разбор файлов без записи в БД: node scripts/dry-parse.ts <файл.xlsx> [...]
import fs from 'node:fs';
import { readWorkbook, readSheet } from '../src/import/workbook.ts';
import { detectProfile } from '../src/import/profiles/index.ts';

for (const file of process.argv.slice(2)) {
  const wb = readWorkbook(fs.readFileSync(file));
  for (const name of wb.SheetNames) {
    const sheet = readSheet(wb, name);
    const profile = detectProfile(sheet);
    if (profile.code === 'generic') { console.log(`\n${file} / ${name}: профиль не определён`); continue; }
    const res = profile.parse(sheet);
    const byCat: Record<string, number> = {};
    for (const r of res.records) byCat[(r.category ?? '?') + (r.valid ? '' : ' (invalid)')] = (byCat[(r.category ?? '?') + (r.valid ? '' : ' (invalid)')] ?? 0) + 1;
    const msgs: Record<string, number> = {};
    for (const r of res.records) for (const m of r.messages) { const k = m.level + ': ' + m.text.replace(/«[^»]*»/g, '«…»').replace(/\d+/g, 'N'); msgs[k] = (msgs[k] ?? 0) + 1; }
    console.log(`\n=== ${file.split(/[\/]/).pop()} / ${name} → ${profile.code}`);
    console.log('records:', byCat);
    console.log('dup groups:', new Set(res.records.filter((r) => r.dupGroup).map((r) => r.dupGroup)).size, 'rows in dup groups:', res.records.filter((r) => r.dupGroup).length);
    console.log('file issues:'); res.fileIssues.forEach((m) => console.log('  ', m.level, m.text.slice(0, 200)));
    console.log('control totals:'); res.controlTotals.forEach((t) => console.log('  ', t.label, '| stated', t.stated, '| computed', t.computed, '|', t.match));
    console.log('messages:'); Object.entries(msgs).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ', n, k));
    if (process.env.SHOW) res.records.filter((r) => r.category === process.env.SHOW).slice(0, Number(process.env.N ?? 5)).forEach((r) => console.log(JSON.stringify({ row: r.rowNo, key: r.naturalKey, core: r.core, attrs: r.attrs })));
  }
}
