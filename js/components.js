// Bauteil-Bibliothek. Geometrie (Raster 20, Pin-Positionen, Rotation) folgt
// dem Desktop-Programm "Digital" von H. Neemann, damit .dig-Dateien
// austauschbar sind. Symbole: DIN EN 60617 (IEC) als Standard, IEEE optional.

import { getCircuit, libVersion } from './lib.js';
import { isGeneric, resolveCircuit, instanceArgs } from './generics.js';
import { S, mask, v0, range, settings, P, formatValue, generic, drawGenericBox, invSet, applyInv } from './base.js';
export { S, mask, settings, formatValue } from './base.js';
import { SWITCH_DEFS } from './comp-switch.js';
import { ARITH_DEFS, PLEX_DEFS } from './comp-arith.js';
import { MEM_DEFS } from './comp-mem.js';
import { IO_DEFS, DISPLAY_DEFS, MISC_IO_DEFS } from './comp-io.js';


// ---------- Gatter ----------
function gate(type, name, sym, fn, invOut, ieee) {
  const isNot = type === 'Not';
  return {
    type, name, cat: 'Logikgatter',
    defaults: isNot ? { Bits: 1, Label: '', wideShape: false } : { Inputs: 2, Bits: 1, wideShape: false, Label: '', inverterConfig: [] },
    props: isNot ? [P.gateLabel, P.bits, P.wide] : [P.gateLabel, P.inputs, P.bits, P.wide, P.invert],
    geo(a) {
      const n = isNot ? 1 : a.Inputs;
      const inv = new Set((a.inverterConfig || []).map(s => parseInt(String(s).replace('In_', '')) - 1).filter(i => i >= 0 && i < n));
      return generic({
        ins: range(n).map(i => ({ n: isNot ? 'in' : 'In_' + (i + 1), bits: a.Bits })),
        outs: [{ n: 'out', bits: a.Bits }],
        width: (isNot ? 1 : 3) + (a.wideShape ? 1 : 0), invOut, invIn: inv,
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
  defaults: { Bits: 1, Label: '', InDefault: 0, intFormat: 'def', pinNumber: '' },
  props: [P.label, P.bits, P.inDefault, P.format, P.pinNumber],
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
  defaults: { Bits: 1, Label: '', intFormat: 'def', pinNumber: '' },
  props: [P.label, P.bits, P.format, P.pinNumber],
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
  defaults: { Label: '', Frequency: 1, runRealTime: false, pinNumber: '' },
  initial: { Label: 'C', runRealTime: true },
  props: [P.label, P.freq, P.realtime, P.pinNumber],
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
  defaults: { Label: '', activeLow: false },
  props: [P.label, P.activeLow],
  geo() { return { pins: [{ n: 'out', bits: 1, x: 0, y: 0, out: true }], box: { x0: -2 * OS - 6, y0: -OS - 4, x1: 0, y1: OS + 4 } }; },
  init(st, a) { st.pressed = false; },
  eval(ins, st, a) { return [(st.pressed ? 1 : 0) ^ (a.activeLow ? 1 : 0)]; },
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
  // Größe wie in Digital: Skalierung um die rechte untere Ecke (70,139)
  const sz = a.segSize ?? 2, k = (2 + sz) / 4;
  const T = ([x, y]) => (sz === 2 ? [x, y] : [(x - 70) * k + 70, (y - 139) * k + 139]);
  r.poly([[-10, 1], [70, 1], [70, 139], [-10, 139]].map(T), true, null, null, '#1b1b1b');
  const col = rgb(a.Color);
  SEG.forEach((poly, i) => r.poly(poly.map(T), true, null, 0, segOn(i) ? col : '#3a3a3a'));
  const [dx, dy] = T([62, 131]);
  r.circle(dx, dy, 4 * k, dpOn ? col : '#3a3a3a', true, null);
}
const sevenBox = a => { const sz = a.segSize ?? 2, k = (2 + sz) / 4; return { x0: Math.min(0, (-10 - 70) * k + 70), y0: Math.min(0, (1 - 139) * k + 139), x1: Math.max(a.commonCathode ? 80 : 60, 70), y1: 140 }; };
const SevenSeg = {
  type: 'Seven-Seg', name: '7-Segment', cat: 'Ein-/Ausgabe',
  defaults: { Color: { r: 255, g: 0, b: 0 }, Label: '', commonCathode: false, commonConnectionType: 'cathode', segSize: 2 },
  props: [P.color, { key: 'commonCathode', label: 'Gemeinsamer Anschluss', type: 'bool' },
    { key: 'commonConnectionType', label: 'Art des gemeinsamen Anschlusses', type: 'select', options: [['cathode', 'Kathode (CC)'], ['anode', 'Anode (CA)']] },
    { key: 'segSize', label: 'Größe', type: 'select', options: [[0, 'klein'], [1, 'mittel'], [2, 'groß']] }, P.label],
  geo(a) {
    const n = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    const pins = n.map((nm, i) => ({ n: nm, bits: 1, x: (i % 4) * S, y: i < 4 ? 0 : 7 * S, out: false, vert: true }));
    if (a.commonCathode) pins.push({ n: a.commonConnectionType === 'anode' ? 'ca' : 'cc', bits: 1, x: 4 * S, y: 7 * S, out: false, vert: true });
    return { pins, box: sevenBox(a) };
  },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const anode = a.commonConnectionType === 'anode';
    // wie in Digital: Segment leuchtet, wenn Segment- und gemeinsamer Anschluss verschieden sind (passend zur Art)
    const on = i => {
      if (!st) return true;
      const v = st.ins[i];
      if (!a.commonCathode) return v != null && v !== 0;
      const cc = st.ins[8];
      if (v == null || cc == null) return false;
      return (!!v !== !!cc) && (!!v !== anode);
    };
    drawSeven(r, a, on, on(7));
    if (a.commonCathode) r.line(4 * S - 10, 7 * S - 1, 4 * S, 7 * S - 1);
    for (const p of g.pins) r.text(p.x, p.y + (p.y ? -4 : 4), p.n, 0, p.y ? -1 : 1, 9, 'pinlabel');
  },
};
const SevenSegHex = {
  type: 'Seven-Seg-Hex', name: '7-Seg. Hex', cat: 'Ein-/Ausgabe',
  defaults: { Color: { r: 255, g: 0, b: 0 }, Label: '', segSize: 2 },
  props: [P.color, { key: 'segSize', label: 'Größe', type: 'select', options: [[0, 'klein'], [1, 'mittel'], [2, 'groß']] }, P.label],
  // Anschlüsse wie in Digital: d bei (40,140), dp bei (60,140)
  geo(a) { return { pins: [{ n: 'd', bits: 4, x: 2 * S, y: 7 * S, out: false, vert: true }, { n: 'dp', bits: 1, x: 3 * S, y: 7 * S, out: false, vert: true }], box: sevenBox(a) }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const d = st ? v0(st.ins[0]) & 15 : 8;
    drawSeven(r, a, i => (st ? (st.ins[0] != null && (HEX[d] >> i) & 1) : true), !st || v0(st.ins[1]) !== 0);
    for (const p of g.pins) r.text(p.x, p.y - 4, p.n, 0, -1, 9, 'pinlabel');
  },
};

// ---------- Leitungen ----------
const Tunnel = {
  type: 'Tunnel', name: 'Tunnel', cat: 'Leitungen',
  defaults: { NetName: '', Bits: 1 },
  initial: { NetName: 'T' },
  props: [P.netName, P.bits],
  geo(a) { return { pins: [{ n: 'in', bits: a.Bits, x: 0, y: 0, out: false, tunnel: true }], box: { x0: 0, y0: -9, x1: 40, y1: 9 } }; },
  eval() { return []; },
  draw(r, c, a) {
    r.poly([[0, 0], [12, -8], [12, 8]], true, null, 2, '#fff');
    r.text(16, 0, a.NetName, 1, 0, 13, 'label');
  },
};

// Aufteilung wie in Digital: "4" (nächste 4 Bit), "4*2" (2× 4 Bit), "1-7" (Bits 1 bis 7)
export function parseSplitPorts(s) {
  const out = []; let pos = 0;
  for (let part of String(s || '1').split(',')) {
    part = part.trim();
    if (!part) continue;
    let m;
    if ((m = part.match(/^(\d+)\s*\*\s*(\d+)$/))) for (let i = 0; i < +m[2]; i++) { out.push({ bits: +m[1], lo: pos }); pos += +m[1]; }
    else if ((m = part.match(/^(\d+)\s*-\s*(\d+)$/))) { const lo = Math.min(+m[1], +m[2]), bits = Math.abs(+m[2] - +m[1]) + 1; out.push({ bits, lo }); pos = lo + bits; }
    else { const b = Math.max(1, parseInt(part) || 1); out.push({ bits: b, lo: pos }); pos += b; }
  }
  return out.length ? out : [{ bits: 1, lo: 0 }];
}
const Splitter = {
  type: 'Splitter', name: 'Splitter', cat: 'Leitungen',
  defaults: { 'Input Splitting': '4,4', 'Output Splitting': '8' },
  initial: { 'Input Splitting': '4', 'Output Splitting': '1,1,1,1' },
  props: [P.inSplit, P.outSplit],
  geo(a) {
    const ins = parseSplitPorts(a['Input Splitting']), outs = parseSplitPorts(a['Output Splitting']);
    const sp = (a.splitterSpreading || 1) * S;
    const label = p => (p.bits === 1 ? '' + p.lo : p.lo + '-' + (p.lo + p.bits - 1));
    const pins = [
      ...ins.map((p, i) => ({ n: label(p), bits: p.bits, x: 0, y: i * sp, out: false })),
      ...outs.map((p, i) => ({ n: label(p), bits: p.bits, x: S, y: i * sp, out: true })),
    ];
    const len = (Math.max(ins.length, outs.length) - 1) * sp;
    return { pins, ins, outs, len, box: { x0: 0, y0: -8, x1: S, y1: len + 2 } };
  },
  eval(insV, st, a, g) {
    // Eingangsbits sammeln; hochohmige (Z) Bereiche merken
    const bit = [], z = [];
    g.ins.forEach((p, i) => { for (let b = 0; b < p.bits; b++) { if (insV[i] == null) z[p.lo + b] = true; else bit[p.lo + b] = Math.floor(insV[i] / 2 ** b) & 1; } });
    return g.outs.map(p => {
      let v = 0;
      for (let b = 0; b < p.bits; b++) { if (z[p.lo + b]) return null; v += (bit[p.lo + b] || 0) * 2 ** b; }
      return v;
    });
  },
  draw(r, c, a, g) {
    for (const p of g.pins) {
      if (!p.out) { r.line(0, p.y, 10, p.y); r.text(-2, p.y - 3, p.n, -1, -1, 9, 'pinlabel'); }
      else { r.line(20, p.y, 10, p.y); r.text(22, p.y - 3, p.n, 1, -1, 9, 'pinlabel'); }
    }
    r.poly([[8, -2], [12, -2], [12, g.len + 2], [8, g.len + 2]], true, null, 0, '#222');
  },
};

// Tri-State-Treiber (Digital: Driver / DriverInvSel)
function driver(type, name, invSel) {
  return {
    type, name, cat: 'Leitungen',
    defaults: { Bits: 1, flipSelPos: false, invertDriverOutput: false },
    props: [P.bits, { key: 'flipSelPos', label: 'Steuereingang unten', type: 'bool' }, { key: 'invertDriverOutput', label: 'Ausgang negiert', type: 'bool' }],
    geo(a) {
      const out = a.invertDriverOutput ? 2 * S : S;
      return {
        pins: [{ n: 'in', bits: a.Bits, x: -S, y: 0, out: false }, { n: 'sel', bits: 1, x: 0, y: a.flipSelPos ? S : -S, out: false, vert: true }, { n: 'out', bits: a.Bits, x: out, y: 0, out: true }],
        box: { x0: -S, y0: -S, x1: out, y1: S },
      };
    },
    eval(ins, st, a) {
      const sel = ins[1] == null ? false : invSel ? !ins[1] : !!ins[1];
      if (!sel || ins[0] == null) return [null];
      return [a.invertDriverOutput ? (~ins[0] & mask(a.Bits)) >>> 0 : ins[0]];
    },
    draw(r, c, a) {
      r.poly([[-S + 1, -12], [S - 1, 0], [-S + 1, 12]], true);
      const y = a.flipSelPos ? 1 : -1;
      if (invSel) { r.line(0, y * S, 0, y * 14); r.circle(0, y * 10, 4, null); } else r.line(0, y * S, 0, y * 7);
      if (a.invertDriverOutput) r.invOut(S, 0, 2 * S);
    },
  };
}
const Delay = {
  type: 'Delay', name: 'Verzögerung', cat: 'Leitungen',
  defaults: { Bits: 1, delayTime: 1 }, props: [P.bits],
  geo(a) { return { pins: [{ n: 'in', bits: a.Bits, x: 0, y: 0, out: false }, { n: 'out', bits: a.Bits, x: 2 * S, y: 0, out: true }], box: { x0: 0, y0: -10, x1: 2 * S, y1: 10 } }; },
  eval(ins) { return [ins[0]]; },
  draw(r) { r.rect(1, -10, 2 * S - 1, 10, true); r.line(10, 0, 30, 0, 1); r.line(10, -5, 10, 5, 1); r.line(30, -5, 30, 5, 1); },
};
// Pull-up / Pull-down: zieht eine offene (hochohmige) Leitung auf 1 bzw. 0
function pull(type, name, up) {
  return {
    type, name, cat: 'Leitungen', pull: up ? 'up' : 'down',
    defaults: { Bits: 1 }, props: [P.bits],
    geo(a) { return { pins: [{ n: 'out', bits: a.Bits, x: 0, y: 0, out: true, vert: true, pull: true }], box: up ? { x0: -10, y0: -2 * S - 6, x1: 10, y1: 0 } : { x0: -10, y0: 0, x1: 10, y1: 2 * S } }; },
    eval() { return [null]; },
    draw(r) {
      const d = up ? -1 : 1;
      r.rect(-7, d * 1, 7, d * 26, true);
      r.line(0, d * 26, 0, d * 2 * S);
      if (up) r.poly([[-10, -2 * S + 6], [0, -2 * S - 4], [10, -2 * S + 6]], false); else r.line(-10, 2 * S, 10, 2 * S, 3);
    },
  };
}
// Bus-Splitter (bidirektional mit OE): Anschlüsse D (gemeinsam), OE, D0..Dn
const BusSplitter = {
  type: 'BusSplitter', name: 'Bus-Splitter', cat: 'Leitungen',
  defaults: { Bits: 1, splitterSpreading: 1 }, initial: { Bits: 8 }, props: [P.bits],
  geo(a) {
    const n = a.Bits, sp = (a.splitterSpreading || 1) * S;
    const pins = [{ n: 'OE', bits: 1, x: 0, y: S, out: false }, { n: 'D', bits: n, x: 0, y: 0, out: false }];
    for (let i = 0; i < n; i++) pins.push({ n: 'D' + i, bits: 1, x: S, y: i * sp, out: false });
    pins.push({ n: 'D', bits: n, x: 0, y: 0, out: true });
    for (let i = 0; i < n; i++) pins.push({ n: 'D' + i, bits: 1, x: S, y: i * sp, out: true });
    const len = (Math.max(3, n) - 1) * sp + 2;
    return { pins, n, len, box: { x0: -4, y0: -4, x1: S + 4, y1: len } };
  },
  eval(ins, st, a, g) {
    const n = g.n, oe = v0(ins[0]);
    if (oe) {
      const d = ins[1];
      return [null, ...Array.from({ length: n }, (_, i) => (d == null ? null : Math.floor(d / 2 ** i) & 1))];
    }
    const bits = ins.slice(2, 2 + n);
    const all = bits.some(b => b == null) ? null : bits.reduce((s, b, i) => s + (b & 1) * 2 ** i, 0);
    return [all, ...Array(n).fill(null)];
  },
  draw(r, c, a, g) {
    r.line(0, 0, 10, 0); r.line(0, S, 10, S);
    r.text(-2, -3, 'D', -1, -1, 9, 'pinlabel'); r.text(-2, S - 3, 'OE', -1, -1, 9, 'pinlabel');
    for (let i = 0; i < g.n; i++) { const y = i * (a.splitterSpreading || 1) * S; r.line(S, y, 10, y); r.text(S + 2, y - 3, String(i), 1, -1, 9, 'pinlabel'); }
    r.poly([[8, -2], [12, -2], [12, g.len], [8, g.len]], true, null, 0, '#222');
  },
};
const BitExtender = {
  type: 'BitExtender', name: 'Vorzeichenerweiterung', cat: 'Arithmetik',
  defaults: { inputBits: 8, outputBits: 16, Label: '' },
  props: [{ key: 'inputBits', label: 'Eingangsbits', type: 'int', min: 1, max: 31 }, { key: 'outputBits', label: 'Ausgangsbits', type: 'int', min: 2, max: 32 }],
  geo(a) { return generic({ ins: [{ n: 'in', bits: a.inputBits }], outs: [{ n: 'out', bits: a.outputBits }], width: 3 }); },
  eval(ins, st, a) {
    const v = ins[0]; if (v == null) return [null];
    const neg = (v >> (a.inputBits - 1)) & 1;
    return [neg ? ((v | (mask(a.outputBits) - mask(a.inputBits))) >>> 0) : v];
  },
  draw(r, c, a, g) { drawGenericBox(r, g, a, { title: 'Vorzeichen' }); },
};
// Spannungsversorgung (in den 74xx-Chips von Digital) – ohne Funktion in der Simulation
const PowerSupply = {
  type: 'PowerSupply', name: 'Spannungsversorgung', cat: null,
  defaults: { Label: '' }, props: [],
  geo() { return generic({ ins: [{ n: 'VDD', bits: 1 }, { n: 'GND', bits: 1 }], outs: [], width: 3 }); },
  eval() { return []; },
  draw(r, c, a, g) { drawGenericBox(r, g, a, { title: 'Versorgung' }); },
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
  defaults: { 'Selector Bits': 1, Bits: 1, flipSelPos: false, Default: 0 },
  props: [P.selBits, P.bits, P.flip],
  geo: a => demuxGeo(a, true),
  // nicht ausgewählte Ausgänge liefern den Wert "Default" (wie in Digital)
  eval(ins, st, a, g) { const s = v0(ins[0]), d = (a.Default || 0) & mask(a.Bits); return range(g.n).map(i => (i === s ? v0(ins[1]) : d)); },
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
function ff(type, name, inNames, step, extraDefaults = {}, extraProps = [], cat = 'Flipflops') {
  return {
    type, name, cat,
    defaults: { Label: '', inverterConfig: [], Default: 0, ...extraDefaults },
    props: [P.label, ...extraProps],
    geo(a) {
      const names = typeof inNames === 'function' ? inNames(a) : inNames;
      const bits = a.Bits || 1;
      return generic({
        ins: names.map(n => ({ n, bits: n === 'C' || n === 'Set' || n === 'Clr' ? 1 : bits, clock: n === 'C' })),
        outs: [{ n: 'Q', bits }, { n: '~Q', bits }], width: 3, invIn: invSet(a, names),
      });
    },
    init(st, a) { st.q = (a.Default || 0) & mask(a.Bits || 1); st.c = 0; },
    eval(ins, st, a, g) {
      const m = mask(a.Bits || 1);
      ins = applyInv(ins, g);
      const names = g.pins.filter(p => !p.out).map(p => p.n);
      const v = {}; names.forEach((n, i) => (v[n] = v0(ins[i])));
      if (v.C && !st.c) st.q = step(v, st.q, m, a) & m;
      st.c = v.C;
      // asynchrones Setzen/Rücksetzen (D_FF_AS, JK_FF_AS)
      if (v.Set) st.q = m; else if (v.Clr) st.q = 0;
      return [st.q >>> 0, (~st.q & m) >>> 0];
    },
    draw(r, c, a, g) { drawGenericBox(r, g, a); },
  };
}
// RS-Flipflop ohne Takt (Digital: RS_FF_AS), pegelgesteuert
const RS_AS = {
  type: 'RS_FF_AS', name: 'RS-Flipflop (asynchron)', cat: 'Flipflops',
  defaults: { Label: '', inverterConfig: [], Default: 0 },
  props: [P.label],
  geo(a) { return generic({ ins: [{ n: 'S', bits: 1 }, { n: 'R', bits: 1 }], outs: [{ n: 'Q', bits: 1 }, { n: '~Q', bits: 1 }], width: 3, invIn: invSet(a, ['S', 'R']) }); },
  init(st, a) { st.q = a.Default ? 1 : 0; st.qn = 1 - st.q; },
  eval(ins, st, a, g) {
    const [s, r] = applyInv(ins, g).map(v0);
    if (s && r) { st.q = 0; st.qn = 0; } else if (s) { st.q = 1; st.qn = 0; } else if (r) { st.q = 0; st.qn = 1; } else if (!st.q && !st.qn) { st.q = 1; }
    return [st.q, st.qn];
  },
  draw(r, c, a, g) { drawGenericBox(r, g, a); },
};

// ---------- Arithmetik ----------
function arith(type, name, ins, outs, ev, defaults, props, initial) {
  return {
    type, name, cat: 'Arithmetik', defaults: { Bits: 1, Label: '', ...defaults }, initial, props: [P.bits, P.label, ...(props || [])],
    geo(a) {
      const iv = ins.map(n => (typeof n === 'string' ? { n, bits: a.Bits } : { ...n, bits: n.bits || a.Bits }));
      return generic({
        ins: iv,
        outs: outs.map(n => (typeof n === 'string' ? { n, bits: a.Bits } : { ...n, bits: n.bits || a.Bits })),
        width: 3, invIn: invSet(a, iv.map(p => p.n)),
      });
    },
    init(st) { st.q = 0; st.c = 0; },
    eval(insV, st, a, g) { return ev(g.pins.some(p => p.inv) ? insV.map((x, i) => (g.pins[i].inv && x != null ? (~x & mask(g.pins[i].bits || 1)) >>> 0 : x)) : insV, st, a, g); },
    draw(r, c, a, g) { drawGenericBox(r, g, a, { title: name }); },
  };
}

const Add = arith('Add', 'Addierer', ['a', 'b', { n: 'c_i', bits: 1 }], ['s', { n: 'c_o', bits: 1 }], (ins, st, a) => {
  const m = mask(a.Bits); const sum = v0(ins[0]) + v0(ins[1]) + (v0(ins[2]) & 1);
  return [sum % (m + 1), sum > m ? 1 : 0];
});
// Ausgänge in der Reihenfolge von Digital: >, =, <
const Comparator = arith('Comparator', 'Komparator', ['a', 'b'], [{ n: '>', bits: 1 }, { n: '=', bits: 1 }, { n: '<', bits: 1 }], (ins, st, a) => {
  let x = v0(ins[0]), y = v0(ins[1]);
  if (a.Signed) { const h = 2 ** (a.Bits - 1); if (x >= h) x -= 2 * h; if (y >= h) y -= 2 * h; }
  return [x > y ? 1 : 0, x === y ? 1 : 0, x < y ? 1 : 0];
}, { Signed: false }, [{ key: 'Signed', label: 'Vorzeichenbehaftet', type: 'bool' }]);
const Counter = arith('Counter', 'Zähler', [{ n: 'en', bits: 1 }, { n: 'C', bits: 1, clock: true }, { n: 'clr', bits: 1 }], ['out', { n: 'ovf', bits: 1 }], (ins, st, a) => {
  const m = mask(a.Bits); const en = v0(ins[0]), C = v0(ins[1]), clr = v0(ins[2]);
  if (C && !st.c) { if (clr) st.q = 0; else if (en) st.q = st.q >= m ? 0 : st.q + 1; }
  st.c = C;
  return [st.q, en && st.q === m ? 1 : 0];
}, {}, null, { Bits: 4 });
const Register = arith('Register', 'Register', ['D', { n: 'C', bits: 1, clock: true }, { n: 'en', bits: 1 }], ['Q'], (ins, st, a) => {
  const C = v0(ins[1]);
  if (C && !st.c && v0(ins[2])) st.q = v0(ins[0]) & mask(a.Bits);
  st.c = C;
  return [st.q];
}, {}, null, { Bits: 8 });

// ---------- Sonstiges ----------
const Text = {
  type: 'Text', name: 'Text', cat: 'Sonstiges',
  defaults: { Description: '' },
  initial: { Description: 'Text' },
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
    const pn = parseInt(a.pinNumber) || 0;
    if (k.type === 'In') ins.push({ n: a.Label || '?', bits: a.Bits || 1, pn });
    else if (k.type === 'Clock') ins.push({ n: a.Label || '?', bits: 1, clock: true, pn });
    else if (k.type === 'Out') outs.push({ n: a.Label || '?', bits: a.Bits || 1, pn });
  }
  return { ins, outs };
}
// Form "LAYOUT" (Digital): Anschlüsse auf der Seite, zu der Ein-/Ausgang in der Schaltung zeigt
function layoutGeo(sub, ins, outs) {
  const L = { left: [], right: [], top: [], bottom: [] };
  for (const k of sub.comps) {
    const a = { ...DEF[k.type]?.defaults, ...k.attrs }, r = (k.rot || 0) & 3;
    if (k.type === 'In' || k.type === 'Clock') L[['left', 'bottom', 'right', 'top'][r]].push({ label: a.Label, x: k.x, y: k.y });
    if (k.type === 'Out') L[['right', 'top', 'left', 'bottom'][r]].push({ label: a.Label, x: k.x, y: k.y });
  }
  const mx = (l, m) => Math.max(m, l.length + 1);
  const height = mx(L.left, mx(L.right, sub.top?.Height ?? 3)), width = mx(L.top, mx(L.bottom, sub.top?.Width ?? 3));
  const map = new Map();
  const place = (l, sx, sy, len, horiz, side) => {
    if (!l.length) return;
    l.sort((p, q) => (horiz ? p.x - q.x : p.y - q.y));
    const delta = Math.floor((len + 2) / (l.length + 1)), pinsOnly = delta * (l.length - 1);
    let pos = Math.floor((len - pinsOnly) / 2);
    for (const p of l) { map.set(p.label, { x: horiz ? sx + S * pos : sx, y: horiz ? sy : sy + S * pos, side }); pos += delta; }
  };
  place(L.top, 0, 0, width, true, 'top'); place(L.bottom, 0, S * height, width, true, 'bottom');
  place(L.left, 0, 0, height, false, 'left'); place(L.right, S * width, 0, height, false, 'right');
  const pins = [...ins.map(p => ({ ...p, out: false })), ...outs.map(p => ({ ...p, out: true }))].map(p => {
    const q = map.get(p.n) || { x: 0, y: 0, side: 'left' };
    return { n: p.n, bits: p.bits, clock: p.clock, x: q.x, y: q.y, out: p.out, vert: q.side === 'top' || q.side === 'bottom', side: q.side };
  });
  return { pins, layout: true, width, height, hasTop: L.top.length > 0, hasBottom: L.bottom.length > 0, box: { x0: 0, y0: 0, x1: S * width, y1: S * height } };
}
// Form "MINIMIZED" (Digital): verkleinerte Schaltung, Anschlüsse an den Stellen der Ein-/Ausgänge
function minimizedGeo(sub, ins, outs) {
  const pos = new Map();
  for (const k of sub.comps) if (k.type === 'In' || k.type === 'Clock' || k.type === 'Out') pos.set({ ...DEF[k.type]?.defaults, ...k.attrs }.Label, [k.x, k.y]);
  const xs = [...pos.values()].map(p => p[0]), ys = [...pos.values()].map(p => p[1]);
  const minX = xs.length ? Math.min(...xs) : 0, minY = ys.length ? Math.min(...ys) : 0;
  const grid = v => Math.round(v / 2 / S) * S;
  const pins = [...ins.map(p => ({ ...p, out: false })), ...outs.map(p => ({ ...p, out: true }))].map(p => {
    const q = pos.get(p.n) || [minX, minY];
    return { n: p.n, bits: p.bits, clock: p.clock, x: grid(q[0] - minX), y: grid(q[1] - minY), out: p.out };
  });
  const px = pins.map(p => p.x), py = pins.map(p => p.y);
  return { pins, minimized: true, box: { x0: Math.min(0, ...px), y0: Math.min(0, ...py) - 10, x1: Math.max(S, ...px), y1: Math.max(S, ...py) + 10 } };
}
// DIL-Gehäuse wie in Digital: Pin 1..n/2 links von oben, Rest rechts von unten, Abstand 40
function dilGeo(sub, ins, outs) {
  const top = sub.top || {};
  const width = (top.Width ?? 3) + 1;
  const all = [...ins.map(p => ({ ...p, out: false })), ...outs.map(p => ({ ...p, out: true }))];
  const map = new Map(); const rest = [];
  let pc = top.pinCount || 0;
  for (const p of all) { if (!p.pn || map.has(p.pn)) rest.push(p); else { map.set(p.pn, p); pc = Math.max(pc, p.pn); } }
  let num = 1;
  for (const p of rest) { while (map.has(num)) num++; map.set(num, p); p.pn = num; }
  pc = Math.max(pc, num); if (pc & 1) pc++;
  const pos = n => (n <= pc / 2 ? [0, (n - 1) * 2 * S] : [S * width, (pc - n) * 2 * S]);
  const pins = all.map(p => { const n = [...map].find(([, q]) => q === p)[0]; const [x, y] = pos(n); return { n: p.n, bits: p.bits, clock: p.clock, x, y, out: p.out, num: n }; });
  const h = (pc / 2) * 2 * S - S;
  return { pins, dil: true, width, pc, map, box: { x0: 0, y0: -S, x1: S * width, y1: h } };
}
const Sub = {
  type: 'Custom', name: 'Baustein', cat: null,
  defaults: { Label: '' },
  props: [{ ...P.label, hint: 'Mit Beschriftung erscheinen die Ausgänge des Bausteins in der Wertetabelle als Zwischenschritte (z. B. HA1.S).' }],
  genericProp: { key: 'generic', label: 'Parameter (generischer Baustein)', type: 'textarea', mono: true, hint: 'z. B. bits := 8; – im Baustein über args.bits verfügbar.' },
  geo(a, c) {
    let sub = getCircuit(c?.sub);
    if (!sub) return { pins: [], missing: true, box: { x0: 0, y0: -10, x1: 100, y1: 30 } };
    if (isGeneric(sub)) { try { sub = resolveCircuit(sub, instanceArgs(c), c.sub); } catch { /* Fehler zeigt die Simulation */ } }
    const { ins, outs } = subInterface(sub);
    if (!ins.length && !outs.length) return { pins: [], missing: true, box: { x0: 0, y0: -10, x1: 100, y1: 30 } };
    // Form: am Baustein eingestellt (falls nicht "DEFAULT"), sonst die der Schaltung
    const shape = a.shapeType && a.shapeType !== 'DEFAULT' ? a.shapeType : sub.top?.shapeType;
    if (shape === 'DIL') return dilGeo(sub, ins, outs);
    if (shape === 'LAYOUT') return layoutGeo(sub, ins, outs);
    if (shape === 'MINIMIZED') return minimizedGeo(sub, ins, outs);
    return generic({ ins, outs: outs.length ? outs : [], width: sub.top?.Width ?? 3 });
  },
  eval() { return []; },
  draw(r, c, a, g) {
    if (g.missing) { r.rect(0, -10, 100, 30, true, '#fde8e8'); r.text(50, 10, (c.sub || '?') + ' fehlt', 0, 0, 11, 'name'); return; }
    if (g.layout) {
      r.rect(0, 0, S * g.width, S * g.height, true);
      for (const p of g.pins) {
        if (p.side === 'left') r.text(p.x + 4, p.y, p.n, 1, 0, 11, 'pinlabel');
        else if (p.side === 'right') r.text(p.x - 4, p.y, p.n, -1, 0, 11, 'pinlabel');
        else r.text(p.x, p.y + (p.side === 'top' ? 4 : -4), p.n, 0, p.side === 'top' ? 1 : -1, 10, 'pinlabel');
      }
      const name = a.Label || c.sub;
      if (!g.hasBottom) r.text(S * g.width / 2, S * g.height + 4, name, 0, 1, 12, 'name');
      else if (!g.hasTop) r.text(S * g.width / 2, -4, name, 0, -1, 12, 'name');
      else r.text(S * g.width / 2, S * g.height / 2, name, 0, 0, 12, 'name');
      return;
    }
    if (g.minimized) {
      const b = g.box; r.ctx.save(); r.ctx.setLineDash([5, 4]); r.ctx.lineWidth = 1.5; r.ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); r.ctx.restore();
      for (const p of g.pins) r.text(p.x + (p.out ? -3 : 3), p.y - 3, p.n, p.out ? -1 : 1, -1, 8, 'pinlabel');
      r.text((b.x0 + b.x1) / 2, b.y0 - 2, a.Label || c.sub, 0, -1, 11, 'name');
      return;
    }
    if (g.dil) {
      const x = S * g.width, p = 10, h = (g.pc / 2) * 2 * S - S, R = S / 2;
      r.path(ctx => {
        ctx.moveTo(p, -S); ctx.lineTo(x / 2 - R, -S); ctx.arc(x / 2, -S, R, Math.PI, 0, true);
        ctx.lineTo(x - p, -S); ctx.lineTo(x - p, h); ctx.lineTo(p, h); ctx.closePath();
      });
      const nice = t => String(t).replace(/_/g, '');
      for (let i = 0; i < g.pc / 2; i++) {
        const y = i * 2 * S;
        r.poly([[p, y - p / 2], [2, y - p / 2], [2, y + p / 2], [p, y + p / 2]], false);
        r.poly([[x - p, y - p / 2], [x - 2, y - p / 2], [x - 2, y + p / 2], [x - p, y + p / 2]], false);
        const lp = g.map.get(i + 1), rp = g.map.get(g.pc - i);
        if (lp) r.text(p + 5, y, nice(lp.n), 1, 0, 11, 'pinlabel');
        if (rp) r.text(x - p - 5, y, nice(rp.n), -1, 0, 11, 'pinlabel');
        r.text(-2, y - 3, String(i + 1), -1, -1, 8, 'name');
        r.text(x + 2, y - 3, String(g.pc - i), 1, -1, 8, 'name');
      }
      r.text(x / 2, S, c.sub, 0, 0, 13, 'symbol');   // zwischen erster und zweiter Pin-Reihe
      if (a.Label) r.text(x / 2, h + 4, a.Label, 0, 1, 13, 'label');
      return;
    }
    drawGenericBox(r, g, a, { title: c.sub });
  },
};

// Testfall (Digital: "Testcase")
const Testcase = {
  type: 'Testcase', name: 'Testfall', cat: 'Sonstiges',
  defaults: { Label: '', Testdata: '' },
  initial: { Testdata: 'A B Y\n0 0 0\n0 1 0\n1 0 0\n1 1 1' },
  props: [P.label, { key: 'Testdata', label: 'Testdaten', type: 'textarea', mono: true, hint: 'Erste Zeile: Namen der Ein- und Ausgänge. Dann je Zeile die Werte. X = beliebig, C = Taktimpuls, Z = hochohmig, # = Kommentar. Außerdem wie in Digital: loop(i,n) … end loop, while(Bedingung) … end while, repeat(n), let, declare, init, memory Name(Adr) = Wert;, program(…), bits(k, Ausdruck), resetRandom.' }],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 80, y1: 40 } }; },
  eval() { return []; },
  draw(r, c, a) {
    const res = c._result;
    r.rrect(1, 1, 79, 39, 6, res === 'ok' ? '#dcfce7' : res === 'fail' ? '#fee2e2' : '#fff');
    r.text(40, a.Label ? 13 : 20, res === 'ok' ? 'Test ✓' : res === 'fail' ? 'Test ✗' : 'Test', 0, 0, 13, 'value');
    if (a.Label) r.text(40, 28, a.Label, 0, 0, 11, 'name');
  },
};

// Code-Bauteile für generische Schaltungen
const GenericInitCode = {
  type: 'GenericInitCode', name: 'Generische Initialisierung', cat: 'Sonstiges',
  defaults: { generic: '', enabled: true }, initial: { generic: 'bits := 4;' },
  props: [{ key: 'generic', label: 'Standardargumente', type: 'textarea', mono: true, hint: 'Werte, mit denen die generische Schaltung allein simuliert wird, z. B. bits := 4;' }, { key: 'enabled', label: 'Aktiv', type: 'bool' }],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 120, y1: 40 } }; },
  eval() { return []; },
  draw(r, c, a) { r.rrect(1, 1, 119, 39, 6, '#ecfdf5'); r.text(8, 8, 'Init', 1, 1, 10, 'name'); r.text(8, 22, String(a.generic || '').split('\n')[0].slice(0, 18), 1, 1, 11, 'value'); },
};
const GenericCode = {
  type: 'GenericCode', name: 'Generischer Code', cat: 'Sonstiges',
  defaults: { generic: '' }, initial: { generic: '// addComponent("And", x, y); addWire(x1, y1, x2, y2);' },
  props: [{ key: 'generic', label: 'Code', type: 'textarea', mono: true, hint: 'Erzeugt Bauteile und Leitungen: c := addComponent("And", 10, 5); c.Inputs = args.n; addWire(0, 0, 10, 0); (Koordinaten in Rastereinheiten)' }],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 120, y1: 40 } }; },
  eval() { return []; },
  draw(r) { r.rrect(1, 1, 119, 39, 6, '#eff6ff'); r.text(60, 20, '{ Code }', 0, 0, 12, 'value'); },
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
  In, Out, LED, Button, Clock, Const, Ground, VDD, Probe, SevenSeg, SevenSegHex, ...IO_DEFS,
  gate('And', 'UND', '&', AND, false, ieeeAnd),
  gate('Or', 'ODER', '≥1', OR, false, ieeeOr),
  gate('Not', 'NICHT', '1', v => v[0], true, ieeeNot),
  gate('NAnd', 'NAND', '&', AND, true, ieeeAnd),
  gate('NOr', 'NOR', '≥1', OR, true, ieeeOr),
  gate('XOr', 'XOR', '=1', XOR, false, (r, g) => ieeeOr(r, g, true)),
  gate('XNOr', 'XNOR', '=1', XOR, true, (r, g) => ieeeOr(r, g, true)),
  Tunnel, Splitter, driver('Driver', 'Treiber (Tri-State)', false), driver('DriverInvSel', 'Treiber, Steuerung invertiert', true),
  BusSplitter, pull('PullUp', 'Pull-up', true), pull('PullDown', 'Pull-down', false), Delay,
  Mux, Demux, Decoder, ...PLEX_DEFS,
  ff('RS_FF', 'RS-Flipflop', ['S', 'C', 'R'], (v, q) => (v.S && !v.R ? 1 : !v.S && v.R ? 0 : q)),
  ff('JK_FF', 'JK-Flipflop', ['J', 'C', 'K'], (v, q) => (v.J && v.K ? ~q : v.J ? 1 : v.K ? 0 : q)),
  ff('D_FF', 'D-Flipflop', ['D', 'C'], v => v.D, { Bits: 1 }, [P.bits]),
  ff('T_FF', 'T-Flipflop', a => (a.withEnable === false ? ['C'] : ['T', 'C']), (v, q, m, a) => (a.withEnable === false || v.T ? ~q : q), { withEnable: true }, [P.withEnable]),
  ff('D_FF_AS', 'D-Flipflop (Set/Clr)', ['Set', 'D', 'C', 'Clr'], v => v.D, { Bits: 1 }, [P.bits]),
  ff('JK_FF_AS', 'JK-Flipflop (Set/Clr)', ['Set', 'J', 'C', 'K', 'Clr'], (v, q) => (v.J && v.K ? ~q : v.J ? 1 : v.K ? 0 : q)),
  RS_AS,
  Add, ...ARITH_DEFS.slice(0, 4), Comparator, ...ARITH_DEFS.slice(4, 6), Counter, ARITH_DEFS[6], Register, BitExtender, ARITH_DEFS[7],
  Text, Testcase,
  ...MEM_DEFS,
  ...SWITCH_DEFS,
  ...DISPLAY_DEFS,
  ...MISC_IO_DEFS,
  GenericInitCode, GenericCode,
];
export const DEF = Object.fromEntries([...DEFS, Unknown, Sub, PowerSupply].map(d => [d.type, d]));
const CAT_ORDER = ['Ein-/Ausgabe', 'Logikgatter', 'Plexer', 'Flipflops', 'Arithmetik', 'Speicher', 'Leitungen', 'Schalter & Transistoren', 'Anzeigen & Terminal', 'Simulation', 'Sonstiges'];
export const CATEGORIES = [...new Set([...CAT_ORDER, ...DEFS.map(d => d.cat)])].filter(k => k && DEFS.some(d => d.cat === k));

export function attrsOf(c) {
  const d = DEF[c.type];
  return { ...d.defaults, ...c.attrs };
}

// Geometrie mit Cache pro Bauteil
const geoCache = new WeakMap();
export function geoOf(c) {
  const key = c.type + JSON.stringify(c.attrs) + (c.type === 'Custom' ? c.sub + '#' + libVersion() : '');
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

// Gespiegelt (an der x-Achse, wie in Digital) und gedreht
export function xform(c, x, y) { return rot(x, c.attrs?.mirror ? -y : y, c.rot || 0); }

export function pinsWorld(c) {
  return geoOf(c).pins.map((p, i) => {
    const [x, y] = xform(c, p.x, p.y);
    return { ...p, idx: i, x: x + c.x, y: y + c.y };
  });
}

export function boundsWorld(c) {
  const b = geoOf(c).box;
  const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => xform(c, x, y));
  const xs = pts.map(p => p[0] + c.x), ys = pts.map(p => p[1] + c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
