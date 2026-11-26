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
    // Schalter (Schalter, FET, Relais …) verbinden im geschlossenen Zustand ihre Netze
    this.swComps = this.comps.filter(c => DEF[c.type].switches);
    for (const c of this.swComps) { const st = this.state.get(c.id); st.pairs = []; st.swKey = ''; }
    this.rebuildGroups();
    for (const net of nets) if (net.drivers.some(d => DEF[d.c.type].pull)) this.resolve(net);
    this.monoflops = this.comps.filter(c => DEF[c.type].onClockTick);
    this.run(this.comps);
    // Reset-Bausteine: nach dem Start loslassen (wie in Digital)
    const resets = this.comps.filter(c => c.type === 'Reset');
    if (resets.length) { for (const c of resets) this.state.get(c.id).resetting = false; this.run(resets); }
  }

  evalComp(c) {
    const st = this.state.get(c.id);
    const def = DEF[c.type];
    st.ins = st.inNets.map(n => this.nets[n].value);
    return def.eval(st.ins, st, attrsOf(c), geoOf(c));
  }

  // Netzgruppen aus geschlossenen Schaltern bilden
  rebuildGroups() {
    this.groupOf = null;
    if (!this.swComps.length) return;
    const p = this.nets.map((_, i) => i);
    const find = a => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; };
    for (const c of this.swComps) {
      const st = this.state.get(c.id);
      for (const [i, j] of st.pairs) { const a = find(st.inNets[i]), b = find(st.inNets[j]); if (a !== b) p[a] = b; }
    }
    const groups = new Map();
    this.groupOf = this.nets.map((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); return groups.get(r); });
    this.nets.forEach((_, i) => this.groupOf[i].push(i));
  }

  // Wert eines Netzes (bzw. seiner Gruppe) bestimmen; liefert die Netze, deren Wert sich geändert hat
  resolve(net) {
    const members = this.groupOf ? this.groupOf[net.id] : [net.id];
    let val = null, conflict = false, pull = null;
    for (const m of members) for (const d of this.nets[m].drivers) {
      const pl = DEF[d.c.type].pull;
      if (pl) { pull = pl; continue; }
      const v = this.state.get(d.c.id)?.outs[d.i];
      if (v == null) continue;
      if (val == null) val = v; else if (v !== val) conflict = true;
    }
    // offene Leitung mit Pull-up/Pull-down
    if (val == null && pull) val = pull === 'up' ? mask(net.bits) : 0;
    const changed = [];
    for (const m of members) {
      const n = this.nets[m];
      if (conflict) n.error = n.error || 'short'; else if (n.error === 'short') n.error = null;
      if (n.value !== val) { n.value = val; changed.push(m); }
    }
    return changed;
  }

  // nach der Auswertung eines Schalters: hat sich die Verbindung geändert?
  switchChanged(c, st, nets) {
    const key = st.pairs.map(q => q.join('-')).join('|');
    if (key === st.swKey) return false;
    st.swKey = key;
    for (const n of st.inNets) nets.add(n);
    return true;
  }

  // Wellen-Simulation; bei Schwingung Fallback auf sequentielle Auswertung
  run(start) {
    let cur = new Set(start);
    // steigende Flanke eines Takt-Eingangs: Monoflops zählen ihre Dauer herunter
    if (this.monoflops?.length) {
      let tick = false;
      for (const c of cur) if (c.type === 'Clock') { const st = this.state.get(c.id); if (st.value === 1 && !st.tickV) tick = true; st.tickV = st.value; }
      if (tick) for (const m of this.monoflops) if (DEF[m.type].tick(this.state.get(m.id))) cur.add(m);
    }
    let waves = 0;
    while (cur.size) {
      if (++waves > 200) return this.runSequential(cur);
      const changed = new Set();
      let sw = false;
      for (const c of cur) {
        const outs = this.evalComp(c);
        const st = this.state.get(c.id);
        outs.forEach((v, i) => { if (v !== st.outs[i]) { st.outs[i] = v; changed.add(st.outNets[i]); } });
        if (st.pairs && this.switchChanged(c, st, changed)) sw = true;
      }
      if (sw) this.rebuildGroups();
      cur = new Set();
      for (const n of changed) for (const m of this.resolve(this.nets[n])) for (const r of this.nets[m].readers) cur.add(r.c);
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
      const touched = new Set();
      outs.forEach((v, i) => { if (v !== st.outs[i]) { st.outs[i] = v; touched.add(st.outNets[i]); } });
      if (st.pairs && this.switchChanged(c, st, touched)) this.rebuildGroups();
      for (const n of touched) for (const m of this.resolve(this.nets[n])) for (const r of this.nets[m].readers) if (!inQ.has(r.c)) { queue.push(r.c); inQ.add(r.c); }
    }
    this.refreshInputs();
    return true;
  }

  refreshInputs() {
    for (const c of this.comps) { const st = this.state.get(c.id); st.ins = st.inNets.map(n => this.nets[n].value); }
  }

  update(c) { return this.run([c]); }

  // Stopp-Element aktiv? Haltepunkt erreicht?
  get stopRequested() { return this.comps.some(c => c.type === 'Stop' && this.state.get(c.id).stop); }
  get breakHit() { return this.comps.find(c => c.type === 'Break' && this.state.get(c.id).hit) || null; }

  // Wert am k-ten Ausgang eines Bausteins (oberste Ebene)
  subOut(c, k) { const outs = (this.subPins.get(c.id) || []).filter(x => x.p.out); return outs[k] ? this.nets[outs[k].net].value : null; }

  netOfWire(w) { return this.nets[this.wireNet.get(w.id)]; }
  st(c) { return this.state.get(c.id); }
}
