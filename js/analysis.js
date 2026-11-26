// Wahrheitstabelle und minimierte Ausdrücke (Quine-McCluskey)
import { Sim } from './sim.js';
import { attrsOf, pinsWorld } from './components.js';

const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true });
const SEQ = new Set(['D_FF', 'JK_FF', 'RS_FF', 'T_FF', 'Counter', 'Register', 'Clock']);

const GATES = new Set(['And', 'Or', 'Not', 'NAnd', 'NOr', 'XOr', 'XNOr']);

// opts.allGates: alle Gatter (nicht nur beschriftete) als Zwischenschritte zeigen
export function truthTable(circuit, opts = {}) {
  const ins = circuit.comps.filter(c => c.type === 'In');
  const outs = circuit.comps.filter(c => c.type === 'Out' || c.type === 'LED');
  if (!ins.length) throw new Error('Die Schaltung hat keine Eingänge.');
  if (!outs.length) throw new Error('Die Schaltung hat keine Ausgänge.');
  const name = (c, i, p) => attrsOf(c).Label || p + (i + 1);
  const I = ins.map((c, i) => ({ c, name: name(c, i, 'E'), bits: attrsOf(c).Bits || 1 })).sort((a, b) => natural(a.name, b.name));
  const O = outs.map((c, i) => ({ c, name: name(c, i, 'Y'), bits: attrsOf(c).Bits || 1 })).sort((a, b) => natural(a.name, b.name));

  // Zwischenschritte: beschriftete Gatter, Messwerte und Bausteine (bzw. alle Gatter und Bausteine)
  const stepComps = circuit.comps.filter(c => ((GATES.has(c.type) || c.type === 'Sub') && (attrsOf(c).Label || opts.allGates)) || (c.type === 'Probe' && attrsOf(c).Label));
  const byPos = (a, b) => a.c.x - b.c.x || a.c.y - b.c.y || (a.k || 0) - (b.k || 0);
  let auto = 0, autoSub = 0;
  const Z = [];
  for (const c of [...stepComps].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const label = attrsOf(c).Label;
    if (c.type === 'Sub') {
      const base = label || c.sub + '#' + ++autoSub;
      pinsWorld(c).filter(p => p.out).forEach((p, k) => Z.push({ c, k, base, name: base + '.' + p.n, bits: p.bits || 1, auto: !label }));
    } else Z.push({ c, name: label || 'G' + ++auto, auto: !label });
  }
  Z.sort(byPos);
  if (Z.every(z => !z.auto)) Z.sort((a, b) => natural(a.base || a.name, b.base || b.name) || (a.k || 0) - (b.k || 0));

  const total = I.reduce((s, x) => s + x.bits, 0);
  if (total > 12) throw new Error(`Zu viele Eingangsbits (${total}). Möglich sind höchstens 12.`);
  const sequential = circuit.comps.some(c => SEQ.has(c.type));
  const sim = new Sim(circuit);
  for (const z of Z) if (z.c.type !== 'Sub') z.bits = z.c.type === 'Probe' ? (sim.st(z.c).bits[0] || 1) : (attrsOf(z.c).Bits || 1);
  const rows = [];
  for (let r = 0; r < 2 ** total; r++) {
    let rest = total;
    const vals = I.map(x => { rest -= x.bits; return Math.floor(r / 2 ** rest) % 2 ** x.bits; });
    I.forEach((x, i) => { sim.st(x.c).value = vals[i]; });
    sim.run(I.map(x => x.c));
    rows.push({
      ins: vals,
      steps: Z.map(z => (z.c.type === 'Sub' ? sim.subOut(z.c, z.k) : z.c.type === 'Probe' ? sim.st(z.c).ins[0] : sim.st(z.c).outs[0])),
      outs: O.map(o => sim.st(o.c).ins[0]),
    });
  }
  const col = arr => arr.map(({ name, bits, auto }) => ({ name, bits, auto }));
  const res = { inputs: col(I), steps: col(Z), outputs: col(O), rows, sequential, oscillating: sim.oscillating };
  if (I.every(x => x.bits === 1) && total <= 8) {
    const names = I.map(x => x.name);
    const dmf = (cols, key) => cols.map((o, j) => (o.bits === 1
      ? (() => { const ones = rows.map((r, i) => (r[key][j] ? i : -1)).filter(i => i >= 0); return { name: o.name, dnf: minimize(total, ones, names), terms: minimizeTerms(total, ones), ones, vars: names }; })()
      : null)).filter(Boolean);
    res.expressions = dmf(O, 'outs');
    res.stepExpressions = dmf(Z, 'steps');
  }
  return res;
}

// Liefert die gewählten Primimplikanten {v, m} (m = Bitmaske der wegfallenden Variablen)
// dcs: "don't care"-Zeilen (X), dürfen zur Vereinfachung mitbenutzt werden
export function minimizeTerms(n, minterms, dcs = []) {
  if (!minterms.length) return [];
  if (minterms.length + dcs.length >= 2 ** n) return [{ v: 0, m: 2 ** n - 1 }];
  let cur = new Map([...minterms, ...dcs].map(v => [v + ':0', { v, m: 0 }]));
  const primes = [];
  while (cur.size) {
    const next = new Map(), used = new Set();
    const list = [...cur.entries()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i], [kb, b] = list[j];
      if (a.m !== b.m) continue;
      const d = a.v ^ b.v;
      if (d & (d - 1)) continue;
      const v = a.v & ~d, m = a.m | d, k = v + ':' + m;
      used.add(ka); used.add(kb);
      if (!next.has(k)) next.set(k, { v, m });
    }
    for (const [k, t] of cur) if (!used.has(k)) primes.push(t);
    cur = next;
  }
  const covers = (p, t) => (t & ~p.m) === p.v;
  const remaining = new Set(minterms);
  const chosen = [];
  for (const t of minterms) {
    const ps = primes.filter(p => covers(p, t));
    if (ps.length === 1 && !chosen.includes(ps[0])) chosen.push(ps[0]);
  }
  for (const p of chosen) for (const t of [...remaining]) if (covers(p, t)) remaining.delete(t);
  while (remaining.size) {
    let best = null, bc = -1;
    for (const p of primes) {
      if (chosen.includes(p)) continue;
      const c = [...remaining].filter(t => covers(p, t)).length;
      if (c > bc || (c === bc && popcount(p.m) > popcount(best.m))) { best = p; bc = c; }
    }
    chosen.push(best);
    for (const t of [...remaining]) if (covers(best, t)) remaining.delete(t);
  }
  return chosen.sort((a, b) => b.v - a.v);
}

export function termToString(p, n, names) {
  const lits = [];
  for (let j = 0; j < n; j++) {
    const bit = 1 << (n - 1 - j);
    if (p.m & bit) continue;
    lits.push((p.v & bit ? '' : '¬') + names[j]);
  }
  return lits.join(' ∧ ');
}

export function minimize(n, minterms, names, dcs = []) {
  if (!minterms.length) return '0';
  if (minterms.length + dcs.length >= 2 ** n) return '1';
  return minimizeTerms(n, minterms, dcs).map(p => termToString(p, n, names)).join('  ∨  ');
}

// Ausdruck-Objekt für eine Spalte (Werte 0/1/'X' je Zeile)
export function columnExpr(name, vars, values) {
  const ones = [], dcs = [];
  values.forEach((v, i) => { if (v === 'X') dcs.push(i); else if (v) ones.push(i); });
  return { name, vars, ones, dcs, terms: minimizeTerms(vars.length, ones, dcs) };
}
const popcount = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
