/**
 * Первичное наполнение базы из исходных Excel-файлов через тот же конвейер, что и в админ-панели:
 * загрузка → разбор → сравнение → применение (с резервной копией перед каждым применением).
 *   npm run import-initial -- "путь/к/файлу1.xlsx" "путь/к/файлу2.xlsx"
 * Повторный запуск с теми же файлами не создаёт дубликатов: записи сопоставляются по ключу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../src/bootstrap.ts';
import { get, json } from '../src/db/db.ts';
import { applyImport, createPreview, inspectSourceFile, storeSourceFile } from '../src/import/service.ts';

bootstrap();
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Укажите пути к файлам Excel');
  process.exit(1);
}
for (const file of files) {
  const buf = fs.readFileSync(file);
  const sfId = storeSourceFile(buf, path.basename(file), null);
  const info = inspectSourceFile(sfId);
  for (const sheet of info.sheets) {
    if (sheet.detected.code === 'generic') {
      console.log(`⚠ ${path.basename(file)} / «${sheet.name}»: формат не распознан — используйте импорт с сопоставлением столбцов в админ-панели.`);
      continue;
    }
    const importId = createPreview(sfId, sheet.name, sheet.detected.code, {}, null);
    const imp = get('SELECT summary FROM imports WHERE id = ?', importId)!;
    const s = json<any>(imp.summary, {});
    const r = applyImport(importId, null);
    console.log(`✔ ${path.basename(file)} / «${sheet.name}» (${sheet.detected.name}), импорт №${importId}`);
    console.log(`   в файле: ${s.total} записей; новых ${s.new}, изменённых ${s.changed}, без изменений ${s.unchanged}, с ошибками ${s.invalid}, отсутствуют в файле ${s.missing}`);
    console.log(`   применено: создано ${r.created}, обновлено ${r.updated}, подтверждено ${r.refreshed}, пропущено ${r.skipped}; резервная копия ${r.backupName}`);
  }
}
