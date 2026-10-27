// Static file server for local checks: serves <root> under <prefix>, as GitHub Pages serves a
// project site under /<repo>/. Optional gzip for text responses (whether GitHub Pages compresses
// was not confirmed; measure both). No dependencies.
// Usage: node scripts/serve.mjs <root> <port> <prefix> [gzip]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const [rootArg, port = '8200', prefix = '/', gz] = process.argv.slice(2);
const root = rootArg && resolve(rootArg);
const GZIP = gz === 'gzip';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.parquet': 'application/octet-stream',
  '.png': 'image/png',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

export function startServer({ root: dir = root, port: p = +port, prefix: pre = prefix, gzip = GZIP } = {}) {
  dir = resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(pre)) return res.writeHead(404).end();
    let file = normalize(join(dir, decodeURIComponent(url.pathname.slice(pre.length))));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end('not found');
    const ext = extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (gzip && COMPRESSIBLE.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': statSync(file).size });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(p, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`serving ${root} at http://127.0.0.1:${port}${prefix} gzip=${GZIP}`));
}
