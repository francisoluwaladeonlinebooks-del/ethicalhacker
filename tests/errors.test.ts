import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, NotFoundError, toPublicError } from '../src/lib/errors';

test('typed errors keep their status and message', () => {
  const { status, body } = toPublicError(new NotFoundError());
  assert.equal(status, 404);
  assert.equal(body.code, 'not_found');
});

test('a malformed identifier cast error becomes a 404, never a 500', () => {
  const dbError = Object.assign(new Error('invalid input syntax for type uuid: "export"'), { code: '22P02' });
  const { status, body } = toPublicError(dbError);
  assert.equal(status, 404);
  assert.equal(body.code, 'not_found');
  assert.ok(!body.error.includes('uuid'), 'the database detail is not echoed to the client');
});

test('unknown errors never leak internals', () => {
  const { status, body } = toPublicError(new Error('relation "findings" does not exist'));
  assert.equal(status, 500);
  assert.equal(body.code, 'internal_error');
  assert.ok(!body.error.includes('findings'));
});

test('application errors pass through with their details', () => {
  const { status, body } = toPublicError(new AppError('Scope check failed', 403, 'scope_violation', { field: 'target' }));
  assert.equal(status, 403);
  assert.equal(body.code, 'scope_violation');
  assert.deepEqual(body.details, { field: 'target' });
});
