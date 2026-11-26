// Messgraph (Zeitdiagramm): zeichnet die Werte von Ein-/Ausgängen über die Simulationsschritte auf
import { attrsOf, formatValue, pinsWorld } from './components.js';

const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true });
const GATES = new Set(['And', 'Or', 'Not', 'NAnd', 'NOr', 'XOr', 'XNOr']);

export class Recorder {
  constructor() { this.signals = []; this.samples = []; this.max = 600; }

  reset(circuit) {
    const pick = (types, need) => circuit.comps.filter(c => types.includes(c.type) && (!need || attrsOf(c).Label))
      .map((c, i) => ({ c, name: attrsOf(c).Label || c.type + (i + 1), bits: attrsOf(c).Bits || 1 }));
    this.signals = [
      ...pick(['Clock']), ...pick(['In']).sort((a, b) => natural(a.name, b.name)),
      ...circuit.comps.filter(c => GATES.has(c.type) && attrsOf(c).Label).map(c => ({ c, name: attrsOf(c).Label, bits: attrsOf(c).Bits || 1, step: true })),
      ...pick(['Probe'], true).map(s => ({ ...s, step: true })),
      ...circuit.comps.filter(c => c.type === 'Sub' && attrsOf(c).Label).flatMap(c => pinsWorld(c).filter(p => p.out).map((p, k) => ({ c, k, name: attrsOf(c).Label + '.' + p.n, bits: p.bits || 1, step: true }))),
      ...pick(['Out']).sort((a, b) => natural(a.name, b.name)),
    ];
    this.samples = [];
  }

  value(sim, s) {
    if (s.c.type === 'Sub') return sim.subOut(s.c, s.k);
    const st = sim.st(s.c); if (!st) return null;
    if (s.c.type === 'In' || s.c.type === 'Clock') return st.value;
    if (GATES.has(s.c.type)) return st.outs[0];
    if (s.c.type === 'Sub') return sim.subOut(s.c, s.k);
    if (s.c.type === 'Probe') { s.bits = st.bits[0] || 1; return st.ins[0]; }
    return st.ins[0];
  }

  sample(sim) {
    const vals = this.signals.map(s => this.value(sim, s));
    const last = this.samples[this.samples.length - 1];
    if (last && last.every((v, i) => v === vals[i])) return false;
    this.samples.push(vals);
    if (this.samples.length > this.max) this.samples.shift();
    return true;
  }

  render(cv) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const lane = 30, left = 78, n = this.signals.length;
    g.font = '600 13px -apple-system, "Segoe UI", sans-serif'; g.textBaseline = 'middle';
    if (!n) { g.fillStyle = '#6b7280'; g.fillText('Keine Ein- oder Ausgänge vorhanden.', 12, 20); return; }
    const step = Math.max(12, Math.min(44, (W - left - 12) / Math.max(8, this.samples.length)));
    const visible = Math.floor((W - left - 12) / step);
    const data = this.samples.slice(-visible);
    const first = this.samples.length - data.length;
    // Raster
    g.strokeStyle = '#eef0f3'; g.lineWidth = 1;
    for (let i = 0; i <= data.length; i++) { const x = left + i * step + 0.5; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 8 + n * lane); g.stroke(); }
    this.signals.forEach((s, k) => {
      const y0 = 8 + k * lane, hi = y0 + 5, lo = y0 + lane - 7, mid = (hi + lo) / 2;
      g.fillStyle = s.step ? '#6b7280' : s.c.type === 'Out' ? '#b45309' : '#1e3a8a';
      g.textAlign = 'right';
      g.fillText(s.name.length > 9 ? s.name.slice(0, 8) + '…' : s.name, left - 10, mid);
      if (k) { g.strokeStyle = '#f3f4f6'; g.beginPath(); g.moveTo(0, y0 - 0.5); g.lineTo(W, y0 - 0.5); g.stroke(); }
      if (s.bits === 1) {
        g.strokeStyle = '#16a34a'; g.lineWidth = 2; g.beginPath();
        data.forEach((row, i) => {
          const v = row[k], yy = v == null ? mid : v ? hi : lo, x = left + i * step;
          if (i === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
          g.lineTo(x + step, yy);
        });
        g.stroke();
      } else {
        g.lineWidth = 1.5; g.strokeStyle = '#1f5f33'; g.textAlign = 'center'; g.font = '600 11px -apple-system, sans-serif';
        let i = 0;
        while (i < data.length) {
          let j = i; while (j + 1 < data.length && data[j + 1][k] === data[i][k]) j++;
          const x0 = left + i * step, x1 = left + (j + 1) * step, e = Math.min(4, (x1 - x0) / 3);
          g.beginPath(); g.moveTo(x0, mid); g.lineTo(x0 + e, hi); g.lineTo(x1 - e, hi); g.lineTo(x1, mid); g.lineTo(x1 - e, lo); g.lineTo(x0 + e, lo); g.closePath();
          g.fillStyle = '#ecfdf3'; g.fill(); g.stroke();
          const txt = formatValue(data[i][k], s.bits, 'def');
          if (x1 - x0 > g.measureText(txt).width + 6) { g.fillStyle = '#14532d'; g.fillText(txt, (x0 + x1) / 2, mid + 0.5); }
          i = j + 1;
        }
        g.font = '600 13px -apple-system, "Segoe UI", sans-serif';
      }
    });
    g.fillStyle = '#9ca3af'; g.font = '11px -apple-system, sans-serif'; g.textAlign = 'left';
    g.fillText(`Schritte ${first + 1}–${this.samples.length}`, left, 8 + n * lane + 10);
  }
}
