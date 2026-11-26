// Ereignisgesteuerter Simulator mit Einheitsverzögerung pro Bauteil
import { DEF, attrsOf, geoOf, mask } from './components.js';
import { buildNets } from './circuit.js';

export class Sim {
  constructor(circuit) {
    this.circuit = circuit;
    const { nets, compPins, wireNet, comps, problems, subPins } = buildNets(circuit);
    this.subPins = subPins;
    this.nets = nets; this.wireNet = wireNet;
    this.state = new Map();
    this.errors = [...new Set(problems)];
    this.comps = comps;
    for (const c of this.comps) {
      const cp = compPins.get(c.id);
      const st = { inNets: cp.ins, outNets: cp.outs, outs: cp.outs.map(() => null), ins: cp.ins.map(() => null), bits: cp.ins.map(n => nets[n].bits) };
      DEF[c.type].init?.(st, attrsOf(c));
      this.state.set(c.id, st);
    }
    if (nets.some(n => n.error === 'bits')) this.errors.push('Bitbreiten passen an einer Leitung nicht zusammen (rot markiert).');
    this.oscillating = false;
    for (const net of nets) if (net.drivers.some(d => DEF[d.c.type].pull)) this.resolve(net);
    this.run(this.comps);
  }

  evalComp(c) {
    const st = this.state.get(c.id);
    const def = DEF[c.type];
    st.ins = st.inNets.map(n => this.nets[n].value);
    return def.eval(st.ins, st, attrsOf(c), geoOf(c));
  }

  resolve(net) {
    let val = null, conflict = false, pull = null;
    for (const d of net.drivers) {
      const pl = DEF[d.c.type].pull;
      if (pl) { pull = pl; continue; }
      const v = this.state.get(d.c.id)?.outs[d.i];
      if (v == null) continue;
      if (val == null) val = v; else if (v !== val) conflict = true;
    }
    if (conflict) { net.error = net.error || 'short'; } else if (net.error === 'short') net.error = null;
    // offene Leitung mit Pull-up/Pull-down
    if (val == null && pull) val = pull === 'up' ? mask(net.bits) : 0;
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

  // Wert am k-ten Ausgang eines Bausteins (oberste Ebene)
  subOut(c, k) { const outs = (this.subPins.get(c.id) || []).filter(x => x.p.out); return outs[k] ? this.nets[outs[k].net].value : null; }

  netOfWire(w) { return this.nets[this.wireNet.get(w.id)]; }
  st(c) { return this.state.get(c.id); }
}
