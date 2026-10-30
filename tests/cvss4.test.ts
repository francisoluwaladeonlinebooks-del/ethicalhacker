import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { scoreVector, severityFromScore, isValidVector, parseVector, buildVector } from '../src/lib/cvss/engine';

type Fixture = { vector: string; score: number };

const reference = JSON.parse(readFileSync(new URL('./fixtures/cvss4-reference.json', import.meta.url), 'utf8')) as {
  count: number;
  macroVectorsCovered: number;
  cases: Fixture[];
};
const fixtures: Fixture[] = reference.cases;

test('CVSS v4.0 reference vectors score exactly', () => {
  assert.ok(fixtures.length >= 6000, `reference fixture is present (${fixtures.length} cases)`);
  assert.equal(fixtures.length, reference.count, 'fixture count matches its declared count');
  let checked = 0;
  for (const fixture of fixtures) {
    const result = scoreVector(fixture.vector);
    assert.equal(
      Number(result.score.toFixed(1)),
      Number(fixture.score.toFixed(1)),
      `score mismatch for ${fixture.vector}: expected ${fixture.score}, received ${result.score}`,
    );
    checked += 1;
  }
  assert.equal(checked, fixtures.length);
});

test('severity bands follow the specification boundaries', () => {
  assert.equal(severityFromScore(0), 'none');
  assert.equal(severityFromScore(0.1), 'low');
  assert.equal(severityFromScore(3.9), 'low');
  assert.equal(severityFromScore(4.0), 'medium');
  assert.equal(severityFromScore(6.9), 'medium');
  assert.equal(severityFromScore(7.0), 'high');
  assert.equal(severityFromScore(8.9), 'high');
  assert.equal(severityFromScore(9.0), 'critical');
  assert.equal(severityFromScore(10), 'critical');
});

test('vectors round-trip through parse and build', () => {
  for (const fixture of fixtures.slice(0, 250)) {
    const metrics = parseVector(fixture.vector);
    const rebuilt = buildVector(metrics);
    assert.equal(scoreVector(rebuilt).score, scoreVector(fixture.vector).score);
  }
});

test('malformed vectors are rejected rather than scored', () => {
  for (const vector of ['', 'CVSS:4.0', 'CVSS:3.1/AV:N', 'CVSS:4.0/AV:X', 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H/ZZ:Z']) {
    assert.equal(isValidVector(vector), false, `expected ${vector} to be rejected`);
  }
});

test('a vector without all base metrics is rejected', () => {
  assert.equal(isValidVector('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N'), false);
});
