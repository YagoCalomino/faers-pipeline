// Words the site never uses to describe a result: side effects, risk, dangerous, causes, rate,
// likelihood (and their forms). They may appear only inside the exact negating phrases of
// ALLOWED. Scans every site-authored string: the page shell, the page scripts, the build's shell
// texts, config/site.yaml, the RxNorm attribution and the docs/limitations.md sections rendered
// on the Method page.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { selectSections } from '../../src/lib/markdown.js';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(SITE, '..');
const read = (p) => readFileSync(p, 'utf8');

const BANNED = /\b(side[- ]effects?|risks?|risky|dangerous|caus(?:e|es|ed|ing)|rates?|likelihood)\b/gi;
export const ALLOWED = [
  'does not measure incidence or risk',
  'not evidence that the drug causes the reaction',
  'not evidence that the medicine causes the reaction',
  'without a pharmacological cause',
  'not that the drug is proven not to cause it',
  'do not show that a medicine causes a reaction',
  'not proof that a medicine causes anything',
  'whether the medicine caused it',
  'Reporting volume, not risk',
];

// Code comments are not site text; URLs ("https://") are not comments.
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const flat = (s) =>
  s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ');

function sources() {
  const out = {};
  out['site/index.html'] = read(join(SITE, 'index.html'));
  out['site/vite.config.js'] = stripJs(read(join(SITE, 'vite.config.js')));
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
    );
  for (const f of walk(join(SITE, 'src'))) out[f.slice(SITE.length + 1).replaceAll('\\', '/')] = stripJs(read(f));
  // YAML values only (comments are notes for maintainers).
  out['config/site.yaml'] = JSON.stringify(YAML.parse(read(join(REPO, 'config/site.yaml'))));
  out['config/rxnorm.yaml attribution'] = YAML.parse(read(join(REPO, 'config/rxnorm.yaml'))).attribution_text;
  const sections = YAML.parse(read(join(REPO, 'config/site.yaml'))).method_page.sections;
  out['docs/limitations.md (Method page)'] = selectSections(read(join(REPO, 'docs/limitations.md')), sections);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, flat(v)]));
}

test('vocabulary: restricted words only inside the allowed negating phrases', () => {
  const hits = [];
  for (const [name, text] of Object.entries(sources())) {
    let rest = text;
    for (const phrase of ALLOWED) rest = rest.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    for (const m of rest.matchAll(BANNED)) hits.push(`${name}: "${m[0]}" in "…${rest.slice(Math.max(0, m.index - 60), m.index + 40).trim()}…"`);
  }
  assert.deepEqual(hits, []);
});

test('vocabulary: every allowed phrase is still used (the list stays exact)', () => {
  const all = Object.values(sources()).join(' ').toLowerCase();
  assert.deepEqual(ALLOWED.filter((p) => !all.includes(p.toLowerCase())), []);
});

test('vocabulary: the scan catches a restricted word outside the allowed phrases', () => {
  const sample = 'A higher reporting rate means the drug causes harm. Reporting volume, not risk.';
  let rest = sample;
  for (const phrase of ALLOWED) rest = rest.replace(new RegExp(phrase, 'gi'), ' ');
  assert.deepEqual([...rest.matchAll(BANNED)].map((m) => m[0]), ['rate', 'causes']);
});
