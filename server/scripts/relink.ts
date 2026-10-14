/** Пересчёт автоматических связей (после изменения правил сопоставления): npm run relink */
import { bootstrap } from '../src/bootstrap.ts';
import { rebuildAutoLinks } from '../src/services/links.ts';

bootstrap();
console.log(rebuildAutoLinks());
