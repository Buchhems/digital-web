// Testfälle im Format von Digital (Teilmenge): Kopfzeile mit Signalnamen, danach Werte.
// 0/1/Zahlen (auch 0x.., 0b..), X = egal (bei Eingängen: alle Varianten), C = Taktimpuls, # Kommentar
import { Sim } from './sim.js';
import { attrsOf, mask } from './components.js';

function parseValue(t) {
  const s = t.toLowerCase();
  if (s === 'x') return 'X';
  if (s === 'c') return 'C';
  if (s === 'z') return 'Z';
  const v = s.startsWith('0x') ? parseInt(s.slice(2), 16) : s.startsWith('0b') ? parseInt(s.slice(2), 2) : parseInt(s, 10);
  if (!Number.isFinite(v)) throw new Error(`Unbekannter Wert „${t}“`);
  return v;
}

export function parseTest(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
  if (!lines.length) throw new Error('Der Testfall ist leer.');
  const names = lines[0].split(/\s+/);
  const rows = [];
  lines.slice(1).forEach((l, i) => {
    if (/^(repeat|loop|end|let|while|declare|program|memory|init)\b/i.test(l)) throw new Error(`Zeile ${i + 2}: „${l.split(/\s|\(/)[0]}“ wird noch nicht unterstützt.`);
    const vals = l.split(/\s+/);
    if (vals.length !== names.length) throw new Error(`Zeile ${i + 2}: ${vals.length} statt ${names.length} Werte.`);
    rows.push({ line: i + 2, vals: vals.map(parseValue) });
  });
  return { names, rows };
}

export function runTest(circuit, testcase) {
  const { names, rows } = parseTest(attrsOf(testcase).Testdata);
  const find = (types, n) => circuit.comps.find(c => types.includes(c.type) && attrsOf(c).Label === n);
  const cols = names.map(n => {
    const i = find(['In', 'Clock'], n); if (i) return { n, c: i, input: true, bits: attrsOf(i).Bits || 1 };
    const o = find(['Out', 'LED'], n); if (o) return { n, c: o, input: false, bits: attrsOf(o).Bits || 1 };
    throw new Error(`Signal „${n}“ gibt es in der Schaltung nicht (Beschriftung prüfen).`);
  });
  // X in Eingängen ausmultiplizieren
  const expanded = [];
  for (const r of rows) {
    const xs = cols.map((c, i) => (c.input && r.vals[i] === 'X' ? i : -1)).filter(i => i >= 0);
    const bits = xs.reduce((s, i) => s + cols[i].bits, 0);
    if (bits > 10) throw new Error(`Zeile ${r.line}: zu viele X.`);
    for (let k = 0; k < 2 ** bits; k++) {
      const vals = [...r.vals]; let rest = k;
      for (const i of xs) { vals[i] = rest % 2 ** cols[i].bits; rest = Math.floor(rest / 2 ** cols[i].bits); }
      expanded.push({ line: r.line, vals });
    }
  }
  const sim = new Sim(circuit);
  const results = [];
  for (const r of expanded) {
    const changed = [];
    cols.forEach((c, i) => {
      if (!c.input) return;
      const v = r.vals[i];
      sim.st(c.c).value = v === 'C' ? 0 : (v & mask(c.bits)) >>> 0;
      changed.push(c.c);
    });
    sim.run(changed);
    const clocks = cols.filter((c, i) => c.input && r.vals[i] === 'C').map(c => c.c);
    if (clocks.length) {
      for (const k of clocks) sim.st(k).value = 1; sim.run(clocks);
      for (const k of clocks) sim.st(k).value = 0; sim.run(clocks);
    }
    const actual = cols.map((c, i) => (c.input ? r.vals[i] : sim.st(c.c).ins[0]));
    const ok = cols.every((c, i) => c.input || r.vals[i] === 'X' || (r.vals[i] === 'Z' ? actual[i] == null : actual[i] === r.vals[i]));
    results.push({ line: r.line, expected: r.vals, actual, ok });
  }
  return { names, cols, results, passed: results.filter(r => r.ok).length, oscillating: sim.oscillating };
}
