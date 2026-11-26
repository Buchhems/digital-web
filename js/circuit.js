// Datenmodell der Schaltung und Netzbildung
import { DEF, pinsWorld, attrsOf } from './components.js';
import { getCircuit } from './lib.js';
import { isGeneric, resolveCircuit, initArgs, instanceArgs, registerCircuitClass } from './generics.js';

let nextId = 1;
export const newId = () => nextId++;

export class Circuit {
  constructor() {
    this.comps = []; // {id,type,x,y,rot,attrs,raw?}
    this.wires = []; // {id,x1,y1,x2,y2}
    this.digAttributes = null; // rohe <attributes> aus .dig
  }
  addComp(type, x, y, attrs = {}, rot = 0) {
    const c = { id: newId(), type, x, y, rot, attrs: { ...attrs } };
    this.comps.push(c);
    return c;
  }
  addWire(x1, y1, x2, y2) {
    if (x1 === x2 && y1 === y2) return null;
    const w = { id: newId(), x1, y1, x2, y2 };
    this.wires.push(w);
    return w;
  }
  toJSON() {
    return {
      comps: this.comps.map(({ type, x, y, rot, attrs, raw, sub }) => ({ type, x, y, rot, attrs, ...(raw ? { raw } : {}), ...(sub ? { sub } : {}) })),
      wires: this.wires.map(w => [w.x1, w.y1, w.x2, w.y2]),
      digAttributes: this.digAttributes,
      ...(this.top ? { top: this.top } : {}),
    };
  }
  static fromJSON(j) {
    const c = new Circuit();
    for (const k of j.comps || []) {
      // früher hieß der eigene Baustein "Sub" (heute ist das der Subtrahierer wie in Digital)
      if (k.type === 'Sub' && k.sub) k = { ...k, type: 'Custom' };
      if (!DEF[k.type]) continue;
      const comp = c.addComp(k.type, k.x, k.y, k.attrs || {}, k.rot || 0);
      if (k.raw) comp.raw = k.raw;
      if (k.sub) comp.sub = k.sub;
    }
    for (const w of j.wires || []) c.addWire(...w);
    c.digAttributes = j.digAttributes || null;
    if (j.top) c.top = j.top;
    return c;
  }
  // Drähte aufräumen: Länge 0 und Duplikate entfernen, kollineare Stücke zusammenfassen
  cleanup() {
    const seen = new Set();
    this.wires = this.wires.filter(w => {
      if (w.x1 === w.x2 && w.y1 === w.y2) return false;
      const a = `${w.x1},${w.y1}`, b = `${w.x2},${w.y2}`;
      const k = a < b ? a + '|' + b : b + '|' + a;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Leitungen entfernen, die vollständig in einer anderen liegen
    const inside = (x, y, w) => onSegment(x, y, w) || (x === w.x1 && y === w.y1) || (x === w.x2 && y === w.y2);
    this.wires = this.wires.filter(a => !this.wires.some(b => b !== a && inside(a.x1, a.y1, b) && inside(a.x2, a.y2, b)
      && (b.x2 - b.x1) ** 2 + (b.y2 - b.y1) ** 2 > (a.x2 - a.x1) ** 2 + (a.y2 - a.y1) ** 2));
    // Zusammenfassen gerader Stücke, wenn am Verbindungspunkt sonst nichts hängt
    const pinPts = new Set();
    for (const c of this.comps) for (const p of pinsWorld(c)) pinPts.add(p.x + ',' + p.y);
    let changed = true;
    while (changed) {
      changed = false;
      const ends = new Map();
      for (const w of this.wires) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
        const k = x + ',' + y; if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w);
      }
      for (const [k, ws] of ends) {
        if (ws.length !== 2 || pinPts.has(k)) continue;
        const [a, b] = ws;
        const [px, py] = k.split(',').map(Number);
        if (this.wires.some(w => w !== a && w !== b && onSegment(px, py, w))) continue;
        const oa = a.x1 === px && a.y1 === py ? [a.x2, a.y2] : [a.x1, a.y1];
        const ob = b.x1 === px && b.y1 === py ? [b.x2, b.y2] : [b.x1, b.y1];
        const cross = (oa[0] - px) * (ob[1] - py) - (oa[1] - py) * (ob[0] - px);
        const dot = (oa[0] - px) * (ob[0] - px) + (oa[1] - py) * (ob[1] - py);
        if (cross !== 0 || dot >= 0) continue;
        a.x1 = oa[0]; a.y1 = oa[1]; a.x2 = ob[0]; a.y2 = ob[1];
        this.wires = this.wires.filter(w => w !== b);
        changed = true;
        break;
      }
    }
  }
}

// Liegt (x,y) echt im Inneren des Drahtes w?
export function onSegment(x, y, w) {
  if ((x === w.x1 && y === w.y1) || (x === w.x2 && y === w.y2)) return false;
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  if ((x - w.x1) * dy - (y - w.y1) * dx !== 0) return false;
  const t = (x - w.x1) * dx + (y - w.y1) * dy;
  return t > 0 && t < dx * dx + dy * dy;
}

class UF {
  constructor() { this.p = new Map(); }
  find(a) {
    if (!this.p.has(a)) this.p.set(a, a);
    let r = a; while (this.p.get(r) !== r) r = this.p.get(r);
    let x = a; while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

// Netze bilden. Teilschaltungen werden (wie in Digital) rekursiv eingebettet.
// Liefert {nets, compPins: Map(id -> {ins,outs}), wireNet: Map(wireId -> net), comps: flache Bauteilliste}
export function buildNets(circuit) {
  const problems = [];
  // generische Schaltung direkt simulieren: Standardargumente verwenden
  if (isGeneric(circuit)) {
    try { circuit = resolveCircuit(circuit, initArgs(circuit)); } catch (e) { problems.push('Generischer Code: ' + e.message); }
  }
  const uf = new UF();
  const flat = [];   // {c, pins:[{key, p}]}
  const topWires = [];

  function flatten(circ, pre, depth) {
    const pk = (x, y) => pre + 'p' + x + ',' + y;
    const wk = w => pre + 'w' + w.id;
    for (const w of circ.wires) {
      uf.union(wk(w), pk(w.x1, w.y1)); uf.union(wk(w), pk(w.x2, w.y2));
      if (!pre) topWires.push(w);
    }
    // T-Verbindungen: Drahtende liegt im Inneren eines anderen Drahtes.
    // (Anschlüsse verbinden nur, wenn eine Leitung dort endet – wie in Digital.)
    for (const v of circ.wires) for (const [x, y] of [[v.x1, v.y1], [v.x2, v.y2]])
      for (const w of circ.wires) if (w !== v && onSegment(x, y, w)) uf.union(pk(x, y), wk(w));
    for (const c of circ.comps) {
      if (c.type === 'Text' || c.type === 'Unknown' || c.type === 'Testcase' || c.type === 'PowerSupply') continue;
      if (depth > 0 && (c.type === 'In' || c.type === 'Out' || c.type === 'Clock')) continue; // werden zu Anschlüssen
      const pins = pinsWorld(c);
      if (c.type === 'Custom') {
        let sub = getCircuit(c.sub);
        if (!sub) { problems.push(`Baustein „${c.sub}“ fehlt.`); continue; }
        if (isGeneric(sub)) {
          try { sub = resolveCircuit(sub, instanceArgs(c), c.sub); }
          catch (e) { problems.push(`Baustein „${c.sub}“: ${e.message}`); continue; }
        }
        if (depth > 16) { problems.push(`Baustein „${c.sub}“ enthält sich selbst.`); continue; }
        const subPre = pre + c.id + '/';
        flatten(sub, subPre, depth + 1);
        const ports = sub.comps.filter(k => k.type === 'In' || k.type === 'Clock');
        const outs = sub.comps.filter(k => k.type === 'Out');
        const inPins = pins.filter(p => !p.out), outPins = pins.filter(p => p.out);
        [...ports.map((k, i) => [k, inPins[i]]), ...outs.map((k, i) => [k, outPins[i]])].forEach(([k, p]) => {
          if (!p) return;
          const q = pinsWorld(k)[0];
          uf.union(pk(p.x, p.y), subPre + 'p' + q.x + ',' + q.y);
          // Anschluss als Punkt registrieren (für Netz-Zuordnung)
        });
        continue;
      }
      const fc = pre ? { ...c, id: pre + c.id } : c;
      const a = attrsOf(c);
      flat.push({ c: fc, pins: pins.map(p => ({ key: pk(p.x, p.y), p })) });
      for (const p of pins) if (p.tunnel) uf.union(pk(p.x, p.y), 'T:' + pre + a.NetName);
    }
  }
  flatten(circuit, '', 0);

  const netIndex = new Map();
  const nets = [];
  const getNet = key => {
    const r = uf.find(key);
    if (!netIndex.has(r)) { netIndex.set(r, nets.length); nets.push({ id: nets.length, bits: 0, bitSet: new Set(), drivers: [], readers: [], value: null, error: null, wires: [] }); }
    return netIndex.get(r);
  };
  const compPins = new Map();
  for (const { c, pins } of flat) {
    const cp = { ins: [], outs: [] };
    compPins.set(c.id, cp);
    for (const { key, p } of pins) {
      const n = getNet(key);
      const net = nets[n];
      if (p.bits) { net.bitSet.add(p.bits); net.bits = Math.max(net.bits, p.bits); }
      if (p.out) { net.drivers.push({ c, i: cp.outs.length }); cp.outs.push(n); }
      else { net.readers.push({ c, i: cp.ins.length }); cp.ins.push(n); }
    }
  }
  const wireNet = new Map();
  for (const w of topWires) { const n = getNet('w' + w.id); wireNet.set(w.id, n); nets[n].wires.push(w); }
  // Anschlüsse der Bausteine auf oberster Ebene: Netz je Anschluss merken (für Zwischenschritte) und Bitbreiten prüfen
  const subPins = new Map();
  for (const c of circuit.comps) if (c.type === 'Custom') {
    const list = [];
    for (const p of pinsWorld(c)) {
      const n = getNet('p' + p.x + ',' + p.y); list.push({ p, net: n });
      if (p.bits) { nets[n].bitSet.add(p.bits); nets[n].bits = Math.max(nets[n].bits, p.bits); }
    }
    subPins.set(c.id, list);
  }
  for (const net of nets) {
    if (!net.bits) net.bits = 1;
    if (net.bitSet.size > 1) net.error = 'bits';
  }
  return { nets, compPins, wireNet, comps: flat.map(f => f.c), problems, subPins };
}

// Verbindungspunkte (für die Punkte an Abzweigungen)
export function junctions(circuit) {
  const cnt = new Map();
  const add = (x, y) => { const k = x + ',' + y; cnt.set(k, (cnt.get(k) || 0) + 1); };
  for (const w of circuit.wires) { add(w.x1, w.y1); add(w.x2, w.y2); }
  const res = [];
  for (const [k, n] of cnt) {
    const [x, y] = k.split(',').map(Number);
    const inner = circuit.wires.some(w => onSegment(x, y, w));
    if (n >= 3 || (inner && n >= 1)) res.push([x, y]);
  }
  return res;
}

registerCircuitClass(Circuit);
