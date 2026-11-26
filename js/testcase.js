// Testfälle im Format von Digital (Teilmenge): Kopfzeile mit Signalnamen, danach Werte.
// 0/1/Zahlen (auch 0x.., 0b..), X = egal (bei Eingängen: alle Varianten), C = Taktimpuls, # Kommentar
import { Sim } from './sim.js';
import { attrsOf, mask } from './components.js';

// ---------- Ausdrücke (ohne eval) ----------
function tokenizeExpr(src) {
  const re = /\s*(0x[0-9a-fA-F]+|0b[01]+|\d+|[A-Za-z_][A-Za-z0-9_]*|<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%&|^~!<>()?:,=])/y;
  const out = []; let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) { if (src.slice(start).trim() === '') break; throw new Error(`Ausdruck „${src}“ nicht verständlich`); }
    out.push(m[1]);
  }
  return out;
}
const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!=', '='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
function evalExpr(src, vars) {
  const t = tokenizeExpr(src); let i = 0;
  const num = s => (s.startsWith('0x') ? parseInt(s.slice(2), 16) : s.startsWith('0b') ? parseInt(s.slice(2), 2) : parseInt(s, 10));
  const prim = () => {
    const k = t[i++];
    if (k === undefined) throw new Error('Ausdruck unvollständig');
    if (k === '(') { const v = expr(); if (t[i++] !== ')') throw new Error('Klammer fehlt'); return v; }
    if (k === '-') return -prim();
    if (k === '~') return ~prim();
    if (k === '!') return prim() ? 0 : 1;
    if (/^\d|^0[xb]/.test(k)) return num(k);
    if (/^[A-Za-z_]/.test(k) && t[i] === '(') {
      // Funktionen wie in Digital: signExt(bits, v), ifThenElse(c, a, b), random(n)
      i++; const args = [];
      if (t[i] !== ')') { args.push(expr()); while (t[i] === ',') { i++; args.push(expr()); } }
      if (t[i++] !== ')') throw new Error('Klammer fehlt');
      switch (k.toLowerCase()) {
        case 'signext': { const [b, v0] = args; const v = v0 & (2 ** b - 1); return (v >> (b - 1)) & 1 ? v - 2 ** b : v; }
        case 'ifthenelse': return args[0] ? args[1] : args[2];
        case 'random': return Math.floor(Math.random() * args[0]);
        default: throw new Error(`Unbekannte Funktion „${k}“`);
      }
    }
    if (/^[A-Za-z_]/.test(k)) { if (!(k in vars)) throw new Error(`Unbekannte Variable „${k}“`); return vars[k]; }
    throw new Error(`Unerwartet: „${k}“`);
  };
  const level = l => {
    if (l >= BIN.length) return prim();
    let a = level(l + 1);
    while (BIN[l].includes(t[i])) {
      const op = t[i++], b = level(l + 1);
      switch (op) {
        case '||': a = a || b ? 1 : 0; break; case '&&': a = a && b ? 1 : 0; break;
        case '|': a = a | b; break; case '^': a = a ^ b; break; case '&': a = a & b; break;
        case '==': case '=': a = a === b ? 1 : 0; break; case '!=': a = a !== b ? 1 : 0; break;
        case '<': a = a < b ? 1 : 0; break; case '>': a = a > b ? 1 : 0; break;
        case '<=': a = a <= b ? 1 : 0; break; case '>=': a = a >= b ? 1 : 0; break;
        case '<<': a = a << b; break; case '>>': a = a >> b; break;
        case '+': a = a + b; break; case '-': a = a - b; break;
        case '*': a = a * b; break; case '/': a = Math.trunc(a / b); break; case '%': a = a % b; break;
      }
    }
    return a;
  };
  const expr = () => { const c = level(0); if (t[i] === '?') { i++; const x = expr(); if (t[i++] !== ':') throw new Error('„:“ fehlt'); const y = expr(); return c ? x : y; } return c; };
  const v = expr();
  if (i < t.length) throw new Error(`Ausdruck „${src}“ nicht verständlich`);
  return v;
}

// Zeile in Werte zerlegen: 0/1/X/C/Z, Zahlen, (Ausdruck), bits(k, Ausdruck)
function rowValues(line, vars) {
  const vals = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) { i++; continue; }
    const m = /^bits\s*\(/i.exec(line.slice(i));
    if (m || line[i] === '(') {
      let j = i + (m ? m[0].length : 1), depth = 1;
      while (j < line.length && depth) { if (line[j] === '(') depth++; else if (line[j] === ')') depth--; j++; }
      const inner = line.slice(i + (m ? m[0].length : 1), j - 1);
      if (m) {
        const k = inner.indexOf(',');
        const n = evalExpr(inner.slice(0, k), vars), v = evalExpr(inner.slice(k + 1), vars);
        for (let b = n - 1; b >= 0; b--) vals.push((v >> b) & 1);
      } else vals.push(evalExpr(inner, vars));
      i = j; continue;
    }
    let j = i; while (j < line.length && !/\s/.test(line[j])) j++;
    vals.push(parseValue(line.slice(i, j)));
    i = j;
  }
  return vals;
}

function parseValue(t) {
  const s = t.toLowerCase();
  if (s === 'x') return 'X';
  if (s === 'c') return 'C';
  if (s === 'z') return 'Z';
  const v = s.startsWith('0x') ? parseInt(s.slice(2), 16) : s.startsWith('0b') ? parseInt(s.slice(2), 2) : parseInt(s, 10);
  if (!Number.isFinite(v)) throw new Error(`Unbekannter Wert „${t}“`);
  return v;
}

// Testdaten ausführen: liefert {names, rows:[{line, vals}]}
export function parseTest(text) {
  const lines = String(text || '').split('\n').map((l, n) => ({ n: n + 1, l: l.replace(/#.*/, '').trim() })).filter(x => x.l);
  if (!lines.length) throw new Error('Der Testfall ist leer.');
  const names = lines[0].l.split(/\s+/);
  const rows = [];
  const vars = {};
  const MAX = 300000;
  const exec = (from, to) => {
    for (let k = from; k < to; k++) {
      const { n, l } = lines[k];
      let m;
      if ((m = /^loop\s*\(\s*([A-Za-z_]\w*)\s*,\s*(.+)\)$/i.exec(l))) {
        // passendes "end loop" suchen
        let depth = 1, e = k + 1;
        for (; e < to; e++) { if (/^loop\s*\(/i.test(lines[e].l)) depth++; else if (/^end\s+loop$/i.test(lines[e].l) && !--depth) break; }
        if (e >= to) throw new Error(`Zeile ${n}: „end loop“ fehlt.`);
        const cnt = evalExpr(m[2], vars);
        for (let v = 0; v < cnt; v++) { vars[m[1]] = v; exec(k + 1, e); }
        delete vars[m[1]];
        k = e; continue;
      }
      if (/^end\s+loop$/i.test(l)) throw new Error(`Zeile ${n}: „end loop“ ohne „loop“.`);
      if ((m = /^let\s+([A-Za-z_]\w*)\s*=\s*(.+?);?$/i.exec(l))) { vars[m[1]] = evalExpr(m[2], vars); continue; }
      if ((m = /^repeat\s*\(\s*([^)]+)\)\s*(.*)$/i.exec(l))) {
        const cnt = evalExpr(m[1], vars), had = 'n' in vars, old = vars.n;
        for (let v = 0; v < cnt; v++) { vars.n = v; pushRow(n, m[2]); }
        if (had) vars.n = old; else delete vars.n;
        continue;
      }
      if (/^(while|declare|program|memory|init|resetRandom|tick)\b/i.test(l)) throw new Error(`Zeile ${n}: „${l.split(/\s|\(/)[0]}“ wird noch nicht unterstützt.`);
      pushRow(n, l);
    }
  };
  const pushRow = (n, l) => {
    let vals;
    try { vals = rowValues(l, vars); } catch (e) { throw new Error(`Zeile ${n}: ${e.message}`); }
    if (vals.length !== names.length) throw new Error(`Zeile ${n}: ${vals.length} statt ${names.length} Werte.`);
    rows.push({ line: n, vals });
    if (rows.length > MAX) throw new Error('Der Test ist zu lang.');
  };
  exec(1, lines.length);
  return { names, rows };
}

export function runTest(circuit, testcase) {
  const { names: rawNames, rows } = parseTest(attrsOf(testcase).Testdata);
  const all = circuit.comps.filter(c => ['In', 'Clock', 'Out', 'LED'].includes(c.type));
  // "/7" = Signal mit Pin-Nummer 7 (wie in Digital)
  const names = rawNames.map(n => {
    if (!n.startsWith('/')) return n;
    const c = all.find(k => String(attrsOf(k).pinNumber) === n.slice(1).trim());
    return c ? attrsOf(c).Label : n;
  });
  const find = (types, n) => circuit.comps.find(c => types.includes(c.type) && attrsOf(c).Label === n);
  const cols = names.map((n, i) => {
    const disp = rawNames[i];
    const inp = find(['In', 'Clock'], n); if (inp) return { n: disp, c: inp, input: true, bits: attrsOf(inp).Bits || 1 };
    const o = find(['Out', 'LED'], n);
    if (o) return { n: disp, c: o, input: false, bits: attrsOf(o).Bits || 1 };
    // "<Name>_out": Wert der Leitung an einem (bidirektionalen) Eingang
    const bi = n.endsWith('_out') && find(['In'], n.slice(0, -4));
    if (bi) return { n: disp, c: bi, input: false, bidir: true, bits: attrsOf(bi).Bits || 1 };
    throw new Error(`Signal „${disp}“ gibt es in der Schaltung nicht (Beschriftung prüfen).`);
  });
  // X an Eingängen: jeweils mit 0 und 1 testen (wie in Digital)
  const expanded = [];
  for (const r of rows) {
    const xs = cols.map((c, i) => (c.input && r.vals[i] === 'X' ? i : -1)).filter(i => i >= 0);
    if (xs.length > 14) throw new Error(`Zeile ${r.line}: zu viele X.`);
    for (let k = 0; k < 2 ** xs.length; k++) {
      const vals = [...r.vals];
      xs.forEach((i, j) => { vals[i] = (k >> j) & 1; });
      expanded.push({ line: r.line, vals });
    }
    if (expanded.length > 300000) throw new Error('Der Test ist zu lang.');
  }
  const sim = new Sim(circuit);
  const results = [];
  const read = c => (c.bidir ? sim.nets[sim.st(c.c).outNets[0]]?.value ?? null : sim.st(c.c).ins[0]);
  for (const r of expanded) {
    const changed = [];
    cols.forEach((c, i) => {
      if (!c.input) return;
      const v = r.vals[i];
      sim.st(c.c).value = v === 'C' ? 0 : v === 'Z' ? null : (v & mask(c.bits)) >>> 0;
      changed.push(c.c);
    });
    sim.run(changed);
    const clocks = cols.filter((c, i) => c.input && r.vals[i] === 'C').map(c => c.c);
    if (clocks.length) {
      for (const k of clocks) sim.st(k).value = 1; sim.run(clocks);
      for (const k of clocks) sim.st(k).value = 0; sim.run(clocks);
    }
    const actual = cols.map((c, i) => (c.input ? r.vals[i] : read(c)));
    const ok = cols.every((c, i) => c.input || r.vals[i] === 'X' || (r.vals[i] === 'Z' ? actual[i] == null : actual[i] === ((r.vals[i] & mask(c.bits)) >>> 0)));
    results.push({ line: r.line, expected: r.vals, actual, ok });
  }
  return { names: rawNames, cols, results, passed: results.filter(r => r.ok).length, oscillating: sim.oscillating };
}
