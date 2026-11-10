// Screenshots of the README (docs/img/readme-*.jpg), taken from a local build of the site.
// Usage, from site/:
//   SITE_EXPORT=../data/site_export SITE_OUT=dist npm run build
//   node scripts/readme-shots.mjs [dist] [out dir]      (defaults: dist, ../docs/img)
// Serves the build with scripts/serve.mjs and uses the Playwright Chromium of the e2e tests.
// Also writes the link-preview image src/og/og-image.jpg (home page, 1200x630, under 100 KB),
// which the build copies to og-image.jpg.
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const [distArg = 'dist', outArg = '../docs/img'] = process.argv.slice(2);
const PORT = 8320;
const PREFIX = '/faers-pipeline/';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;
const out = (name) => resolve(outArg, `readme-${name}.jpg`);
const JPEG = { type: 'jpeg', quality: 85 };

const server = startServer({ root: resolve(distArg), port: PORT, prefix: PREFIX });
const browser = await chromium.launch();

async function open(route, opts) {
  const page = await browser.newPage(opts);
  await page.goto(BASE + route);
  await page.locator('main h1').first().waitFor();
  await page.waitForLoadState('networkidle');
  return page;
}

// Search page: the top of the page on a laptop screen.
let page = await open('#/', { viewport: { width: 1280, height: 800 } });
await page.screenshot({ path: out('search'), ...JPEG });
await page.close();

// Ingredient page: atorvastatin, the top of its reactions table with the reporting-pattern badges.
page = await open('#/ingredient/atorvastatin', { viewport: { width: 1280, height: 1350 } });
await page.locator('table.pairs').waitFor();
await page.screenshot({ path: out('ingredient'), ...JPEG });
await page.close();

// Pair page on a phone: atorvastatin and rhabdomyolysis, from the top of the page content (the
// breadcrumb and the headline, which name the pair) to the end of the two shares.
page = await open('#/ingredient/atorvastatin/15f363411c34bda6a976d905528afff2', {
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const top = await page.locator('main nav.crumbs').evaluate((e) => e.getBoundingClientRect().top + scrollY);
const end = await page.locator('#division').evaluate((e) => e.getBoundingClientRect().bottom + scrollY);
await page.screenshot({ path: out('pair-mobile'), fullPage: true, clip: { x: 0, y: top - 4, width: 360, height: end - top + 12 }, ...JPEG });
await page.close();

// Link-preview image: the home page in the light theme at 1200x630, the size Open Graph and
// Twitter cards use. JPEG quality goes down until the file is under 100 KB.
const og = resolve(dirname(fileURLToPath(import.meta.url)), '../src/og/og-image.jpg');
mkdirSync(dirname(og), { recursive: true });
page = await open('#/', { viewport: { width: 1200, height: 630 }, colorScheme: 'light' });
for (const quality of [85, 80, 75, 70, 65, 60]) {
  await page.screenshot({ path: og, type: 'jpeg', quality });
  if (statSync(og).size < 100_000) break;
}
if (statSync(og).size >= 100_000) throw new Error(`og-image.jpg is ${statSync(og).size} bytes, over 100 KB`);
await page.close();

await browser.close();
server.close?.();
process.exit(0);
