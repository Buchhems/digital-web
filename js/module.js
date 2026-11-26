// Ausgewählten Teil einer Schaltung in einen eigenen Baustein umwandeln
import { Circuit, buildNets, onSegment } from './circuit.js';
import { pinsWorld, boundsWorld, attrsOf, rot } from './components.js';
import { library, touchLibrary } from './lib.js';

const S = 20;
const snap = v => Math.round(v / S) * S;
const key = (x, y) => x + ',' + y;

// Richtung -> Drehung eines Tunnels, dessen Spitze in Richtung d zeigt (Tunnel zeigt ohne Drehung nach rechts)
function rotFor([dx, dy]) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy < 0 ? 1 : 3;
}

// Draht an Punkt (x,y) aufteilen, falls der Punkt im Inneren liegt (Anschlüsse verbinden nur an Drahtenden)
function splitAt(c, x, y) {
  for (const w of [...c.wires]) if (onSegment(x, y, w)) {
    c.addWire(x, y, w.x2, w.y2);
    w.x2 = x; w.y2 = y;
  }
}

// Einfache Leitungsführung (gerade, L- oder Z-Form) ohne ungewollte Verbindungen.
// Liefert die Liste der Punkte oder null, wenn kein sicherer Weg gefunden wurde.
export function route(c, a, b, ignore = new Set()) {
  const pts = new Set();
  for (const k of c.comps) for (const q of pinsWorld(k)) pts.add(key(q.x, q.y));
  for (const w of c.wires) { pts.add(key(w.x1, w.y1)); pts.add(key(w.x2, w.y2)); }
  const boxes = c.comps.filter(k => !ignore.has(k) && k.type !== 'Text').map(k => boundsWorld(k));
  const cand = [];
  if (a[0] === b[0] || a[1] === b[1]) cand.push([a, b]);
  cand.push([a, [b[0], a[1]], b], [a, [a[0], b[1]], b]);
  const mx = snap((a[0] + b[0]) / 2), my = snap((a[1] + b[1]) / 2);
  for (const dx of [0, S, -S, 2 * S, -2 * S]) cand.push([a, [mx + dx, a[1]], [mx + dx, b[1]], b]);
  for (const dy of [0, S, -S, 2 * S, -2 * S]) cand.push([a, [a[0], my + dy], [b[0], my + dy], b]);
  const onSeg = (x, y, p, q) => onSegment(x, y, { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }) || (x === p[0] && y === p[1]) || (x === q[0] && y === q[1]);
  const segOk = (p, q) => {
    if (p[0] !== q[0] && p[1] !== q[1]) return false;
    // kein vorhandener Punkt auf dem Stück (außer Start und Ziel)
    for (const k of pts) { const [x, y] = k.split(',').map(Number); if (onSeg(x, y, p, q) && !(x === a[0] && y === a[1]) && !(x === b[0] && y === b[1])) return false; }
    for (const w of c.wires) {
      // Ecken/Enden nicht im Inneren fremder Leitungen, keine Überlappung
      for (const r of [p, q]) if (onSegment(r[0], r[1], w)) return false;
      const col = (p[0] === q[0] && w.x1 === w.x2 && w.x1 === p[0]) || (p[1] === q[1] && w.y1 === w.y2 && w.y1 === p[1]);
      if (col) { const [lo, hi] = p[0] === q[0] ? [Math.min(p[1], q[1]), Math.max(p[1], q[1])] : [Math.min(p[0], q[0]), Math.max(p[0], q[0])]; const [wl, wh] = p[0] === q[0] ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)]; if (Math.min(hi, wh) > Math.max(lo, wl)) return false; }
    }
    // nicht durch Bauteile hindurch
    for (const bx of boxes) {
      const [lx, hx] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])], [ly, hy] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      if (hx > bx.x0 + 2 && lx < bx.x1 - 2 && hy > bx.y0 + 2 && ly < bx.y1 - 2) return false;
    }
    return true;
  };
  for (const path of cand) {
    const clean = path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
    if (clean.length < 2) continue;
    if (clean.slice(1).every((q, i) => segOk(clean[i], q))) return clean;
  }
  return null;
}
const addPath = (c, path) => { for (let i = 1; i < path.length; i++) c.addWire(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]); };

export function makeModule(circuit, sel, name) {
  const backup = JSON.stringify(circuit.toJSON());
  const ids = [...sel].map(x => (x.type ? 'c' + circuit.comps.indexOf(x) : 'w' + circuit.wires.indexOf(x)));
  const r = selectionToModule(circuit, sel, name, true);
  if (!r.retry) return r;
  // zurücksetzen und mit Tunneln statt Leitungen bauen
  const restored = Circuit.fromJSON(JSON.parse(backup));
  circuit.comps = restored.comps; circuit.wires = restored.wires;
  const sel2 = new Set(ids.map(id => (id[0] === 'c' ? circuit.comps[+id.slice(1)] : circuit.wires[+id.slice(1)])));
  return selectionToModule(circuit, sel2, name, false);
}

/**
 * sel: Set mit Bauteilen und Leitungen der Schaltung `circuit`.
 * Legt die Teilschaltung `name` in der Bibliothek an und ersetzt die Auswahl durch eine Instanz.
 * Liefert {instance, inputs, outputs}.
 */
export function selectionToModule(circuit, sel, name, useRoutes = true) {
  const insideC = new Set([...sel].filter(x => x.type));
  const insideW = new Set([...sel].filter(x => !x.type));
  if (!insideC.size) throw new Error('Bitte zuerst Bauteile auswählen.');
  if ([...insideC].some(c => c.type === 'Sub' && c.sub === name)) throw new Error('Ein Baustein kann sich nicht selbst enthalten.');

  // Netze der ganzen Schaltung, Anschlüsse jedem Netz zuordnen
  const { nets, compPins, wireNet, subPins } = buildNets(circuit);
  const pinNet = (c) => {
    if (c.type === 'Sub') return (subPins.get(c.id) || []).map(x => ({ p: x.p, net: x.net }));
    const cp = compPins.get(c.id); if (!cp) return [];
    let ii = 0, oi = 0;
    return pinsWorld(c).map(p => ({ p, net: p.out ? cp.outs[oi++] : cp.ins[ii++] }));
  };
  const info = new Map(); // net -> {inPins, outPins, inWires, outWires}
  const get = n => { if (!info.has(n)) info.set(n, { inPins: [], outPins: [], inWires: [], outWires: [] }); return info.get(n); };
  for (const c of circuit.comps) for (const { p, net } of pinNet(c)) if (net != null) get(net)[insideC.has(c) ? 'inPins' : 'outPins'].push({ p, c });
  for (const w of circuit.wires) { const n = wireNet.get(w.id); if (n != null) get(n)[insideW.has(w) ? 'inWires' : 'outWires'].push(w); }

  // Grenz-Netze: verbinden Innen und Außen
  const labelsUsed = new Set();
  const uniq = base => { let l = base, i = 2; while (labelsUsed.has(l)) l = base + i++; labelsUsed.add(l); return l; };
  for (const c of insideC) if (['In', 'Out', 'Clock'].includes(c.type) && attrsOf(c).Label) labelsUsed.add(attrsOf(c).Label);
  const ports = [];
  for (const [n, f] of info) {
    if (!f.inPins.length || (!f.outPins.length && !f.outWires.length)) continue;
    // Berührungspunkte zwischen innerem und äußerem Teil
    const inPts = new Map(), outPts = new Map();
    for (const { p } of f.inPins) inPts.set(key(p.x, p.y), [p.x, p.y]);
    for (const w of f.inWires) { inPts.set(key(w.x1, w.y1), [w.x1, w.y1]); inPts.set(key(w.x2, w.y2), [w.x2, w.y2]); }
    for (const { p } of f.outPins) outPts.set(key(p.x, p.y), [p.x, p.y]);
    for (const w of f.outWires) { outPts.set(key(w.x1, w.y1), [w.x1, w.y1]); outPts.set(key(w.x2, w.y2), [w.x2, w.y2]); }
    const touch = new Map();
    for (const [k, pt] of inPts) if (outPts.has(k)) touch.set(k, pt);
    for (const [k, [x, y]] of outPts) if (f.inWires.some(w => onSegment(x, y, w))) touch.set(k, [x, y]);
    for (const [k, [x, y]] of inPts) if (f.outWires.some(w => onSegment(x, y, w))) touch.set(k, [x, y]);
    // nur über Tunnel verbunden?
    const outTunnel = f.outPins.find(x => x.c.type === 'Tunnel');
    const isOut = f.inPins.some(x => x.p.out) && !f.outPins.some(x => x.p.out);
    const named = f.outPins.find(x => ['In', 'Out', 'Clock'].includes(x.c.type) && attrsOf(x.c).Label)
      || f.inPins.find(x => x.c.type === 'Tunnel');
    const firstY = Math.min(...f.inPins.map(x => x.p.y));
    ports.push({ net: n, bits: nets[n].bits, isOut, touch: [...touch.values()], outTunnel, base: named ? (attrsOf(named.c).Label || attrsOf(named.c).NetName) : null, y: firstY, x: Math.min(...f.inPins.map(x => x.p.x)) });
  }
  let ni = 0, no = 0;
  for (const p of ports.sort((a, b) => a.y - b.y || a.x - b.x)) p.label = uniq(p.base || (p.isOut ? 'Y' + ++no : String.fromCharCode(65 + ni++)));
  if (!ports.length) throw new Error('Die Auswahl hat keine Verbindung nach außen – ein Baustein bräuchte Ein- oder Ausgänge.');

  // Bereich der Auswahl
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of insideC) { const b = boundsWorld(c); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  for (const w of insideW) { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2); }

  // ---- Teilschaltung bauen
  const sub = new Circuit();
  for (const c of insideC) { const k = sub.addComp(c.type, c.x, c.y, JSON.parse(JSON.stringify(c.attrs)), c.rot); if (c.raw) k.raw = [...c.raw]; if (c.sub) k.sub = c.sub; }
  for (const w of insideW) sub.addWire(w.x1, w.y1, w.x2, w.y2);
  const tunnelName = p => '›' + p.label;
  const ins = ports.filter(p => !p.isOut), outs = ports.filter(p => p.isOut);
  const colIn = snap(x0) - 80, colOut = snap(x1) + 80;
  const portComp = new Map();
  const place = (list, x, type) => list.forEach((p, i) => {
    const y = snap(y0) + i * 40;
    portComp.set(p, { c: sub.addComp(type, x, y, { Label: p.label, Bits: p.bits }), x, y, r: type === 'In' ? 0 : 2 });
  });
  place(ins, colIn, 'In');
  place(outs, colOut, 'Out');
  const subPts = p => (p.touch.length ? p.touch : [[info.get(p.net).inPins[0].p.x, info.get(p.net).inPins[0].p.y]]);
  for (const p of ports) for (const [x, y] of subPts(p)) splitAt(sub, x, y);
  for (const p of ports) {
    const f = info.get(p.net), pc = portComp.get(p);
    const pts = subPts(p);
    let needTunnel = false;
    for (const [x, y] of pts) {
      const path = useRoutes && route(sub, [pc.x, pc.y], [x, y], new Set([pc.c]));
      if (path) { addPath(sub, path); continue; }
      needTunnel = true;
      const w = sub.wires.find(w => (w.x1 === x && w.y1 === y) || (w.x2 === x && w.y2 === y));
      let d;
      if (w) { const [ox, oy] = w.x1 === x && w.y1 === y ? [w.x2, w.y2] : [w.x1, w.y1]; d = [x - ox, y - oy]; }
      else { const ip = f.inPins.find(q => q.p.x === x && q.p.y === y) || f.inPins[0]; const b = boundsWorld(ip.c); d = [x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2]; }
      sub.addComp('Tunnel', x, y, { NetName: tunnelName(p), Bits: p.bits }, rotFor(d));
    }
    if (needTunnel) sub.addComp('Tunnel', pc.x, pc.y, { NetName: tunnelName(p), Bits: p.bits }, pc.r);
  }
  sub.cleanup();
  library.set(name, sub); touchLibrary();

  // ---- Elternschaltung: Auswahl entfernen, Baustein einsetzen, über Tunnel verbinden
  circuit.comps = circuit.comps.filter(c => !insideC.has(c));
  circuit.wires = circuit.wires.filter(w => !insideW.has(w));
  // Platz suchen, an dem kein Anschluss des Bausteins auf einem vorhandenen Punkt oder einer Leitung liegt
  const occupied = new Set();
  for (const c of circuit.comps) for (const q of pinsWorld(c)) occupied.add(key(q.x, q.y));
  for (const w of circuit.wires) { occupied.add(key(w.x1, w.y1)); occupied.add(key(w.x2, w.y2)); }
  for (const p of ports) for (const [x, y] of p.touch) occupied.add(key(x, y));
  const probe = { id: -7, type: 'Sub', sub: name, x: 0, y: 0, rot: 0, attrs: {} };
  const touchAll = ports.flatMap(p => p.touch);
  const free = (x, y) => {
    probe.x = x; probe.y = y;
    // Baustein darf die Anschlusspunkte der alten Leitungen nicht überdecken (mit Abstand)
    const b = boundsWorld(probe);
    if (touchAll.some(([tx, ty]) => tx >= b.x0 - S && tx <= b.x1 + S && ty >= b.y0 - S && ty <= b.y1 + S)) return false;
    if (circuit.comps.some(k => { const o = boundsWorld(k); return o.x0 < b.x1 + S && o.x1 > b.x0 - S && o.y0 < b.y1 + S && o.y1 > b.y0 - S; })) return false;
    // Anschlüsse und die 40 Einheiten langen Tunnel davor müssen frei sein
    return pinsWorld(probe).every(q => {
      const dx = q.out ? S : -S;
      return [0, 1, 2].every(k => { const px = q.x + dx * k, py = q.y; return !occupied.has(key(px, py)) && !circuit.wires.some(w => onSegment(px, py, w)); });
    });
  };
  let pos = null;
  const cx = snap((x0 + x1) / 2) - 40;
  // möglichst nah an der Mitte der Auswahl, sonst spiralförmig nach außen
  const cy = snap((y0 + y1) / 2) - 20;
  outer: for (let r = 0; r <= 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (free(cx + dx * S, cy + dy * S)) { pos = [cx + dx * S, cy + dy * S]; break outer; }
  }
  if (!pos) pos = [cx, snap(y1) + 80];
  const inst = circuit.addComp('Sub', pos[0], pos[1], {});
  inst.sub = name;
  const outerName = p => (p.touch.length || !p.outTunnel ? name + '.' + p.label : attrsOf(p.outTunnel.c).NetName);
  const pins = pinsWorld(inst);
  const subIns = pins.filter(q => !q.out), subOuts = pins.filter(q => q.out);
  const pinOf = p => (p.isOut ? subOuts[outs.indexOf(p)] : subIns[ins.indexOf(p)]);
  for (const p of ports) for (const [x, y] of p.touch) splitAt(circuit, x, y);
  for (const p of ports) {
    const q = pinOf(p); if (!q) continue;
    let needTunnel = !p.touch.length;
    for (const [x, y] of p.touch) {
      const path = useRoutes && route(circuit, [q.x, q.y], [x, y], new Set([inst]));
      if (path) { addPath(circuit, path); continue; }
      needTunnel = true;
      const w = circuit.wires.find(w => (w.x1 === x && w.y1 === y) || (w.x2 === x && w.y2 === y));
      let d = p.isOut ? [-1, 0] : [1, 0];
      if (w) { const [ox, oy] = w.x1 === x && w.y1 === y ? [w.x2, w.y2] : [w.x1, w.y1]; d = [x - ox, y - oy]; }
      circuit.addComp('Tunnel', x, y, { NetName: outerName(p), Bits: p.bits }, rotFor(d));
    }
    if (needTunnel) circuit.addComp('Tunnel', q.x, q.y, { NetName: outerName(p), Bits: p.bits }, p.isOut ? 0 : 2);
  }
  circuit.cleanup();
  // Kontrolle: jeder Anschluss genau mit "seinem" Netz verbunden, keine Netze vereint
  const ok = (circ, anchor) => {
    const { nets: nn, compPins: cpm, subPins: spm } = buildNets(circ);
    const netAt = (x, y) => { for (const k of circ.comps) { const pp = k.type === 'Sub' ? (spm.get(k.id) || []).map(z => ({ p: z.p, net: z.net })) : (() => { const cp = cpm.get(k.id); if (!cp) return []; let i = 0, o = 0; return pinsWorld(k).map(p => ({ p, net: p.out ? cp.outs[o++] : cp.ins[i++] })); })(); const h = pp.find(z => z.p.x === x && z.p.y === y); if (h) return h.net; } return null; };
    const seen = new Map();
    for (const p of ports) {
      const a = anchor(p); if (!a) continue;
      const n = netAt(a[0], a[1]);
      if (n == null) return false;
      for (const [x, y] of p.touch) { const m = netAt(x, y); if (m != null && m !== n) return false; }
      if (seen.has(n) && seen.get(n) !== p) return false;
      seen.set(n, p);
    }
    void nn; return true;
  };
  if (useRoutes && !(ok(circuit, p => { const q = pinOf(p); return q && [q.x, q.y]; }) && ok(sub, p => [portComp.get(p).x, portComp.get(p).y]))) return { retry: true };
  return { instance: inst, inputs: ins.map(p => p.label), outputs: outs.map(p => p.label) };
}

void rot;
