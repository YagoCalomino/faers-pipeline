// Post-processing of HTML rendered from Markdown (marked), used at build time by vite.config.js.

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
