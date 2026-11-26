// Schaltwerke: Zustandsanalyse aus Flipflop-Schaltungen und Synthese aus Automaten
import { Sim } from './sim.js';
import { attrsOf, pinsWorld } from './components.js';
import { columnExpr } from './analysis.js';
import { parseExpr, buildCircuit, termsToAST, variables } from './synth.js';

const natural = (a, b) => a.localeCompare(b, 'de', { numeric: true });
const FF = ['D_FF', 'JK_FF', 'T_FF', 'RS_FF'];
const bitsOf = (v, n) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);

// ---------- Zustandsanalyse ----------
export function stateAnalysis(circuit) {
  const ffs = circuit.comps.filter(c => FF.includes(c.type));
  if (!ffs.length) throw new Error('Die Schaltung enthält keine Flipflops.');
  if (ffs.some(f => (attrsOf(f).Bits || 1) > 1)) throw new Error('Nur Flipflops mit 1 Bit werden analysiert.');
  if (ffs.length > 6) throw new Error('Höchstens 6 Flipflops.');
  let clocks = circuit.comps.filter(c => c.type === 'Clock');
  const ins = circuit.comps.filter(c => c.type === 'In');
  if (!clocks.length) clocks = ins.filter(c => /^(c|clk|clock|takt|t)$/i.test(attrsOf(c).Label || ''));
  if (!clocks.length) throw new Error('Kein Takt gefunden. Verwende das Bauteil „Takt“ (oder einen Eingang namens C/Clk).');
  const S = ffs.map((c, i) => ({ c, name: attrsOf(c).Label || 'Q' + i })).sort((a, b) => natural(b.name, a.name)); // Q1 vor Q0
  const I = ins.filter(c => !clocks.includes(c)).map((c, i) => ({ c, name: attrsOf(c).Label || 'E' + (i + 1), bits: attrsOf(c).Bits || 1 })).sort((a, b) => natural(a.name, b.name));
  if (I.some(x => x.bits > 1)) throw new Error('Nur Eingänge mit 1 Bit werden analysiert.');
  if (I.length > 4) throw new Error('Höchstens 4 Eingänge.');
  const O = circuit.comps.filter(c => c.type === 'Out' || c.type === 'LED').map((c, i) => ({ c, name: attrsOf(c).Label || 'Y' + (i + 1) })).sort((a, b) => natural(a.name, b.name));
  // Ansteuerung der Flipflops (D, J, K, T, S, R)
  const ffIn = S.flatMap(s => pinsWorld(s.c).filter(p => !p.out && p.n !== 'C').map((p, k) => ({ s, k, name: p.n + '(' + s.name + ')', short: p.n + s.name.replace(/^Q/, '') })));
  const sim = new Sim(circuit);
  const k = S.length, m = I.length, rows = [];
  for (let st = 0; st < 2 ** k; st++) for (let x = 0; x < 2 ** m; x++) {
    for (const c of clocks) sim.st(c).value = 0;
    sim.run(clocks);
    bitsOf(st, k).forEach((b, i) => { const f = sim.st(S[i].c); f.q = b; f.c = 0; });
    sim.run(S.map(s => s.c));
    bitsOf(x, m).forEach((b, i) => { sim.st(I[i].c).value = b; });
    sim.run(I.map(i => i.c));
    const outs = O.map(o => sim.st(o.c).ins[0] ?? 0);
    const exc = ffIn.map(f => sim.st(f.s.c).ins[f.k] ?? 0);
    for (const c of clocks) sim.st(c).value = 1;
    sim.run(clocks);
    const next = S.map(s => sim.st(s.c).q & 1);
    rows.push({ state: st, x, stateBits: bitsOf(st, k), inBits: bitsOf(x, m), next: next.reduce((a, b) => a * 2 + b, 0), nextBits: next, outs, exc });
  }
  // Moore (Ausgänge nur vom Zustand abhängig)?
  const moore = O.length > 0 && [...Array(2 ** k).keys()].every(st => {
    const r = rows.filter(r => r.state === st);
    return r.every(x => x.outs.join() === r[0].outs.join());
  });
  // Gleichungen
  const vars = [...S.map(s => s.name), ...I.map(i => i.name)];
  const col = f => rows.map(f);
  const eqs = {
    next: S.map((s, i) => columnExpr(s.name + '⁺', vars, col(r => r.nextBits[i]))),
    exc: ffIn.map((f, j) => columnExpr(f.short, vars, col(r => r.exc[j]))),
    outs: O.map((o, j) => moore ? columnExpr(o.name, S.map(s => s.name), [...Array(2 ** k).keys()].map(st => rows.find(r => r.state === st).outs[j])) : columnExpr(o.name, vars, col(r => r.outs[j]))),
  };
  return { states: S.map(s => s.name), inputs: I.map(i => i.name), outputs: O.map(o => o.name), ffInputs: ffIn.map(f => f.name), rows, moore, eqs, oscillating: sim.oscillating };
}

// ---------- Zustandsdiagramm (SVG) ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function stateDiagramSVG(nodes, edges, opts = {}) {
  // nodes: [{id, label, sub, initial}], edges: [{from, to, label}]
  const n = nodes.length, R = 34;
  const W = opts.width || Math.max(360, Math.min(760, 180 + n * 70)), H = opts.height || W * 0.78;
  const cx = W / 2, cy = H / 2, rad = n === 1 ? 0 : Math.min(W, H) / 2 - R - 46;
  const pos = new Map(nodes.map((nd, i) => [nd.id, nd.x != null ? { x: nd.x, y: nd.y } : { x: cx + rad * Math.cos(-Math.PI / 2 + i * 2 * Math.PI / n), y: cy + rad * Math.sin(-Math.PI / 2 + i * 2 * Math.PI / n) }]));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="state-svg" font-family="-apple-system,Segoe UI,sans-serif">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>`;
  // Kanten gleicher Richtung zusammenfassen
  const merged = new Map();
  for (const e of edges) { const key = e.from + '>' + e.to; if (!merged.has(key)) merged.set(key, { ...e, labels: [] }); merged.get(key).labels.push(e.label); }
  const label = (x, y, text) => `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="#111827" stroke="#fff" stroke-width="5" paint-order="stroke">${esc(text)}</text>`;
  for (const e of merged.values()) {
    const a = pos.get(e.from), b = pos.get(e.to), txt = e.labels.filter(Boolean).join(', ');
    if (e.from === e.to) {
      const ang = Math.atan2(a.y - cy, a.x - cx) || -Math.PI / 2;
      const ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
      const p1 = { x: a.x + R * (ux * 0.7 + px * 0.7), y: a.y + R * (uy * 0.7 + py * 0.7) };
      const p2 = { x: a.x + R * (ux * 0.7 - px * 0.7), y: a.y + R * (uy * 0.7 - py * 0.7) };
      const c1 = { x: a.x + ux * R * 2.6 + px * R * 1.1, y: a.y + uy * R * 2.6 + py * R * 1.1 };
      const c2 = { x: a.x + ux * R * 2.6 - px * R * 1.1, y: a.y + uy * R * 2.6 - py * R * 1.1 };
      s += `<path d="M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}" fill="none" stroke="#374151" stroke-width="1.8" marker-end="url(#arr)"/>`;
      if (txt) s += label(a.x + ux * R * 2.55, a.y + uy * R * 2.55, txt);
      continue;
    }
    const back = merged.has(e.to + '>' + e.from);
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const bend = back ? 28 : 0, mx = (a.x + b.x) / 2 - uy * bend, my = (a.y + b.y) / 2 + ux * bend;
    const sa = { x: a.x + ux * R, y: a.y + uy * R }, eb = { x: b.x - ux * (R + 2), y: b.y - uy * (R + 2) };
    if (back) { sa.x -= uy * 10; sa.y += ux * 10; eb.x -= uy * 10; eb.y += ux * 10; }
    s += `<path d="M${sa.x},${sa.y} Q${mx},${my} ${eb.x},${eb.y}" fill="none" stroke="#374151" stroke-width="1.8" marker-end="url(#arr)"/>`;
    if (txt) s += label((sa.x + 2 * mx + eb.x) / 4 - uy * 10, (sa.y + 2 * my + eb.y) / 4 + ux * 10, txt);
  }
  for (const nd of nodes) {
    const p = pos.get(nd.id);
    if (nd.initial) s += `<path d="M${p.x - R - 26},${p.y} L${p.x - R - 2},${p.y}" stroke="#374151" stroke-width="1.8" marker-end="url(#arr)"/>`;
    s += `<circle cx="${p.x}" cy="${p.y}" r="${R}" fill="${nd.dim ? '#f3f4f6' : '#fff'}" stroke="${nd.dim ? '#9ca3af' : '#1e3a8a'}" stroke-width="2.2" ${nd.dim ? 'stroke-dasharray="4 3"' : ''}/>`;
    s += `<text x="${p.x}" y="${p.y + (nd.sub ? -3 : 5)}" text-anchor="middle" font-size="15" font-weight="700" fill="#1e3a8a">${esc(nd.label)}</text>`;
    if (nd.sub) s += `<text x="${p.x}" y="${p.y + 15}" text-anchor="middle" font-size="12" fill="#b45309">${esc(nd.sub)}</text>`;
  }
  return s + '</svg>';
}

// ---------- Automat -> Tabelle und Schaltung ----------
export function evalAst(e, env) {
  switch (e.op) {
    case 'var': if (!(e.name in env)) throw new Error(`Unbekannter Eingang „${e.name}“`); return env[e.name];
    case 'const': return e.v;
    case 'not': return 1 - evalAst(e.a, env);
    case 'and': return e.args.every(a => evalAst(a, env)) ? 1 : 0;
    case 'or': return e.args.some(a => evalAst(a, env)) ? 1 : 0;
    case 'xor': return e.args.reduce((s, a) => s ^ evalAst(a, env), 0);
  }
}

// fsm: {inputs:[], outputs:[], states:[{id,name,out:{},initial}], trans:[{from,to,cond}]}
export function fsmTable(fsm) {
  const states = [...fsm.states];
  if (!states.length) throw new Error('Der Automat hat noch keine Zustände.');
  const init = states.findIndex(s => s.initial);
  if (init > 0) states.unshift(...states.splice(init, 1));
  const k = Math.max(1, Math.ceil(Math.log2(states.length)));
  const m = fsm.inputs.length;
  if (m > 4) throw new Error('Höchstens 4 Eingänge.');
  const qn = Array.from({ length: k }, (_, i) => 'Q' + (k - 1 - i));
  const clash = qn.find(q => fsm.inputs.includes(q) || fsm.outputs.includes(q));
  if (clash) throw new Error(`Der Name „${clash}“ ist für die Zustandsbits reserviert.`);
  const conds = new Map();
  const problems = [];
  for (const t of fsm.trans) {
    try { conds.set(t, t.cond.trim() ? parseExpr(t.cond) : { op: 'const', v: 1 }); }
    catch (e) { problems.push(`Bedingung „${t.cond}“: ${e.message}`); }
  }
  const rows = [];
  states.forEach((s, code) => {
    for (let x = 0; x < 2 ** m; x++) {
      const env = Object.fromEntries(fsm.inputs.map((n, i) => [n, (x >> (m - 1 - i)) & 1]));
      let hits = [];
      for (const t of fsm.trans.filter(t => t.from === s.id && conds.has(t))) {
        try { if (evalAst(conds.get(t), env)) hits.push(t); } catch (e) { problems.push(e.message); }
      }
      const targets = [...new Set(hits.map(t => t.to))];
      if (targets.length > 1) problems.push(`Zustand „${s.name}“ bei ${fsm.inputs.map((n, i) => n + '=' + ((x >> (m - 1 - i)) & 1)).join(', ') || 'jeder Eingabe'}: mehrere Übergänge treffen zu.`);
      const stay = !targets.length;
      const to = stay ? s : states.find(z => z.id === targets[0]);
      // Mealy: Ausgänge am Übergang kommen zu denen des Zustands hinzu
      const tr = hits[0];
      if (hits.length > 1) for (const o of fsm.outputs) if (hits.some(h => !!h.out?.[o] !== !!tr.out?.[o])) problems.push(`Zustand „${s.name}“: zutreffende Übergänge setzen „${o}“ verschieden.`);
      rows.push({ from: s, code, x, inBits: bitsOf(x, m), to, next: states.indexOf(to), stay, outs: fsm.outputs.map(o => (s.out?.[o] || tr?.out?.[o] ? 1 : 0)) });
    }
  });
  const mealy = isMealy(fsm);
  const ff = ['JK', 'T'].includes(fsm.ffType) ? fsm.ffType : 'D';
  // Ansteuerung der Flipflops je Zeile (X = egal)
  const excNames = ff === 'JK' ? qn.flatMap(q => ['J' + q.slice(1), 'K' + q.slice(1)]) : qn.map(q => ff + q.slice(1));
  for (const r of rows) {
    r.exc = [];
    for (let i = 0; i < k; i++) {
      const b = k - 1 - i, q = (r.code >> b) & 1, qp = (r.next >> b) & 1;
      if (ff === 'D') r.exc.push(qp);
      else if (ff === 'T') r.exc.push(q ^ qp);
      else r.exc.push(q ? 'X' : qp, q ? 1 - qp : 'X');
    }
  }
  return { states, k, qn, rows, mealy, ff, excNames, problems: [...new Set(problems)] };
}
export const isMealy = fsm => fsm.trans.some(t => Object.values(t.out || {}).some(Boolean));

export function fsmCircuit(fsm) {
  const t = fsmTable(fsm);
  if (t.problems.length) throw new Error(t.problems[0]);
  const { k, qn, states } = t, m = fsm.inputs.length;
  const vars = [...qn, ...fsm.inputs];
  const N = 2 ** (k + m);
  // Spalten über alle Codes (unbenutzte Codes = X)
  const val = (fn) => Array.from({ length: N }, (_, idx) => {
    const code = idx >> m, x = idx & (2 ** m - 1);
    const r = t.rows.find(r => r.code === code && r.x === x);
    return r ? fn(r) : 'X';
  });
  const defs = [];
  t.excNames.forEach((name, j) => {
    const e = columnExpr(name, vars, val(r => r.exc[j]));
    defs.push({ name, ast: termsToAST(e.terms, vars.length, vars), expr: e });
  });
  for (const [j, o] of fsm.outputs.entries()) {
    if (t.mealy) {
      // Mealy: Ausgang hängt von Zustand und Eingängen ab
      const e = columnExpr(o, vars, val(r => r.outs[j]));
      defs.push({ name: o, ast: termsToAST(e.terms, vars.length, vars), expr: e });
    } else {
      const e = columnExpr(o, qn, Array.from({ length: 2 ** k }, (_, code) => (code < states.length ? (states[code].out?.[o] ? 1 : 0) : 'X')));
      defs.push({ name: o, ast: termsToAST(e.terms, qn.length, qn), expr: e });
    }
  }
  // Eingänge, die nirgends vorkommen, trotzdem als Schalter anlegen
  const c = buildCircuit(defs);
  // Zustandsbits über Tunnel mit den D-Flipflops verbinden
  for (const comp of [...c.comps]) {
    const a = comp.attrs;
    if (comp.type === 'In' && qn.includes(a.Label)) { comp.type = 'Tunnel'; comp.attrs = { NetName: a.Label }; comp.rot = 2; }
    if (comp.type === 'Out' && t.excNames.includes(a.Label)) { comp.type = 'Tunnel'; comp.attrs = { NetName: a.Label }; comp.rot = 0; }
  }
  const used = new Set(defs.flatMap(d => [...variables(d.ast)]));
  let maxY = Math.max(0, ...c.comps.map(k => k.y), ...c.wires.map(w => Math.max(w.y1, w.y2)));
  fsm.inputs.filter(n => !used.has(n)).forEach(n => { maxY += 40; c.addComp('In', 60, maxY, { Label: n }); });
  const x = 260, y0 = maxY + 100, ff = t.ff, step = ff === 'JK' ? 100 : 80;
  c.addComp('Clock', x - 80, y0 + 20, { Label: 'C', Frequency: 1, runRealTime: false });
  qn.forEach((q, i) => {
    const y = y0 + i * step, n = q.slice(1);
    const type = ff === 'JK' ? 'JK_FF' : ff === 'T' ? 'T_FF' : 'D_FF';
    c.addComp(type, x, y, { Label: q });
    // Ansteuer-Eingänge über Tunnel: D bzw. T oben, beim JK-Flipflop J oben und K unten
    const ins = ff === 'JK' ? [['J' + n, 0], ['K' + n, 40]] : [[ff + n, 0]];
    for (const [name, dy] of ins) { c.addComp('Tunnel', x - 40, y + dy, { NetName: name }, 2); c.addWire(x - 40, y + dy, x, y + dy); }
    c.addComp('Tunnel', x + 100, y, { NetName: q });
    c.addWire(x + 60, y, x + 100, y);
    if (i === 0) c.addWire(x - 80, y + 20, x, y + 20);
    else c.addWire(x - 20, y + 20, x, y + 20);
  });
  if (k > 1) c.addWire(x - 20, y0 + 20, x - 20, y0 + (k - 1) * step + 20);
  c.addComp('Text', x - 80, y0 - 60, { Description: `Zustandsspeicher mit ${ff}-Flipflops (Startzustand „${states[0].name}“ = ${'0'.repeat(k)})${t.mealy ? ' · Mealy-Automat' : ''}` });
  c.cleanup();
  return { circuit: c, table: t, defs };
}
