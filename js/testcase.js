// Testfälle im Format von Digital (Teilmenge): Kopfzeile mit Signalnamen, danach Werte.
// 0/1/Zahlen (auch 0x.., 0b..), X = egal (bei Eingängen: alle Varianten), C = Taktimpuls, # Kommentar
import { Sim } from './sim.js';
import { attrsOf, DEF } from './components.js';
import { isGeneric, resolveCircuit, initArgs } from './generics.js';
import { runHgs } from './hgs.js';

// Bitoperationen auch über 32 Bit (bis 64 Bit wie in Digital)
const big = (a, b, f) => Number(BigInt.asIntN(64, f(BigInt(Math.trunc(a)), BigInt(Math.trunc(b)))));
const wrapBits = (v, bits) => { if (bits >= 53) return v; const m = 2 ** bits; return ((v % m) + m) % m; };

// reproduzierbare Zufallszahlen (resetRandom setzt den Startwert zurück)
let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const resetRandom = () => { seed = 1; };

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
  const look = typeof vars === 'function' ? vars : n => { if (!(n in vars)) throw new Error(`Unbekannte Variable „${n}“`); return vars[n]; };
  const t = tokenizeExpr(src); let i = 0;
  const num = s => (s.startsWith('0x') ? parseInt(s.slice(2), 16) : s.startsWith('0b') ? parseInt(s.slice(2), 2) : parseInt(s, 10));
  const prim = () => {
    const k = t[i++];
    if (k === undefined) throw new Error('Ausdruck unvollständig');
    if (k === '(') { const v = expr(); if (t[i++] !== ')') throw new Error('Klammer fehlt'); return v; }
    if (k === '-') return -prim();
    if (k === '~') return -prim() - 1;
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
        case 'random': return Math.floor(rnd() * args[0]);
        default: throw new Error(`Unbekannte Funktion „${k}“`);
      }
    }
    if (/^[A-Za-z_]/.test(k)) return look(k);
    throw new Error(`Unerwartet: „${k}“`);
  };
  const level = l => {
    if (l >= BIN.length) return prim();
    let a = level(l + 1);
    while (BIN[l].includes(t[i])) {
      const op = t[i++], b = level(l + 1);
      switch (op) {
        case '||': a = a || b ? 1 : 0; break; case '&&': a = a && b ? 1 : 0; break;
        case '|': a = big(a, b, (x, y) => x | y); break; case '^': a = big(a, b, (x, y) => x ^ y); break; case '&': a = big(a, b, (x, y) => x & y); break;
        case '==': case '=': a = a === b ? 1 : 0; break; case '!=': a = a !== b ? 1 : 0; break;
        case '<': a = a < b ? 1 : 0; break; case '>': a = a > b ? 1 : 0; break;
        case '<=': a = a <= b ? 1 : 0; break; case '>=': a = a >= b ? 1 : 0; break;
        case '<<': a = a * 2 ** b; break; case '>>': a = Math.floor(a / 2 ** b); break;
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
        for (let b = n - 1; b >= 0; b--) vals.push(Math.floor(v / 2 ** b) % 2);
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

// Testprogramm abarbeiten. Zeilen werden sofort an onRow übergeben, damit
// Bedingungen (while) und Ausdrücke die aktuellen Ausgangswerte lesen können.
// ctx: { onRow(line, vals), signal(name), init(name, v), memory(name, addr, v), program(values), declare(name, expr) }
export function interpretTest(text, ctx) {
  const raw = String(text || '').split('\n').map((l, n) => ({ n: n + 1, l: l.replace(/#.*/, '').trim() })).filter(x => x.l);
  if (!raw.length) throw new Error('Der Testfall ist leer.');
  // mehrzeilige Anweisungen (program(...) über mehrere Zeilen) zusammenfügen
  const lines = [];
  for (let k = 0; k < raw.length; k++) {
    let { n, l } = raw[k];
    if (/^program\s*\(/i.test(l)) while (!l.includes(')') && k + 1 < raw.length) l += ' ' + raw[++k].l;
    lines.push({ n, l });
  }
  const names = lines[0].l.split(/\s+/);
  const vars = {};
  const look = name => {
    if (name in vars) return vars[name];
    const v = ctx.signal?.(name);
    if (v === undefined) throw new Error(`Unbekannte Variable „${name}“`);
    return v ?? 0;
  };
  let rows = 0, steps = 0;
  const MAX = 300000;
  const blockEnd = (k, to, kind) => {
    let depth = 1, e = k + 1;
    for (; e < to; e++) {
      const l = lines[e].l;
      if (/^(loop|while)\s*\(/i.test(l)) depth++;
      else if (/^end\s+(loop|while)$/i.test(l) && !--depth) {
        if (!new RegExp('^end\\s+' + kind + '$', 'i').test(l)) throw new Error(`Zeile ${lines[e].n}: „end ${kind}“ erwartet.`);
        return e;
      }
    }
    throw new Error(`Zeile ${lines[k].n}: „end ${kind}“ fehlt.`);
  };
  const stmt = /;\s*$/;
  const exec = (from, to) => {
    for (let k = from; k < to; k++) {
      const { n, l } = lines[k];
      if (++steps > 5 * MAX) throw new Error('Der Test läuft zu lange (Endlosschleife?).');
      let m;
      try {
        if ((m = /^loop\s*\(\s*([A-Za-z_]\w*)\s*,\s*(.+)\)$/i.exec(l))) {
          const e = blockEnd(k, to, 'loop');
          const cnt = evalExpr(m[2], look), had = m[1] in vars, old = vars[m[1]];
          for (let v = 0; v < cnt; v++) { vars[m[1]] = v; exec(k + 1, e); }
          if (had) vars[m[1]] = old; else delete vars[m[1]];
          k = e; continue;
        }
        if ((m = /^while\s*\((.+)\)$/i.exec(l))) {
          const e = blockEnd(k, to, 'while');
          let guard = 0;
          while (evalExpr(m[1], look)) { exec(k + 1, e); if (++guard > MAX) throw new Error('„while“ endet nicht.'); }
          k = e; continue;
        }
        if (/^end\s+(loop|while)$/i.test(l)) throw new Error(`„${l}“ ohne Anfang.`);
        if ((m = /^let\s+([A-Za-z_]\w*)\s*=\s*(.+?);?$/i.exec(l))) { vars[m[1]] = evalExpr(m[2], look); continue; }
        if ((m = /^declare\s+([A-Za-z_]\w*)\s*=\s*(.+?);?$/i.exec(l))) { ctx.declare?.(m[1], m[2]); continue; }
        if ((m = /^init\s+([A-Za-z_]\w*)\s*=\s*(-?\s*[0-9a-fA-Fxb]+)\s*;?$/i.exec(l))) { ctx.init?.(m[1], parseValue(m[2].replace(/\s/g, '').replace(/^-/, '')) * (m[2].trim().startsWith('-') ? -1 : 1)); continue; }
        if ((m = /^memory\s+([A-Za-z_]\w*)\s*\(\s*([0-9a-fA-Fxb]+)\s*\)\s*=\s*([0-9a-fA-Fxb]+)\s*;?$/i.exec(l))) { ctx.memory?.(m[1], parseValue(m[2]), parseValue(m[3])); continue; }
        if ((m = /^program\s*\(([^)]*)\)\s*;?$/i.exec(l))) { ctx.program?.(m[1].split(',').map(x => x.trim()).filter(Boolean).map(parseValue)); continue; }
        if (/^resetRandom\s*;?$/i.test(l)) { resetRandom(); continue; }
        if ((m = /^repeat\s*\(\s*([^)]+)\)\s*(.*)$/i.exec(l))) {
          const cnt = evalExpr(m[1], look), had = 'n' in vars, old = vars.n;
          for (let v = 0; v < cnt; v++) { vars.n = v; row(n, m[2]); }
          if (had) vars.n = old; else delete vars.n;
          continue;
        }
        if (stmt.test(l) && !/^[\d(]/.test(l)) throw new Error(`„${l}“ wird nicht unterstützt.`);
        row(n, l);
      } catch (e) { throw e.message.startsWith('Zeile ') ? e : new Error(`Zeile ${n}: ${e.message}`); }
    }
  };
  const row = (n, l) => {
    const vals = rowValues(l, look);
    if (vals.length !== names.length) throw new Error(`${vals.length} statt ${names.length} Werte.`);
    if (++rows > MAX) throw new Error('Der Test ist zu lang.');
    ctx.onRow(n, vals, look);
  };
  resetRandom();
  return { names, run: () => exec(1, lines.length) };
}

// Nur zerlegen (ohne Schaltung): liefert {names, rows:[{line, vals}]}
export function parseTest(text) {
  const rows = [];
  const t = interpretTest(text, { onRow: (line, vals) => rows.push({ line, vals }) });
  t.run();
  return { names: t.names, rows };
}

export function runTest(circuit, testcase) {
  // generische Schaltung: Parameter des Testfalls (wie in Digital) oder Standardargumente
  if (isGeneric(circuit)) {
    const code = String(testcase.attrs?.generic || '').trim();
    circuit = resolveCircuit(circuit, code ? runHgs(code) : initArgs(circuit));
  }
  const rowsOut = [];
  const declared = new Map();
  let sim = null, cols = null;
  const results = [];
  const t = interpretTest(attrsOf(testcase).Testdata, {
    onRow: (line, vals, look) => rowsOut.push({ line, vals, look }) && flush(),
    // in Ausdrücken: aktuelle Werte von Ausgängen (und Eingängen) der Schaltung
    signal: name => { const c = sigComp(name); if (!c) return undefined; const st = sim.st(c); return c.type === 'In' || c.type === 'Clock' ? st.value : st.ins[0]; },
    declare: (name, expr) => declared.set(name, expr),
    init: (name, v) => {
      const c = sim.comps.find(k => attrsOf(k).Label === name);
      if (!c) throw new Error(`„${name}“ für init nicht gefunden.`);
      const st = sim.st(c);
      if ('value' in st) st.value = v >>> 0; else if ('q' in st) st.q = v >>> 0; else throw new Error(`„${name}“ lässt sich nicht vorbelegen.`);
      sim.run([c]);
    },
    memory: (name, addr, v) => {
      const list = sim.comps.filter(k => DEF[k.type].memory && attrsOf(k).Label === name);
      if (!list.length) throw new Error(`Speicher „${name}“ nicht gefunden.`);
      if (list.length > 1) throw new Error(`Mehrere Speicher heißen „${name}“.`);
      sim.st(list[0]).mem[addr] = v; sim.run([list[0]]);
    },
    program: values => {
      const list = sim.comps.filter(k => DEF[k.type].memory && attrsOf(k).isProgramMemory);
      if (!list.length) throw new Error('Kein Programmspeicher gefunden (Eigenschaft „Programmspeicher“ bei einem ROM/RAM einschalten).');
      if (list.length > 1) throw new Error('Mehrere Programmspeicher gefunden.');
      const st = sim.st(list[0]); st.mem = [...values]; sim.run([list[0]]);
    },
  });
  const rawNames = t.names;
  const all = circuit.comps.filter(c => ['In', 'Clock', 'Out', 'LED'].includes(c.type));
  // "/7" = Signal mit Pin-Nummer 7 (wie in Digital)
  const names = rawNames.map(n => {
    if (!n.startsWith('/')) return n;
    const c = all.find(k => String(attrsOf(k).pinNumber) === n.slice(1).trim());
    return c ? attrsOf(c).Label : n;
  });
  const find = (types, n) => circuit.comps.find(c => types.includes(c.type) && attrsOf(c).Label === n);
  const sigComp = n => find(['Out', 'LED', 'In', 'Clock'], n);
  sim = new Sim(circuit);
  const read = c => (c.virtual ? evalExpr(declared.get(c.n), c.look) : c.bidir ? sim.nets[sim.st(c.c).outNets[0]]?.value ?? null : sim.st(c.c).ins[0]);
  const makeCols = () => names.map((n, i) => {
    const disp = rawNames[i];
    if (declared.has(n)) return { n: disp, virtual: true, input: false, bits: 64 };
    const inp = find(['In', 'Clock'], n); if (inp) return { n: disp, c: inp, input: true, bits: attrsOf(inp).Bits || 1 };
    const o = find(['Out', 'LED'], n);
    if (o) return { n: disp, c: o, input: false, bits: attrsOf(o).Bits || 1 };
    // "<Name>_out": Wert der Leitung an einem (bidirektionalen) Eingang
    const bi = n.endsWith('_out') && find(['In'], n.slice(0, -4));
    if (bi) return { n: disp, c: bi, input: false, bidir: true, bits: attrsOf(bi).Bits || 1 };
    throw new Error(`Signal „${disp}“ gibt es in der Schaltung nicht (Beschriftung prüfen).`);
  });
  const runRow = (line, vals, look) => {
    const changed = [];
    cols.forEach((c, i) => {
      if (!c.input) return;
      const v = vals[i];
      // Takt: wie in Digital zunächst den bisherigen Wert behalten, dann 1 und wieder 0
      if (v === 'C') return;
      sim.st(c.c).value = v === 'Z' ? null : wrapBits(v, c.bits);
      changed.push(c.c);
    });
    sim.run(changed);
    const clocks = cols.filter((c, i) => c.input && vals[i] === 'C').map(c => c.c);
    if (clocks.length) {
      for (const k of clocks) sim.st(k).value = 1; sim.run(clocks);
      for (const k of clocks) sim.st(k).value = 0; sim.run(clocks);
    }
    const actual = cols.map((c, i) => (c.input ? vals[i] : c.virtual ? evalExpr(declared.get(names[i]), look) : read(c)));
    const eq = (c, a, e) => (c.virtual ? a === e : a === wrapBits(e, c.bits));
    const ok = cols.every((c, i) => c.input || vals[i] === 'X' || (vals[i] === 'Z' ? actual[i] == null : eq(c, actual[i], vals[i])));
    results.push({ line, expected: vals, actual, ok });
  };
  // X an Eingängen: jeweils mit 0 und 1 testen (wie in Digital)
  function flush() {
    if (!cols) cols = makeCols();
    while (rowsOut.length) {
      const r = rowsOut.shift();
      const xs = cols.map((c, i) => (c.input && r.vals[i] === 'X' ? i : -1)).filter(i => i >= 0);
      if (xs.length > 14) throw new Error(`Zeile ${r.line}: zu viele X.`);
      for (let k = 0; k < 2 ** xs.length; k++) {
        const vals = [...r.vals];
        xs.forEach((i, j) => { vals[i] = (k >> j) & 1; });
        runRow(r.line, vals, r.look);
      }
      if (results.length > 300000) throw new Error('Der Test ist zu lang.');
    }
    return true;
  }
  t.run();
  if (!cols) cols = makeCols();
  return { names: rawNames, cols, results, passed: results.filter(r => r.ok).length, oscillating: sim.oscillating };
}
