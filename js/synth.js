// Boolesche Ausdrücke: Parser, Darstellung (Negation als Überstrich) und Schaltungsaufbau
import { Circuit } from './circuit.js';
import { pinsWorld } from './components.js';

const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true });
const KW = { und: 'and', and: 'and', oder: 'or', or: 'or', xor: 'xor', nicht: 'not', not: 'not' };

// ---------- Parser ----------
// Erlaubt: ¬ ! ~ / (nicht), ∧ & * · (und), ∨ | + (oder), ⊕ ^ (xor), A' (nicht), Klammern, 0/1
export function parseExpr(src) {
  const toks = [];
  const re = /\s*(?:([¬!~\/])|(∧|&&|&|\*|·|⋅)|(∨|\|\||\||\+)|(⊕|\^)|(\()|(\))|([A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*)|([01])(?![0-9])|(')|(\S))/gy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[0].trim() === '') break;
    if (m[1]) toks.push({ t: 'not' });
    else if (m[2]) toks.push({ t: 'and' });
    else if (m[3]) toks.push({ t: 'or' });
    else if (m[4]) toks.push({ t: 'xor' });
    else if (m[5]) toks.push({ t: '(' });
    else if (m[6]) toks.push({ t: ')' });
    else if (m[7]) { const k = KW[m[7].toLowerCase()]; toks.push(k ? { t: k } : { t: 'id', v: m[7] }); }
    else if (m[8]) toks.push({ t: 'const', v: +m[8] });
    else if (m[9]) toks.push({ t: "'" });
    else throw new Error(`Unbekanntes Zeichen „${m[10]}“`);
  }
  let i = 0;
  const peek = () => toks[i]?.t, take = t => { if (peek() !== t) throw new Error(t === ')' ? 'Schließende Klammer fehlt' : 'Ausdruck unvollständig'); return toks[i++]; };
  const nary = (op, sub) => () => {
    const args = [sub()];
    while (peek() === op) { i++; args.push(sub()); }
    return args.length === 1 ? args[0] : { op, args: args.flatMap(a => (a.op === op ? a.args : [a])) };
  };
  const unary = () => {
    if (peek() === 'not') { i++; return neg(unary()); }
    let e = primary();
    while (peek() === "'") { i++; e = neg(e); }
    return e;
  };
  const primary = () => {
    const t = toks[i++];
    if (!t) throw new Error('Ausdruck unvollständig');
    if (t.t === 'id') return { op: 'var', name: t.v };
    if (t.t === 'const') return { op: 'const', v: t.v };
    if (t.t === '(') { const e = or(); take(')'); return e; }
    throw new Error('Unerwartetes Zeichen im Ausdruck');
  };
  const and = nary('and', unary), xor = nary('xor', and), or = nary('or', xor);
  const e = or();
  if (i < toks.length) throw new Error('Unerwartetes Zeichen im Ausdruck');
  return e;
}
const neg = e => (e.op === 'not' ? e.a : { op: 'not', a: e });

// Mehrere Gleichungen: "Y = A ∧ B; Z = ¬A" oder zeilenweise
export function parseEquations(text) {
  const out = [];
  for (const line of text.split(/[\n;]+/)) {
    const l = line.trim(); if (!l) continue;
    const m = l.match(/^([A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*)\s*=(?!=)\s*(.*)$/);
    const name = m ? m[1] : (out.length ? 'Y' + (out.length + 1) : 'Y');
    try { out.push({ name, ast: parseExpr(m ? m[2] : l) }); }
    catch (e) { throw new Error(`${name}: ${e.message}`); }
  }
  if (!out.length) throw new Error('Bitte einen Ausdruck eingeben.');
  return out;
}

export function variables(ast, set = new Set()) {
  if (ast.op === 'var') set.add(ast.name);
  else if (ast.op === 'not') variables(ast.a, set);
  else if (ast.args) ast.args.forEach(a => variables(a, set));
  return set;
}

// ---------- Darstellung ----------
const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PREC = { or: 1, xor: 2, and: 3 };
const SYM = { or: ' ∨ ', xor: ' ⊕ ', and: ' ∧ ' };
// HTML mit Überstrich für Negationen
export function toHTML(e, parentPrec = 0) {
  switch (e.op) {
    case 'var': return `<i>${escH(e.name)}</i>`;
    case 'const': return String(e.v);
    case 'not': return `<span class="ov">${toHTML(e.a, 0)}</span>`;
    default: {
      const s = e.args.map(a => toHTML(a, PREC[e.op])).join(SYM[e.op]);
      return PREC[e.op] < parentPrec ? `(${s})` : s;
    }
  }
}
// Textform zum Kopieren (¬ statt Überstrich)
export function toText(e, parentPrec = 0) {
  switch (e.op) {
    case 'var': return e.name;
    case 'const': return String(e.v);
    case 'not': return '¬' + (e.a.op === 'var' || e.a.op === 'const' || e.a.op === 'not' ? toText(e.a) : '(' + toText(e.a) + ')');
    default: {
      const s = e.args.map(a => toText(a, PREC[e.op])).join(SYM[e.op]);
      return PREC[e.op] < parentPrec ? `(${s})` : s;
    }
  }
}
// Primimplikanten -> AST (DMF)
export function termsToAST(terms, n, names) {
  if (!terms.length) return { op: 'const', v: 0 };
  const prods = terms.map(p => {
    const lits = [];
    for (let j = 0; j < n; j++) {
      const bit = 1 << (n - 1 - j);
      if (p.m & bit) continue;
      lits.push(p.v & bit ? { op: 'var', name: names[j] } : { op: 'not', a: { op: 'var', name: names[j] } });
    }
    return lits.length === 0 ? { op: 'const', v: 1 } : lits.length === 1 ? lits[0] : { op: 'and', args: lits };
  });
  return prods.length === 1 ? prods[0] : { op: 'or', args: prods };
}

// ---------- Schaltungsaufbau ----------
// Layout: Eingänge oben links mit senkrechten Sammelleitungen (auch negiert über NICHT-Gatter),
// Gatter spaltenweise nach Tiefe, jedes Gatter in eigenen Zeilen, damit sich Leitungen nie fälschlich verbinden.
const TYPE = { and: 'And', or: 'Or', xor: 'XOr' };
export function buildCircuit(defs) {
  const c = new Circuit();
  const vars = [...new Set(defs.flatMap(d => [...variables(d.ast)]))].sort(natural);
  const negVars = new Set();
  const scanNeg = e => { if (e.op === 'not' && e.a.op === 'var') negVars.add(e.a.name); else if (e.op === 'not') scanNeg(e.a); else e.args?.forEach(scanNeg); };
  defs.forEach(d => scanNeg(d.ast));
  const negList = vars.filter(v => negVars.has(v));
  const posUsed = new Set();
  const scanPos = (e, underNot) => { if (e.op === 'var' && !underNot) posUsed.add(e.name); else if (e.op === 'not') scanPos(e.a, e.a.op === 'var'); else e.args?.forEach(a => scanPos(a, false)); };
  defs.forEach(d => scanPos(d.ast, false));

  const X0 = 60, XV = i => 120 + i * 20;
  const xNot = 120 + vars.length * 20 + 20;
  const XN = i => xNot + 60 + i * 20;
  const yVar = i => 40 + i * 40;
  const signals = new Map(); // key -> {x, top, rows:[]}
  vars.forEach((v, i) => signals.set('v:' + v, { x: XV(i), top: yVar(i), rows: [] }));
  negList.forEach((v, k) => signals.set('n:' + v, { x: XN(k), top: yVar(vars.indexOf(v)), rows: [] }));
  const railsEnd = negList.length ? XN(negList.length - 1) : XV(vars.length - 1);

  // 1. Gatter-Knoten in Post-Order anlegen (Kinder zuerst -> Kinder liegen weiter oben)
  let y = 40 + vars.length * 40 + 20;
  const gates = [], outs = [];
  const sigOf = e => (e.op === 'var' ? { kind: 'sig', key: 'v:' + e.name } : e.op === 'not' && e.a.op === 'var' ? { kind: 'sig', key: 'n:' + e.a.name } : e.op === 'const' ? { kind: 'const', v: e.v } : null);
  const node = e => {
    const direct = sigOf(e);
    if (direct) return direct;
    let type, args;
    if (e.op === 'not') { type = 'Not'; args = [e.a]; }
    else {
      args = e.args;
      if (args.length > 16) return node({ op: e.op, args: [{ op: e.op, args: args.slice(0, 16) }, ...args.slice(16)] });
      type = TYPE[e.op];
    }
    const inputs = args.map(node);
    const n = inputs.length;
    const col = 1 + Math.max(0, ...inputs.map(s => (s.kind === 'gate' ? s.g.col : 0)));
    const attrs = type === 'Not' ? {} : { Inputs: n };
    const h = type === 'Not' ? 0 : (n - 1) * 20 + ((n & 1) === 0 ? 20 : 0);
    const g = { type, attrs, inputs, col, y: y };
    y += h + 60;
    gates.push(g);
    return { kind: 'gate', g };
  };
  for (const d of defs) {
    const s = node(d.ast);
    if (s.kind === 'gate') outs.push({ name: d.name, s, y: null });
    else { outs.push({ name: d.name, s, y }); y += 60; }
  }

  // 2. Spaltenpositionen
  const maxCol = Math.max(0, ...gates.map(g => g.col));
  const colX = [], railX = new Map();
  let x = railsEnd + 60;
  for (let k = 1; k <= maxCol; k++) {
    colX[k] = x;
    const inCol = gates.filter(g => g.col === k);
    const w = Math.max(...inCol.map(g => (g.type === 'Not' ? 40 : 60)));
    const withRail = inCol.filter(g => !outs.some(o => o.s.g === g));
    withRail.forEach((g, i) => railX.set(g, x + w + 20 + i * 20));
    x += w + 20 + withRail.length * 20 + 40;
  }
  const outX = x + 40;

  // 3. Eingänge mit Sammelleitungen
  vars.forEach((v, i) => {
    const yy = yVar(i);
    c.addComp('In', X0, yy, { Label: v });
    const neg = negVars.has(v);
    const end = neg ? xNot : XV(i);
    if (posUsed.has(v) && neg) { c.addWire(X0, yy, XV(i), yy); c.addWire(XV(i), yy, xNot, yy); }
    else c.addWire(X0, yy, end, yy);
    if (neg) {
      c.addComp('Not', xNot, yy);
      c.addWire(xNot + 40, yy, XN(negList.indexOf(v)), yy);
    }
  });

  // 4. Gatter platzieren und verdrahten
  const connect = (src, px, py) => {
    if (src.kind === 'const') { c.addComp('Const', px - 20, py, { Value: src.v }); c.addWire(px - 20, py, px, py); return; }
    const sig = src.kind === 'gate' ? signals.get(src.g) : signals.get(src.key);
    sig.rows.push(py);
    if (sig.x !== px) c.addWire(sig.x, py, px, py);
  };
  for (const g of gates) {
    const comp = c.addComp(g.type, colX[g.col], g.y, g.attrs);
    const pins = pinsWorld(comp);
    g.pins = pins;
    const outPin = pins.find(p => p.out);
    if (railX.has(g)) {
      signals.set(g, { x: railX.get(g), top: outPin.y, rows: [] });
      c.addWire(outPin.x, outPin.y, railX.get(g), outPin.y);
    }
  }
  for (const g of gates) g.inputs.forEach((src, i) => { const p = g.pins.filter(q => !q.out)[i]; connect(src, p.x, p.y); });
  for (const o of outs) {
    if (o.s.kind === 'gate') {
      const p = o.s.g.pins.find(q => q.out);
      c.addComp('Out', outX, p.y, { Label: o.name });
      c.addWire(p.x, p.y, outX, p.y);
    } else {
      c.addComp('Out', outX, o.y, { Label: o.name });
      connect(o.s, outX, o.y);
    }
  }
  // 5. Senkrechte Sammelleitungen
  for (const sig of signals.values()) {
    if (!sig.rows.length) continue;
    const bottom = Math.max(...sig.rows), top = Math.min(sig.top, ...sig.rows);
    if (bottom > top) c.addWire(sig.x, top, sig.x, bottom);
  }
  c.cleanup();
  return c;
}
