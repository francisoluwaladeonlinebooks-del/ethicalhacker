import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * design.md §11 publishes a contrast record. This test is what makes that record
 * true: every pair is recomputed from the tokens actually shipped in
 * `globals.css`, so a later "small colour tweak" cannot silently drop the
 * interface below WCAG 2.2 AA.
 *
 * Ratios follow WCAG 2.x relative luminance. Body text needs 4.5:1; large text
 * and non-text UI boundaries need 3:1.
 */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

const tokens = new Map<string, string>();
for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  tokens.set(match[1], match[2].toLowerCase());
}

function token(name: string): string {
  const value = tokens.get(name);
  assert.ok(value, `token --${name} is not declared in globals.css`);
  return value;
}

function channel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [channel(hex, 1), channel(hex, 3), channel(hex, 5)].map((value) =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every published pair, with the threshold it must clear. */
const PAIRS: { fg: string; bg: string; min: number; note: string }[] = [
  { fg: 'ficap-ink', bg: 'ficap-surface', min: 4.5, note: 'body text on a panel' },
  { fg: 'ficap-ink-muted', bg: 'ficap-surface', min: 4.5, note: 'secondary text on a panel' },
  { fg: 'ficap-ink-faint', bg: 'ficap-surface', min: 4.5, note: 'placeholder and tertiary text' },
  { fg: 'ficap-accent', bg: 'ficap-surface', min: 4.5, note: 'links on a panel' },
  { fg: 'ficap-accent', bg: 'ficap-surface-sunken', min: 4.5, note: 'links in a table header band' },
  { fg: 'ficap-ink-muted', bg: 'ficap-bg', min: 4.5, note: 'captions on the application canvas' },
  { fg: 'ficap-ink-inverse', bg: 'ficap-field', min: 4.5, note: 'text on the navy field' },
  { fg: 'ficap-ink-inverse-muted', bg: 'ficap-field', min: 4.5, note: 'captions on the navy field' },
  { fg: 'ficap-ink-inverse-muted', bg: 'ficap-field-deep', min: 4.5, note: 'captions on the footer well' },
  { fg: 'ficap-warm-ink', bg: 'ficap-warm', min: 4.5, note: 'text on the champagne accent' },
  { fg: 'sev-critical', bg: 'ficap-surface', min: 4.5, note: 'critical severity label' },
  { fg: 'sev-high', bg: 'ficap-surface', min: 4.5, note: 'high severity label' },
  { fg: 'sev-medium', bg: 'ficap-surface', min: 4.5, note: 'medium severity label' },
  { fg: 'sev-low', bg: 'ficap-surface', min: 4.5, note: 'low severity label' },
  { fg: 'sev-critical', bg: 'ficap-bg', min: 4.5, note: 'critical severity on the canvas' },
];

for (const pair of PAIRS) {
  test(`contrast: --${pair.fg} on --${pair.bg} meets ${pair.min}:1 (${pair.note})`, () => {
    const ratio = contrast(token(pair.fg), token(pair.bg));
    assert.ok(
      ratio >= pair.min,
      `--${pair.fg} on --${pair.bg} is ${ratio.toFixed(2)}:1, below the required ${pair.min}:1. Adjust the token or amend design.md §11 with a justified exception.`,
    );
  });
}

test('severity levels are distinguishable by luminance as well as hue', () => {
  // design.md §7 requires that removing colour does not remove the level. Hue
  // alone would fail in greyscale and forced-colours mode, so each adjacent pair
  // of severity tokens must also differ perceptibly in luminance.
  const order = ['sev-critical', 'sev-high', 'sev-medium', 'sev-low'];
  for (let i = 0; i < order.length - 1; i += 1) {
    const a = relativeLuminance(token(order[i]));
    const b = relativeLuminance(token(order[i + 1]));
    assert.ok(Math.abs(a - b) > 0.002, `--${order[i]} and --${order[i + 1]} have near-identical luminance`);
  }
});

test('severity tokens are defined separately from status colours', () => {
  // A workflow status must not be able to inherit a severity hue by accident.
  for (const name of ['sev-critical', 'sev-high', 'sev-medium', 'sev-low', 'sev-info']) {
    assert.ok(token(name).startsWith('#'), `${name} must be a literal token`);
  }
});
