import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsUnredactedSensitiveData, redactHeaders, redactText } from '../src/lib/redact';

test('authorisation and cookie values are masked while structure is preserved', () => {
  const redacted = redactHeaders({
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    cookie: 'ficap_session=abc123; theme=dark',
    'content-type': 'application/json',
  });
  assert.equal(redacted['content-type'], 'application/json');
  const auth = String(redacted.Authorization);
  assert.ok(!auth.includes('eyJhbGciOiJIUzI1NiJ9'), 'token must not survive');
  assert.ok(auth.includes('[REDACTED]'));
  const cookie = String(redacted.cookie);
  assert.ok(!cookie.includes('abc123'), 'session value must not survive');
  assert.ok(cookie.includes('[REDACTED]'));
});

test('common credential patterns are masked and counted', () => {
  const result = redactText('password=Sup3rSecret! and api_key: sk_live_9f8e7d6c5b4a3210');
  assert.match(result.text, /\[REDACTED/);
  assert.ok(result.redactions.length > 0);
  assert.ok(result.text.includes('Sup3rSecret!') === false);
  assert.ok(!result.text.includes('sk_live_9f8e7d6c5b4a3210'));
});

test('redaction is idempotent', () => {
  const once = redactText('token=abcdef1234567890').text;
  const twice = redactText(once).text;
  assert.equal(twice, once);
});

test('unredacted sensitive values can be detected before storage', () => {
  assert.equal(containsUnredactedSensitiveData('Authorization: Bearer abcdefghijklmnop'), true);
  assert.equal(containsUnredactedSensitiveData('The response contained no credentials.'), false);
});

test('phone numbers and account numbers are masked', () => {
  const result = redactText('Call +2348012345678 or debit account 0123456789');
  assert.ok(!result.text.includes('+2348012345678'));
  assert.ok(!result.text.includes('0123456789'));
});
