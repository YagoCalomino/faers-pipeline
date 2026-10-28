// Time to the first useful information of each page, bytes transferred, and screenshots, with
// Playwright's headless Chromium. Same profiles as the measurements in ADR 0003:
//   desktop  1366x900, no throttling, median of RUNS
//   mobile   Pixel 7 emulation, 150 ms latency, 1.6 Mbps down, 750 kbps up, CPU 4x slower, 1 run
// Every run uses a new browser context (empty cache). The site is served under /faers-pipeline/
// by scripts/serve.mjs, without and with gzip (GitHub Pages
// serves gzip: Content-Encoding: gzip on the published JSON, checked 2026-10-28).
// Usage: node scripts/measure.mjs <dist> <screens dir|-> [runs=3] [gzip|plain|both]
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { startServer } from './serve.mjs';

const [distArg = 'dist', screensArg = '-', runsArg = '3', modeArg = 'both'] = process.argv.slice(2);
const dist = resolve(distArg);
const RUNS = +runsArg;
const search = JSON.parse(readFileSync(resolve(dist, 'data/json/search.json'), 'utf8'));
const slug = search.rows[0][search.columns.indexOf('slug')];
const doc = JSON.parse(readFileSync(resolve(dist, `data/json/signals/${slug}.json`), 'utf8'));
const pairKey = doc.pairs[0].reaction_key;
const SLUG = process.env.MEASURE_SLUG || slug;
const PAIR = process.env.MEASURE_PAIR || pairKey;

// "First useful information": the element that carries the page's data, visible.
const SCENARIOS = [
  { name: 'home', route: '', wait: '#top-list li a' },
  { name: 'ingredient', route: `#/ingredient/${SLUG}`, wait: 'table.pairs tbody tr' },
  { name: 'pair', route: `#/ingredient/${SLUG}/${PAIR}`, wait: 'table.two-by-two td[data-field="a"]' },
  { name: 'quality', route: '#/quality', wait: 'table.metrics td.num' },
  { name: 'validation', route: '#/validation', wait: 'table.known tbody tr' },
  { name: 'method', route: '#/method', wait: '.prose h2' },
  { name: 'downloads', route: '#/downloads', wait: 'main section h2' },
];
const PROFILES = {
  desktop: { context: { viewport: { width: 1366, height: 900 } }, throttle: null, runs: RUNS },
  mobile: {
    context: { ...devices['Pixel 7'] },
    throttle: { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8, cpu: 4 },
    runs: 1,
  },
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
if (screensArg !== '-') mkdirSync(screensArg, { recursive: true });

const modes = modeArg === 'both' ? ['plain', 'gzip'] : [modeArg];
const browser = await chromium.launch();
const results = [];
for (const [mi, mode] of modes.entries()) {
  const port = 8330 + mi;
  const server = await startServer({ root: dist, port, prefix: '/faers-pipeline/', gzip: mode === 'gzip' });
  const base = `http://127.0.0.1:${port}/faers-pipeline/`;
  for (const sc of SCENARIOS) {
    for (const [pname, prof] of Object.entries(PROFILES)) {
      const times = [];
      const bytes = [];
      let error = null;
      let overflow = null;
      for (let i = 0; i < prof.runs; i++) {
        const ctx = await browser.newContext(prof.context);
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (prof.throttle) {
          const t = prof.throttle;
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: t.latency,
            downloadThroughput: t.download,
            uploadThroughput: t.upload,
          });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: t.cpu });
        }
        let total = 0;
        const pending = [];
        ctx.on('requestfinished', (req) =>
          pending.push(req.sizes().then((s) => (total += s.responseBodySize + s.responseHeadersSize)).catch(() => {})),
        );
        const t0 = Date.now();
        try {
          await page.goto(base + sc.route, { waitUntil: 'commit', timeout: 120000 });
          await page.locator(sc.wait).first().waitFor({ state: 'visible', timeout: 120000 });
          times.push(Date.now() - t0);
          await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
          await Promise.all(pending);
          bytes.push(total);
          if (i === 0) {
            overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            if (screensArg !== '-' && mode === 'gzip') {
              await page.screenshot({ path: `${screensArg}/${sc.name}-${pname}.png`, fullPage: pname === 'desktop' });
            }
          }
        } catch (e) {
          error = String(e).split('\n')[0].slice(0, 200);
        }
        await ctx.close();
        if (error) break;
      }
      const r = {
        mode,
        page: sc.name,
        profile: pname,
        runs: times.length,
        ms_median: times.length ? median(times) : null,
        ms_all: times,
        kb_transferred: bytes.length ? Math.round(median(bytes) / 1024) : null,
        horizontal_overflow_px: overflow,
        error,
      };
      results.push(r);
      console.log(JSON.stringify(r));
    }
  }
  server.close();
}
await browser.close();
