// Writes the built site (dist/) as the single commit of a local orphan branch (config/site.yaml
// site.pages_branch, default gh-pages) and prints the commands to publish it. Never pushes.
//
// Git plumbing with a temporary index file, so the working tree, the real index and the current
// branch are never touched: add dist/ to the temporary index, write-tree, commit-tree without a
// parent (orphan: no history), update-ref. A previous gh-pages commit is replaced, not extended.
// Files are committed byte for byte (core.autocrlf=false).
//
// Refuses to run when dist/data/manifest.json is not the export validated by publish_site or
// make publish-site (its sha256 must equal the ready marker's manifest_sha256).
// Usage: node scripts/gh-pages.mjs --marker <ready.json> [--dist dist] [--branch gh-pages]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const REPO = resolve(SITE, '..');
const cfg = YAML.parse(readFileSync(join(REPO, 'config/site.yaml'), 'utf8')).site;

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const dist = resolve(SITE, args.dist || 'dist');
const branch = args.branch || cfg.pages_branch;
const marker = args.marker && resolve(SITE, args.marker);

function fail(msg) {
  console.error(`gh-pages: ${msg}`);
  process.exit(1);
}

const git = (gitArgs, opts = {}) =>
  execFileSync('git', ['-C', REPO, '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...gitArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();

if (!existsSync(join(dist, 'index.html'))) fail(`no build in ${dist} (run the build first)`);
if (!marker || !existsSync(marker)) fail('ready marker not found (--marker); run the validated export first');
const ready = JSON.parse(readFileSync(marker, 'utf8'));
const distManifest = readFileSync(join(dist, 'data', 'manifest.json'));
const sha = createHash('sha256').update(distManifest).digest('hex');
if (sha !== ready.manifest_sha256) {
  fail(`dist/data/manifest.json (${sha.slice(0, 12)}…) is not the validated export (${ready.manifest_sha256.slice(0, 12)}…)`);
}
const meta = JSON.parse(readFileSync(join(dist, 'data', 'meta.json'), 'utf8'));
const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (current === branch) fail(`the current branch is ${branch}; switch to another branch first`);

const tmp = mkdtempSync(join(tmpdir(), 'faers-gh-pages-'));
const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
let commit;
let tree;
try {
  // --work-tree points git at dist/; -f ignores the repository's .gitignore patterns.
  execFileSync('git', ['--git-dir', join(REPO, '.git'), '--work-tree', dist, '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', 'add', '-A', '-f', '.'], {
    cwd: dist,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tree = execFileSync('git', ['--git-dir', join(REPO, '.git'), 'write-tree'], { cwd: dist, env, encoding: 'utf8' }).trim();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let previous = null;
try {
  previous = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
} catch {
  previous = null;
}
const previousTree = previous ? git(['rev-parse', `${previous}^{tree}`]) : null;
if (previousTree === tree) {
  commit = previous;
  console.log(`${branch} already holds this build (tree ${tree.slice(0, 12)}); nothing to commit.`);
} else {
  const message = `Publish site: data through ${meta.last_quarter}, exported ${meta.export_date}`;
  commit = git(['commit-tree', tree, '-m', message]);
  git(['update-ref', `refs/heads/${branch}`, commit, ...(previous ? [previous] : [])]);
  console.log(`${branch} -> ${commit.slice(0, 12)} (tree ${tree.slice(0, 12)}, orphan, ${previous ? `replaces ${previous.slice(0, 12)}` : 'new branch'})`);
}

const count = git(['rev-list', '--count', branch]);
const files = git(['ls-tree', '-r', '--name-only', branch]).split('\n').length;
const remote = (() => {
  try {
    return git(['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
})();
const remoteUrl = `${cfg.repo_url}.git`;
console.log(`
Branch ${branch}: ${count} commit, ${files} files, data through ${meta.last_quarter} (export ${meta.export_date}).
Nothing was pushed. To publish, run from the repository root:
${remote ? `  # origin is ${remote}` : `  git remote add origin ${remoteUrl}`}
  git push --force origin ${branch}
--force is expected: every publish replaces the single orphan commit.
First time only, on GitHub: Settings > Pages > Build and deployment > Source "Deploy from a
branch", Branch "${branch}", folder "/ (root)", Save. The site is then served at
  ${cfg.public_url}`);
