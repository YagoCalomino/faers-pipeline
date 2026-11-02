// WCAG 2.2 contrast of the color tokens in src/style.css, in both themes: text pairs at least
// 4.5:1 (1.4.3), non-text marks at least 3:1 (1.4.11). The tokens are read from the stylesheet,
// so the test checks the values that ship, not the ones written in the design notes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/style.css'), 'utf8');

function tokens(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no ${selector} block`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum, where it is used]
const TEXT = 4.5;
const MARK = 3;
const PAIRS = [
  ['text', 'bg', TEXT, 'body text'],
  ['text', 'surface', TEXT, 'notice, footer, details'],
  ['text', 'accent-100', TEXT, 'selected search option, chip hover'],
  ['muted', 'bg', TEXT, 'secondary text'],
  ['muted', 'surface', TEXT, 'footer last line'],
  ['muted', 'accent-100', TEXT, 'case count in a selected option'],
  ['accent-700', 'bg', TEXT, 'links'],
  ['accent-700', 'surface', TEXT, 'links in the notice and footer'],
  ['accent-800', 'bg', TEXT, 'link hover'],
  ['pattern-text', 'pattern-bg', TEXT, 'reporting-pattern badge'],
  ['accent', 'bg', MARK, 'focus ring, active nav'],
  ['accent', 'surface', MARK, 'focus ring in the notice and footer'],
  ['border', 'bg', MARK, 'input, button and chip borders'],
  ['volume', 'bg', MARK, 'volume bars of the home list'],
  ['accent-700', 'accent-200', MARK, 'magnitude dot and range over its band'],
  ['accent-700', 'track', MARK, 'share bars over their track'],
];
// Not checked, on purpose: divider (hairlines between rows) and accent-200 (the band from 0 to
// the magnitude dot: the dot and the number in its own cell carry the value).

for (const [theme, selector] of [['light', ':root'], ['dark', "[data-theme='dark']"]]) {
  test(`contrast of the ${theme} tokens`, () => {
    const t = tokens(selector);
    const bad = [];
    for (const [fg, bg, min, use] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${theme}: token ${t[fg] ? bg : fg} missing`);
      const r = ratio(t[fg], t[bg]);
      if (r < min) bad.push(`${fg} on ${bg} ${r.toFixed(2)} < ${min} (${use})`);
    }
    assert.deepEqual(bad, []);
  });
}

test('both themes define the same color tokens', () => {
  assert.deepEqual(Object.keys(tokens("[data-theme='dark']")).sort(), Object.keys(tokens(':root')).sort());
});
