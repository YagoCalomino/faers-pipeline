// Quarterly trend of a pair as an inline SVG bar chart (reports per init quarter). Hand-drawn:
// one series, at most a few dozen bars, so a chart library would add weight without need.
// Quarters with fewer than 3 reports have no bar and a "<3" label; the provisional quarter is
// drawn with a hatched bar. Colors come from CSS custom properties, so the chart follows the
// light and dark themes. The page shows the same values in a table next to the chart.

const W = 640;
const H = 220;
const PAD = { top: 16, right: 12, bottom: 40, left: 48 };

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function trendSvg(series, { provisionalQuarter, titleId, descId, title, desc }) {
  const max = niceMax(Math.max(3, ...series.map((s) => s.a ?? 0)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = iw / Math.max(series.length, 1);
  const bw = Math.min(48, step * 0.7);
  const y = (v) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const parts = [];
  parts.push(
    `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${titleId} ${descId}" preserveAspectRatio="xMidYMid meet">`,
    `<title id="${titleId}">${esc(title)}</title><desc id="${descId}">${esc(desc)}</desc>`,
    '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="bar-provisional-bg"/><line x1="0" y1="0" x2="0" y2="6" class="bar-provisional-line"/></pattern></defs>',
  );
  for (const t of ticks) {
    parts.push(
      `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t)}" y2="${y(t)}"/>`,
      `<text class="tick" x="${PAD.left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`,
    );
  }
  series.forEach((s, i) => {
    const cx = PAD.left + step * i + step / 2;
    const provisional = s.quarter === provisionalQuarter;
    if (s.a == null) {
      parts.push(`<text class="none" x="${cx}" y="${y(0) - 6}" text-anchor="middle">&lt;3</text>`);
    } else {
      const top = y(s.a);
      parts.push(
        `<rect class="${provisional ? 'bar provisional' : 'bar'}" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${y(0) - top}"${provisional ? ' fill="url(#hatch)"' : ''}/>`,
        `<text class="value" x="${cx}" y="${top - 4}" text-anchor="middle">${s.a}</text>`,
      );
    }
    parts.push(
      `<text class="tick" x="${cx}" y="${H - PAD.bottom + 16}" text-anchor="middle">${esc(s.quarter)}${provisional ? '*' : ''}</text>`,
    );
  });
  parts.push(
    `<text class="axis" x="12" y="${PAD.top + ih / 2}" transform="rotate(-90 12 ${PAD.top + ih / 2})" text-anchor="middle">Reports</text>`,
    '</svg>',
  );
  return parts.join('');
}
