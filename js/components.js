// Bauteil-Bibliothek. Geometrie (Raster 20, Pin-Positionen, Rotation) folgt
// dem Desktop-Programm "Digital" von H. Neemann, damit .dig-Dateien
// austauschbar sind. Symbole: DIN EN 60617 (IEC) als Standard, IEEE optional.

import { library, libVersion } from './lib.js';

export const S = 20;
export const mask = b => (b >= 32 ? 0xFFFFFFFF : 2 ** b - 1);
const v0 = x => (x == null ? 0 : x);
const range = n => Array.from({ length: n }, (_, i) => i);

export const settings = { shapes: 'iec' };

// ---------- Eigenschaften ----------
const P = {
  label: { key: 'Label', label: 'Beschriftung', type: 'text' },
  gateLabel: { key: 'Label', label: 'Beschriftung', type: 'text', hint: 'Beschriftete Gatter erscheinen in der Wertetabelle als Zwischenschritt.' },
  bits: { key: 'Bits', label: 'Datenbits', type: 'int', min: 1, max: 32 },
  inputs: { key: 'Inputs', label: 'Anzahl Eingänge', type: 'int', min: 2, max: 16 },
  wide: { key: 'wideShape', label: 'Breite Form', type: 'bool' },
  invert: { key: 'inverterConfig', label: 'Eingänge negieren', type: 'invert' },
  selBits: { key: 'Selector Bits', label: 'Auswahlbits', type: 'int', min: 1, max: 6 },
  flip: { key: 'flipSelPos', label: 'Auswahl-Eingang oben', type: 'bool' },
  freq: { key: 'Frequency', label: 'Frequenz (Hz)', type: 'int', min: 1, max: 50 },
  realtime: { key: 'runRealTime', label: 'Läuft automatisch', type: 'bool' },
  value: { key: 'Value', label: 'Wert', type: 'int', min: 0, max: 0xFFFFFFFF },
  inDefault: { key: 'InDefault', label: 'Startwert', type: 'int', min: 0, max: 0xFFFFFFFF },
  format: { key: 'intFormat', label: 'Zahlenformat', type: 'select', options: [['def', 'Dezimal'], ['hex', 'Hexadezimal'], ['bin', 'Binär']] },
  color: { key: 'Color', label: 'Farbe', type: 'color' },
  netName: { key: 'NetName', label: 'Netzname', type: 'text' },
  desc: { key: 'Description', label: 'Text', type: 'textarea' },
  inSplit: { key: 'Input Splitting', label: 'Eingänge (Bits)', type: 'text', hint: 'z. B. 4 oder 1,1,1,1 oder 4*1' },
  outSplit: { key: 'Output Splitting', label: 'Ausgänge (Bits)', type: 'text', hint: 'z. B. 1,1,1,1' },
  activeLow: { key: 'ActiveLow', label: 'Low-aktiv', type: 'bool' },
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
function generic({ ins, outs, width, invOut = false, invIn = new Set() }) {
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

function drawGenericBox(r, g, a, { title, labels = true, clockPins = [] } = {}) {
  const W = S * g.width;
  r.rect(1, -10, W - 1, g.yb);
  for (const p of g.pins) {
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

// ---------- Gatter ----------
function gate(type, name, sym, fn, invOut, ieee) {
  const isNot = type === 'Not';
  return {
    type, name, cat: 'Logikgatter',
    defaults: isNot ? { Bits: 1, Label: '' } : { Inputs: 2, Bits: 1, wideShape: false, Label: '', inverterConfig: [] },
    props: isNot ? [P.gateLabel, P.bits] : [P.gateLabel, P.inputs, P.bits, P.wide, P.invert],
    geo(a) {
      const n = isNot ? 1 : a.Inputs;
      const inv = new Set((a.inverterConfig || []).map(s => parseInt(String(s).replace('In_', '')) - 1).filter(i => i >= 0 && i < n));
      return generic({
        ins: range(n).map(i => ({ n: isNot ? 'in' : 'In_' + (i + 1), bits: a.Bits })),
        outs: [{ n: 'out', bits: a.Bits }],
        width: isNot ? 1 : (a.wideShape ? 4 : 3), invOut, invIn: inv,
      });
    },
    eval(ins, st, a, g) {
      const m = mask(a.Bits);
      const vals = ins.map((x, i) => (g.pins[i].inv ? (~v0(x) & m) >>> 0 : v0(x)));
      let res = fn(vals, m);
      if (invOut) res = ~res;
      return [(res & m) >>> 0];
    },
    draw(r, c, a, g) {
      if (settings.shapes === 'ieee') ieee(r, g);
      else {
        r.rect(1, -10, S * g.width - 1, g.yb);
        r.text(S * g.width / 2, -7, sym, 0, 1, 15, 'symbol');
      }
      for (const p of g.pins) if (p.inv) r.invIn(p.y);
      if (invOut) r.invOut(S * g.width, g.offs, S * g.width + S);
      if (a.Label) r.text(S * g.width / 2, -14, a.Label, 0, -1, 13, 'label');
      if (a.Bits > 1) r.text(S * g.width / 2, g.yb + 3, a.Bits + ' Bit', 0, 1, 10, 'name');
    },
  };
}

// IEEE-Formen (amerikanisch)
function ieeeAnd(r, g) {
  const W = S * g.width, top = -10, bot = g.yb, h = bot - top, mid = (top + bot) / 2;
  const rx = Math.min(h / 2, W * 0.55);
  r.path(ctx => {
    ctx.moveTo(1, top); ctx.lineTo(W - rx, top);
    ctx.ellipse(W - rx, mid, rx - 1, h / 2, 0, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(1, bot); ctx.closePath();
  });
}
function ieeeOr(r, g, xor) {
  const W = S * g.width, top = -10, bot = g.yb, mid = (top + bot) / 2;
  r.path(ctx => {
    ctx.moveTo(1, top);
    ctx.quadraticCurveTo(W * 0.65, top, W - 1, mid);
    ctx.quadraticCurveTo(W * 0.65, bot, 1, bot);
    ctx.quadraticCurveTo(14, mid, 1, top);
    ctx.closePath();
  });
  for (const p of g.pins) if (!p.out && !p.inv) r.line(0, p.y, 8, p.y);
  if (xor) r.path(ctx => { ctx.moveTo(-5, top); ctx.quadraticCurveTo(8, mid, -5, bot); }, false);
}
function ieeeNot(r, g) {
  r.poly([[1, -10], [S * g.width - 1, 0], [1, 10]], true);
}

const AND = v => v.reduce((x, y) => x & y);
const OR = v => v.reduce((x, y) => x | y);
const XOR = v => v.reduce((x, y) => x ^ y);

// ---------- Ein-/Ausgabe ----------
const OS = 15; // Größe der Ein-/Ausgabebox

const In = {
  type: 'In', name: 'Eingang', cat: 'Ein-/Ausgabe',
  defaults: { Bits: 1, Label: '', InDefault: 0, intFormat: 'def' },
  props: [P.label, P.bits, P.inDefault, P.format],
  geo(a) { return { pins: [{ n: 'out', bits: a.Bits, x: 0, y: 0, out: true }], box: { x0: -2 * OS - 2, y0: -OS, x1: 0, y1: OS } }; },
  init(st, a) { st.value = (a.InDefault || 0) & mask(a.Bits); },
  eval(ins, st) { return [st.value]; },
  interactive: true,
  tap(st, a, sim, c) {
    if (a.Bits === 1) st.value ^= 1;
    else return 'askValue';
  },
  draw(r, c, a, g, st) {
    r.rrect(-2 * OS - 1, -OS + 2, -1, OS - 2, 5, '#e8f0fe');
    if (a.Bits === 1) {
      // Kippschalter: Schiene mit Knopf, rechts = 1
      const on = st ? st.value === 1 : false;
      r.rrect(-27, -6, -5, 6, 6, st ? (on ? '#34d058' : '#9ca3af') : '#cbd5e1', true);
      r.circle(on ? -11 : -21, 0, 5.5, '#ffffff');
    } else r.text(-1 - OS, 0, st ? formatValue(st.value, a.Bits, a.intFormat) : a.Bits + 'b', 0, 0, st ? 12 : 10, 'value');
    if (a.Label) r.text(-3 * OS, 0, a.Label, -1, 0, 14, 'label');
  },
};

const Out = {
  type: 'Out', name: 'Ausgang', cat: 'Ein-/Ausgabe',
  defaults: { Bits: 1, Label: '', intFormat: 'def' },
  props: [P.label, P.bits, P.format],
  geo(a) { return { pins: [{ n: 'in', bits: a.Bits, x: 0, y: 0, out: false }], box: { x0: 0, y0: -OS, x1: 2 * OS + 2, y1: OS } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const v = st ? st.ins[0] : undefined;
    if (a.Bits === 1) {
      // Runde Anzeige; im Simulationsmodus mit Wert
      r.line(0, 0, 2, 0);
      r.circle(1 + OS, 0, OS, st ? r.valueColor(v, 1) : '#f3f4f6');
      if (st) r.text(1 + OS, 0.5, v == null ? 'Z' : String(v), 0, 0, 14, v ? 'valueDark' : 'valueLight');
    } else {
      r.rrect(1, -OS, 2 * OS + 1, OS, OS, '#f3f4f6');
      r.text(1 + OS, 0, st ? formatValue(v, a.Bits, a.intFormat) : a.Bits + 'b', 0, 0, st ? 12 : 10, 'value');
    }
    if (a.Label) r.text(3 * OS, 0, a.Label, 1, 0, 14, 'label');
  },
};

const rgb = c => (c && typeof c === 'object' ? `rgb(${c.r},${c.g},${c.b})` : c || 'rgb(255,0,0)');
const LED = {
  type: 'LED', name: 'LED', cat: 'Ein-/Ausgabe',
  defaults: { Label: '', Color: { r: 255, g: 0, b: 0 } },
  props: [P.label, P.color],
  geo() { return { pins: [{ n: 'in', bits: 1, x: 0, y: 0, out: false }], box: { x0: 0, y0: -OS, x1: 2 * OS + 2, y1: OS } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const on = !st || v0(st.ins[0]) !== 0;
    r.circle(1 + OS, 0, OS, '#444');
    r.circle(1 + OS, 0, OS - 2, on ? rgb(a.Color) : '#7a7a7a', true, null);
    if (a.Label) r.text(2 * OS + 6, 0, a.Label, 1, 0, 14, 'label');
  },
};

const Clock = {
  type: 'Clock', name: 'Takt', cat: 'Ein-/Ausgabe',
  defaults: { Label: 'C', Frequency: 1, runRealTime: true },
  props: [P.label, P.freq, P.realtime],
  geo() { return { pins: [{ n: 'C', bits: 1, x: 0, y: 0, out: true }], box: { x0: -2 * OS - 2, y0: -OS, x1: 0, y1: OS } }; },
  init(st) { st.value = 0; },
  eval(ins, st) { return [st.value]; },
  interactive: true,
  tap(st) { st.value ^= 1; },
  draw(r, c, a, g, st) {
    r.rect(-2 * OS - 1, -OS, -1, OS, true);
    const col = st ? r.valueColor(st.value, 1) : null;
    r.poly([[-27, 6], [-22, 6], [-22, -6], [-16, -6], [-16, 6], [-10, 6], [-10, -6], [-5, -6]], false, col, 2);
    if (a.Label) r.text(-3 * OS, 0, a.Label, -1, 0, 14, 'label');
  },
};

const Button = {
  type: 'Button', name: 'Taster', cat: 'Ein-/Ausgabe',
  defaults: { Label: '', ActiveLow: false },
  props: [P.label, P.activeLow],
  geo() { return { pins: [{ n: 'out', bits: 1, x: 0, y: 0, out: true }], box: { x0: -2 * OS - 6, y0: -OS - 4, x1: 0, y1: OS + 4 } }; },
  init(st, a) { st.pressed = false; },
  eval(ins, st, a) { return [(st.pressed ? 1 : 0) ^ (a.ActiveLow ? 1 : 0)]; },
  interactive: true,
  press(st) { st.pressed = true; },
  release(st) { st.pressed = false; },
  draw(r, c, a, g, st) {
    r.rect(-2 * OS - 5, -OS - 3, -1, OS + 3, true);
    const p = st && st.pressed;
    r.rect(-2 * OS + 1 + (p ? 2 : 0), -OS + 3 + (p ? 2 : 0), -7 + (p ? 2 : 0), OS - 3 + (p ? 2 : 0), true, p ? '#9aa4b2' : '#dde3ea');
    if (a.Label) r.text(-2 * OS - 10, 0, a.Label, -1, 0, 14, 'label');
  },
};

const Const = {
  type: 'Const', name: 'Konstante', cat: 'Ein-/Ausgabe',
  defaults: { Value: 1, Bits: 1, intFormat: 'def' },
  props: [P.value, P.bits, P.format],
  geo(a) { return { pins: [{ n: 'out', bits: a.Bits, x: 0, y: 0, out: true }], box: { x0: -22, y0: -9, x1: 0, y1: 9 } }; },
  eval(ins, st, a) { return [(a.Value & mask(a.Bits)) >>> 0]; },
  draw(r, c, a) { r.text(-3, 0, formatValue((a.Value & mask(a.Bits)) >>> 0, a.Bits, a.intFormat), -1, 0, 14, 'value'); },
};

const Ground = {
  type: 'Ground', name: 'Masse (0)', cat: 'Ein-/Ausgabe',
  defaults: { Bits: 1 }, props: [P.bits],
  geo(a) { return { pins: [{ n: 'out', bits: a.Bits, x: 0, y: 0, out: true, vert: true }], box: { x0: -11, y0: 0, x1: 11, y1: 12 } }; },
  eval() { return [0]; },
  draw(r) { r.line(0, 0, 0, 10); r.line(-10, 10, 10, 10, 3); },
};
const VDD = {
  type: 'VDD', name: 'Versorgung (1)', cat: 'Ein-/Ausgabe',
  defaults: { Bits: 1 }, props: [P.bits],
  geo(a) { return { pins: [{ n: 'out', bits: a.Bits, x: 0, y: 0, out: true, vert: true }], box: { x0: -11, y0: -14, x1: 11, y1: 0 } }; },
  eval(ins, st, a) { return [mask(a.Bits)]; },
  draw(r) { r.line(0, 0, 0, -10); r.poly([[-8, -4], [0, -12], [8, -4]], false); },
};

const Probe = {
  type: 'Probe', name: 'Messwert', cat: 'Ein-/Ausgabe',
  defaults: { Label: '', intFormat: 'def' },
  props: [{ ...P.label, hint: 'Mit Beschriftung erscheint der Messwert in der Wertetabelle als Zwischenschritt.' }, P.format],
  geo(a) { return { pins: [{ n: 'in', bits: 0, x: 0, y: 0, out: false }], box: { x0: 0, y0: -10, x1: 50, y1: 10 } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    r.circle(0, 0, 4, '#222');
    const v = st ? formatValue(st.ins[0], st.bits?.[0] || 1, a.intFormat) : '?';
    r.text(8, 0, (a.Label ? a.Label + ' = ' : '') + v, 1, 0, 13, 'value');
  },
};

// 7-Segment
const SEG = [
  [[12.04, 5], [52.8, 5], [58.15, 10.61], [52.28, 16.22], [11.52, 16.22], [6.17, 10.61]],
  [[59.49, 12.01], [64.84, 17.62], [62.74, 62.99], [56.87, 68.6], [51.52, 62.99], [53.62, 17.62]],
  [[56.74, 71.4], [62.09, 77.01], [60, 122.38], [54.13, 127.99], [48.78, 122.38], [50.88, 77.01]],
  [[6.55, 123.78], [47.32, 123.78], [52.67, 129.39], [46.8, 135], [6.04, 135], [0.69, 129.39]],
  [[1.96, 71.4], [7.31, 77.01], [5.22, 122.38], [-0.64, 127.99], [-5.99, 122.38], [-3.9, 77.01]],
  [[4.7, 12.01], [10.05, 17.62], [7.96, 62.99], [2.09, 68.6], [-3.25, 62.99], [-1.15, 17.62]],
  [[9.3, 64.39], [50.06, 64.39], [55.41, 70], [49.54, 75.61], [8.78, 75.61], [3.43, 70]],
];
const HEX = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71];
function drawSeven(r, a, segOn, dpOn) {
  r.rect(-10, 1, 70, 139, true, '#1b1b1b');
  const col = rgb(a.Color);
  SEG.forEach((poly, i) => r.poly(poly, true, null, 0, segOn(i) ? col : '#3a3a3a'));
  r.circle(62, 131, 4, dpOn ? col : '#3a3a3a', true, null);
}
const SevenSeg = {
  type: 'Seven-Seg', name: '7-Segment', cat: 'Ein-/Ausgabe',
  defaults: { Color: { r: 255, g: 0, b: 0 }, Label: '' },
  props: [P.color, P.label],
  geo() {
    const n = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    return { pins: n.map((nm, i) => ({ n: nm, bits: 1, x: (i % 4) * S, y: i < 4 ? 0 : 7 * S, out: false, vert: true })), box: { x0: -10, y0: 0, x1: 70, y1: 140 } };
  },
  eval() { return []; },
  draw(r, c, a, g, st) {
    drawSeven(r, a, i => !st || v0(st.ins[i]) !== 0, !st || v0(st.ins[7]) !== 0);
    for (const p of g.pins) r.text(p.x, p.y + (p.y ? -4 : 4), p.n, 0, p.y ? -1 : 1, 9, 'pinlabel');
  },
};
const SevenSegHex = {
  type: 'Seven-Seg-Hex', name: '7-Seg. Hex', cat: 'Ein-/Ausgabe',
  defaults: { Color: { r: 255, g: 0, b: 0 }, Label: '' },
  props: [P.color, P.label],
  geo() { return { pins: [{ n: 'd', bits: 4, x: S, y: 7 * S, out: false, vert: true }, { n: 'dp', bits: 1, x: 2 * S, y: 7 * S, out: false, vert: true }], box: { x0: -10, y0: 0, x1: 70, y1: 140 } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const d = st ? v0(st.ins[0]) & 15 : 8;
    drawSeven(r, a, i => (HEX[d] >> i) & 1, !st || v0(st.ins[1]) !== 0);
    for (const p of g.pins) r.text(p.x, p.y - 4, p.n, 0, -1, 9, 'pinlabel');
  },
};

// ---------- Leitungen ----------
const Tunnel = {
  type: 'Tunnel', name: 'Tunnel', cat: 'Leitungen',
  defaults: { NetName: 'T', Bits: 1 },
  props: [P.netName, P.bits],
  geo(a) { return { pins: [{ n: 'in', bits: a.Bits, x: 0, y: 0, out: false, tunnel: true }], box: { x0: 0, y0: -9, x1: 40, y1: 9 } }; },
  eval() { return []; },
  draw(r, c, a) {
    r.poly([[0, 0], [12, -8], [12, 8]], true, null, 2, '#fff');
    r.text(16, 0, a.NetName, 1, 0, 13, 'label');
  },
};

export function parseSplit(s) {
  const out = [];
  for (let part of String(s || '1').split(',')) {
    part = part.trim();
    if (!part) continue;
    let m;
    if ((m = part.match(/^(\d+)\s*\*\s*(\d+)$/))) for (let i = 0; i < +m[2]; i++) out.push(+m[1]);
    else if ((m = part.match(/^(\d+)\s*-\s*(\d+)$/))) out.push(Math.abs(+m[2] - +m[1]) + 1);
    else out.push(Math.max(1, parseInt(part) || 1));
  }
  return out.length ? out : [1];
}
const Splitter = {
  type: 'Splitter', name: 'Splitter', cat: 'Leitungen',
  defaults: { 'Input Splitting': '4', 'Output Splitting': '1,1,1,1' },
  props: [P.inSplit, P.outSplit],
  geo(a) {
    const ins = parseSplit(a['Input Splitting']), outs = parseSplit(a['Output Splitting']);
    const sp = (a.splitterSpreading || 1) * S;
    const label = arr => { let o = 0; return arr.map(b => { const t = b === 1 ? '' + o : o + '-' + (o + b - 1); o += b; return t; }); };
    const li = label(ins), lo = label(outs);
    const pins = [
      ...ins.map((b, i) => ({ n: li[i], bits: b, x: 0, y: i * sp, out: false })),
      ...outs.map((b, i) => ({ n: lo[i], bits: b, x: S, y: i * sp, out: true })),
    ];
    const len = (Math.max(ins.length, outs.length) - 1) * sp;
    return { pins, ins, outs, len, box: { x0: 0, y0: -8, x1: S, y1: len + 2 } };
  },
  eval(insV, st, a, g) {
    let all = 0, o = 0;
    g.ins.forEach((b, i) => { all += (v0(insV[i]) & mask(b)) * 2 ** o; o += b; });
    o = 0;
    return g.outs.map(b => { const v = Math.floor(all / 2 ** o) % 2 ** b; o += b; return v; });
  },
  draw(r, c, a, g) {
    for (const p of g.pins) {
      if (!p.out) { r.line(0, p.y, 10, p.y); r.text(-2, p.y - 3, p.n, -1, -1, 9, 'pinlabel'); }
      else { r.line(20, p.y, 10, p.y); r.text(22, p.y - 3, p.n, 1, -1, 9, 'pinlabel'); }
    }
    r.poly([[8, -2], [12, -2], [12, g.len + 2], [8, g.len + 2]], true, null, 0, '#222');
  },
};

// ---------- Plexer ----------
const Mux = {
  type: 'Multiplexer', name: 'Multiplexer', cat: 'Plexer',
  defaults: { 'Selector Bits': 1, Bits: 1, flipSelPos: false },
  props: [P.selBits, P.bits, P.flip],
  geo(a) {
    const n = 2 ** a['Selector Bits'];
    const pins = [{ n: 'sel', bits: a['Selector Bits'], x: S, y: a.flipSelPos ? 0 : n * S, out: false, vert: true }];
    for (let i = 0; i < n; i++) pins.push({ n: 'in_' + i, bits: a.Bits, x: 0, y: n === 2 ? i * 2 * S : i * S, out: false });
    pins.push({ n: 'out', bits: a.Bits, x: 2 * S, y: Math.floor(n / 2) * S, out: true });
    return { pins, n, box: { x0: 0, y0: -4, x1: 2 * S, y1: n * S + 4 } };
  },
  eval(ins) { const s = v0(ins[0]); return [ins[1 + s] ?? null]; },
  draw(r, c, a, g) {
    const n = g.n;
    r.poly([[1, -4], [39, 5], [39, n * S - 5], [1, n * S + 4]], true);
    r.text(3, 2, '0', 1, 1, 9, 'pinlabel');
  },
};
function demuxGeo(a, hasInput) {
  const n = 2 ** a['Selector Bits'];
  const h = hasInput || n <= 2 ? S * n : S * (n - 1);
  const pins = [{ n: 'sel', bits: a['Selector Bits'], x: S, y: a.flipSelPos ? 0 : h, out: false, vert: true }];
  if (hasInput) pins.push({ n: 'in', bits: a.Bits, x: 0, y: (n / 2) * S, out: false });
  for (let i = 0; i < n; i++) pins.push({ n: 'out_' + i, bits: hasInput ? a.Bits : 1, x: 2 * S, y: n === 2 ? i * 2 * S : i * S, out: true });
  return { pins, n, h, box: { x0: 0, y0: -4, x1: 2 * S, y1: h + 4 } };
}
function demuxDraw(r, c, a, g) {
  r.poly([[1, 5], [39, -4], [39, g.h + 4], [1, g.h - 5]], true);
  r.text(37, 2, '0', -1, 1, 9, 'pinlabel');
}
const Demux = {
  type: 'Demultiplexer', name: 'Demultiplexer', cat: 'Plexer',
  defaults: { 'Selector Bits': 1, Bits: 1, flipSelPos: false },
  props: [P.selBits, P.bits, P.flip],
  geo: a => demuxGeo(a, true),
  eval(ins, st, a, g) { const s = v0(ins[0]); return range(g.n).map(i => (i === s ? v0(ins[1]) : 0)); },
  draw: demuxDraw,
};
const Decoder = {
  type: 'Decoder', name: 'Decoder', cat: 'Plexer',
  defaults: { 'Selector Bits': 1, flipSelPos: false },
  props: [P.selBits, P.flip],
  geo: a => demuxGeo(a, false),
  eval(ins, st, a, g) { const s = v0(ins[0]); return range(g.n).map(i => (i === s ? 1 : 0)); },
  draw: demuxDraw,
};

// ---------- Flipflops ----------
function ff(type, name, inNames, step, extraDefaults = {}, extraProps = []) {
  return {
    type, name, cat: 'Flipflops',
    defaults: { Label: '', ...extraDefaults },
    props: [P.label, ...extraProps],
    geo(a) {
      const names = typeof inNames === 'function' ? inNames(a) : inNames;
      const bits = a.Bits || 1;
      return generic({
        ins: names.map(n => ({ n, bits: n === 'C' ? 1 : bits, clock: n === 'C' })),
        outs: [{ n: 'Q', bits }, { n: '~Q', bits }], width: 3,
      });
    },
    init(st) { st.q = 0; st.c = 0; },
    eval(ins, st, a, g) {
      const names = g.pins.filter(p => !p.out).map(p => p.n);
      const v = {}; names.forEach((n, i) => (v[n] = v0(ins[i])));
      const m = mask(a.Bits || 1);
      if (v.C && !st.c) st.q = step(v, st.q, m, a) & m;
      st.c = v.C;
      return [st.q >>> 0, (~st.q & m) >>> 0];
    },
    draw(r, c, a, g) { drawGenericBox(r, g, a); },
  };
}

// ---------- Arithmetik ----------
function arith(type, name, ins, outs, ev, defaults, props) {
  return {
    type, name, cat: 'Arithmetik', defaults: { Bits: 1, Label: '', ...defaults }, props: [P.bits, P.label, ...(props || [])],
    geo(a) {
      return generic({
        ins: ins.map(n => (typeof n === 'string' ? { n, bits: a.Bits } : { ...n, bits: n.bits || a.Bits })),
        outs: outs.map(n => (typeof n === 'string' ? { n, bits: a.Bits } : { ...n, bits: n.bits || a.Bits })),
        width: 3,
      });
    },
    init(st) { st.q = 0; st.c = 0; },
    eval: ev,
    draw(r, c, a, g) { drawGenericBox(r, g, a, { title: name }); },
  };
}

const Add = arith('Add', 'Addierer', ['a', 'b', { n: 'c_i', bits: 1 }], ['s', { n: 'c_o', bits: 1 }], (ins, st, a) => {
  const m = mask(a.Bits); const sum = v0(ins[0]) + v0(ins[1]) + (v0(ins[2]) & 1);
  return [sum % (m + 1), sum > m ? 1 : 0];
});
const Comparator = arith('Comparator', 'Komparator', ['a', 'b'], [{ n: '=', bits: 1 }, { n: '>', bits: 1 }, { n: '<', bits: 1 }], ins => {
  const x = v0(ins[0]), y = v0(ins[1]); return [x === y ? 1 : 0, x > y ? 1 : 0, x < y ? 1 : 0];
});
const Counter = arith('Counter', 'Zähler', [{ n: 'en', bits: 1 }, { n: 'C', bits: 1, clock: true }, { n: 'clr', bits: 1 }], ['out', { n: 'ovf', bits: 1 }], (ins, st, a) => {
  const m = mask(a.Bits); const en = v0(ins[0]), C = v0(ins[1]), clr = v0(ins[2]);
  if (C && !st.c) { if (clr) st.q = 0; else if (en) st.q = st.q >= m ? 0 : st.q + 1; }
  st.c = C;
  return [st.q, en && st.q === m ? 1 : 0];
}, { Bits: 4 });
const Register = arith('Register', 'Register', ['D', { n: 'C', bits: 1, clock: true }, { n: 'en', bits: 1 }], ['Q'], (ins, st, a) => {
  const C = v0(ins[1]);
  if (C && !st.c && v0(ins[2])) st.q = v0(ins[0]) & mask(a.Bits);
  st.c = C;
  return [st.q];
}, { Bits: 8 });

// ---------- Sonstiges ----------
const Text = {
  type: 'Text', name: 'Text', cat: 'Sonstiges',
  defaults: { Description: 'Text' },
  props: [P.desc],
  geo(a) {
    const lines = String(a.Description || '').split('\n');
    const w = Math.max(20, ...lines.map(l => l.length * 8));
    return { pins: [], box: { x0: 0, y0: 0, x1: w, y1: lines.length * 18 + 2 } };
  },
  eval() { return []; },
  draw(r, c, a) {
    String(a.Description || '').split('\n').forEach((l, i) => r.text(0, i * 18, l, 1, 1, 15, 'text'));
  },
};

// Eigener Baustein (Teilschaltung). Anschlüsse in der Reihenfolge der Ein-/Ausgänge
// in der Teilschaltung (wie in Digital: Eingänge = In und Clock, Ausgänge = Out).
export function subInterface(circuit) {
  const ins = [], outs = [];
  for (const k of circuit.comps) {
    const a = { ...DEF[k.type]?.defaults, ...k.attrs };
    if (k.type === 'In') ins.push({ n: a.Label || '?', bits: a.Bits || 1 });
    else if (k.type === 'Clock') ins.push({ n: a.Label || '?', bits: 1, clock: true });
    else if (k.type === 'Out') outs.push({ n: a.Label || '?', bits: a.Bits || 1 });
  }
  return { ins, outs };
}
const Sub = {
  type: 'Sub', name: 'Baustein', cat: null,
  defaults: { Label: '', Width: 3 },
  props: [P.label, { key: 'Width', label: 'Breite', type: 'int', min: 2, max: 10 }],
  geo(a, c) {
    const sub = library.get(c?.sub);
    if (!sub) return { pins: [], missing: true, box: { x0: 0, y0: -10, x1: 100, y1: 30 } };
    const { ins, outs } = subInterface(sub);
    if (!ins.length && !outs.length) return { pins: [], missing: true, box: { x0: 0, y0: -10, x1: 100, y1: 30 } };
    return generic({ ins, outs: outs.length ? outs : [], width: a.Width || 3 });
  },
  eval() { return []; },
  draw(r, c, a, g) {
    if (g.missing) { r.rect(0, -10, 100, 30, true, '#fde8e8'); r.text(50, 10, (c.sub || '?') + ' fehlt', 0, 0, 11, 'name'); return; }
    drawGenericBox(r, g, a, { title: c.sub });
  },
};

// Testfall (Digital: "Testcase")
const Testcase = {
  type: 'Testcase', name: 'Testfall', cat: 'Sonstiges',
  defaults: { Label: '', Testdata: 'A B Y\n0 0 0\n0 1 0\n1 0 0\n1 1 1' },
  props: [P.label, { key: 'Testdata', label: 'Testdaten', type: 'textarea', mono: true, hint: 'Erste Zeile: Namen der Ein- und Ausgänge. Dann je Zeile die Werte. X = beliebig, C = Taktimpuls, # = Kommentar.' }],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 80, y1: 40 } }; },
  eval() { return []; },
  draw(r, c, a) {
    const res = c._result;
    r.rrect(1, 1, 79, 39, 6, res === 'ok' ? '#dcfce7' : res === 'fail' ? '#fee2e2' : '#fff');
    r.text(40, a.Label ? 13 : 20, res === 'ok' ? 'Test ✓' : res === 'fail' ? 'Test ✗' : 'Test', 0, 0, 13, 'value');
    if (a.Label) r.text(40, 28, a.Label, 0, 0, 11, 'name');
  },
};

// Platzhalter für Bauteile aus .dig-Dateien, die (noch) nicht unterstützt werden
export const Unknown = {
  type: 'Unknown', name: 'Unbekannt', cat: null,
  defaults: { elementName: '?' }, props: [],
  geo() { return { pins: [], box: { x0: 0, y0: -10, x1: 80, y1: 30 } }; },
  eval() { return []; },
  draw(r, c, a) { r.rect(0, -10, 80, 30, true, '#fde8e8'); r.text(40, 10, a.elementName, 0, 0, 11, 'name'); },
};

export const DEFS = [
  In, Out, LED, Button, Clock, Const, Ground, VDD, Probe, SevenSeg, SevenSegHex,
  gate('And', 'UND', '&', AND, false, ieeeAnd),
  gate('Or', 'ODER', '≥1', OR, false, ieeeOr),
  gate('Not', 'NICHT', '1', v => v[0], true, ieeeNot),
  gate('NAnd', 'NAND', '&', AND, true, ieeeAnd),
  gate('NOr', 'NOR', '≥1', OR, true, ieeeOr),
  gate('XOr', 'XOR', '=1', XOR, false, (r, g) => ieeeOr(r, g, true)),
  gate('XNOr', 'XNOR', '=1', XOR, true, (r, g) => ieeeOr(r, g, true)),
  Tunnel, Splitter,
  Mux, Demux, Decoder,
  ff('RS_FF', 'RS-Flipflop', ['S', 'C', 'R'], (v, q) => (v.S && !v.R ? 1 : !v.S && v.R ? 0 : q)),
  ff('JK_FF', 'JK-Flipflop', ['J', 'C', 'K'], (v, q) => (v.J && v.K ? ~q : v.J ? 1 : v.K ? 0 : q)),
  ff('D_FF', 'D-Flipflop', ['D', 'C'], v => v.D, { Bits: 1 }, [P.bits]),
  ff('T_FF', 'T-Flipflop', a => (a.withEnable === false ? ['C'] : ['T', 'C']), (v, q, m, a) => (a.withEnable === false || v.T ? ~q : q), { withEnable: true }, [P.withEnable]),
  Add, Comparator, Counter, Register,
  Text, Testcase,
];
export const DEF = Object.fromEntries([...DEFS, Unknown, Sub].map(d => [d.type, d]));
export const CATEGORIES = [...new Set(DEFS.map(d => d.cat))];

export function attrsOf(c) {
  const d = DEF[c.type];
  return { ...d.defaults, ...c.attrs };
}

// Geometrie mit Cache pro Bauteil
const geoCache = new WeakMap();
export function geoOf(c) {
  const key = c.type + JSON.stringify(c.attrs) + (c.type === 'Sub' ? c.sub + '#' + libVersion() : '');
  const cached = geoCache.get(c);
  if (cached && cached.key === key) return cached.g;
  const g = DEF[c.type].geo(attrsOf(c), c);
  geoCache.set(c, { key, g });
  return g;
}

export function rot(x, y, r) {
  switch (r & 3) {
    case 1: return [y, -x];
    case 2: return [-x, -y];
    case 3: return [-y, x];
    default: return [x, y];
  }
}

export function pinsWorld(c) {
  return geoOf(c).pins.map((p, i) => {
    const [x, y] = rot(p.x, p.y, c.rot || 0);
    return { ...p, idx: i, x: x + c.x, y: y + c.y };
  });
}

export function boundsWorld(c) {
  const b = geoOf(c).box;
  const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => rot(x, y, c.rot || 0));
  const xs = pts.map(p => p[0] + c.x), ys = pts.map(p => p[1] + c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
