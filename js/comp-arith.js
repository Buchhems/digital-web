// Arithmetik und Codierer (wie in Digital: Sub, Mul, Div, Neg, BarrelShifter,
// BitCount, PRNG, CounterPreset, PriorityEncoder, BitSelector)
import { S, v0, range, P, generic, drawGenericBox, invSet, applyInv } from './base.js';

const AR = 'Arithmetik';
// Werte bis 53 Bit exakt (JavaScript-Zahlen); Bitoperationen nur bis 32 Bit
const pow2 = b => 2 ** b;
const wrap = (v, b) => { const m = pow2(b); if (v >= 0 && v < m) return v; const r = v % m; return r < 0 ? r + m : r; };
const signed = (v, b) => (v >= pow2(b - 1) ? v - pow2(b) : v);
const binLn2 = b => { let n = 1; while (pow2(n) <= b) n++; return n; };
const signedProp = { key: 'Signed', label: 'Vorzeichenbehaftet (Zweierkomplement)', type: 'bool' };

function box(type, name, title, { ins, outs, defaults = {}, props = [], width = 3, ev, init, cat = AR, initial }) {
  return {
    type, name, cat, initial,
    defaults: { Label: '', ...defaults },
    props: [P.label, ...props],
    geo(a) {
      const iv = ins(a), ov = outs(a);
      return generic({ ins: iv, outs: ov, width: a.Width || width, invIn: invSet(a, iv.map(p => p.n)) });
    },
    init: init || (st => { st.q = 0; st.c = 0; }),
    eval(insV, st, a, g) { return ev(applyInv(insV, g), st, a, g); },
    draw(r, c, a, g) { drawGenericBox(r, g, a, { title }); },
  };
}
const pin = (n, bits, extra = {}) => ({ n, bits, ...extra });

const Sub = box('Sub', 'Subtrahierer', 'Subtrahierer', {
  defaults: { Bits: 1 }, initial: { Bits: 4 }, props: [P.bits],
  ins: a => [pin('a', a.Bits), pin('b', a.Bits), pin('c_i', 1)],
  outs: a => [pin('s', a.Bits), pin('c_o', 1)],
  ev(i, st, a) {
    if (i.some(x => x == null)) return [null, null];
    const v = i[0] - i[1] - (i[2] & 1);
    return [wrap(v, a.Bits), v < 0 ? 1 : 0];
  },
});

const Mul = box('Mul', 'Multiplizierer', 'Multiplizierer', {
  defaults: { Bits: 1, Signed: false }, initial: { Bits: 4 }, props: [P.bits, signedProp],
  ins: a => [pin('a', a.Bits), pin('b', a.Bits)],
  outs: a => [pin('mul', Math.min(64, a.Bits * 2))],
  ev(i, st, a) {
    if (i.some(x => x == null)) return [null];
    const ob = Math.min(64, a.Bits * 2);
    const v = a.Signed ? signed(i[0], a.Bits) * signed(i[1], a.Bits) : i[0] * i[1];
    return [wrap(v, ob)];
  },
});

const Div = box('Div', 'Dividierer', 'Dividierer', {
  defaults: { Bits: 1, Signed: false, remainderPositive: true }, initial: { Bits: 4 },
  props: [P.bits, signedProp, { key: 'remainderPositive', label: 'Rest immer positiv', type: 'bool' }],
  ins: a => [pin('a', a.Bits), pin('b', a.Bits)],
  outs: a => [pin('q', a.Bits), pin('r', a.Bits)],
  ev(i, st, a) {
    if (i.some(x => x == null)) return [null, null];
    let q, r;
    if (a.Signed) {
      const av = signed(i[0], a.Bits); let bv = signed(i[1], a.Bits); if (bv === 0) bv = 1;
      q = Math.trunc(av / bv); r = av - q * bv;
      if (a.remainderPositive && r < 0) { if (bv >= 0) { r += bv; q--; } else { r -= bv; q++; } }
    } else {
      const bv = i[1] || 1; q = Math.floor(i[0] / bv); r = i[0] - q * bv;
    }
    return [wrap(q, a.Bits), wrap(r, a.Bits)];
  },
});

const Neg = box('Neg', 'Negation', 'Negation', {
  defaults: { Bits: 1 }, initial: { Bits: 4 }, props: [P.bits],
  ins: a => [pin('in', a.Bits)], outs: a => [pin('out', a.Bits)],
  ev(i, st, a) { return [i[0] == null ? null : wrap(-i[0], a.Bits)]; },
});

const BitCount = box('BitCount', 'Bitzähler', 'Bitzähler', {
  defaults: { Bits: 1 }, initial: { Bits: 8 }, props: [P.bits],
  ins: a => [pin('in', a.Bits)], outs: a => [pin('out', binLn2(a.Bits))],
  ev(i) {
    if (i[0] == null) return [null];
    let v = i[0], n = 0; while (v > 0) { n += v % 2; v = Math.floor(v / 2); }
    return [n];
  },
});

const BarrelShifter = box('BarrelShifter', 'Barrel-Shifter', 'Shifter', {
  defaults: { Bits: 1, barrelSigned: false, direction: 'left', barrelShifterMode: 'logical' }, initial: { Bits: 8 },
  props: [P.bits,
    { key: 'direction', label: 'Richtung', type: 'select', options: [['left', 'links'], ['right', 'rechts']] },
    { key: 'barrelShifterMode', label: 'Art', type: 'select', options: [['logical', 'logisch'], ['rotate', 'rotieren'], ['arithmetic', 'arithmetisch']] },
    { key: 'barrelSigned', label: 'Verschiebung vorzeichenbehaftet', type: 'bool' }],
  ins: a => [pin('in', a.Bits), pin('shift', binLn2(a.Bits) + (a.barrelSigned ? 1 : 0))],
  outs: a => [pin('out', a.Bits)],
  ev(i, st, a, g) {
    if (i.some(x => x == null)) return [null];
    const b = a.Bits, sb = g.pins[1].bits;
    let sh = a.barrelSigned ? signed(i[1], sb) : i[1];
    if (a.direction === 'right') sh = -sh;
    const inV = i[0];
    let v = 0;
    if (sh < 0) {
      sh = -sh;
      if (a.barrelShifterMode === 'rotate') { sh %= b; v += wrap(inV * pow2(b - sh), b); }
      v += Math.floor(inV / pow2(sh));
      if (a.barrelShifterMode === 'arithmetic' && inV >= pow2(b - 1)) {
        // obere sh Bits mit 1 füllen
        const fill = pow2(b) - pow2(Math.max(0, b - sh));
        v = (v % pow2(Math.max(0, b - sh))) + fill;
      }
    } else {
      if (a.barrelShifterMode === 'rotate') { sh %= b; v += Math.floor(inV / pow2(b - sh)); }
      v += inV * pow2(sh);
    }
    return [wrap(v, b)];
  },
});

// Zufallszahlen: S = Startwert, se = Startwert setzen, ne = nächster Wert, C = Takt
const PRNG = box('PRNG', 'Zufallszahlen', 'Zufall', {
  defaults: { Bits: 1 }, initial: { Bits: 8 }, props: [P.bits],
  ins: a => [pin('S', a.Bits), pin('se', 1), pin('ne', 1), pin('C', 1, { clock: true })],
  outs: a => [pin('R', a.Bits)],
  init(st) { st.seed = (Math.random() * 2 ** 31) >>> 0 || 1; st.q = 0; st.c = 0; },
  ev(i, st, a) {
    const C = v0(i[3]);
    if (C && !st.c) {
      if (v0(i[1])) st.seed = (v0(i[0]) >>> 0) || 1;
      if (v0(i[2])) {
        // xorshift32
        let x = st.seed; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; st.seed = x || 1;
        st.q = wrap(x, Math.min(32, a.Bits));
      }
    }
    st.c = C;
    return [st.q];
  },
});

// Zähler mit Voreinstellung (Digital: CounterPreset)
const CounterPreset = box('CounterPreset', 'Zähler mit Voreinstellung', 'Zähler', {
  defaults: { Bits: 1, maxValue: 0, inverterConfig: [] }, initial: { Bits: 4 },
  props: [P.bits, { key: 'maxValue', label: 'Höchster Wert (0 = alle Bits)', type: 'int', min: 0, max: 0xFFFFFFFF }, P.invert],
  ins: a => [pin('en', 1), pin('C', 1, { clock: true }), pin('dir', 1), pin('in', a.Bits), pin('ld', 1), pin('clr', 1)],
  outs: a => [pin('out', a.Bits), pin('ovf', 1)],
  ev(i, st, a) {
    const m = pow2(a.Bits) - 1; const max = (a.maxValue ? wrap(a.maxValue, a.Bits) : 0) || m;
    const [en, C, dir, inV, ld, clr] = [v0(i[0]), v0(i[1]), v0(i[2]), v0(i[3]), v0(i[4]), v0(i[5])];
    if (C && !st.c) {
      if (en) { if (dir) st.q = st.q === 0 ? max : st.q - 1; else st.q = st.q === max ? 0 : st.q + 1; }
      if (clr) st.q = 0; else if (ld) st.q = wrap(inV, a.Bits);
    }
    st.c = C;
    const ovf = en && (dir ? st.q === 0 : st.q === max) ? 1 : 0;
    return [st.q, ovf];
  },
});

// Prioritätsencoder: Nummer des höchsten aktiven Eingangs
const PriorityEncoder = box('PriorityEncoder', 'Prioritätsencoder', 'Priorität', {
  cat: 'Plexer', width: 4,
  defaults: { 'Selector Bits': 2 }, props: [P.selBits],
  ins: a => range(2 ** a['Selector Bits']).map(i => pin('in' + i, 1)),
  outs: a => [pin('num', a['Selector Bits']), pin('any', 1)],
  ev(i) { let n = 0, any = 0; i.forEach((x, k) => { if (x) { n = k; any = 1; } }); return [n, any]; },
});

// Bit-Auswahl: liefert das Bit "sel" des Eingangs
const BitSelector = {
  type: 'BitSelector', name: 'Bit-Auswahl', cat: 'Plexer',
  defaults: { 'Selector Bits': 1, flipSelPos: false }, props: [P.selBits, P.flip],
  geo(a) {
    const sb = a['Selector Bits'];
    return {
      pins: [{ n: 'sel', bits: sb, x: S, y: (a.flipSelPos ? -1 : 1) * S, out: false, vert: true }, { n: 'in', bits: 2 ** sb, x: 0, y: 0, out: false }, { n: 'out', bits: 1, x: 2 * S, y: 0, out: true }],
      box: { x0: 0, y0: -S - 4, x1: 2 * S, y1: S + 4 },
    };
  },
  eval(i) { if (i[0] == null || i[1] == null) return [null]; return [Math.floor(i[1] / 2 ** i[0]) % 2]; },
  draw(r) { r.poly([[1, -S - 4], [2 * S - 1, -S + 5], [2 * S - 1, S - 5], [1, S + 4]], true); r.text(S, 0, 'bit', 0, 0, 9, 'pinlabel'); },
};

export const ARITH_DEFS = [Sub, Mul, Div, Neg, BarrelShifter, BitCount, CounterPreset, PRNG];
export const PLEX_DEFS = [PriorityEncoder, BitSelector];
