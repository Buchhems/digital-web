// Ein-/Ausgabe wie in Digital: DIP-Schalter, RGB-LED, LED mit Polarität, Taster mit LED,
// Drehgeber, LED-Matrix, Terminal, Tastatur, Grafikkarte, VGA, Monoflop, Stop, Reset, Break,
// Pin-Steuerung, "nicht verbunden", Rechteck (Rahmen), Messgraph-Element.
import { S, v0, P, generic, drawGenericBox, invSet, applyInv } from './base.js';

const IO = 'Ein-/Ausgabe', DISP = 'Anzeigen & Terminal', CTRL = 'Simulation';
const rgbOf = c => (c && typeof c === 'object' ? `rgb(${c.r},${c.g},${c.b})` : c || 'rgb(255,0,0)');
const pin = (n, bits, extra = {}) => ({ n, bits, ...extra });
const labelProp = P.label;

// ---------- einfache Ein-/Ausgaben ----------
const DipSwitch = {
  type: 'DipSwitch', name: 'DIP-Schalter', cat: IO,
  defaults: { Label: '', dipDefault: false, Description: '' },
  props: [labelProp, { key: 'dipDefault', label: 'Startwert 1', type: 'bool' }],
  geo() { return { pins: [pin('out', 1, { x: 0, y: 0, out: true })], box: { x0: -2 * S, y0: -8, x1: 0, y1: 8 } }; },
  init(st, a) { st.value = a.dipDefault ? 1 : 0; },
  eval(i, st) { return [st.value]; },
  interactive: true, tap(st) { st.value ^= 1; },
  draw(r, c, a, g, st) {
    const on = st ? st.value : a.dipDefault ? 1 : 0;
    r.rect(-2 * S + 1, -8, -1, 8, true, '#b91c1c');
    r.rect(on ? -18 : -38, -5, on ? -4 : -24, 5, true, '#f9fafb');
    r.text(-2 * S - 3, 0, a.Label, -1, 0, 13, 'label');
  },
};

const RGBLED = {
  type: 'RGBLED', name: 'RGB-LED', cat: IO,
  defaults: { Label: '', Bits: 1, Size: 1 }, props: [labelProp, P.bits, { key: 'Size', label: 'Größe', type: 'int', min: 1, max: 5 }],
  geo(a) {
    const R = 10 + a.Size * 5;
    return { pins: [pin('R', a.Bits, { x: 0, y: -S, out: false }), pin('G', a.Bits, { x: 0, y: 0, out: false }), pin('B', a.Bits, { x: 0, y: S, out: false })], box: { x0: 0, y0: -Math.max(S, R), x1: 12 + 2 * R, y1: Math.max(S, R) } };
  },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const R = 10 + a.Size * 5, max = 2 ** a.Bits - 1;
    const ch = i => (st && st.ins[i] != null ? Math.round((st.ins[i] / max) * 255) : 0);
    r.line(0, -S, 8, -S, 1); r.line(0, 0, 8, 0, 1); r.line(0, S, 8, S, 1);
    r.circle(10 + R, 0, R, st ? `rgb(${ch(0)},${ch(1)},${ch(2)})` : '#9ca3af');
    r.text(2, -S - 3, 'R', 1, -1, 8, 'pinlabel'); r.text(2, -3, 'G', 1, -1, 8, 'pinlabel'); r.text(2, S - 3, 'B', 1, -1, 8, 'pinlabel');
    if (a.Label) r.text(14 + 2 * R, 0, a.Label, 1, 0, 13, 'label');
  },
};

const PolarityAwareLED = {
  type: 'PolarityAwareLED', name: 'LED mit Polung', cat: IO,
  defaults: { Label: '', Color: { r: 255, g: 0, b: 0 } }, props: [labelProp, P.color],
  geo() { return { pins: [pin('A', 1, { x: 0, y: 0, out: false, vert: true }), pin('C', 1, { x: 0, y: 4 * S, out: false, vert: true })], box: { x0: -14, y0: 0, x1: 14, y1: 4 * S } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const on = st ? st.ins[0] === 1 && st.ins[1] === 0 : false;
    r.line(0, 0, 0, 2 * S - 8); r.line(0, 2 * S + 8, 0, 4 * S);
    r.poly([[-9, 2 * S - 8], [9, 2 * S - 8], [0, 2 * S + 6]], true, null, null, on ? rgbOf(a.Color) : '#fff');
    r.line(-9, 2 * S + 7, 9, 2 * S + 7);
    r.line(11, 2 * S - 6, 17, 2 * S - 12, 1); r.line(13, 2 * S, 19, 2 * S - 6, 1);
    if (on) r.circle(0, 2 * S, 13, rgbOf(a.Color) + '', true);
    r.text(4, 3, 'A', 1, 1, 8, 'pinlabel'); r.text(4, 4 * S - 3, 'C', 1, -1, 8, 'pinlabel');
    if (a.Label) r.text(16, 2 * S, a.Label, 1, 0, 13, 'label');
  },
};

const ButtonLED = {
  type: 'ButtonLED', name: 'Taster mit LED', cat: IO,
  defaults: { Label: '', activeLow: false, Color: { r: 255, g: 0, b: 0 } }, props: [labelProp, P.activeLow, P.color],
  geo() { return { pins: [pin('out', 1, { x: 0, y: 0, out: true }), pin('in', 1, { x: 0, y: S, out: false })], box: { x0: -2 * S - 10, y0: -14, x1: 0, y1: S + 4 } }; },
  init(st) { st.pressed = false; },
  eval(i, st, a) { return [(st.pressed ? 1 : 0) ^ (a.activeLow ? 1 : 0)]; },
  interactive: true, press(st) { st.pressed = true; }, release(st) { st.pressed = false; },
  draw(r, c, a, g, st) {
    const p = st && st.pressed, lit = st && st.ins[0] === 1;
    r.rect(-2 * S - 9, -13, -1, S + 3, true);
    r.circle(-S - 5, 3 + (p ? 1 : 0), 11, lit ? rgbOf(a.Color) : p ? '#9aa4b2' : '#dde3ea');
    if (a.Label) r.text(-2 * S - 14, 3, a.Label, -1, 0, 13, 'label');
  },
};

// Drehgeber: A/B im Gray-Code; antippen öffnet Knöpfe zum Drehen
const GRAY = [[0, 0], [1, 0], [1, 1], [0, 1]];
const RotEncoder = {
  type: 'RotEncoder', name: 'Drehgeber', cat: IO,
  defaults: { Label: '' }, props: [labelProp],
  geo() { return { pins: [pin('A', 1, { x: 0, y: 0, out: true }), pin('B', 1, { x: 0, y: S, out: true })], box: { x0: -3 * S, y0: -S, x1: 0, y1: 2 * S } }; },
  init(st) { st.pos = 0; },
  eval(i, st) { return GRAY[((st.pos % 4) + 4) % 4]; },
  interactive: true, tap() { return 'rotate'; },
  draw(r, c, a, g, st) {
    r.circle(-30, 10, 22, '#e5e7eb'); r.circle(-30, 10, 15, '#9ca3af');
    const ang = ((st ? st.pos : 0) * Math.PI) / 8 - Math.PI / 2;
    r.line(-30, 10, -30 + Math.cos(ang) * 13, 10 + Math.sin(ang) * 13, 3);
    if (a.Label) r.text(-30, -14, a.Label, 0, -1, 13, 'label');
  },
};

// ---------- LED-Matrix ----------
const LedMatrix = {
  type: 'LedMatrix', name: 'LED-Matrix', cat: DISP,
  defaults: { Label: '', rowDataBits: 8, colAddrBits: 3, Color: { r: 255, g: 0, b: 0 }, ledPersistence: false },
  props: [labelProp, { key: 'rowDataBits', label: 'Zeilen (Datenbits)', type: 'int', min: 1, max: 32 }, { key: 'colAddrBits', label: 'Spalten-Adressbits', type: 'int', min: 1, max: 6 }, P.color, { key: 'ledPersistence', label: 'LEDs behalten ihren Zustand', type: 'bool' }],
  geo(a) {
    const g = generic({ ins: [pin('r-data', a.rowDataBits), pin('c-addr', a.colAddrBits)], outs: [], width: 3 });
    const cols = 2 ** a.colAddrBits, rows = a.rowDataBits, d = 10;
    g.mx = 3 * S + 10; g.my = -10; g.d = d;
    g.box = { ...g.box, x1: g.mx + cols * d + 4, y1: Math.max(g.box.y1, g.my + rows * d + 4) };
    return g;
  },
  init(st, a) { st.cols = Array(2 ** a.colAddrBits).fill(0); },
  eval(i, st) { const c = v0(i[1]); if (c < st.cols.length) st.cols[c] = v0(i[0]); return []; },
  draw(r, c, a, g, st) {
    drawGenericBox(r, g, a, { title: 'LED-Matrix' });
    const cols = 2 ** a.colAddrBits, rows = a.rowDataBits, d = g.d;
    r.rect(g.mx - 2, g.my - 2, g.mx + cols * d + 2, g.my + rows * d + 2, true, '#1f2937');
    const col = rgbOf(a.Color);
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const on = st && Math.floor(st.cols[x] / 2 ** y) % 2 === 1;
      r.circle(g.mx + x * d + d / 2, g.my + y * d + d / 2, d / 2 - 1.2, on ? col : '#4b5563', true);
    }
  },
};

// ---------- Terminal & Tastatur ----------
const Terminal = {
  type: 'Terminal', name: 'Terminal', cat: DISP,
  defaults: { Label: '', termWidth: 50, termHeight: 25 },
  props: [labelProp, { key: 'termWidth', label: 'Zeichen pro Zeile', type: 'int', min: 10, max: 200 }, { key: 'termHeight', label: 'Zeilen', type: 'int', min: 2, max: 100 }],
  geo() { const g = generic({ ins: [pin('D', 0), pin('C', 1, { clock: true }), pin('en', 1)], outs: [], width: 3 }); g.box = { ...g.box, x1: 3 * S + 190, y1: Math.max(g.box.y1, 54) }; return g; },
  init(st) { st.text = ''; st.c = 0; },
  eval(i, st, a) {
    const C = v0(i[1]);
    if (C && !st.c && v0(i[2])) {
      const v = v0(i[0]);
      if (v === 8 || v === 127) st.text = st.text.slice(0, -1);
      else if (v === 13 || v === 10) st.text += '\n';
      else if (v) st.text += String.fromCharCode(v);
      // nur die letzten Zeilen behalten
      const lines = wrapLines(st.text, a.termWidth);
      if (lines.length > a.termHeight * 4) st.text = lines.slice(-a.termHeight).join('\n');
    }
    st.c = C;
    return [];
  },
  interactive: true, tap() { return 'showView'; },
  draw(r, c, a, g, st) {
    drawGenericBox(r, g, a, { title: 'Terminal' });
    const x0 = 3 * S + 8;
    r.rect(x0, -10, x0 + 180, 52, true, '#111827');
    const lines = st ? wrapLines(st.text, 28).slice(-4) : [];
    lines.forEach((l, k) => termText(r, x0 + 4, -6 + k * 14, l));
  },
  view(el, st, a) {
    const lines = wrapLines(st.text, a.termWidth).slice(-a.termHeight);
    el.innerHTML = `<pre class="term" style="width:${a.termWidth}ch">${lines.map(escHtml).join('\n') || ' '}</pre>`;
  },
};
function wrapLines(text, w) { const out = []; for (const l of text.split('\n')) { if (!l.length) out.push(''); for (let i = 0; i < l.length; i += w) out.push(l.slice(i, i + w)); } return out; }
function termText(r, x, y, s) { r.ctx.save(); r.ctx.fillStyle = '#86efac'; r.ctx.font = '11px ui-monospace, Menlo, monospace'; r.ctx.textBaseline = 'top'; r.ctx.fillText(s, x, y); r.ctx.restore(); }
const escHtml = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

const Keyboard = {
  type: 'Keyboard', name: 'Tastatur', cat: DISP,
  defaults: { Label: '', inverterConfig: [] }, props: [labelProp, P.invert],
  geo(a) {
    const iv = [pin('C', 1, { clock: true }), pin('en', 1)];
    const g = generic({ ins: iv, outs: [pin('D', 16), pin('av', 1)], width: 3, invIn: invSet(a, ['C', 'en']) });
    g.box = { ...g.box, y1: Math.max(g.box.y1, 44) };
    return g;
  },
  init(st) { st.buf = ''; st.c = 0; },
  eval(insV, st, a, g) {
    const [C, en] = applyInv(insV, g).map(v0);
    if (C && !st.c && en) st.buf = st.buf.slice(1);
    st.c = C;
    const ch = st.buf.length ? st.buf.charCodeAt(0) : 0;
    return [en ? ch : null, st.buf.length ? 1 : 0];
  },
  interactive: true, tap() { return 'keyboard'; },
  draw(r, c, a, g, st) {
    drawGenericBox(r, g, a, { title: 'Tastatur' });
    r.rect(8, 26, 3 * S - 8, 40, true, '#f3f4f6');
    if (st) r.text(10, 33, st.buf.slice(0, 6) || '…', 1, 0, 10, 'value');
  },
};

// ---------- Grafikkarte & VGA ----------
const PALETTE = (() => {
  const p = new Map();
  const base = ['#fff', '#000', '#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f', '#ffc800', '#ffafaf'];
  base.forEach((c, i) => p.set(i, c));
  return p;
})();
const comp = (c, n) => Math.floor((255 * c) / (n - 1));
export function gcColor(v) {
  if (PALETTE.has(v)) return PALETTE.get(v);
  if (v >= 32 && v < 64) { const g = 255 - comp(v - 32, 32); return `rgb(${g},${g},${g})`; }
  if (v >= 64 && v < 128) { const i = v - 64; return `rgb(${comp(i >> 4 & 3, 4)},${comp(i >> 2 & 3, 4)},${comp(i & 3, 4)})`; }
  if (v >= 0x8000 && v < 0x10000) { const i = v - 0x8000; return `rgb(${comp(i >> 10 & 31, 32)},${comp(i >> 5 & 31, 32)},${comp(i & 31, 32)})`; }
  return '#000';
}
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  return cv;
}
const GraphicCard = {
  type: 'GraphicCard', name: 'Grafikkarte', cat: DISP, memory: true,
  defaults: { Label: '', Bits: 16, graphicWidth: 160, graphicHeight: 100 },
  props: [labelProp, P.bits, { key: 'graphicWidth', label: 'Breite (Pixel)', type: 'int', min: 8, max: 1024 }, { key: 'graphicHeight', label: 'Höhe (Pixel)', type: 'int', min: 8, max: 768 }],
  geo(a) {
    const size = a.graphicWidth * a.graphicHeight * 2;
    let ab = 1; while (2 ** ab < size) ab++;
    const g = generic({ ins: [pin('A', ab), pin('str', 1), pin('C', 1, { clock: true }), pin('ld', 1), pin('B', 1)], outs: [pin('D', a.Bits)], width: 3 });
    const o = g.pins.find(p => p.out); g.pins.push({ ...o, out: false, hidden: true });
    g.size = size; g.ab = ab;
    const sc = 160 / a.graphicWidth;
    g.vw = 160; g.vh = Math.round(a.graphicHeight * sc);
    g.box = { ...g.box, x1: 3 * S + 30 + g.vw, y1: Math.max(g.box.y1, g.vh - 6) };
    return g;
  },
  init(st, a) { st.mem = []; st.c = 0; st.addr = 0; st.bank = 0; st.cv = makeCanvas(a.graphicWidth, a.graphicHeight); },
  eval(i, st, a) {
    const [A, str, C, ld, B, Din] = i;
    const clk = v0(C), bank = v0(B), bs = a.graphicWidth * a.graphicHeight;
    const doStr = clk && !st.c && v0(str);
    if (v0(ld) || doStr) st.addr = v0(A);
    if (doStr) {
      st.mem[st.addr] = v0(Din);
      if ((st.addr >= bs ? 1 : 0) === bank && st.cv) { const p = st.addr % bs; const ctx = st.cv.getContext('2d'); ctx.fillStyle = gcColor(v0(Din)); ctx.fillRect(p % a.graphicWidth, Math.floor(p / a.graphicWidth), 1, 1); }
    }
    if (bank !== st.bank && st.cv) {
      st.bank = bank; const ctx = st.cv.getContext('2d');
      for (let p = 0; p < bs; p++) { ctx.fillStyle = gcColor(v0(st.mem[bank * bs + p])); ctx.fillRect(p % a.graphicWidth, Math.floor(p / a.graphicWidth), 1, 1); }
    }
    st.c = clk;
    return [v0(ld) ? v0(st.mem[st.addr]) : null];
  },
  interactive: true, tap() { return 'showView'; },
  draw(r, c, a, g, st) {
    drawGenericBox(r, g, a, { title: 'Grafik' });
    const x0 = 3 * S + 20;
    r.rect(x0 - 2, -12, x0 + g.vw + 2, -8 + g.vh, true, '#111827');
    if (st && st.cv) { r.ctx.save(); r.ctx.imageSmoothingEnabled = false; r.ctx.drawImage(st.cv, x0, -10, g.vw, g.vh); r.ctx.restore(); }
    else r.rect(x0, -10, x0 + g.vw, -10 + g.vh, true, '#fff');
  },
  view(el, st) { showCanvas(el, st.cv); },
};
function showCanvas(el, cv) {
  if (!cv) return;
  let img = el.querySelector('canvas');
  if (!img) { img = document.createElement('canvas'); img.className = 'gview'; el.appendChild(img); }
  if (img.width !== cv.width || img.height !== cv.height) { img.width = cv.width; img.height = cv.height; }
  img.getContext('2d').drawImage(cv, 0, 0);
}
// VGA: Pixeltakt C, Synchronimpulse H/V; Bildgröße wird aus den Impulsen ermittelt
function syncDetector() {
  return { last: false, high: 0, highLen: 0, low: 0, lowLen: 0,
    add(s) {
      if (s) { this.high++; if (!this.last) { this.lowLen = this.low; this.low = 0; } }
      else { this.low++; if (this.last) { this.highLen = this.high; this.high = 0; } }
      let res = false;
      if (this.lowLen > 0 && this.highLen > 0) res = this.lowLen > this.highLen ? this.last && !s : !this.last && s;
      this.last = s; return res;
    } };
}
const VGA = {
  type: 'VGA', name: 'VGA-Monitor', cat: DISP,
  defaults: { Label: '' }, props: [labelProp],
  geo() {
    const g = generic({ ins: [pin('R', 0), pin('G', 0), pin('B', 0), pin('H', 1), pin('V', 1), pin('C', 1, { clock: true })], outs: [], width: 3 });
    g.box = { ...g.box, x1: 3 * S + 190 };
    return g;
  },
  init(st) { Object.assign(st, { c: 0, x: 0, y: 0, lineLen: 0, lineCount: 0, hs: syncDetector(), vs: syncDetector(), cv: null, frames: 0 }); },
  eval(i, st, a) {
    const clk = v0(i[5]);
    if (clk && !st.c) {
      st.x++;
      if (st.hs.add(!!v0(i[3]))) { st.lineLen = st.x; st.x = 0; st.y++; }
      if (st.vs.add(!!v0(i[4]))) { st.lineCount = st.y; st.y = 0; st.frames++; }
      if (st.frames >= 2 && st.lineLen > 4 && st.lineCount > 2) {
        if (!st.cv || st.cv.width !== st.lineLen || st.cv.height !== st.lineCount) st.cv = makeCanvas(Math.min(2048, st.lineLen), Math.min(2048, st.lineCount));
        if (st.cv) {
          const bits = Math.max(1, st.bits?.[0] || 1), max = 2 ** bits - 1;
          const col = k => Math.round((v0(i[k]) * 255) / max);
          const ctx = st.cv.getContext('2d'); ctx.fillStyle = `rgb(${col(0)},${col(1)},${col(2)})`; ctx.fillRect(st.x, st.y, 1, 1);
        }
      }
    }
    st.c = clk;
    return [];
  },
  interactive: true, tap() { return 'showView'; },
  draw(r, c, a, g, st) {
    drawGenericBox(r, g, a, { title: 'VGA' });
    const x0 = 3 * S + 10;
    r.rect(x0, -10, x0 + 176, 122, true, '#111827');
    if (st && st.cv) { r.ctx.save(); r.ctx.imageSmoothingEnabled = false; r.ctx.drawImage(st.cv, x0 + 2, -8, 172, 128); r.ctx.restore(); }
    else r.text(x0 + 88, 56, st ? 'kein Signal' : 'VGA', 0, 0, 11, 'name');
  },
  view(el, st) { if (st.cv) showCanvas(el, st.cv); else el.innerHTML = '<p>Noch kein stabiles Bild (H- und V-Synchronimpulse nötig).</p>'; },
};

// ---------- Monoflop ----------
const Monoflop = {
  type: 'Monoflop', name: 'Monoflop', cat: 'Flipflops',
  defaults: { Label: '', Default: 0, timerDelay: 1, inverterConfig: [], mirror: false },
  props: [labelProp, { key: 'timerDelay', label: 'Dauer (Takte)', type: 'int', min: 1, max: 1e6, hint: 'Nach einer steigenden Flanke an C bleibt Q so viele Takte (des Takt-Eingangs der Schaltung) auf 1.' }, P.invert],
  geo(a) { return generic({ ins: [pin('C', 1, { clock: true }), pin('R', 1)], outs: [pin('Q', 1), pin('~Q', 1)], width: 3, invIn: invSet(a, ['C', 'R']) }); },
  onClockTick: true,
  init(st, a) { st.q = a.Default ? 1 : 0; st.c = 0; st.counter = 0; },
  eval(insV, st, a, g) {
    const [C, R] = applyInv(insV, g).map(v0);
    if (R) { st.q = 0; st.counter = 0; } else if (C && !st.c) { st.counter = a.timerDelay; st.q = 1; }
    st.c = C;
    return [st.q, 1 - st.q];
  },
  tick(st) { if (st.counter > 0 && --st.counter === 0) { st.q = 0; return true; } return false; },
  draw(r, c, a, g) { drawGenericBox(r, g, a, { title: 'Monoflop' }); },
};

// ---------- Simulationssteuerung ----------
const Stop = {
  type: 'Stop', name: 'Stopp', cat: CTRL,
  defaults: { Label: '', inverterConfig: [] }, props: [labelProp, P.invert],
  geo(a) { return generic({ ins: [pin('stop', 1)], outs: [], width: 2, invIn: invSet(a, ['stop']) }); },
  eval(i, st, a, g) { st.stop = !!v0(applyInv(i, g)[0]); return []; },
  draw(r, c, a, g) {
    r.poly([[12, -10], [28, -10], [38, 0], [38, 10], [28, 20], [12, 20], [2, 10], [2, 0]].map(([x, y]) => [x, y - 5]), true, null, null, '#dc2626');
    r.text(20, 0, 'STOP', 0, 0, 8, 'valueLight');
    if (a.Label) r.text(20, -18, a.Label, 0, -1, 12, 'label');
  },
};
const Reset = {
  type: 'Reset', name: 'Reset', cat: CTRL,
  defaults: { Label: '', invertOutput: true }, props: [labelProp, { key: 'invertOutput', label: 'Ausgang negiert (0 während des Resets)', type: 'bool' }],
  geo() { return { pins: [pin('Reset', 1, { x: 0, y: 0, out: true })], box: { x0: -2 * S - 10, y0: -12, x1: 0, y1: 12 } }; },
  init(st) { st.resetting = true; },
  eval(i, st, a) { return [(st.resetting ? 1 : 0) ^ (a.invertOutput ? 1 : 0)]; },
  draw(r, c, a, g, st) {
    r.rrect(-2 * S - 9, -11, -1, 11, 4, '#fef3c7');
    r.text(-S - 5, 0, 'R', 0, 0, 13, 'value');
    if (a.Label) r.text(-2 * S - 14, 0, a.Label, -1, 0, 13, 'label');
  },
};
const Break = {
  type: 'Break', name: 'Haltepunkt', cat: CTRL,
  defaults: { Label: '', enabled: true, Cycles: 100000 }, props: [labelProp, { key: 'enabled', label: 'Aktiv', type: 'bool' }],
  geo() { return { pins: [pin('brk', 1, { x: 0, y: 0, out: false })], box: { x0: 0, y0: -12, x1: 2 * S + 6, y1: 12 } }; },
  init(st) { st.last = 0; },
  eval(i, st, a) { const v = v0(i[0]); if (v && !st.last && a.enabled) st.hit = true; st.last = v; return []; },
  interactive: true, tap(st) { st.hit = false; return 'resume'; },
  draw(r, c, a, g, st) {
    r.circle(S + 2, 0, 11, st?.hit ? '#dc2626' : '#fca5a5'); r.line(0, 0, S - 9, 0);
    r.text(S + 2, 0, '‖', 0, 0, 12, 'value');
    if (a.Label) r.text(2 * S + 10, 0, a.Label, 1, 0, 13, 'label');
  },
};
// Asynchrone Ablaufsteuerung (Digital: AsyncSeq) – hier nur als Markierung
const AsyncSeq = {
  type: 'AsyncSeq', name: 'Asynchroner Ablauf', cat: null,
  defaults: { runRealTime: false, Frequency: 1 }, props: [],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 4 * S, y1: S + 4 } }; },
  eval() { return []; },
  draw(r) { r.rrect(1, 1, 4 * S - 1, S + 3, 4, '#f3f4f6'); r.text(2 * S, S / 2 + 2, 'Async', 0, 0, 10, 'name'); },
};

const NotConnected = {
  type: 'NotConnected', name: 'Nicht verbunden', cat: 'Leitungen',
  defaults: { Bits: 1 }, props: [P.bits],
  geo(a) { return { pins: [pin('out', a.Bits, { x: 0, y: 0, out: true })], box: { x0: -8, y0: -8, x1: 8, y1: 8 } }; },
  eval() { return [null]; },
  draw(r) { r.line(-6, -6, 6, 6, 2); r.line(-6, 6, 6, -6, 2); },
};
// Pin-Steuerung: Ausgang "pin" bidirektional (oe = Treiber an), "rd" liest den Pin
const PinControl = {
  type: 'PinControl', name: 'Pin-Steuerung', cat: 'Leitungen',
  defaults: { Bits: 1, mirror: false }, props: [P.bits, { key: 'mirror', label: 'Spiegeln', type: 'bool' }],
  geo(a) {
    return {
      pins: [pin('wr', a.Bits, { x: 0, y: 0, out: false }), pin('oe', 1, { x: S, y: -S, out: false, vert: true }), pin('pin', a.Bits, { x: 3 * S, y: 0, out: false, hidden: true }),
        pin('rd', a.Bits, { x: 2 * S, y: S, out: true, vert: true }), pin('pin', a.Bits, { x: 3 * S, y: 0, out: true })],
      box: { x0: 0, y0: -S, x1: 3 * S, y1: S },
    };
  },
  eval(i) { const [wr, oe, p] = i; return [p, v0(oe) ? wr : null]; },
  draw(r) {
    r.poly([[2, -12], [30, 0], [2, 12]], true); r.line(30, 0, 3 * S, 0); r.line(S, -S, S, -7);
    r.line(2 * S, 0, 2 * S, S); r.circle(2 * S, 0, 2.5, '#222', true);
  },
};

// ---------- Darstellung ----------
const Rectangle = {
  type: 'Rectangle', name: 'Rahmen', cat: 'Sonstiges',
  defaults: { Label: '', RectWidth: 6, RectHeight: 4, RectInside: false, RectBottom: false, RectRight: false, fontSize: 14 },
  initial: { Label: 'Bereich' },
  props: [{ ...labelProp, label: 'Titel' }, { key: 'RectWidth', label: 'Breite (Raster)', type: 'int', min: 1, max: 200 }, { key: 'RectHeight', label: 'Höhe (Raster)', type: 'int', min: 1, max: 200 },
    { key: 'RectInside', label: 'Titel innen', type: 'bool' }, { key: 'RectBottom', label: 'Titel unten', type: 'bool' }, { key: 'RectRight', label: 'Titel rechts', type: 'bool' }],
  geo(a) { return { pins: [], box: { x0: 0, y0: -18, x1: a.RectWidth * S, y1: a.RectHeight * S } }; },
  eval() { return []; },
  draw(r, c, a) {
    const w = a.RectWidth * S, h = a.RectHeight * S;
    r.ctx.save(); r.ctx.setLineDash([6, 4]); r.ctx.lineWidth = 1.5; r.ctx.strokeStyle = '#6b7280'; r.ctx.strokeRect(0, 0, w, h); r.ctx.restore();
    if (a.Label && a.Label !== '-') {
      const inside = !!a.RectInside, bottom = !!a.RectBottom, right = !!a.RectRight;
      const y = (bottom ? h : 0) + (inside !== bottom ? 4 : -4);
      r.text(right ? w - 4 : 4, y, a.Label, right ? -1 : 1, inside !== bottom ? 1 : -1, 13, 'label');
    }
  },
};
// Messgraph-Element (Digital: "Data"): antippen öffnet den Messgraphen
const DataGraph = {
  type: 'Data', name: 'Messgraph', cat: CTRL,
  defaults: { microStep: false, maxStepCount: 1000 }, props: [],
  geo() { return { pins: [], box: { x0: 0, y0: 0, x1: 5 * S, y1: 2 * S } }; },
  eval() { return []; },
  interactive: true, tap() { return 'showGraph'; },
  draw(r) {
    r.rrect(1, 1, 5 * S - 1, 2 * S - 1, 4, '#fff');
    r.poly([[8, 28], [20, 28], [20, 12], [40, 12], [40, 28], [60, 28], [60, 12], [80, 12], [80, 28], [92, 28]], false, '#2563eb', 2);
  },
};
const ScopeTrigger = {
  type: 'ScopeTrigger', name: 'Oszilloskop-Auslöser', cat: null,
  defaults: { Label: '' }, props: [labelProp],
  geo() { return { pins: [pin('T', 1, { x: 0, y: 0, out: false, clock: true })], box: { x0: 0, y0: -S, x1: 3 * S, y1: S } }; },
  eval() { return []; },
  interactive: true, tap() { return 'showGraph'; },
  draw(r, c, a) { r.rrect(2, -S + 1, 3 * S - 1, S - 1, 4, '#fff'); r.poly([[8, 6], [20, 6], [20, -6], [36, -6], [36, 6], [52, 6]], false, '#2563eb', 2); if (a.Label) r.text(30, -S - 3, a.Label, 0, -1, 12, 'label'); },
};

export const IO_DEFS = [DipSwitch, ButtonLED, RGBLED, PolarityAwareLED, RotEncoder];
export const DISPLAY_DEFS = [LedMatrix, Terminal, Keyboard, GraphicCard, VGA];
export const MISC_IO_DEFS = [Monoflop, Stop, Reset, Break, DataGraph, NotConnected, PinControl, Rectangle, AsyncSeq, ScopeTrigger];
