import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardedHostRepair } from '../src/lib/proxy-origin';

const PUBLIC = 'https://3000-abc123.e2b.app';

test('a proxy that rewrites Host is repaired for ordinary same-origin requests', () => {
  assert.equal(
    forwardedHostRepair({ fetchSite: 'same-origin', origin: PUBLIC, host: 'localhost:3000' }),
    '3000-abc123.e2b.app',
  );
  assert.equal(
    forwardedHostRepair({ fetchSite: 'same-origin', origin: PUBLIC, host: 'localhost:3000', forwardedHost: '127.0.0.1:3000' }),
    '3000-abc123.e2b.app',
  );
});

test('a forwarded host that already matches needs no repair', () => {
  assert.equal(
    forwardedHostRepair({ fetchSite: 'same-origin', origin: PUBLIC, forwardedHost: '3000-abc123.e2b.app' }),
    null,
  );
});

test('cross-site requests are never repaired', () => {
  for (const fetchSite of ['cross-site', 'same-site', 'none', '', undefined]) {
    assert.equal(forwardedHostRepair({ fetchSite, origin: PUBLIC, host: 'localhost:3000' }), null, String(fetchSite));
  }
});

test('a missing or unparseable origin is left alone', () => {
  assert.equal(forwardedHostRepair({ fetchSite: 'same-origin', origin: null, host: 'localhost:3000' }), null);
  assert.equal(forwardedHostRepair({ fetchSite: 'same-origin', origin: 'not a url', host: 'localhost:3000' }), null);
});

test('the repair only ever restores the browser-reported host', () => {
  const repaired = forwardedHostRepair({ fetchSite: 'same-origin', origin: PUBLIC, host: 'internal:3000' });
  assert.equal(repaired, '3000-abc123.e2b.app');
  assert.ok(!repaired?.includes('internal'));
});
