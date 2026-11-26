// Gemeinsame Hilfsfunktionen für die Bauteil-Definitionen
export const S = 20;
export const mask = b => (b >= 32 ? 0xFFFFFFFF : 2 ** b - 1);
export const v0 = x => (x == null ? 0 : x);
export const range = n => Array.from({ length: n }, (_, i) => i);

export const settings = { shapes: 'iec' };

// ---------- Eigenschaften ----------
export const P = {
  label: { key: 'Label', label: 'Beschriftung', type: 'text' },
  pinNumber: { key: 'pinNumber', label: 'Pin-Nummer (im Baustein)', type: 'text', hint: 'Nur für Bausteine im DIL-Gehäuse: an welchem Pin dieser Anschluss liegt.' },
  gateLabel: { key: 'Label', label: 'Beschriftung', type: 'text', hint: 'Beschriftete Gatter erscheinen in der Wertetabelle als Zwischenschritt.' },
  bits: { key: 'Bits', label: 'Datenbits', type: 'int', min: 1, max: 32 },
  inputs: { key: 'Inputs', label: 'Anzahl Eingänge', type: 'int', min: 2, max: 16 },
  wide: { key: 'wideShape', label: 'Breite Form', type: 'bool' },
  invert: { key: 'inverterConfig', label: 'Eingänge negieren', type: 'invert' },
  selBits: { key: 'Selector Bits', label: 'Auswahlbits', type: 'int', min: 1, max: 6 },
  flip: { key: 'flipSelPos', label: 'Auswahl-Eingang oben', type: 'bool' },
  freq: { key: 'Frequency', label: 'Frequenz (Hz)', type: 'int', min: 1, max: 100000, hint: 'Über 50 Hz läuft der Takt so schnell, wie das Gerät es schafft.' },
  realtime: { key: 'runRealTime', label: 'Läuft automatisch', type: 'bool' },
  value: { key: 'Value', label: 'Wert', type: 'int', min: 0, max: 0xFFFFFFFF },
  inDefault: { key: 'InDefault', label: 'Startwert', type: 'int', min: 0, max: 0xFFFFFFFF },
  format: { key: 'intFormat', label: 'Zahlenformat', type: 'select', options: [['def', 'Dezimal'], ['hex', 'Hexadezimal'], ['bin', 'Binär']] },
  color: { key: 'Color', label: 'Farbe', type: 'color' },
  netName: { key: 'NetName', label: 'Netzname', type: 'text' },
  desc: { key: 'Description', label: 'Text', type: 'textarea' },
  inSplit: { key: 'Input Splitting', label: 'Eingänge (Bits)', type: 'text', hint: 'z. B. 4 oder 1,1,1,1 oder 4*1' },
  outSplit: { key: 'Output Splitting', label: 'Ausgänge (Bits)', type: 'text', hint: 'z. B. 1,1,1,1' },
  activeLow: { key: 'activeLow', label: 'Low-aktiv', type: 'bool' },
  withEnable: { key: 'withEnable', label: 'Mit T-Eingang', type: 'bool' },
};

export function formatValue(v, bits, fmt = 'def') {
  if (v == null) return 'Z';
  if (bits === 1) return String(v);
  if (fmt === 'hex') return '0x' + v.toString(16).toUpperCase();
  if (fmt === 'bin') return '0b' + v.toString(2).padStart(bits, '0');
  return String(v);
}

// ---------- Generische Form (wie GenericShape in Digital) ----------
export function generic({ ins, outs, width, invOut = false, invIn = new Set() }) {
  const nIn = ins.length, nOut = outs.length;
  const sym = nOut === 1, even = (nIn & 1) === 0;
  const offs = sym ? Math.floor(nIn / 2) * S : 0;
  const pins = [];
  ins.forEach((p, i) => {
    let y = i * S;
    if (sym && even && i >= nIn / 2) y += S;
    pins.push({ ...p, x: invIn.has(i) ? -S : 0, y, out: false, inv: invIn.has(i) });
  });
  outs.forEach((p, i) => pins.push({ ...p, x: S * (width + (invOut ? 1 : 0)), y: i * S + offs, out: true }));
  const max = Math.max(nIn, nOut);
  const yb = (max - 1) * S + 10 + (sym && even ? S : 0);
  return {
    pins, yb, offs, width, invOut,
    box: { x0: invIn.size ? -S : 0, y0: -10, x1: S * width + (invOut ? S : 0), y1: yb },
  };
}

export function drawGenericBox(r, g, a, { title, labels = true, clockPins = [] } = {}) {
  const W = S * g.width;
  r.rect(1, -10, W - 1, g.yb);
  for (const p of g.pins) {
    if (p.hidden) continue;
    if (labels) {
      if (!p.out) {
        let dx = 4 + (p.inv ? S : 0);
        if (p.clock) { r.poly([[1, p.y - 6], [8, p.y], [1, p.y + 6]], false); dx += 7; }
        r.text(p.x + dx - (p.inv ? S : 0), p.y, p.n, 1, 0, 11);
      } else {
        r.text(W - 4, p.y, p.n, -1, 0, 11);
      }
    }
    if (p.inv) r.invIn(p.y);
  }
  if (g.invOut) for (const p of g.pins.filter(p => p.out)) r.invOut(W, p.y, p.x);
  if (title) r.text(W / 2, g.yb + 4, title, 0, 1, 11, 'name');
  if (a.Label) r.text(W / 2, -14, a.Label, 0, -1, 13, 'label');
}

// Indizes der Eingänge, die laut inverterConfig negiert sind
export const invSet = (a, names) => new Set(names.map((n, i) => ((a.inverterConfig || []).includes(n) ? i : -1)).filter(i => i >= 0));
// Negation mit der Bitbreite des jeweiligen Eingangs
export const applyInv = (ins, g) => ins.map((x, i) => (g.pins[i]?.inv ? (x == null ? null : (~x & mask(g.pins[i].bits || 1)) >>> 0) : x));

