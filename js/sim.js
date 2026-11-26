// Ereignisgesteuerter Simulator mit Einheitsverzögerung pro Bauteil
import { DEF, attrsOf, geoOf } from './components.js';
import { buildNets } from './circuit.js';

export class Sim {
  constructor(circuit) {
    this.circuit = circuit;
    const { nets, compPins, wireNet } = buildNets(circuit);
    this.nets = nets; this.wireNet = wireNet;
    this.state = new Map();
    this.errors = [];
    this.comps = circuit.comps.filter(c => c.type !== 'Unknown' && c.type !== 'Text');
    for (const c of this.comps) {
      const cp = compPins.get(c.id);
      const st = { inNets: cp.ins, outNets: cp.outs, outs: cp.outs.map(() => null), ins: cp.ins.map(() => null), bits: cp.ins.map(n => nets[n].bits) };
      DEF[c.type].init?.(st, attrsOf(c));
      this.state.set(c.id, st);
    }
    if (nets.some(n => n.error === 'bits')) this.errors.push('Bitbreiten passen an einer Leitung nicht zusammen (rot markiert).');
    this.oscillating = false;
    this.run(this.comps);
  }

  evalComp(c) {
    const st = this.state.get(c.id);
    const def = DEF[c.type];
    st.ins = st.inNets.map(n => this.nets[n].value);
    return def.eval(st.ins, st, attrsOf(c), geoOf(c));
  }

  resolve(net) {
    let val = null, conflict = false;
    for (const d of net.drivers) {
      const v = this.state.get(d.c.id)?.outs[d.i];
      if (v == null) continue;
      if (val == null) val = v; else if (v !== val) conflict = true;
    }
    if (conflict) { net.error = net.error || 'short'; } else if (net.error === 'short') net.error = null;
    net.value = val;
  }

  // Wellen-Simulation; bei Schwingung Fallback auf sequentielle Auswertung
  run(start) {
    let cur = new Set(start);
    let waves = 0;
    while (cur.size) {
      if (++waves > 200) return this.runSequential(cur);
      const changed = new Set();
      for (const c of cur) {
        const outs = this.evalComp(c);
        const st = this.state.get(c.id);
        outs.forEach((v, i) => { if (v !== st.outs[i]) { st.outs[i] = v; changed.add(st.outNets[i]); } });
      }
      cur = new Set();
      for (const n of changed) {
        const net = this.nets[n];
        const old = net.value;
        this.resolve(net);
        if (net.value !== old) for (const r of net.readers) cur.add(r.c);
      }
    }
    this.refreshInputs();
    return true;
  }

  runSequential(set) {
    const queue = [...set];
    const inQ = new Set(queue);
    let steps = 0;
    const limit = 2000 + this.comps.length * 200;
    while (queue.length) {
      if (++steps > limit) { this.oscillating = true; this.refreshInputs(); return false; }
      const c = queue.shift(); inQ.delete(c);
      const outs = this.evalComp(c);
      const st = this.state.get(c.id);
      outs.forEach((v, i) => {
        if (v === st.outs[i]) return;
        st.outs[i] = v;
        const net = this.nets[st.outNets[i]];
        const old = net.value; this.resolve(net);
        if (net.value !== old) for (const r of net.readers) if (!inQ.has(r.c)) { queue.push(r.c); inQ.add(r.c); }
      });
    }
    this.refreshInputs();
    return true;
  }

  refreshInputs() {
    for (const c of this.comps) { const st = this.state.get(c.id); st.ins = st.inNets.map(n => this.nets[n].value); }
  }

  update(c) { return this.run([c]); }

  netOfWire(w) { return this.nets[this.wireNet.get(w.id)]; }
  st(c) { return this.state.get(c.id); }
}
