// Schalterebene: Schalter, Relais, FETs, Transmission-Gate, Sicherung, Dioden.
// Geschlossene Kontakte verbinden ihre Netze (bidirektional) – der Simulator
// bildet dazu Netzgruppen (siehe sim.js, "switches").
import { S, range, P } from './base.js';

const SW = 'Schalter & Transistoren';
const mirrorProp = { key: 'mirror', label: 'Spiegeln', type: 'bool' };
const polesProp = { key: 'poles', label: 'Anzahl Pole', type: 'select', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] };
const blownProp = (label = 'Durchgebrannt / programmiert') => ({ key: 'Blown', label, type: 'bool' });
const isZ = x => x == null;

// Kontakt zeichnen: von (x0,y) zum Gegenkontakt, offen leicht schräg
function contact(r, x0, y, x1, closed, yc = y) {
  if (closed) r.line(x0, y, x1, yc, 2.5);
  else r.line(x0, y, x1 - 4, y - 12, 2.5);
  r.circle(x0, y, 2.5, '#222', true); r.circle(x1, yc, 2.5, '#222', true);
}
// Umschalter: A -> B (geschlossen) bzw. A -> C
function contactDT(r, y, closed) {
  r.line(S * 2, y + S, S * 2 - 5, y + S); r.line(S * 2 - 5, y + S, S * 2 - 5, y + 12);
  if (closed) r.line(0, y, S * 2, y, 2.5); else r.line(0, y, S * 2 - 6, y + 10, 2.5);
  r.circle(0, y, 2.5, '#222', true);
}
function actuator(r, poles, yTop, closed, dt) {
  const yo = closed && !dt ? 0 : -6;
  r.ctx.save(); r.ctx.setLineDash([4, 3]); r.line(S, (poles - 1) * 2 * S + yo, S, yTop, 1.2); r.ctx.restore();
}

// ---------- Schalter (von Hand) ----------
function manualSwitch(type, name, dt) {
  return {
    type, name, cat: SW, switches: true,
    defaults: { Label: '', Bits: 1, poles: 1, Closed: false, mirror: false, switchActsAsInput: false },
    props: dt ? [P.label, P.bits, polesProp, mirrorProp] : [P.label, P.bits, polesProp, { key: 'Closed', label: 'Geschlossen (Start)', type: 'bool' }, mirrorProp],
    geo(a) {
      const pins = [];
      for (let p = 0; p < a.poles; p++) {
        pins.push({ n: 'A' + (p + 1), bits: a.Bits, x: 0, y: 2 * S * p, out: false, bidi: true });
        pins.push({ n: 'B' + (p + 1), bits: a.Bits, x: 2 * S, y: 2 * S * p, out: false, bidi: true });
        if (dt) pins.push({ n: 'C' + (p + 1), bits: a.Bits, x: 2 * S, y: 2 * S * p + S, out: false, bidi: true });
      }
      return { pins, box: { x0: 0, y0: -2 * S, x1: 2 * S, y1: 2 * S * (a.poles - 1) + (dt ? S : 4) } };
    },
    init(st, a) { st.closed = dt ? false : !!a.Closed; },
    eval(ins, st, a) {
      const n = dt ? 3 : 2;
      st.pairs = range(a.poles).map(p => (dt ? [p * n, p * n + (st.closed ? 1 : 2)] : st.closed ? [p * n, p * n + 1] : null)).filter(Boolean);
      return [];
    },
    interactive: true,
    tap(st) { st.closed = !st.closed; },
    draw(r, c, a, g, st) {
      const closed = st ? st.closed : (dt ? false : !!a.Closed);
      for (let p = 0; p < a.poles; p++) dt ? contactDT(r, 2 * S * p, closed) : contact(r, 0, 2 * S * p, 2 * S, closed);
      actuator(r, a.poles, -S - 6, closed, dt);
      r.line(10, -S - 6, 30, -S - 6, 2.5);
      if (a.Label) r.text(S, -S - 10, a.Label, 0, -1, 13, 'label');
    },
  };
}

// ---------- Relais ----------
function relay(type, name, dt) {
  return {
    type, name, cat: SW, switches: true,
    defaults: { Label: '', Bits: 1, poles: 1, mirror: false, ...(dt ? {} : { relayNormallyClosed: false }) },
    props: dt ? [P.label, P.bits, polesProp, mirrorProp] : [P.label, P.bits, polesProp, { key: 'relayNormallyClosed', label: 'Öffner (in Ruhe geschlossen)', type: 'bool' }, mirrorProp],
    geo(a) {
      const pins = [{ n: 'in1', bits: 1, x: 0, y: -2 * S, out: false }, { n: 'in2', bits: 1, x: 2 * S, y: -2 * S, out: false }];
      for (let p = 0; p < a.poles; p++) {
        pins.push({ n: 'A' + (p + 1), bits: a.Bits, x: 0, y: 2 * S * p, out: false, bidi: true });
        pins.push({ n: 'B' + (p + 1), bits: a.Bits, x: 2 * S, y: 2 * S * p, out: false, bidi: true });
        if (dt) pins.push({ n: 'C' + (p + 1), bits: a.Bits, x: 2 * S, y: 2 * S * p + S, out: false, bidi: true });
      }
      return { pins, box: { x0: 0, y0: -2 * S - 10, x1: 2 * S, y1: 2 * S * (a.poles - 1) + (dt ? S : 4) } };
    },
    eval(ins, st, a) {
      const inv = !dt && !!a.relayNormallyClosed;
      st.closed = isZ(ins[0]) || isZ(ins[1]) ? inv : (!!ins[0] !== !!ins[1]) !== inv;
      const n = dt ? 3 : 2;
      st.pairs = range(a.poles).map(p => (dt ? [2 + p * n, 2 + p * n + (st.closed ? 1 : 2)] : st.closed ? [2 + p * n, 2 + p * n + 1] : null)).filter(Boolean);
      return [];
    },
    draw(r, c, a, g, st) {
      const closed = st ? st.closed : !dt && !!a.relayNormallyClosed;
      // Spule
      r.line(0, -2 * S, 8, -2 * S); r.line(32, -2 * S, 2 * S, -2 * S);
      r.rect(8, -2 * S - 8, 32, -2 * S + 8, true);
      r.line(8, -2 * S + 8, 32, -2 * S - 8, 1);
      for (let p = 0; p < a.poles; p++) dt ? contactDT(r, 2 * S * p, closed) : contact(r, 0, 2 * S * p, 2 * S, closed);
      actuator(r, a.poles, -2 * S + 8, closed, dt);
      if (a.Label) r.text(2 * S + 4, -2 * S - 8, a.Label, 1, -1, 13, 'label');
    },
  };
}

// ---------- Feldeffekttransistoren ----------
// N-Kanal: G unten links, D oben, S unten (wie in Digital); P-Kanal: G oben links, S oben, D unten
function fet(type, name, pChan, floating) {
  return {
    type, name, cat: SW, switches: true,
    defaults: { Label: '', Bits: 1, mirror: false, ...(floating ? { Blown: false } : { unidirectional: false }) },
    props: [P.label, P.bits, mirrorProp, floating ? blownProp('Programmiert (sperrt immer)') : { key: 'unidirectional', label: 'Nur in eine Richtung', type: 'bool', hint: 'Wie Open-Collector-Ausgänge: der Wert wird nur von S nach D (N-Kanal) bzw. S nach D (P-Kanal) weitergegeben.' }],
    geo(a) {
      const uni = !floating && a.unidirectional;
      const gy = pChan ? 0 : 2 * S;
      const n1 = pChan ? 'S' : 'D', n2 = pChan ? 'D' : 'S';
      // unidirektional: N-Kanal S -> D, P-Kanal S -> D (D ist dann ein Ausgang)
      const p1 = { n: n1, bits: a.Bits, x: S, y: 0, out: uni && n1 === 'D', vert: true, bidi: !uni };
      const p2 = { n: n2, bits: a.Bits, x: S, y: 2 * S, out: uni && n2 === 'D', vert: true, bidi: !uni };
      const pins = [{ n: 'G', bits: 1, x: 0, y: gy, out: false }];
      // Eingänge zuerst (Reihenfolge der ins), Ausgang zuletzt
      if (p1.out) pins.push(p2, p1); else pins.push(p1, p2);
      return { pins, uni, box: { x0: 0, y0: 0, x1: S + 10, y1: 2 * S } };
    },
    eval(ins, st, a, g) {
      const G = ins[0];
      let closed = isZ(G) ? false : pChan ? !G : !!G;
      if (floating && a.Blown) closed = false;
      st.closed = closed;
      if (g.uni) { st.pairs = []; return [closed ? ins[1] : null]; }
      st.pairs = closed ? [[1, 2]] : [];
      return [];
    },
    draw(r, c, a, g, st) {
      // Kanal und Anschlüsse
      r.poly([[S, 0], [8, 0], [8, 7]], false); r.poly([[S, 2 * S], [8, 2 * S], [8, 2 * S - 7]], false);
      r.line(8, 13, 8, 27);
      // Gate
      const gy = pChan ? 0 : 2 * S;
      r.line(1, 4, 1, 2 * S - 4);
      if (pChan) { r.line(0, 0, 1, 4); r.circle(-3, 0, 0.1, null); } else r.line(0, 2 * S, 1, 2 * S - 4);
      if (floating) r.line(4, 6, 4, 2 * S - 6, 1);
      // Pfeil (Substrat)
      r.line(8, S, S, S, 1);
      if (pChan) r.poly([[S - 1, S], [S - 6, S - 3], [S - 6, S + 3]], true, null, 0, '#222');
      else r.poly([[9, S], [14, S - 3], [14, S + 3]], true, null, 0, '#222');
      if (st) { const on = st.closed; r.circle(S + 6, S, 3, on ? '#16a34a' : '#9ca3af', true); }
      r.text(S + 3, 2, pChan ? 'S' : 'D', 1, 1, 8, 'pinlabel');
      r.text(S + 3, 2 * S - 2, pChan ? 'D' : 'S', 1, -1, 8, 'pinlabel');
      if (a.Label) r.text(S + 10, gy === 0 ? 2 * S : 0, a.Label, 1, gy === 0 ? -1 : 1, 12, 'label');
      if (floating && a.Blown) r.text(-2, S, '×', -1, 0, 14, 'value');
    },
  };
}

// ---------- Transmission-Gate ----------
const TransGate = {
  type: 'TransGate', name: 'Transmission-Gate', cat: SW, switches: true,
  defaults: { Bits: 1 }, props: [P.bits],
  geo(a) {
    return {
      pins: [{ n: 'S', bits: 1, x: S, y: -S, out: false, vert: true }, { n: '~S', bits: 1, x: S, y: S, out: false, vert: true },
        { n: 'A', bits: a.Bits, x: 0, y: 0, out: false, bidi: true }, { n: 'B', bits: a.Bits, x: 2 * S, y: 0, out: false, bidi: true }],
      box: { x0: 0, y0: -S, x1: 2 * S, y1: S },
    };
  },
  init(st) { st.closed = false; },
  eval(ins, st) {
    if (isZ(ins[0]) || isZ(ins[1])) st.closed = false;
    else if (!!ins[0] !== !!ins[1]) st.closed = !!ins[0];
    st.pairs = st.closed ? [[2, 3]] : [];
    return [];
  },
  draw(r, c, a, g, st) {
    r.poly([[4, -9], [36, 9], [36, -9], [4, 9]], true);
    r.line(0, 0, 4, 0); r.line(36, 0, 40, 0);
    r.line(S, -S, S, -4); r.line(S, S, S, 9); r.circle(S, 13, 4, null);
    if (st) r.circle(S, 0, 3, st.closed ? '#16a34a' : '#9ca3af', true);
  },
};

// ---------- Sicherung ----------
const Fuse = {
  type: 'Fuse', name: 'Sicherung', cat: SW, switches: true,
  defaults: { Bits: 1, Blown: false }, props: [P.bits, blownProp('Durchgebrannt')],
  geo(a) { return { pins: [{ n: 'out1', bits: a.Bits, x: 0, y: 0, out: false, bidi: true }, { n: 'out2', bits: a.Bits, x: S, y: 0, out: false, bidi: true }], box: { x0: 0, y0: -5, x1: S, y1: 5 } }; },
  eval(ins, st, a) { st.pairs = a.Blown ? [] : [[0, 1]]; return []; },
  draw(r, c, a) {
    r.rect(2, -5, 18, 5, true);
    if (a.Blown) { r.line(0, 0, 7, 0); r.line(13, 0, 20, 0); } else r.line(0, 0, 20, 0, 1.5);
  },
};

// ---------- Dioden (wie in Digital: für PLA-Strukturen mit Pull-up/-down) ----------
const Diode = {
  type: 'Diode', name: 'Diode', cat: SW,
  defaults: { Blown: false }, props: [blownProp()],
  // Kathode bei (0,0), Anode bei (0,-20); beide Anschlüsse lesen und treiben
  geo() {
    return {
      pins: [{ n: 'cathode', bits: 1, x: 0, y: 0, out: false, vert: true }, { n: 'anode', bits: 1, x: 0, y: -S, out: false, vert: true },
        { n: 'cathode', bits: 1, x: 0, y: 0, out: true, vert: true }, { n: 'anode', bits: 1, x: 0, y: -S, out: true, vert: true }],
      box: { x0: -8, y0: -S, x1: 8, y1: 0 },
    };
  },
  eval(ins, st, a) {
    if (a.Blown) return [null, null];
    const [k, an] = ins;
    return [an === 1 ? 1 : null, k === 0 ? 0 : null];
  },
  draw(r, c, a) { diodeSym(r, -S, 0, a.Blown); },
};
function diodeSym(r, y0, y1, blown) {
  const m = (y0 + y1) / 2;
  r.line(0, y0, 0, m - 5); r.line(0, m + 5, 0, y1);
  r.poly([[-6, m - 5], [6, m - 5], [0, m + 5]], true, null, null, '#222');
  r.line(-6, m + 5, 6, m + 5);
  if (blown) r.line(-8, m - 8, 8, m + 8, 1.5);
}
function diodeDir(type, name, forward) {
  return {
    type, name, cat: SW,
    defaults: { Blown: false }, props: [blownProp()],
    // Eingang bei (0,0), Ausgang bei (0,20) bzw. (0,-20)
    geo() { const y = forward ? S : -S; return { pins: [{ n: 'in', bits: 1, x: 0, y: 0, out: false, vert: true }, { n: 'out', bits: 1, x: 0, y, out: true, vert: true }], box: { x0: -8, y0: Math.min(0, y), x1: 8, y1: Math.max(0, y) } }; },
    eval(ins, st, a) {
      if (a.Blown || isZ(ins[0])) return [null];
      if (forward) return [ins[0] ? 1 : null];
      return [ins[0] ? null : 0];
    },
    draw(r, c, a) {
      if (forward) diodeSym(r, 0, S, a.Blown); else diodeSym(r, -S, 0, a.Blown);
    },
  };
}

// Glühlampe: leuchtet, wenn an beiden Anschlüssen verschiedene Werte liegen
const LightBulb = {
  type: 'LightBulb', name: 'Glühlampe', cat: 'Ein-/Ausgabe',
  defaults: { Label: '', Color: { r: 255, g: 255, b: 0 } }, props: [P.label, P.color],
  geo() { return { pins: [{ n: 'A', bits: 1, x: 0, y: 0, out: false, vert: true }, { n: 'B', bits: 1, x: 0, y: 2 * S, out: false, vert: true }], box: { x0: -S, y0: 0, x1: S, y1: 2 * S } }; },
  eval() { return []; },
  draw(r, c, a, g, st) {
    const on = st ? (st.ins[0] != null && st.ins[1] != null && st.ins[0] !== st.ins[1]) : false;
    const col = a.Color && typeof a.Color === 'object' ? `rgb(${a.Color.r},${a.Color.g},${a.Color.b})` : '#ff0';
    r.circle(0, S, S - 2, on ? col : '#f3f4f6');
    r.line(-13, 7, 13, 33, 1.5); r.line(13, 7, -13, 33, 1.5);
    r.line(0, 0, 0, 2); r.line(0, 38, 0, 40);
    if (a.Label) r.text(S + 4, S, a.Label, 1, 0, 13, 'label');
  },
};

export const SWITCH_DEFS = [
  manualSwitch('Switch', 'Schalter', false), manualSwitch('SwitchDT', 'Umschalter', true),
  relay('Relay', 'Relais', false), relay('RelayDT', 'Relais (Umschalter)', true),
  fet('NFET', 'N-FET', false, false), fet('PFET', 'P-FET', true, false),
  fet('FGNFET', 'N-FET (Floating Gate)', false, true), fet('FGPFET', 'P-FET (Floating Gate)', true, true),
  TransGate, Fuse, Diode, diodeDir('DiodeForward', 'Diode zur Versorgung', true), diodeDir('DiodeBackward', 'Diode zur Masse', false),
  LightBulb,
];
