// Pre- and post-processing of the Markdown rendered by marked, used at build time by
// vite.config.js.

// Keeps the text before the first level-2 heading and the "## <title>" sections listed in
// `titles` (config/site.yaml method_page.sections), in file order. Headings inside fenced code
// blocks do not count. Throws when a listed title is missing, so a renamed heading fails the
// build instead of silently dropping a section.
export function selectSections(markdown, titles) {
  const wanted = new Set(titles);
  const found = new Set();
  const out = [];
  let keep = true;
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^## (.+?)\s*$/.exec(line);
    if (m) {
      keep = wanted.has(m[1]);
      if (keep) found.add(m[1]);
    }
    if (keep) out.push(line);
  }
  const missing = titles.filter((t) => !found.has(t));
  if (missing.length) throw new Error(`sections not found in the Markdown: ${missing.join(', ')}`);
  return out.join('\n');
}

const HEADING = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g;
const TABLE = /<table[\s>][\s\S]*?<\/table>/g;

// Visible text of an HTML fragment, entities kept as they are (valid inside an attribute).
function textOf(html) {
  return html.replace(/<[^>]*>/g, '').replace(/"/g, '&quot;').replace(/\s+/g, ' ').trim();
}

// Wraps every <table> in the same focusable scroll region as the other pages (.table-scroll):
// a table wider than the column scrolls inside a region that the keyboard can reach and screen
// readers can name. The name is the text of the closest heading before the table ("<heading>,
// table 2" for a second table under it), or "Table N" when no heading precedes it.
export function wrapTables(html) {
  const headings = [...html.matchAll(HEADING)].map((m) => ({ at: m.index, text: textOf(m[2]) }));
  const perHeading = new Map();
  let n = 0;
  return html.replace(TABLE, (table, at) => {
    n += 1;
    const heading = headings.filter((h) => h.at < at).at(-1);
    let label = `Table ${n}`;
    if (heading?.text) {
      const k = (perHeading.get(heading.at) ?? 0) + 1;
      perHeading.set(heading.at, k);
      label = k === 1 ? heading.text : `${heading.text}, table ${k}`;
    }
    return `<div class="table-scroll" role="region" aria-label="${label}" tabindex="0">${table}</div>`;
  });
}
