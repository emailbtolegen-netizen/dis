import test from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/domain/normalize.ts';

test('адреса МЖД и КСК сводятся к одному ключу', () => {
  const pairs: [string, string][] = [
    ['Авангард-2, 16', 'Авангард- 2 ы.а, 16 үй'],
    ['Привокзальный-3а, 25а', 'Вокзал маңы- 3а ы.а, 25а үй'],
    ['СМП-163, 3', 'СМП 163 ы/а 3 үй'],
    ['Сатпаева, 23', 'Сәтпаев көшесі 23 үй'],
    ['Абай, 21', 'Абая көшесі 21 үй'],
    ['Махамбет, 109', 'Махамбета көшесі 109 үй'],
    ['Привокзальный-5, 13', 'мкр.Привокзальный 5 дом № 13'],
    ['Азаттык, 42а', 'ул. Азаттык, дом №42А'],
    ['Владимирский, 100', 'Владимирскийкөшесі 100 үй'],
    ['Сары-арка, 29', 'Сары-Арқа ы.а, 29 үй (2 жеделсаты)'],
    ['Молдагалиева, 7', 'ул. Молдагалиева дом 7  кап.ремонт)'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(n.parseAddress(a).buildingKey, n.parseAddress(b).buildingKey, `${a} ≠ ${b}`);
    assert.ok(n.parseAddress(a).buildingKey);
  }
  assert.notEqual(n.parseAddress('Сатпаева, 48').buildingKey, n.parseAddress('пр.Сатпаева дом № 48 Д 1 подъезд ( лифт)').buildingKey);
});

test('числа', () => {
  assert.equal(n.parseNumber('37,284,579.64'), 37284579.64);
  assert.equal(n.parseNumber('28 276 602,48'), 28276602.48);
  assert.equal(n.parseNumber(' 40,851,455.88   '), 40851455.88);
  assert.equal(n.parseNumber('218,348'), 218.348);
  assert.equal(n.parseNumber('               4.000'), 4);
  assert.equal(n.parseNumber('2х400'), null);
});

test('мощность', () => {
  assert.deepEqual(n.parsePower('2-х 16000кВа'), { count: 2, unitKva: 16000, totalKva: 32000, ambiguous: false });
  assert.equal(n.parsePower('2х1000кВя').totalKva, 2000);
  assert.equal(n.parsePower('630 кВа').totalKva, 630);
  assert.equal(n.parsePower(' 1х630').totalKva, 630);
  assert.equal(n.parsePower('630ква ').totalKva, 630);
  assert.equal(n.parsePower('2х400,630').ambiguous, true);
});

test('ТП, ПС, РП, фидеры', () => {
  assert.deepEqual(n.parseTpName('КТПнГ-84/8'), { equipmentType: 'КТПНГ', code: '84/8' });
  assert.deepEqual(n.parseTpName('ТП-10/0,4 кВ №23      '), { equipmentType: 'ТП', code: '23' });
  assert.deepEqual(n.parseTpName('КТП-6/0,4кВ №68/15'), { equipmentType: 'КТП', code: '68/15' });
  assert.deepEqual(n.parseTpName('БКТП-10/0,4 кВ №171/4'), { equipmentType: 'БКТП', code: '171/4' });
  assert.deepEqual(n.parseTpName('КТПН-144/ 24'), { equipmentType: 'КТПН', code: '144/24' });
  assert.deepEqual(n.parseTpName('КТПНГ 10/0,4кВ №607/6'), { equipmentType: 'КТПНГ', code: '607/6' });
  assert.equal(n.parseUnitCode(' 110/35/10кВ ПС-49  «Кокарна»', 'ПС'), '49');
  assert.equal(n.parseUnitCode('РП-10/0,4кВ №32 (недействующии)', 'РП'), '32');
  assert.equal(n.parseUnitCode('РП -83', 'РП'), '83');
  assert.equal(n.extractVoltage(' 110/35/10кВ ПС-49'), '110/35/10');
  assert.deepEqual(n.findTpRefs('между КТПН-550/3 до КТПН-550/4'), ['550/3', '550/4']);
  assert.deepEqual(n.findTpRefs('ВЛ-0,4кВ от ТП №-41/3 (ТП №503/1) ТП-№4/13 Молод. гвардия'), ['41/3', '503/1', '4/13']);
  assert.deepEqual(n.findTpRefs('ВЛ-6кВ протяженностью-1,8 км и ТП-250 кВА'), []);
  assert.deepEqual(n.findFeeders('ВЛ-6кВ отпайка от ВЛ-6кВ Ф№196Ш опора №55'), ['196Ш']);
  assert.deepEqual(n.findFeeders('ВЛ-10 кВ Фидер №207 «Д» отпайка на'), ['207Д']);
  assert.deepEqual(n.findFeeders('Ф 013 Ф016 от ПС 51 до РП 26 СПЭ'), ['013', '016']);
  assert.deepEqual(n.findFeeders('КТПнг-189/2 (вт.пит. ф.190)'), ['190']);
  assert.deepEqual(n.findFeeders('КТПнГ-84/8 Ф - 1,2,3'), []);
  assert.deepEqual(n.findPsRefs('ПС-100 Ф-637 до ТП-637/1'), ['100']);
  assert.deepEqual(n.findRpRefs('ВЛ-10кВ от ПС-17 до РП-21 Ф№460Д'), ['21']);
});
