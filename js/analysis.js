// Wahrheitstabelle und minimierte Ausdrücke (Quine-McCluskey)
import { Sim } from './sim.js';
import { attrsOf } from './components.js';

const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true });
const SEQ = new Set(['D_FF', 'JK_FF', 'RS_FF', 'T_FF', 'Counter', 'Register', 'Clock']);

export function truthTable(circuit) {
  const ins = circuit.comps.filter(c => c.type === 'In');
  const outs = circuit.comps.filter(c => c.type === 'Out' || c.type === 'LED');
  if (!ins.length) throw new Error('Die Schaltung hat keine Eingänge.');
  if (!outs.length) throw new Error('Die Schaltung hat keine Ausgänge.');
  const name = (c, i, p) => attrsOf(c).Label || p + (i + 1);
  const I = ins.map((c, i) => ({ c, name: name(c, i, 'E'), bits: attrsOf(c).Bits || 1 })).sort((a, b) => natural(a.name, b.name));
  const O = outs.map((c, i) => ({ c, name: name(c, i, 'Y'), bits: attrsOf(c).Bits || 1 })).sort((a, b) => natural(a.name, b.name));
  const total = I.reduce((s, x) => s + x.bits, 0);
  if (total > 12) throw new Error(`Zu viele Eingangsbits (${total}). Möglich sind höchstens 12.`);
  const sequential = circuit.comps.some(c => SEQ.has(c.type));
  const sim = new Sim(circuit);
  const rows = [];
  for (let r = 0; r < 2 ** total; r++) {
    let rest = total;
    const vals = I.map(x => { rest -= x.bits; return Math.floor(r / 2 ** rest) % 2 ** x.bits; });
    I.forEach((x, i) => { sim.st(x.c).value = vals[i]; });
    sim.run(I.map(x => x.c));
    rows.push({ ins: vals, outs: O.map(o => sim.st(o.c).ins[0]) });
  }
  const res = { inputs: I.map(({ name, bits }) => ({ name, bits })), outputs: O.map(({ name, bits }) => ({ name, bits })), rows, sequential, oscillating: sim.oscillating };
  if (I.every(x => x.bits === 1) && total <= 8) {
    res.expressions = O.map((o, j) => o.bits === 1
      ? { name: o.name, dnf: minimize(total, rows.map((r, i) => (r.outs[j] ? i : -1)).filter(i => i >= 0), I.map(x => x.name)) }
      : null).filter(Boolean);
  }
  return res;
}

export function minimize(n, minterms, names) {
  if (!minterms.length) return '0';
  if (minterms.length === 2 ** n) return '1';
  let cur = new Map(minterms.map(v => [v + ':0', { v, m: 0, terms: [v] }]));
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
      if (!next.has(k)) next.set(k, { v, m, terms: [...a.terms, ...b.terms] });
    }
    for (const [k, t] of cur) if (!used.has(k)) primes.push(t);
    cur = next;
  }
  const covers = (p, t) => (t & ~p.m) === p.v;
  let remaining = new Set(minterms);
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
      const lits = n - popcount(p.m);
      if (c > bc || (c === bc && lits < n - popcount(best.m))) { best = p; bc = c; }
    }
    chosen.push(best);
    for (const t of [...remaining]) if (covers(best, t)) remaining.delete(t);
  }
  const term = p => {
    const lits = [];
    for (let j = 0; j < n; j++) {
      const bit = 1 << (n - 1 - j);
      if (p.m & bit) continue;
      lits.push((p.v & bit ? '' : '¬') + names[j]);
    }
    return lits.join(' ∧ ');
  };
  return chosen.sort((a, b) => b.v - a.v).map(term).join('  ∨  ');
}
const popcount = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
