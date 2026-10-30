// Screenshots of the README (docs/img/readme-*.jpg), taken from a local build of the site.
// Usage, from site/:
//   SITE_EXPORT=../data/site_export SITE_OUT=dist npm run build
//   node scripts/readme-shots.mjs [dist] [out dir]      (defaults: dist, ../docs/img)
// Serves the build with scripts/serve.mjs and uses the Playwright Chromium of the e2e tests.
import { resolve } from 'node:path';
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

// Ingredient page: atorvastatin, the top of its reactions table with the concentration alerts.
page = await open('#/ingredient/atorvastatin', { viewport: { width: 1280, height: 900 } });
await page.locator('table.pairs').waitFor();
await page.screenshot({ path: out('ingredient'), ...JPEG });
await page.close();

// Pair page on a phone: atorvastatin and rhabdomyolysis, from the criteria to the first rows of
// the quarterly table.
page = await open('#/ingredient/atorvastatin/15f363411c34bda6a976d905528afff2', {
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const top = await page.locator('dt', { hasText: 'ROR criterion' }).evaluate((e) => e.parentElement.getBoundingClientRect().top + scrollY);
const table = await page.locator('main table').last().evaluate((e) => e.getBoundingClientRect().top + scrollY);
await page.screenshot({ path: out('pair-mobile'), fullPage: true, clip: { x: 0, y: top - 4, width: 360, height: table - top + 110 }, ...JPEG });
await page.close();

await browser.close();
server.close?.();
process.exit(0);
