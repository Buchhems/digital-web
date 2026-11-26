// Zeichenfläche mit Touch-/Stift-/Maus-Bedienung
import { DEF, attrsOf, geoOf, pinsWorld, boundsWorld, rot, S, formatValue } from './components.js';
import { buildNets, junctions } from './circuit.js';

const COL = {
  bg: '#f7f7f4', grid: '#cfd2d6', fg: '#1d1f22', body: '#ffffff',
  wire: '#24439b', sel: '#2563eb', selFill: 'rgba(37,99,235,0.12)',
  low: '#0b7a2a', high: '#34d058', z: '#8b8bf5', err: '#e11d48', bus: '#1f5f33',
  pinIn: '#2563eb', pinOut: '#dc2626',
};
const snap = v => Math.round(v / S) * S;

export class Editor {
  constructor(canvas, hooks) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.circuit = null; this.sim = null;
    this.view = { s: 1.6, ox: 80, oy: 80 };
    this.sel = new Set();
    this.pointers = new Map();
    this.action = null;
    this.rectMode = false;
    this.cache = null;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e, true));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // iOS: Gesten-Events von Safari abfangen
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(t, e => e.preventDefault());
    this.resize();
  }

  setCircuit(c) { this.circuit = c; this.sel.clear(); this.invalidate(); this.hooks.onSelect?.(); }
  invalidate() { this.cache = null; this.redraw(); }
  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); });
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.w = r.width; this.h = r.height;
    this.render();
  }

  // ---------- Koordinaten ----------
  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.s, y: (sy - this.view.oy) / this.view.s }; }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  centerWorld() { return this.toWorld(this.w / 2, this.h / 2); }

  fit() {
    const c = this.circuit; if (!c) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of c.comps) { const b = boundsWorld(k); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    for (const w of c.wires) { x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2); }
    if (!isFinite(x0)) { this.view = { s: 1.6, ox: 80, oy: 80 }; this.redraw(); return; }
    const pad = 60;
    const s = Math.min(3, Math.max(0.25, Math.min((this.w - pad) / (x1 - x0 + 40), (this.h - pad) / (y1 - y0 + 40))));
    this.view = { s, ox: this.w / 2 - ((x0 + x1) / 2) * s, oy: this.h / 2 - ((y0 + y1) / 2) * s };
    this.redraw();
  }
  zoomBy(f, sx = this.w / 2, sy = this.h / 2) {
    const v = this.view, ns = Math.min(5, Math.max(0.2, v.s * f));
    const wx = (sx - v.ox) / v.s, wy = (sy - v.oy) / v.s;
    this.view = { s: ns, ox: sx - wx * ns, oy: sy - wy * ns };
    this.redraw();
  }

  // ---------- Treffer ----------
  tol(e) { return (e.pointerType === 'mouse' ? 7 : 16) / this.view.s; }
  hitPin(p, tol) {
    let best = null, bd = tol;
    for (const c of this.circuit.comps) for (const q of pinsWorld(c)) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bd) { bd = d; best = { x: q.x, y: q.y, c, pin: q }; }
    }
    for (const w of this.circuit.wires) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) { bd = d; best = { x, y, wire: w }; }
    }
    return best;
  }
  hitComp(p) {
    const cs = this.circuit.comps;
    for (let i = cs.length - 1; i >= 0; i--) {
      const b = boundsWorld(cs[i]);
      if (p.x >= b.x0 - 3 && p.x <= b.x1 + 3 && p.y >= b.y0 - 3 && p.y <= b.y1 + 3) return cs[i];
    }
    return null;
  }
  hitWire(p, tol) {
    let best = null, bd = tol;
    for (const w of this.circuit.wires) {
      const d = segDist(p.x, p.y, w);
      if (d <= bd) { bd = d; best = w; }
    }
    return best;
  }

  // ---------- Zeiger-Ereignisse ----------
  down(e) {
    e.preventDefault();
    this.cv.setPointerCapture(e.pointerId);
    const sp = this.local(e);
    this.pointers.set(e.pointerId, { ...sp });
    if (this.pointers.size === 2) {
      // Pinch-Zoom: laufende Aktion abbrechen
      if (this.action?.kind === 'wire') this.action = null;
      if (this.action?.kind === 'simpress') this.releaseSim();
      const [a, b] = [...this.pointers.values()];
      this.action = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: mid(a, b), v0: { ...this.view } };
      return;
    }
    if (this.pointers.size > 2) return;
    const w = this.toWorld(sp.x, sp.y);
    const tol = this.tol(e);
    const base = { sx: sp.x, sy: sp.y, w, moved: false, pointerType: e.pointerType };

    if (this.sim) {
      const c = this.hitComp(w);
      if (c && DEF[c.type].interactive) {
        const def = DEF[c.type], st = this.sim.st(c);
        if (def.press) { def.press(st, attrsOf(c)); this.sim.update(c); this.redraw(); }
        this.action = { ...base, kind: 'simpress', c };
        return;
      }
      this.action = { ...base, kind: 'pan', v0: { ...this.view } };
      return;
    }

    if (this.rectMode || (e.pointerType === 'mouse' && e.shiftKey && !this.hitComp(w))) {
      this.action = { ...base, kind: 'rect', add: e.shiftKey };
      return;
    }
    const pin = this.hitPin(w, tol);
    const comp = this.hitComp(w);
    if (pin && !(pin.wire && this.sel.has(pin.wire))) {
      this.action = { ...base, kind: 'wire', sx0: pin.x, sy0: pin.y, ex: pin.x, ey: pin.y, hFirst: null, sh: pinH(pin), eh: null };
      return;
    }
    if (comp) {
      if (!this.sel.has(comp)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(comp); this.hooks.onSelect?.(); }
      this.action = { ...base, kind: 'move' };
      this.redraw();
      return;
    }
    const wire = this.hitWire(w, tol);
    if (wire) {
      if (this.sel.has(wire)) { this.action = { ...base, kind: 'move' }; return; }
      this.action = { ...base, kind: 'wireOrSelect', wire, sx0: snap(w.x), sy0: snap(w.y) };
      return;
    }
    this.action = { ...base, kind: 'panOrTap', v0: { ...this.view } };
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') this.hover(e);
      return;
    }
    const sp = this.local(e);
    this.pointers.set(e.pointerId, sp);
    const a = this.action; if (!a) return;
    if (a.kind === 'pinch') {
      const [p, q] = [...this.pointers.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y), m = mid(p, q);
      const s = Math.min(5, Math.max(0.2, a.v0.s * d / a.d0));
      const wx = (a.m0.x - a.v0.ox) / a.v0.s, wy = (a.m0.y - a.v0.oy) / a.v0.s;
      this.view = { s, ox: m.x - wx * s, oy: m.y - wy * s };
      this.redraw();
      return;
    }
    const dist = Math.hypot(sp.x - a.sx, sp.y - a.sy);
    const thr = a.pointerType === 'mouse' ? 3 : 8;
    if (!a.moved && dist > thr) {
      a.moved = true;
      if (a.kind === 'panOrTap') a.kind = 'pan';
      if (a.kind === 'wireOrSelect') Object.assign(a, { kind: 'wire', ex: a.sx0, ey: a.sy0, hFirst: null });
      if (a.kind === 'move') this.startMove(a);
    }
    if (!a.moved) return;
    const w = this.toWorld(sp.x, sp.y);
    if (a.kind === 'pan' || (a.kind === 'simpress' && !DEF[a.c.type].press)) {
      const v0 = a.v0 || { ...this.view }; a.v0 = v0;
      this.view = { s: v0.s, ox: v0.ox + sp.x - a.sx, oy: v0.oy + sp.y - a.sy };
      this.redraw();
    } else if (a.kind === 'wire') {
      const pin = this.hitPin(w, this.tol(e));
      a.ex = pin ? pin.x : snap(w.x); a.ey = pin ? pin.y : snap(w.y);
      a.eh = pin ? pinH(pin) : null;
      if (a.hFirst === null && (a.ex !== a.sx0 || a.ey !== a.sy0)) a.hFirst = Math.abs(w.x - a.sx0) >= Math.abs(w.y - a.sy0);
      this.redraw();
    } else if (a.kind === 'move') {
      const dx = snap(w.x - a.w.x), dy = snap(w.y - a.w.y);
      if (dx !== a.dx || dy !== a.dy) { a.dx = dx; a.dy = dy; this.applyMove(a); this.invalidate(); }
    } else if (a.kind === 'rect') {
      a.cur = w; this.redraw();
    }
  }

  up(e, cancel) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const a = this.action;
    if (a?.kind === 'pinch') { if (this.pointers.size === 0) this.action = null; return; }
    if (this.pointers.size) return;
    this.action = null;
    if (!a || cancel) { if (a?.kind === 'simpress') this.releaseSim(a); this.redraw(); return; }
    switch (a.kind) {
      case 'simpress': {
        const def = DEF[a.c.type], st = this.sim.st(a.c);
        if (def.release) { def.release(st); this.sim.update(a.c); }
        else if (!a.moved && def.tap) {
          const res = def.tap(st, attrsOf(a.c), this.sim, a.c);
          if (res === 'askValue') this.hooks.askValue?.(a.c);
          else this.sim.update(a.c);
        }
        this.hooks.onSimChange?.();
        break;
      }
      case 'panOrTap':
        if (this.sel.size) { this.sel.clear(); this.hooks.onSelect?.(); }
        break;
      case 'wireOrSelect':
        this.sel.clear(); this.sel.add(a.wire); this.hooks.onSelect?.();
        break;
      case 'wire': {
        const pts = this.wirePath(a);
        let added = 0;
        for (let i = 0; i < pts.length - 1; i++) if (this.circuit.addWire(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) added++;
        if (added) { this.circuit.cleanup(); this.hooks.onChange?.(); }
        break;
      }
      case 'move':
        if (a.moved && (a.dx || a.dy)) { this.orthogonalize(a); this.circuit.cleanup(); this.hooks.onChange?.(); }
        break;
      case 'rect': {
        if (!a.cur) { this.sel.clear(); this.hooks.onSelect?.(); break; }
        const x0 = Math.min(a.w.x, a.cur.x), x1 = Math.max(a.w.x, a.cur.x), y0 = Math.min(a.w.y, a.cur.y), y1 = Math.max(a.w.y, a.cur.y);
        if (!a.add) this.sel.clear();
        const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        for (const c of this.circuit.comps) { const b = boundsWorld(c); if (inR(b.x0, b.y0) && inR(b.x1, b.y1)) this.sel.add(c); }
        for (const w of this.circuit.wires) if (inR(w.x1, w.y1) && inR(w.x2, w.y2)) this.sel.add(w);
        this.hooks.onSelect?.();
        break;
      }
    }
    this.invalidate();
  }

  releaseSim(a) {
    const act = a || this.action;
    if (act?.kind === 'simpress' && DEF[act.c.type].release) { DEF[act.c.type].release(this.sim.st(act.c)); this.sim.update(act.c); }
  }

  hover(e) {
    if (this.sim) { const c = this.hitComp(this.toWorld(...Object.values(this.local(e)))); this.cv.style.cursor = c && DEF[c.type].interactive ? 'pointer' : 'grab'; return; }
    const w = this.toWorld(...Object.values(this.local(e)));
    const pin = this.hitPin(w, 7 / this.view.s);
    this.cv.style.cursor = pin ? 'crosshair' : this.hitComp(w) || this.hitWire(w, 6 / this.view.s) ? 'move' : 'default';
  }

  wheel(e) {
    e.preventDefault();
    const sp = this.local(e);
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.deltaX) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sp.x, sp.y);
    else { this.view.ox -= e.deltaX; this.view.oy -= e.deltaY; this.redraw(); }
  }

  wirePath(a) {
    const { sx0: x0, sy0: y0, ex: x1, ey: y1, sh, eh } = a;
    if (x0 === x1 || y0 === y1) return [[x0, y0], [x1, y1]];
    if (sh != null && eh != null && sh === eh) {
      // Anschluss zu Anschluss: Z-Form
      if (sh) { const mx = snap((x0 + x1) / 2); return [[x0, y0], [mx, y0], [mx, y1], [x1, y1]]; }
      const my = snap((y0 + y1) / 2); return [[x0, y0], [x0, my], [x1, my], [x1, y1]];
    }
    let hFirst = a.hFirst !== false;
    if (eh != null) hFirst = !eh; else if (sh != null) hFirst = sh;
    return hFirst ? [[x0, y0], [x1, y0], [x1, y1]] : [[x0, y0], [x0, y1], [x1, y1]];
  }

  startMove(a) {
    const comps = [...this.sel].filter(x => x.type), wires = [...this.sel].filter(x => !x.type);
    const pts = new Map();
    for (const c of comps) for (const p of pinsWorld(c)) pts.set(p.x + ',' + p.y, pinH({ c, pin: p }));
    for (const w of wires) { pts.set(w.x1 + ',' + w.y1, null); pts.set(w.x2 + ',' + w.y2, null); }
    const attached = [];
    for (const w of this.circuit.wires) {
      if (this.sel.has(w)) continue;
      const k1 = w.x1 + ',' + w.y1, k2 = w.x2 + ',' + w.y2;
      if (pts.has(k1)) attached.push({ w, e: 1, x: w.x1, y: w.y1, h: pts.get(k1) ?? w.y1 === w.y2 });
      if (pts.has(k2)) attached.push({ w, e: 2, x: w.x2, y: w.y2, h: pts.get(k2) ?? w.y1 === w.y2 });
    }
    a.comps = comps.map(c => ({ c, x: c.x, y: c.y }));
    a.wires = wires.map(w => ({ w, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }));
    a.attached = attached; a.dx = 0; a.dy = 0;
  }
  // Schräg gewordene Leitungen in zwei rechtwinklige Stücke zerlegen
  orthogonalize(a) {
    for (const o of a.attached) {
      const w = o.w;
      if (w.x1 === w.x2 || w.y1 === w.y2) continue;
      const mx = w['x' + o.e], my = w['y' + o.e];
      const f = o.e === 1 ? 2 : 1, fx = w['x' + f], fy = w['y' + f];
      const [cx, cy] = o.h ? [fx, my] : [mx, fy];
      // Hat die Leitung am festen Ende schon einen Knick? Dann den Knickpunkt verschieben.
      const pinAt = this.circuit.comps.some(c => pinsWorld(c).some(p => p.x === fx && p.y === fy));
      const others = this.circuit.wires.filter(v => v !== w && ((v.x1 === fx && v.y1 === fy) || (v.x2 === fx && v.y2 === fy)));
      if (!pinAt && others.length === 1) {
        const v = others[0], ve = v.x1 === fx && v.y1 === fy ? 1 : 2;
        if (o.h ? v.x1 === v.x2 : v.y1 === v.y2) {
          v['x' + ve] = cx; v['y' + ve] = cy;
          w['x' + f] = cx; w['y' + f] = cy;
          continue;
        }
      }
      w['x' + o.e] = cx; w['y' + o.e] = cy;
      this.circuit.addWire(cx, cy, mx, my);
    }
  }
  applyMove(a) {
    for (const o of a.comps) { o.c.x = o.x + a.dx; o.c.y = o.y + a.dy; }
    for (const o of a.wires) { o.w.x1 = o.x1 + a.dx; o.w.y1 = o.y1 + a.dy; o.w.x2 = o.x2 + a.dx; o.w.y2 = o.y2 + a.dy; }
    for (const o of a.attached) { o.w['x' + o.e] = o.x + a.dx; o.w['y' + o.e] = o.y + a.dy; }
  }

  // ---------- Zeichnen ----------
  nets() {
    if (!this.cache) this.cache = { nets: buildNets(this.circuit), junctions: junctions(this.circuit) };
    return this.cache;
  }

  render() {
    const ctx = this.ctx, { s, ox, oy } = this.view, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.sim ? '#f3f7f3' : COL.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.circuit) return;
    // Raster
    const step = s * S >= 9 ? S : S * 5;
    const gx0 = Math.floor(-ox / s / step) * step, gy0 = Math.floor(-oy / s / step) * step;
    ctx.fillStyle = COL.grid;
    const ds = Math.max(1, Math.min(2, s));
    for (let x = gx0; x * s + ox < this.w; x += step) for (let y = gy0; y * s + oy < this.h; y += step) ctx.fillRect(x * s + ox - ds / 2, y * s + oy - ds / 2, ds, ds);

    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const { nets: netInfo, junctions: junc } = this.nets();
    const sim = this.sim;

    // Auswahl hinterlegen
    for (const it of this.sel) {
      if (it.type) {
        const b = boundsWorld(it);
        ctx.fillStyle = COL.selFill; ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5 / s * 1.5;
        roundRect(ctx, b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 12, b.y1 - b.y0 + 12, 6); ctx.fill(); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(37,99,235,0.35)'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
      }
    }

    // Drähte
    const busLabels = [];
    for (const w of this.circuit.wires) {
      const net = sim ? sim.netOfWire(w) : netInfo.nets[netInfo.wireNet.get(w.id)];
      const bits = net?.bits || 1;
      let col = COL.wire;
      if (sim) {
        if (net.error) col = COL.err;
        else if (net.value == null) col = COL.z;
        else if (bits > 1) col = COL.bus;
        else col = net.value ? COL.high : COL.low;
        if (bits > 1 && !busLabels.some(b => b.net === net)) busLabels.push({ net, w });
      } else if (net?.error === 'bits') col = COL.err;
      ctx.strokeStyle = col; ctx.lineWidth = bits > 1 ? 4.5 : 2.5;
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    }
    ctx.fillStyle = sim ? '#333' : COL.wire;
    for (const [x, y] of junc) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }

    // Bauteile
    const texts = [];
    for (const c of this.circuit.comps) this.drawComp(ctx, c, texts, sim ? sim.st(c) : null);

    // Pins
    if (!sim) {
      for (const c of this.circuit.comps) for (const p of pinsWorld(c)) {
        ctx.fillStyle = p.out ? COL.pinOut : COL.pinIn;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Texte
    for (const t of texts) drawText(ctx, t);
    // Bus-Werte
    if (sim) for (const { net, w } of busLabels) {
      if (net.value == null) continue;
      const x = (w.x1 + w.x2) / 2, y = (w.y1 + w.y2) / 2;
      drawText(ctx, { x: x + 3, y: y - 4, str: formatValue(net.value, net.bits, 'def'), hx: 1, hy: -1, size: 11, kind: 'bus' });
    }

    // Draht-Vorschau
    const a = this.action;
    if (a?.kind === 'wire') {
      const pts = this.wirePath(a);
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.sel;
      for (const p of [pts[0], pts[pts.length - 1]]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill(); }
    }
    if (a?.kind === 'rect' && a.cur) {
      ctx.fillStyle = COL.selFill; ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.fillRect(a.w.x, a.w.y, a.cur.x - a.w.x, a.cur.y - a.w.y);
      ctx.strokeRect(a.w.x, a.w.y, a.cur.x - a.w.x, a.cur.y - a.w.y);
      ctx.setLineDash([]);
    }
  }

  drawComp(ctx, c, texts, st) {
    const def = DEF[c.type]; if (!def) return;
    const a = attrsOf(c), g = geoOf(c), r = c.rot || 0;
    const [sn, cs] = [[0, 1], [1, 0], [0, -1], [-1, 0]][r & 3];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.transform(cs, -sn, sn, cs, 0, 0);
    ctx.lineWidth = 2; ctx.strokeStyle = COL.fg; ctx.fillStyle = COL.body;
    const R = makeRenderer(ctx, c, texts);
    try { def.draw(R, c, a, g, st); } catch (err) { console.error(err); }
    ctx.restore();
  }

  // Bild der Schaltung (PNG) für Export
  snapshot() { return this.cv.toDataURL('image/png'); }
}

// Kleine Vorschau eines Bauteils (Palette)
export function drawPreview(canvas, type, attrs = {}) {
  const c = { id: -1, type, x: 0, y: 0, rot: 0, attrs };
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 64, H = canvas.clientHeight || 44;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  const b = boundsWorld(c);
  const pad = 6;
  const s = Math.min(0.78, (W - 2 * pad) / (b.x1 - b.x0 + 4), (H - 2 * pad) / (b.y1 - b.y0 + 4));
  const ox = W / 2 - ((b.x0 + b.x1) / 2) * s, oy = H / 2 - ((b.y0 + b.y1) / 2) * s;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const texts = [];
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = COL.fg; ctx.fillStyle = COL.body;
  DEF[type].draw(makeRenderer(ctx, c, texts), c, attrsOf(c), geoOf(c), null);
  ctx.restore();
  for (const t of texts) if (t.kind !== 'label' && t.kind !== 'name') drawText(ctx, t);
  for (const p of pinsWorld(c)) { ctx.fillStyle = p.out ? COL.pinOut : COL.pinIn; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); }
}

function makeRenderer(ctx, c, texts) {
  const fill = (f, stroke = true) => { if (f !== null) { ctx.fillStyle = f || COL.body; ctx.fill(); } if (stroke) ctx.stroke(); };
  return {
    ctx,
    rect(x0, y0, x1, y1, doFill = true, f) { ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); fill(doFill ? f : null); },
    line(x1, y1, x2, y2, lw) { ctx.save(); if (lw) ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); },
    poly(pts, closed = true, stroke = null, lw = null, f) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
      if (closed) ctx.closePath();
      if (stroke) ctx.strokeStyle = stroke;
      if (lw) ctx.lineWidth = lw;
      if (closed) { ctx.fillStyle = f || COL.body; ctx.fill(); }
      if (lw !== 0) ctx.stroke();
      ctx.restore();
    },
    circle(x, y, rad, f, noStroke) { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); fill(f, !noStroke); },
    // Negationskreis am Ausgang: klein am Körper, Stummel bis zum Anschluss
    invOut(bx, y, px) { ctx.beginPath(); ctx.arc(bx + 5, y, 5, 0, Math.PI * 2); fill(COL.body); ctx.beginPath(); ctx.moveTo(bx + 10, y); ctx.lineTo(px, y); ctx.stroke(); },
    invIn(y) { ctx.beginPath(); ctx.moveTo(-S, y); ctx.lineTo(-10, y); ctx.stroke(); ctx.beginPath(); ctx.arc(-5, y, 5, 0, Math.PI * 2); fill(COL.body); },
    rrect(x0, y0, x1, y1, rad, f, noStroke) { roundRect(ctx, x0, y0, x1 - x0, y1 - y0, Math.min(rad, (y1 - y0) / 2, (x1 - x0) / 2)); fill(f, !noStroke); },
    path(fn, closed = true) { ctx.beginPath(); fn(ctx); fill(closed ? COL.body : null); },
    text(x, y, str, hx, hy, size, kind) {
      if (str === '' || str == null) return;
      const [px, py] = rot(x, y, c.rot || 0);
      const [ax, ay] = rot(hx, hy, c.rot || 0);
      texts.push({ x: px + c.x, y: py + c.y, str: String(str), hx: ax, hy: ay, size, kind });
    },
    valueColor(v, bits) { return v == null ? COL.z : bits > 1 ? COL.bus : v ? COL.high : COL.low; },
  };
}

const KIND = {
  label: ['600', '#1e3a8a'], symbol: ['700', COL.fg], name: ['400', '#6b7280'], value: ['700', COL.fg],
  pinlabel: ['400', '#4b5563'], valueDark: ['700', '#064e1b'], valueLight: ['700', '#ffffff'], text: ['400', COL.fg], bus: ['700', COL.bus],
};
function drawText(ctx, t) {
  const [weight, color] = KIND[t.kind] || ['400', COL.fg];
  ctx.font = `${weight} ${t.size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = t.hx < 0 ? 'right' : t.hx > 0 ? 'left' : 'center';
  ctx.textBaseline = t.hy < 0 ? 'bottom' : t.hy > 0 ? 'top' : 'middle';
  let s = t.str, over = false;
  if (s.startsWith('~')) { s = s.slice(1); over = true; }
  ctx.fillText(s, t.x, t.y);
  if (over) {
    const m = ctx.measureText(s);
    const x0 = t.hx < 0 ? t.x - m.width : t.hx > 0 ? t.x : t.x - m.width / 2;
    const yTop = t.hy < 0 ? t.y - t.size : t.hy > 0 ? t.y : t.y - t.size / 2;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, yTop + 0.5); ctx.lineTo(x0 + m.width, yTop + 0.5); ctx.stroke(); ctx.restore();
  }
}

function segDist(x, y, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l = dx * dx + dy * dy;
  let t = l ? ((x - w.x1) * dx + (y - w.y1) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy));
}
// Läuft die Leitung an diesem Anschluss waagerecht an? (null = kein Bauteil-Anschluss)
function pinH(hit) {
  if (!hit?.pin) return null;
  return ((hit.c.rot || 0) & 1) === 0 ? !hit.pin.vert : !!hit.pin.vert;
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export { COL };
