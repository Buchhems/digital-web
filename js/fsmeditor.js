// Automaten-Editor (Moore- und Mealy-Automat): Zustände und Übergänge per Touch/Stift/Maus
import { fsmTable, fsmCircuit, isMealy } from './seq.js';
import { parseExpr, toHTML, toText, OV } from './synth.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const R = 36;
const KEY = 'digitalweb.v1.fsm';
const ident = s => String(s).split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*$/.test(x));

export function defaultFsm() {
  return { inputs: ['E'], outputs: ['Y'], nextId: 2, states: [{ id: 1, name: 'S0', x: 160, y: 180, out: {}, initial: true }], trans: [] };
}

export class FsmEditor {
  constructor(app) {
    this.app = app; // {toast, openDialog, closeDialog, onBuild(circuit, table)}
    try { this.fsm = JSON.parse(localStorage.getItem(KEY)) || defaultFsm(); } catch { this.fsm = defaultFsm(); }
    this.sel = null; this.mode = 'move';
    this.el = document.createElement('div');
    this.el.id = 'fsm';
    this.el.innerHTML = `
      <header class="fsm-bar">
        <b class="fsm-title">Automaten-Editor</b>
        <label>Eingänge <input id="fsmIn" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
        <label>Ausgänge <input id="fsmOut" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
        <span class="spacer"></span>
        <button class="btn" id="fsmAdd">＋ Zustand</button>
        <button class="btn toggle" id="fsmMode">↗ Übergang</button>
        <button class="btn" id="fsmTable">Tabelle</button>
        <button class="btn primary" id="fsmBuild">Schaltung erzeugen</button>
        <button class="btn" id="fsmMore" title="Neu, Beispiele, Austausch">⋯</button>
        <button class="btn" id="fsmClose" title="Schließen">✕</button>
      </header>
      <div class="fsm-main"><svg id="fsmSvg"></svg><aside id="fsmSide"></aside></div>`;
    document.body.appendChild(this.el);
    this.svg = this.el.querySelector('#fsmSvg');
    this.side = this.el.querySelector('#fsmSide');
    const $ = s => this.el.querySelector(s);
    $('#fsmIn').onchange = e => { this.fsm.inputs = [...new Set(ident(e.target.value))]; this.changed(); };
    $('#fsmOut').onchange = e => { const o = [...new Set(ident(e.target.value))]; this.fsm.outputs = o; this.changed(); };
    $('#fsmAdd').onclick = () => this.addState();
    $('#fsmMode').onclick = () => { this.mode = this.mode === 'move' ? 'trans' : 'move'; $('#fsmMode').classList.toggle('on', this.mode === 'trans'); this.render(); };
    $('#fsmTable').onclick = () => this.showTable();
    $('#fsmBuild').onclick = () => this.build();
    $('#fsmClose').onclick = () => this.close();
    $('#fsmMore').onclick = () => this.more();
    this.svg.addEventListener('pointerdown', e => this.down(e));
    this.svg.addEventListener('pointermove', e => this.move(e));
    this.svg.addEventListener('pointerup', e => this.up(e));
    this.svg.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    new ResizeObserver(() => this.renderSvg()).observe(this.svg);
  }

  open() { this.el.classList.add('open'); this.syncFields(); this.render(); }
  close() { this.el.classList.remove('open'); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.fsm)); } catch { } }
  changed() { this.save(); this.syncFields(); this.render(); }
  syncFields() {
    const i = this.el.querySelector('#fsmIn'), o = this.el.querySelector('#fsmOut');
    if (document.activeElement !== i) i.value = this.fsm.inputs.join(' ');
    if (document.activeElement !== o) o.value = this.fsm.outputs.join(' ');
  }

  addState(x, y) {
    const f = this.fsm, W = this.svg.clientWidth || 600, H = this.svg.clientHeight || 400;
    let n = f.states.length;
    const names = new Set(f.states.map(s => s.name));
    while (names.has('S' + n)) n++;
    if (x == null) {
      // freien Platz suchen
      const cand = [];
      for (let yy = 100; yy < H - 60; yy += 120) for (let xx = 120; xx < W - 60; xx += 150) cand.push([xx, yy]);
      const free = cand.find(([a, b]) => f.states.every(s => Math.hypot(s.x - a, s.y - b) > 110)) || [W / 2, H / 2];
      [x, y] = free;
    }
    const s = { id: f.nextId++, name: 'S' + n, x, y, out: {}, initial: !f.states.length };
    f.states.push(s);
    this.sel = { type: 'state', id: s.id };
    this.changed();
  }

  // ---------- Zeiger ----------
  pt(e) { const r = this.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  nodeAt(p) { return [...this.fsm.states].reverse().find(s => Math.hypot(s.x - p.x, s.y - p.y) <= R + 6); }
  down(e) {
    const ae = document.activeElement; if (ae && /INPUT|TEXTAREA/.test(ae.tagName)) ae.blur();
    const p = this.pt(e);
    const edge = e.target.closest('[data-edge]');
    const node = this.nodeAt(p);
    this.svg.setPointerCapture(e.pointerId);
    if (node && this.mode === 'trans') { this.drag = { kind: 'link', from: node, p }; this.render(); return; }
    if (node) { this.sel = { type: 'state', id: node.id }; this.drag = { kind: 'move', node, dx: node.x - p.x, dy: node.y - p.y, moved: false }; this.render(); return; }
    if (edge) { this.sel = { type: 'trans', id: +edge.dataset.edge }; this.drag = null; this.render(); return; }
    this.sel = null; this.drag = null; this.render();
  }
  move(e) {
    const d = this.drag; if (!d) return;
    const p = this.pt(e);
    if (d.kind === 'move') {
      d.node.x = Math.round((p.x + d.dx) / 10) * 10; d.node.y = Math.round((p.y + d.dy) / 10) * 10;
      d.moved = true; this.renderSvg();
    } else if (d.kind === 'link') { d.p = p; this.renderSvg(); }
  }
  up(e) {
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.kind === 'move' && d.moved) this.save();
    if (d.kind === 'link') {
      const to = this.nodeAt(this.pt(e));
      if (to) {
        const t = { id: this.fsm.nextId++, from: d.from.id, to: to.id, cond: this.fsm.inputs[0] || '' };
        this.fsm.trans.push(t);
        this.sel = { type: 'trans', id: t.id };
        this.save();
      }
    }
    this.render();
  }

  // ---------- Zeichnen ----------
  render() { this.renderSvg(); this.renderSide(); }
  renderSvg() {
    const f = this.fsm, W = this.svg.clientWidth, H = this.svg.clientHeight;
    if (!W) return;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const byId = new Map(f.states.map(s => [s.id, s]));
    let s = `<defs><marker id="farr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker>
      <marker id="farrSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2563eb"/></marker></defs>`;
    // Beschriftung als SVG-Text; Negation mit kombinierendem Überstrich (zuverlässig auch in Safari)
    const label = (x, y, c, sel) => {
      let txt, fill = sel ? '#2563eb' : '#111827', style = '';
      if (!c.trim()) { txt = 'immer'; fill = '#6b7280'; style = 'font-style:italic'; }
      else { try { txt = toText(parseExpr(c)); } catch { txt = c; fill = '#dc2626'; } }
      return `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="600" fill="${fill}" stroke="#f7f7f4" stroke-width="5" paint-order="stroke" style="${style}" pointer-events="none">${esc(txt)}</text>`;
    };
    // Übergänge
    const groups = new Map();
    for (const t of f.trans) { const k = t.from + '>' + t.to; groups.set(k, (groups.get(k) || 0) + 1); }
    const idx = new Map();
    for (const t of f.trans) {
      const a = byId.get(t.from), b = byId.get(t.to); if (!a || !b) continue;
      const key = t.from + '>' + t.to, i = idx.get(key) || 0; idx.set(key, i + 1);
      const sel = this.sel?.type === 'trans' && this.sel.id === t.id;
      const stroke = sel ? '#2563eb' : '#374151', mk = sel ? 'farrSel' : 'farr';
      let d, lx, ly;
      if (a === b) {
        const spread = 1 + i * 0.5;
        const p1 = { x: a.x - R * 0.55, y: a.y - R * 0.83 }, p2 = { x: a.x + R * 0.55, y: a.y - R * 0.83 };
        d = `M${p1.x},${p1.y} C${a.x - R * 1.3 * spread},${a.y - R * 2.7 * spread} ${a.x + R * 1.3 * spread},${a.y - R * 2.7 * spread} ${p2.x},${p2.y}`;
        lx = a.x; ly = a.y - R * 2.2 * spread - 6;
      } else {
        const back = groups.has(t.to + '>' + t.from);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const bend = (back ? 30 : 0) + i * 34;
        const mx = (a.x + b.x) / 2 - uy * bend, my = (a.y + b.y) / 2 + ux * bend;
        const off = back ? 9 : 0;
        const sa = { x: a.x + ux * R - uy * off, y: a.y + uy * R + ux * off }, eb = { x: b.x - ux * (R + 2) - uy * off, y: b.y - uy * (R + 2) + ux * off };
        d = `M${sa.x},${sa.y} Q${mx},${my} ${eb.x},${eb.y}`;
        lx = (sa.x + 2 * mx + eb.x) / 4 - uy * 12; ly = (sa.y + 2 * my + eb.y) / 4 + ux * 12;
      }
      s += `<path d="${d}" fill="none" stroke="transparent" stroke-width="26" data-edge="${t.id}" style="cursor:pointer"/>`;
      s += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sel ? 3 : 2}" marker-end="url(#${mk})" pointer-events="none"/>`;
      s += label(lx, ly, t.cond, sel);
      const tOuts = f.outputs.filter(o => t.out?.[o]);
      if (tOuts.length) s += `<text x="${lx}" y="${ly + 22}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#b45309" stroke="#f7f7f4" stroke-width="4" paint-order="stroke" pointer-events="none">/ ${esc(tOuts.join(','))}=1</text>`;
    }
    // Zustände
    for (const st of f.states) {
      const sel = this.sel?.type === 'state' && this.sel.id === st.id;
      if (st.initial) s += `<path d="M${st.x - R - 34},${st.y} L${st.x - R - 3},${st.y}" stroke="#374151" stroke-width="2" marker-end="url(#farr)"/>`;
      s += `<circle cx="${st.x}" cy="${st.y}" r="${R}" fill="${sel ? '#eef4ff' : '#fff'}" stroke="${sel ? '#2563eb' : '#1e3a8a'}" stroke-width="${sel ? 3.5 : 2.2}" style="cursor:${this.mode === 'trans' ? 'crosshair' : 'grab'}"/>`;
      const outs = f.outputs.filter(o => st.out?.[o]);
      s += `<text x="${st.x}" y="${st.y + (f.outputs.length ? -4 : 5)}" text-anchor="middle" font-size="16" font-weight="700" fill="#1e3a8a" pointer-events="none">${esc(st.name)}</text>`;
      if (f.outputs.length) s += `<text x="${st.x}" y="${st.y + 15}" text-anchor="middle" font-size="11.5" fill="#b45309" pointer-events="none">${esc(outs.length ? outs.join(',') + '=1' : '–')}</text>`;
    }
    if (this.drag?.kind === 'link') {
      const a = this.drag.from, p = this.drag.p;
      s += `<path d="M${a.x},${a.y} L${p.x},${p.y}" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="6 4" marker-end="url(#farrSel)"/>`;
    }
    if (!f.states.length) s += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#6b7280" font-size="15">„＋ Zustand“ tippen, um zu beginnen.</text>`;
    this.svg.innerHTML = s;
  }

  renderSide() {
    const f = this.fsm, side = this.side;
    const sel = this.sel;
    if (sel?.type === 'state') {
      const st = f.states.find(s => s.id === sel.id); if (!st) { this.sel = null; return this.renderSide(); }
      side.innerHTML = `<h2>Zustand</h2>
        <div class="field"><label>Name</label><input type="text" id="stName" value="${esc(st.name)}" autocomplete="off" spellcheck="false"></div>
        <label class="switch"><span>Startzustand</span><input type="checkbox" id="stInit" ${st.initial ? 'checked' : ''}></label>
        ${f.outputs.length ? `<div class="field" style="margin-top:12px"><label>Ausgänge in diesem Zustand</label><div class="chips">${f.outputs.map(o => `<button class="chip ${st.out?.[o] ? 'on' : ''}" data-o="${esc(o)}">${esc(o)} = ${st.out?.[o] ? 1 : 0}</button>`).join('')}</div></div>` : '<p class="muted">Lege oben Ausgänge an, um ihre Werte je Zustand festzulegen.</p>'}
        <p class="muted">Übergang von hier: „↗ Übergang“ einschalten und vom Zustand zum Ziel ziehen.</p>
        <div class="prop-actions"><button class="btn red" id="stDel" style="grid-column:span 2">Zustand löschen</button></div>`;
      side.querySelector('#stName').oninput = e => { st.name = e.target.value.trim() || st.name; this.save(); this.renderSvg(); };
      side.querySelector('#stInit').onchange = e => { f.states.forEach(s => (s.initial = false)); st.initial = e.target.checked || true; this.changed(); };
      side.querySelectorAll('[data-o]').forEach(b => (b.onclick = () => { st.out = st.out || {}; st.out[b.dataset.o] = st.out[b.dataset.o] ? 0 : 1; this.changed(); }));
      side.querySelector('#stDel').onclick = () => {
        f.states = f.states.filter(s => s !== st); f.trans = f.trans.filter(t => t.from !== st.id && t.to !== st.id);
        if (st.initial && f.states.length) f.states[0].initial = true;
        this.sel = null; this.changed();
      };
      return;
    }
    if (sel?.type === 'trans') {
      const t = f.trans.find(x => x.id === sel.id); if (!t) { this.sel = null; return this.renderSide(); }
      const a = f.states.find(s => s.id === t.from), b = f.states.find(s => s.id === t.to);
      side.innerHTML = `<h2>Übergang</h2><div class="sub">${esc(a?.name)} → ${esc(b?.name)}</div>
        <div class="field"><label>Bedingung</label><input type="text" id="trCond" class="formula-in" value="${esc(t.cond)}" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="leer = immer"></div>
        <div class="keys">${f.inputs.map(i => `<button class="chip" data-ins="${esc(i)}">${esc(i)}</button><button class="chip" data-ins="${esc([...i].map(c => c + OV).join(''))}"><span class="ov">${esc(i)}</span></button>`).join('')}
          <button class="chip" data-ins=" ∧ ">∧</button><button class="chip" data-ins=" ∨ ">∨</button><button class="chip" data-clear="1">leeren</button></div>
        <div class="expr" id="trPrev"></div>
        ${f.outputs.length ? `<div class="field" style="margin-top:12px"><label>Ausgänge bei diesem Übergang (Mealy)</label><div class="chips">${f.outputs.map(o => `<button class="chip ${t.out?.[o] ? 'on' : ''}" data-to="${esc(o)}">${esc(o)} = ${t.out?.[o] ? 1 : 0}</button>`).join('')}</div><div class="hint">Gesetzte Ausgänge sind 1, solange der Automat im Ausgangszustand ist und die Bedingung erfüllt ist.</div></div>` : ''}
        <p class="muted">Leer = Übergang immer. Gibt es für eine Eingabe keinen passenden Übergang, bleibt der Automat im Zustand.</p>
        <div class="prop-actions"><button class="btn red" id="trDel" style="grid-column:span 2">Übergang löschen</button></div>`;
      const inp = side.querySelector('#trCond');
      const prev = () => {
        const el = side.querySelector('#trPrev');
        if (!t.cond.trim()) { el.innerHTML = '<i class="always">immer</i>'; return; }
        try { el.innerHTML = toHTML(parseExpr(t.cond)); } catch (e) { el.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
      };
      prev();
      inp.oninput = () => { t.cond = inp.value; this.save(); prev(); this.renderSvg(); };
      side.querySelector('.keys').addEventListener('pointerdown', e => e.preventDefault());
      side.querySelector('.keys').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.clear) t.cond = '';
        else t.cond = (t.cond + b.dataset.ins).replace(/\s+/g, ' ').replace(/^\s+/, '');
        this.save(); this.render();
      };
      side.querySelectorAll('[data-to]').forEach(b => (b.onclick = () => { t.out = t.out || {}; t.out[b.dataset.to] = t.out[b.dataset.to] ? 0 : 1; this.changed(); }));
      side.querySelector('#trDel').onclick = () => { f.trans = f.trans.filter(x => x !== t); this.sel = null; this.changed(); };
      return;
    }
    // Übersicht mit Prüfung
    let check = '';
    try {
      const tb = fsmTable(f);
      const stays = tb.rows.filter(r => r.stay && f.trans.some(t => t.from === r.from.id)).length;
      check = tb.problems.length ? `<div class="note">${tb.problems.map(esc).join('<br>')}</div>`
        : `<div class="ok-note">✓ Der Automat ist eindeutig.${stays ? ` In ${stays} Fällen bleibt er mangels passendem Übergang im Zustand.` : ''}</div>`;
    } catch (e) { check = `<p class="muted">${esc(e.message)}</p>`; }
    const ffT = f.ffType || 'D';
    side.innerHTML = `<h2>${isMealy(f) ? 'Mealy' : 'Moore'}-Automat</h2>
      <p class="muted">${f.states.length} Zustände · ${f.trans.length} Übergänge</p>${check}
      <div class="field"><label>Flipflops für die Schaltung</label><div class="chips" id="ffType">${[['D', 'D-Flipflops'], ['JK', 'JK-Flipflops'], ['T', 'T-Flipflops']].map(([k, l]) => `<button class="chip ${ffT === k ? 'on' : ''}" data-ff="${k}">${l}</button>`).join('')}</div></div>
      <ul class="help-list">
        <li><b>Zustand:</b> „＋ Zustand“, dann verschieben. Antippen zeigt Name, Startzustand und Ausgänge.</li>
        <li><b>Übergang:</b> „↗ Übergang“ einschalten und von einem Zustand zum nächsten ziehen (zum selben Zustand = Schleife). Danach die Bedingung festlegen.</li>
        <li><b>Moore oder Mealy:</b> Ausgänge im Zustand festlegen (Moore) oder am Übergang (Mealy, Anzeige „/ Y=1“).</li>
        <li><b>Schaltung erzeugen:</b> Zustände werden binär codiert (Startzustand = 0…0) und mit den gewählten Flipflops umgesetzt. Die Logik wird minimiert (DMF).</li>
      </ul>`;
    side.querySelector('#ffType').onclick = e => { const k = e.target.dataset.ff; if (!k) return; f.ffType = k; this.changed(); };
  }

  more() {
    this.app.openDialog(`<div class="dialog"><h2>Automat <button class="close">✕</button></h2>
      <div class="menu-list">
        <button class="menu-item" data-a="new"><span class="ico">＋</span><span><b>Neuer Automat</b><small>Aktuellen verwerfen</small></span></button>
        <button class="menu-item" data-a="ex1"><span class="ico">⚡</span><span><b>Beispiel: 11-Erkenner</b><small>Y = 1 nach zwei Einsen</small></span></button>
        <button class="menu-item" data-a="ex2"><span class="ico">🚦</span><span><b>Beispiel: Ampel</b><small>Rot – Rotgelb – Grün – Gelb</small></span></button>
        <button class="menu-item" data-a="export"><span class="ico">⤓</span><span><b>Als Text kopieren</b><small>Zum Weitergeben (JSON)</small></span></button>
        <button class="menu-item" data-a="import"><span class="ico">⤒</span><span><b>Aus Text einfügen</b><small>Kopierten Automaten laden</small></span></button>
      </div></div>`);
    document.querySelector('#sheet').onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'new') this.fsm = defaultFsm();
      if (a === 'ex1') this.fsm = EX_11();
      if (a === 'ex2') this.fsm = EX_AMPEL();
      if (a === 'export') { try { await navigator.clipboard.writeText(JSON.stringify(this.fsm)); this.app.toast('Automat in die Zwischenablage kopiert.'); } catch { this.app.toast('Kopieren nicht möglich', true); } }
      if (a === 'import') {
        const txt = prompt('Automat (Text) einfügen:');
        try { const j = JSON.parse(txt); if (!j.states) throw 0; this.fsm = j; } catch { if (txt) this.app.toast('Kein gültiger Automat.', true); }
      }
      this.sel = null; this.app.closeDialog(); this.changed();
    };
  }

  showTable() {
    let tb;
    try { tb = fsmTable(this.fsm); } catch (e) { return this.app.toast(e.message, true); }
    const f = this.fsm, code = c => c.toString(2).padStart(tb.k, '0');
    const head = `<th>Zustand</th>${tb.qn.map(q => `<th class="step">${q}</th>`).join('')}${f.inputs.map(i => `<th>${esc(i)}</th>`).join('')}<th class="sepcol">Folgezustand</th>${tb.qn.map(q => `<th class="step">${q}⁺</th>`).join('')}${tb.ff !== 'D' ? tb.excNames.map((n, j) => `<th class="${j ? '' : 'sepcol'}">${n}</th>`).join('') : ''}${f.outputs.map((o, j) => `<th class="${j ? '' : 'sepcol'}">${esc(o)}</th>`).join('')}`;
    const body = tb.rows.map(r => `<tr><td><b>${esc(r.from.name)}</b></td>${[...code(r.code)].map(b => `<td class="step">${b}</td>`).join('')}${r.inBits.map(b => `<td>${b}</td>`).join('')}<td class="sepcol"><b>${esc(r.to.name)}</b>${r.stay && f.trans.some(t => t.from === r.from.id) ? ' <small class="muted">(bleibt)</small>' : ''}</td>${[...code(r.next)].map(b => `<td class="step">${b}</td>`).join('')}${tb.ff !== 'D' ? r.exc.map((v, j) => `<td class="${j ? '' : 'sepcol'} ${v === 'X' ? '' : v ? 'one' : 'zero'}">${v}</td>`).join('') : ''}${r.outs.map((v, j) => `<td class="${j ? '' : 'sepcol'} ${v ? 'one' : 'zero'}">${v}</td>`).join('')}</tr>`).join('');
    let eqs = '';
    try { const { defs } = fsmCircuit(f); eqs = '<h3>Gleichungen (DMF, unbenutzte Codes als X)</h3>' + defs.map(d => `<div class="expr"><b>${esc(d.name)}</b> = ${toHTML(d.ast)}</div>`).join(''); } catch { }
    this.app.openDialog(`<div class="dialog"><h2>Zustandsübergangstabelle <button class="close">✕</button></h2>
      ${tb.problems.length ? `<div class="note">${tb.problems.map(esc).join('<br>')}</div>` : ''}
      <p class="muted">Codierung: ${tb.states.map((s, i) => `${esc(s.name)} = ${code(i)}`).join(' · ')}</p>
      <div class="tt-wrap"><table class="tt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${eqs}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="fsmBuild2">Schaltung erzeugen</button></div></div>`, true);
    document.querySelector('#fsmBuild2').onclick = () => { this.app.closeDialog(); this.build(); };
  }

  build() {
    let res;
    try { res = fsmCircuit(this.fsm); } catch (e) { return this.app.toast(e.message, true, 5000); }
    this.close();
    this.app.onBuild(res.circuit);
  }
}

function EX_11() {
  const O = OV;
  return { inputs: ['E'], outputs: ['Y'], nextId: 20, states: [
    { id: 1, name: 'S0', x: 160, y: 280, out: { Y: 0 }, initial: true }, { id: 2, name: 'S1', x: 420, y: 150, out: { Y: 0 } }, { id: 3, name: 'S2', x: 420, y: 420, out: { Y: 1 } }],
    trans: [{ id: 4, from: 1, to: 2, cond: 'E' }, { id: 5, from: 1, to: 1, cond: 'E' + O }, { id: 6, from: 2, to: 3, cond: 'E' }, { id: 7, from: 2, to: 1, cond: 'E' + O }, { id: 8, from: 3, to: 3, cond: 'E' }, { id: 9, from: 3, to: 1, cond: 'E' + O }] };
}
function EX_AMPEL() {
  return { inputs: [], outputs: ['Rot', 'Gelb', 'Gruen'], nextId: 20, states: [
    { id: 1, name: 'rot', x: 200, y: 130, out: { Rot: 1 }, initial: true }, { id: 2, name: 'rotgelb', x: 460, y: 130, out: { Rot: 1, Gelb: 1 } },
    { id: 3, name: 'grün', x: 460, y: 330, out: { Gruen: 1 } }, { id: 4, name: 'gelb', x: 200, y: 330, out: { Gelb: 1 } }],
    trans: [{ id: 5, from: 1, to: 2, cond: '' }, { id: 6, from: 2, to: 3, cond: '' }, { id: 7, from: 3, to: 4, cond: '' }, { id: 8, from: 4, to: 1, cond: '' }] };
}
