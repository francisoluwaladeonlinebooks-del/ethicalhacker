import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIGITAL_ASSET_TYPES, parseRegistryPayload, toCsv } from '../src/lib/domain/registry';
import { INSTITUTION_CATEGORIES } from '../src/lib/domain/institutions';

test('CSV import parses quoted fields, embedded commas and escaped quotes', () => {
  const csv = [
    'code,name,category,regulator,licenceNumber,licenceStatus',
    'SYN-1,"Example Bank, Plc",commercial_bank,CBN,CBN/SYN/1,active',
    'SYN-2,"Quote ""Name"" Bank",microfinance_bank_state,CBN,CBN/SYN/2,suspended',
  ].join('\n');

  const rows = parseRegistryPayload('csv', csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Example Bank, Plc');
  assert.equal(rows[0].code, 'SYN-1');
  assert.equal(rows[1].name, 'Quote "Name" Bank');
});

test('CSV import requires a header row and a name column', () => {
  assert.throws(() => parseRegistryPayload('csv', 'only-one-line'), /header row/i);
  assert.throws(() => parseRegistryPayload('csv', 'code,category\nA,b'), /name/i);
});

test('JSON import accepts an array or an institutions object', () => {
  const arrayRows = parseRegistryPayload('json', JSON.stringify([{ name: 'Example Bank', category: 'commercial_bank' }]));
  assert.equal(arrayRows.length, 1);
  const objectRows = parseRegistryPayload('json', JSON.stringify({ institutions: [{ name: 'Another Bank' }] }));
  assert.equal(objectRows.length, 1);
  assert.throws(() => parseRegistryPayload('json', '{"institutions": []}'), /non-empty/i);
  assert.throws(() => parseRegistryPayload('json', 'not json'), /valid JSON/i);
});

test('an import never carries a digital asset or an authorisation field', () => {
  const rows = parseRegistryPayload(
    'json',
    JSON.stringify([{ name: 'Example Bank', assets: ['x.example'], authorized: true, scan: 'yes' }]),
  );
  const row = rows[0] as unknown as Record<string, unknown>;
  assert.equal('assets' in row, false);
  assert.equal('authorized' in row, false);
  assert.equal('scan' in row, false);
});

test('an empty payload is rejected before any write happens', () => {
  assert.throws(() => parseRegistryPayload('csv', '   '), /empty/i);
  assert.throws(() => parseRegistryPayload('json', ''), /empty/i);
});

test('CSV export quotes separators, quotes and newlines', () => {
  const csv = toCsv([
    { name: 'Example, Bank', note: 'line one\nline two', quote: 'say "hi"' },
    { name: 'Plain', note: '', quote: '' },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'name,note,quote');
  assert.ok(csv.includes('"Example, Bank"'));
  assert.ok(csv.includes('"line one\nline two"'));
  assert.ok(csv.includes('"say ""hi"""'));
  assert.equal(toCsv([]), '');
});

test('every licence category the schema accepts is described once', () => {
  const keys = INSTITUTION_CATEGORIES.map((category) => category.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate category key');
  for (const category of INSTITUTION_CATEGORIES) {
    assert.ok(category.label.length > 0, `${category.key} has no label`);
    assert.ok(category.regulator.length > 0, `${category.key} has no regulator`);
  }
});

test('asset types cover the inventory classes required for banks, MFBs and PSPs', () => {
  const keys = DIGITAL_ASSET_TYPES.map((type) => type.key);
  for (const required of [
    'web_app', 'internet_banking', 'corporate_banking', 'mobile_android', 'mobile_ios', 'api', 'webhook',
    'onboarding', 'admin_portal', 'core_banking_interface', 'third_party_service', 'shared_infrastructure',
  ]) {
    assert.ok(keys.includes(required), `missing asset type ${required}`);
  }
  assert.equal(new Set(keys).size, keys.length, 'duplicate asset type');
});
