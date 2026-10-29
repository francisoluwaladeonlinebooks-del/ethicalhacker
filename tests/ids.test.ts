import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUuid } from '../src/lib/ids';

test('accepts canonical record identifiers', () => {
  assert.equal(isUuid('811a3396-8de4-43d7-a159-2f203f431aa6'), true);
  assert.equal(isUuid('00000000-0000-0000-0000-000000000000'), true);
  assert.equal(isUuid('811A3396-8DE4-43D7-A159-2F203F431AA6'), true);
});

test('rejects values that could never identify a record', () => {
  for (const value of [
    '',
    'export',
    'not-a-uuid',
    '811a3396-8de4-43d7-a159-2f203f431aa',
    '811a3396-8de4-43d7-a159-2f203f431aa61',
    '811a3396_8de4_43d7_a159_2f203f431aa6',
    ' 811a3396-8de4-43d7-a159-2f203f431aa6',
    '../../etc/passwd',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(isUuid(value), false, `rejects ${JSON.stringify(value)}`);
  }
});
