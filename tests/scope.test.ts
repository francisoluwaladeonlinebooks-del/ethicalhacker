import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateTarget, ipInCidr, isPrivateOrSpecialAddress, isSafeMethod, normaliseHost, parseTargetUrl, type ScopeAsset } from '../src/lib/scope';

const domainAsset = (value: string, extra: Partial<ScopeAsset> = {}): ScopeAsset => ({
  id: 'asset-1',
  asset_type: 'domain',
  value,
  allow_subdomains: false,
  allowed_methods: ['GET', 'HEAD'],
  ...extra,
});

test('an asset inside the approved scope is allowed', () => {
  const result = evaluateTarget('https://bank.example/online/accounts', 'GET', [domainAsset('bank.example')]);
  assert.equal(result.allowed, true, result.reason);
  assert.equal(result.code, 'allowed');
});

test('a host that is not listed is refused', () => {
  const result = evaluateTarget('https://other.example/', 'GET', [domainAsset('bank.example')]);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'not_in_scope');
});

test('subdomains are refused unless the asset explicitly allows them', () => {
  const strict = evaluateTarget('https://api.bank.example/', 'GET', [domainAsset('bank.example')]);
  assert.equal(strict.allowed, false);
  const permissive = evaluateTarget('https://api.bank.example/', 'GET', [domainAsset('bank.example', { allow_subdomains: true })]);
  assert.equal(permissive.allowed, true, permissive.reason);
});

test('an exclusion always wins over a scope entry', () => {
  const result = evaluateTarget(
    'https://bank.example/admin',
    'GET',
    [domainAsset('bank.example')],
    [{ asset_type: 'url', value: 'https://bank.example/admin' }],
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'excluded');
});

test('write methods are refused when the asset only permits safe methods', () => {
  const result = evaluateTarget('https://bank.example/api/transfer', 'POST', [domainAsset('bank.example')]);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'method_not_allowed');
});

test('an asset that lists a method permits exactly that method', () => {
  const asset = domainAsset('bank.example', { allowed_methods: ['GET', 'POST'] });
  assert.equal(evaluateTarget('https://bank.example/pay', 'POST', [asset]).allowed, true);
  assert.equal(evaluateTarget('https://bank.example/pay', 'DELETE', [asset]).allowed, false);
});

test('path prefixes confine requests to the approved area', () => {
  const asset = domainAsset('bank.example', { path_prefix: '/public' });
  assert.equal(evaluateTarget('https://bank.example/public/rates', 'GET', [asset]).allowed, true);
  assert.equal(evaluateTarget('https://bank.example/private/rates', 'GET', [asset]).allowed, false);
});

test('private and special addresses are refused even when listed', () => {
  const target = evaluateTarget('http://127.0.0.1:8080/', 'GET', [{ asset_type: 'url', value: 'http://127.0.0.1:8080' }]);
  assert.equal(target.allowed, false);
  assert.equal(target.code, 'blocked_address');

  const internal = evaluateTarget('http://10.0.0.5/', 'GET', [{ asset_type: 'ip_address', value: '10.0.0.5' }]);
  assert.equal(internal.allowed, false);
  assert.equal(internal.code, 'blocked_address');
});

test('the loopback training range is only reachable when explicitly enabled for demo mode', () => {
  const assets: ScopeAsset[] = [
    { asset_type: 'url', value: '127.0.0.1', is_training_range: true, scheme: 'http', port: 3000, path_prefix: '/demo', allowed_methods: ['GET'] },
  ];
  assert.equal(evaluateTarget('http://127.0.0.1:3000/demo', 'GET', assets).allowed, false);
  const enabled = evaluateTarget('http://127.0.0.1:3000/demo', 'GET', assets, [], { allowLoopbackTrainingRange: true });
  assert.equal(enabled.allowed, true, enabled.reason);
});

test('CIDR matching is exact for the network and mask', () => {
  assert.equal(ipInCidr('192.168.1.20', '192.168.1.0/24'), true);
  assert.equal(ipInCidr('192.168.2.20', '192.168.1.0/24'), false);
  assert.equal(ipInCidr('10.20.30.40', '10.20.0.0/16'), true);
  assert.equal(ipInCidr('10.21.30.40', '10.20.0.0/16'), false);
});

test('unsafe schemes and malformed targets are refused', () => {
  assert.equal(evaluateTarget('file:///etc/passwd', 'GET', [domainAsset('bank.example')]).allowed, false);
  assert.equal(evaluateTarget('javascript:alert(1)', 'GET', [domainAsset('bank.example')]).allowed, false);
  assert.throws(() => parseTargetUrl('not a url'));
});

test('host normalisation is case and trailing-dot insensitive', () => {
  assert.equal(normaliseHost('BANK.Example.'), 'bank.example');
});

test('private address detection covers documentation and link-local ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.4.4', '192.168.0.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateOrSpecialAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) {
    assert.equal(isPrivateOrSpecialAddress(address), false, address);
  }
});

test('only safe HTTP methods are classified as non-mutating', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(isSafeMethod(method), true, method);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isSafeMethod(method), false, method);
});
