import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isServedStatus, scanBuffer, scannerConfigured, scannerDescription } from '../src/lib/evidence-scan';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

test('without a configured scanner, a file is reported as not scanned — never clean', async () => {
  delete process.env.FICAP_MALWARE_SCANNER;
  delete process.env.FICAP_SCANNER_ENDPOINT;
  assert.equal(scannerConfigured(), false);

  const result = await scanBuffer(Buffer.from('PK\u0003\u0004 not really a package'), 'release.apk');
  assert.equal(result.state, 'not_performed');
  assert.equal(result.provider, 'none');
  assert.match(result.detail, /not been examined|not scanned/i);
  assert.doesNotMatch(result.detail, /\bclean\b/i);
});

test('the interface description states the limitation explicitly', () => {
  delete process.env.FICAP_MALWARE_SCANNER;
  const description = scannerDescription();
  assert.match(description, /not scanned/i);
  assert.match(description, /FICAP_MALWARE_SCANNER/);
});

test('an unreachable scanner is recorded as an error, not as clean', async () => {
  process.env.FICAP_MALWARE_SCANNER = 'http';
  process.env.FICAP_SCANNER_ENDPOINT = 'http://127.0.0.1:9/scan';
  assert.equal(scannerConfigured(), true);
  const result = await scanBuffer(Buffer.from('payload'), 'file.bin');
  assert.equal(result.state, 'error');
  assert.match(result.detail, /could not be reached|timed out/i);
});

test('quarantined and failed artefacts are never served', () => {
  assert.equal(isServedStatus('quarantined', null), false);
  assert.equal(isServedStatus('failed', null), false);
  assert.equal(isServedStatus('stored', { scan: { state: 'infected' } }), false);
  assert.equal(isServedStatus('stored', { scan: { state: 'not_performed' } }), true);
  assert.equal(isServedStatus('stored', { scan: { state: 'clean' } }), true);
  assert.equal(isServedStatus('stored', {}), true);
});
