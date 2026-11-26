// KV-Diagramm (Karnaugh-Veitch) als SVG mit eingezeichneten Primimplikanten
const GRAY = { 0: [0], 1: [0, 1], 2: [0, 1, 3, 2] };
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// expr: {name, ones, terms, vars}; nur für 2–4 Variablen
export function kvSVG(expr) {
  const n = expr.vars.length;
  if (n < 2 || n > 4) return null;
  const nc = Math.ceil(n / 2), nr = n - nc;            // Spalten- und Zeilenvariablen
  const colVars = expr.vars.slice(0, nc), rowVars = expr.vars.slice(nc);
  const cols = GRAY[nc], rows = GRAY[nr];
  const ones = new Set(expr.ones), dcs = new Set(expr.dcs || []);
  const C = 52, L = 64, T = 58;                         // Zellgröße, Ränder
  const W = L + cols.length * C + 12, H = T + rows.length * C + 12;
  const bin = (v, k) => v.toString(2).padStart(k, '0');
  const minterm = (r, c) => (cols[c] << nr) | rows[r];
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="kv" font-family="-apple-system,Segoe UI,sans-serif">`;
  // Kopf
  s += `<text x="${L - 8}" y="${T - 30}" text-anchor="end" font-size="13" fill="#6b7280">${esc(colVars.join(''))}</text>`;
  s += `<text x="${L - 8}" y="${T - 12}" text-anchor="end" font-size="13" fill="#6b7280">${esc(rowVars.join(''))}</text>`;
  s += `<line x1="${L - 40}" y1="${T - 26}" x2="${L - 4}" y2="${T - 4}" stroke="#d4d6dc"/>`;
  cols.forEach((g, c) => { s += `<text x="${L + c * C + C / 2}" y="${T - 12}" text-anchor="middle" font-size="14" font-weight="600">${bin(g, nc)}</text>`; });
  rows.forEach((g, r) => { s += `<text x="${L - 10}" y="${T + r * C + C / 2 + 5}" text-anchor="end" font-size="14" font-weight="600">${bin(g, nr)}</text>`; });
  // Zellen
  rows.forEach((_, r) => cols.forEach((_, c) => {
    const m = minterm(r, c), v = ones.has(m), x = dcs.has(m);
    s += `<rect x="${L + c * C}" y="${T + r * C}" width="${C}" height="${C}" fill="#fff" stroke="#9ca3af"/>`;
    s += `<text x="${L + c * C + C / 2}" y="${T + r * C + C / 2 + 7}" text-anchor="middle" font-size="20" font-weight="${v || x ? 700 : 400}" fill="${v ? '#15803d' : x ? '#7c3aed' : '#9ca3af'}">${v ? 1 : x ? 'X' : 0}</text>`;
    s += `<text x="${L + c * C + 4}" y="${T + r * C + 12}" font-size="9" fill="#b0b4bb">${m}</text>`;
  }));
  // Primimplikanten als Blöcke (bei Umbruch über den Rand in Teilen)
  const runs = idx => {
    const out = []; let cur = null;
    idx.forEach(i => { if (cur && i === cur[1] + 1) cur[1] = i; else { cur = [i, i]; out.push(cur); } });
    return out;
  };
  expr.terms.forEach((p, k) => {
    const colIdx = cols.map((g, c) => c).filter(c => rows.length && ((minterm(0, c) ^ p.v) & ~p.m & (((1 << nc) - 1) << nr)) === 0);
    const rowIdx = rows.map((g, r) => r).filter(r => ((minterm(r, 0) ^ p.v) & ~p.m & ((1 << nr) - 1)) === 0);
    const col = COLORS[k % COLORS.length], ins = 5 + (k % 4) * 3;
    for (const [r0, r1] of runs(rowIdx)) for (const [c0, c1] of runs(colIdx)) {
      s += `<rect x="${L + c0 * C + ins}" y="${T + r0 * C + ins}" width="${(c1 - c0 + 1) * C - 2 * ins}" height="${(r1 - r0 + 1) * C - 2 * ins}" rx="12" fill="${col}" fill-opacity="0.10" stroke="${col}" stroke-width="2.5"/>`;
    }
  });
  return s + '</svg>';
}
export const KV_COLORS = COLORS;
