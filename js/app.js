import { DEF, DEFS, CATEGORIES, attrsOf, settings, mask, formatValue, subInterface } from './components.js';
import { Circuit } from './circuit.js';
import { Sim } from './sim.js';
import { Editor, drawPreview } from './editor.js';
import { parseDig, writeDig, subName } from './dig.js';
import { truthTable } from './analysis.js';
import { kvSVG, KV_COLORS } from './kv.js';
import { parseEquations, buildCircuit, toHTML, toText, termsToAST } from './synth.js';
import { Recorder } from './graph.js';
import { runTest } from './testcase.js';
import { writeZip, readZip } from './zip.js';
import { library, touchLibrary, usesCircuit, dependencies } from './lib.js';
import { EXAMPLES } from './examples.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STORE = 'digitalweb.v1';

// ---------- Zustand ----------
// Ein Projekt besteht aus mehreren Schaltungen (library). Jede kann in den anderen als Baustein dienen.
let current = null;          // Name der geöffneten Schaltung
let circuit = null;
let navStack = [];           // für "Zurück" nach dem Öffnen eines Bausteins
let history = [], hIdx = -1;
let clockTimer = null;
const recorder = new Recorder();
let graphOpen = false;

const editor = new Editor($('#canvas'), {
  onChange: commit,
  onSelect: renderProps,
  askValue: c => askValue(c),
  onSimChange: () => recordSample(),
});

// ---------- Einstellungen ----------
try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE + '.settings') || '{}')); } catch { }
const saveSettings = () => { try { localStorage.setItem(STORE + '.settings', JSON.stringify(settings)); } catch { } };

// ---------- Projekt / Verlauf ----------
function snapshot() { return JSON.stringify(circuit.toJSON()); }
function commit() {
  history = history.slice(0, hIdx + 1);
  history.push(snapshot());
  if (history.length > 150) history.shift();
  hIdx = history.length - 1;
  touchLibrary();
  autosave(); updateUI();
  editor.invalidate();
}
function loadSnapshot(s) {
  circuit = Circuit.fromJSON(JSON.parse(s));
  library.set(current, circuit); touchLibrary();
  editor.setCircuit(circuit); autosave(); updateUI();
}
function undo() { if (hIdx > 0) { hIdx--; loadSnapshot(history[hIdx]); } }
function redo() { if (hIdx < history.length - 1) { hIdx++; loadSnapshot(history[hIdx]); } }
function autosave() {
  try {
    const docs = Object.fromEntries([...library].map(([n, c]) => [n, c.toJSON()]));
    localStorage.setItem(STORE, JSON.stringify({ v: 2, current, docs }));
  } catch { }
}
const cleanName = n => String(n || '').replace(/\.dig$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();
function uniqueName(base) {
  base = cleanName(base) || 'Schaltung';
  if (!library.has(base)) return base;
  for (let i = 2; ; i++) if (!library.has(`${base} ${i}`)) return `${base} ${i}`;
}
function setCurrent(name, { fit = true, keepNav = false } = {}) {
  stopSim();
  if (!keepNav) navStack = [];
  current = name; circuit = library.get(name);
  editor.setCircuit(circuit);
  history = [snapshot()]; hIdx = 0;
  buildPalette(); autosave(); updateUI(); renderProps();
  if (fit) requestAnimationFrame(() => editor.fit());
}
function addDoc(name, c, open = true) {
  const n = uniqueName(name);
  library.set(n, c); touchLibrary();
  if (open) setCurrent(n); else { autosave(); buildPalette(); }
  return n;
}
// Mehrere Schaltungen auf einmal hinzufügen; bei Namenskonflikten umbenennen und Verweise anpassen
function addDocsRenaming(docs) {
  const map = {};
  for (const n of Object.keys(docs)) map[n] = uniqueName(n);
  for (const [n, c] of Object.entries(docs)) {
    for (const k of c.comps) if (k.type === 'Sub' && map[k.sub]) k.sub = map[k.sub];
    library.set(map[n], c);
  }
  touchLibrary();
  return map;
}
function renameDoc(old, nu) {
  nu = cleanName(nu);
  if (!nu) return toast('Bitte einen Namen eingeben.', true), false;
  if (nu === old) return true;
  if (library.has(nu)) return toast(`„${nu}“ gibt es schon.`, true), false;
  const entries = [...library].map(([n, c]) => [n === old ? nu : n, c]);
  library.clear(); for (const [n, c] of entries) library.set(n, c);
  for (const c of library.values()) for (const k of c.comps) if (k.type === 'Sub' && k.sub === old) k.sub = nu;
  if (current === old) current = nu;
  navStack = navStack.map(n => (n === old ? nu : n));
  touchLibrary(); autosave(); buildPalette(); updateUI(); editor.invalidate();
  return true;
}
function usersOf(name) { return [...library.keys()].filter(n => n !== name && library.get(n).comps.some(k => k.type === 'Sub' && k.sub === name)); }

// ---------- Toast ----------
let toastT;
function toast(msg, error = false, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), ms);
}

// ---------- Palette ----------
const tileRO = new ResizeObserver(entries => {
  for (const e of entries) {
    const cv = e.target, t = cv.parentElement;
    if (cv.clientWidth && cv.clientHeight) drawPreview(cv, t.dataset.type, {}, t.dataset.sub);
  }
});
function buildPalette() {
  const pal = $('#palette');
  tileRO.disconnect();
  pal.innerHTML = '';
  const section = (title, items, extra) => {
    const h = document.createElement('h3'); h.textContent = title; pal.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'tiles'; pal.appendChild(grid);
    for (const it of items) {
      const t = document.createElement('div'); t.className = 'tile'; t.dataset.type = it.type;
      if (it.sub) t.dataset.sub = it.sub;
      const cv = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = it.name;
      t.append(cv, sp); grid.appendChild(t);
      setupTileDrag(t, it.type, it.sub);
      tileRO.observe(cv);
    }
    if (extra) pal.insertAdjacentHTML('beforeend', extra);
  };
  const subs = [...library.keys()].filter(n => n !== current && !usesCircuit(n, current) && (() => { const i = subInterface(library.get(n)); return i.ins.length + i.outs.length > 0; })());
  section('Eigene Bausteine', subs.map(n => ({ type: 'Sub', sub: n, name: n })),
    subs.length ? '' : '<p class="pal-hint">Jede andere Schaltung deines Projekts lässt sich hier als Baustein einsetzen. Tippe oben auf den Schaltungsnamen, um eine weitere anzulegen.</p>');
  for (const cat of CATEGORIES) section(cat, DEFS.filter(d => d.cat === cat));
}
function setupTileDrag(tile, type, sub) {
  let start = null, ghost = null;
  tile.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  tile.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!ghost && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      tile.setPointerCapture(e.pointerId);
      ghost = tile.cloneNode(true);
      Object.assign(ghost.style, { position: 'fixed', pointerEvents: 'none', opacity: .85, zIndex: 30, width: tile.offsetWidth + 'px', transform: 'scale(1.1)' });
      document.body.appendChild(ghost);
      drawPreview(ghost.querySelector('canvas'), type, {}, sub);
    }
    if (ghost) { ghost.style.left = e.clientX - 40 + 'px'; ghost.style.top = e.clientY - 30 + 'px'; }
  });
  const end = (e, cancel) => {
    if (!start || e.pointerId !== start.id) return;
    const wasDrag = !!ghost;
    if (ghost) { ghost.remove(); ghost = null; }
    start = null;
    if (cancel) return;
    if (wasDrag) {
      const r = $('#canvas').getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) place(type, editor.toWorld(e.clientX - r.left, e.clientY - r.top), sub);
    } else {
      // Mitte des sichtbaren Bereichs – das Eigenschaften-Panel öffnet sich gleich rechts
      const panelOpen = $('#props').classList.contains('open');
      const pw = panelOpen ? 0 : Math.min(272, editor.w * 0.3);
      place(type, editor.toWorld((editor.w - pw) / 2, editor.h / 2), sub);
    }
  };
  tile.addEventListener('pointerup', e => end(e));
  tile.addEventListener('pointercancel', e => end(e, true));
}
function place(type, p, sub) {
  let x = Math.round(p.x / 20) * 20, y = Math.round(p.y / 20) * 20;
  while (circuit.comps.some(c => c.x === x && c.y === y)) { x += 40; y += 40; }
  const c = circuit.addComp(type, x, y, {});
  if (sub) c.sub = sub;
  editor.sel.clear(); editor.sel.add(c);
  commit(); renderProps();
}

// ---------- Eigenschaften ----------
function renderProps() {
  const panel = $('#props');
  const sel = [...editor.sel];
  updateUI();
  if (editor.sim || !sel.length) { panel.classList.remove('open'); return; }
  panel.classList.add('open');
  const inner = document.createElement('div'); inner.className = 'inner';
  if (sel.length > 1 || !sel[0].type) {
    const nc = sel.filter(x => x.type).length, nw = sel.length - nc;
    inner.innerHTML = `<h2>${sel.length > 1 ? 'Auswahl' : 'Leitung'}</h2><div class="sub">${nc ? nc + ' Bauteil(e)' : ''}${nc && nw ? ', ' : ''}${nw ? nw + ' Leitung(en)' : ''}</div>`;
  } else {
    const c = sel[0], def = DEF[c.type], a = attrsOf(c);
    const subtitle = c.type === 'Unknown' ? 'Wird noch nicht unterstützt – bleibt beim Speichern erhalten.' : c.type === 'Sub' ? 'Baustein „' + esc(c.sub) + '“' : def.cat;
    inner.innerHTML = `<h2>${c.type === 'Sub' ? esc(c.sub) : def.name}</h2><div class="sub">${subtitle}</div>`;
    for (const p of def.props) inner.appendChild(field(c, p, a));
    if (c.type === 'Sub' && library.has(c.sub)) {
      const b = document.createElement('button'); b.className = 'btn primary wide'; b.textContent = 'Baustein öffnen und bearbeiten';
      b.onclick = () => { const back = current; setCurrent(c.sub, { keepNav: true }); navStack.push(back); updateUI(); };
      inner.appendChild(b);
    }
    if (c.type === 'Testcase') {
      const b = document.createElement('button'); b.className = 'btn primary wide'; b.textContent = 'Test ausführen';
      b.onclick = () => runAllTests([c]);
      inner.appendChild(b);
    }
  }
  const act = document.createElement('div'); act.className = 'prop-actions';
  act.innerHTML = `<button class="btn" data-a="rot">Drehen</button><button class="btn" data-a="dup">Kopie</button><button class="btn red" data-a="del" style="grid-column:span 2">Löschen</button>`;
  if (!sel.some(x => x.type)) act.querySelector('[data-a=rot]').remove(), act.querySelector('[data-a=dup]').remove();
  act.addEventListener('click', e => { const a = e.target.dataset.a; if (a === 'rot') rotateSel(); if (a === 'dup') duplicateSel(); if (a === 'del') deleteSel(); });
  inner.appendChild(act);
  panel.innerHTML = ''; panel.appendChild(inner);
}

function field(c, p, a) {
  const f = document.createElement('div'); f.className = 'field';
  const set = (v, doCommit = true) => { c.attrs[p.key] = v; editor.invalidate(); if (doCommit) commit(); };
  const val = a[p.key];
  if (p.type === 'bool') {
    f.innerHTML = `<label class="switch"><span>${p.label}</span><input type="checkbox"></label>`;
    const i = f.querySelector('input'); i.checked = !!val; i.onchange = () => { set(i.checked); renderProps(); };
    return f;
  }
  f.innerHTML = `<label>${p.label}</label>`;
  if (p.type === 'int') {
    const st = document.createElement('div'); st.className = 'stepper';
    st.innerHTML = `<button>−</button><input type="text" inputmode="numeric"><button>+</button>`;
    const [minus, inp, plus] = st.children;
    inp.value = val;
    const apply = v => { v = Math.max(p.min ?? 0, Math.min(p.max ?? 1e9, v)); if (v !== attrsOf(c)[p.key]) { set(v); renderProps(); } else inp.value = v; };
    minus.onclick = () => apply(+inp.value - 1); plus.onclick = () => apply(+inp.value + 1);
    // Wert sofort übernehmen (auch ohne Return), gespeichert wird beim Verlassen des Feldes
    inp.oninput = () => { const v = parseNum(inp.value); if (v != null && v >= (p.min ?? 0) && v <= (p.max ?? 1e9)) set(v, false); };
    inp.onchange = () => { const v = parseNum(inp.value); if (v != null) { const cl = Math.max(p.min ?? 0, Math.min(p.max ?? 1e9, v)); c.attrs[p.key] = cl; commit(); renderProps(); } else inp.value = val; };
    f.appendChild(st);
  } else if (p.type === 'text' || p.type === 'textarea') {
    const i = document.createElement(p.type === 'text' ? 'input' : 'textarea');
    if (p.type === 'text') i.type = 'text';
    if (p.mono) i.className = 'mono';
    i.value = val ?? ''; i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
    i.oninput = () => set(i.value, false);
    i.onchange = () => commit();
    f.appendChild(i);
  } else if (p.type === 'select') {
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const [k, l] of p.options) {
      const b = document.createElement('button'); b.className = 'chip' + (val === k ? ' on' : ''); b.textContent = l;
      b.onclick = () => { set(k); renderProps(); }; chips.appendChild(b);
    }
    f.appendChild(chips);
  } else if (p.type === 'color') {
    const i = document.createElement('input'); i.type = 'color';
    const hex = n => n.toString(16).padStart(2, '0');
    i.value = '#' + hex(val.r) + hex(val.g) + hex(val.b);
    i.oninput = () => { const h = i.value; set({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }, false); };
    i.onchange = () => commit();
    f.appendChild(i);
  } else if (p.type === 'invert') {
    const chips = document.createElement('div'); chips.className = 'chips';
    const cur = new Set(val || []);
    for (let k = 1; k <= a.Inputs; k++) {
      const n = 'In_' + k;
      const b = document.createElement('button'); b.className = 'chip' + (cur.has(n) ? ' on' : ''); b.textContent = k;
      b.onclick = () => { cur.has(n) ? cur.delete(n) : cur.add(n); set([...cur].sort()); renderProps(); };
      chips.appendChild(b);
    }
    f.appendChild(chips);
    f.insertAdjacentHTML('beforeend', '<div class="hint">Antippen, um einen Eingang mit Negationskreis zu versehen.</div>');
  }
  if (p.hint && p.type !== 'invert') f.insertAdjacentHTML('beforeend', `<div class="hint">${p.hint}</div>`);
  return f;
}
function parseNum(s) {
  s = String(s).trim().toLowerCase();
  let v;
  if (s.startsWith('0x')) v = parseInt(s.slice(2), 16);
  else if (s.startsWith('0b')) v = parseInt(s.slice(2), 2);
  else v = parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
}

// ---------- Bearbeiten ----------
function deleteSel() {
  if (!editor.sel.size) return;
  circuit.comps = circuit.comps.filter(c => !editor.sel.has(c));
  circuit.wires = circuit.wires.filter(w => !editor.sel.has(w));
  editor.sel.clear(); commit(); renderProps();
}
function rotateSel() {
  const cs = [...editor.sel].filter(x => x.type);
  if (!cs.length) return;
  for (const c of cs) c.rot = ((c.rot || 0) + 1) & 3;
  commit(); renderProps();
}
function duplicateSel() {
  if (!editor.sel.size) return;
  const ns = new Set();
  for (const it of editor.sel) {
    if (it.type) { const c = circuit.addComp(it.type, it.x + 40, it.y + 40, JSON.parse(JSON.stringify(it.attrs)), it.rot); if (it.raw) c.raw = [...it.raw]; if (it.sub) c.sub = it.sub; ns.add(c); }
    else { const w = circuit.addWire(it.x1 + 40, it.y1 + 40, it.x2 + 40, it.y2 + 40); if (w) ns.add(w); }
  }
  editor.sel = ns; commit(); renderProps();
}

// ---------- Simulation ----------
function startSim() {
  if (editor.sim) return;
  editor.sel.clear(); renderProps();
  const sim = new Sim(circuit);
  editor.sim = sim;
  document.body.classList.add('sim');
  $('#simLabel').textContent = 'Stopp';
  if (sim.errors.length) toast(sim.errors[0], true, 4000);
  else if (sim.oscillating) toast('Die Schaltung schwingt (instabile Rückkopplung).', true, 4000);
  if (circuit.comps.some(c => c.type === 'Unknown')) toast('Nicht unterstützte Bauteile werden ignoriert.', true, 4000);
  recorder.reset(circuit); recorder.sample(sim); renderGraph();
  let last = performance.now();
  const acc = new Map();
  clockTimer = setInterval(() => {
    const now = performance.now(), dt = Math.min(0.5, (now - last) / 1000); last = now;
    let changed = false;
    for (const c of circuit.comps) {
      if (c.type !== 'Clock') continue;
      const a = attrsOf(c);
      if (!a.runRealTime) continue;
      const half = 1 / (2 * Math.max(0.1, a.Frequency || 1));
      let t = (acc.get(c.id) || 0) + dt;
      while (t >= half) { t -= half; sim.st(c).value ^= 1; sim.update(c); recorder.sample(sim); changed = true; }
      acc.set(c.id, t);
    }
    if (changed) { checkOsc(); editor.redraw(); renderGraph(); }
  }, 16);
  editor.redraw(); updateUI(); updateFreqLabel();
}
function recordSample() { if (editor.sim && recorder.sample(editor.sim)) renderGraph(); }
function checkOsc() { if (editor.sim?.oscillating) { toast('Die Schaltung schwingt (instabile Rückkopplung) – Simulation gestoppt.', true, 5000); stopSim(); } }
function stopSim() {
  if (!editor.sim) return;
  clearInterval(clockTimer); clockTimer = null;
  editor.sim = null;
  document.body.classList.remove('sim');
  $('#simLabel').textContent = 'Start';
  editor.invalidate(); updateUI();
}
function stepClock() {
  const sim = editor.sim; if (!sim) return;
  const clocks = circuit.comps.filter(c => c.type === 'Clock');
  if (!clocks.length) { toast('Die Schaltung hat keinen Takt-Eingang.'); return; }
  for (const c of clocks) { sim.st(c).value ^= 1; sim.update(c); }
  recordSample(); checkOsc(); editor.redraw();
}

const FREQS = [1, 2, 5, 10, 20, 50];
function showFreq() {
  const clocks = circuit.comps.filter(c => c.type === 'Clock');
  if (!clocks.length) return toast('Die Schaltung hat keinen Takt-Eingang.');
  const cur = attrsOf(clocks[0]).Frequency || 1, auto = clocks.some(c => attrsOf(c).runRealTime);
  openDialog(`<div class="dialog"><h2>Takt <button class="close">✕</button></h2>
    <label class="switch"><span>Takt läuft automatisch</span><input type="checkbox" id="frAuto" ${auto ? 'checked' : ''}></label>
    <div class="field" style="margin-top:12px"><label>Frequenz</label><div class="chips">${FREQS.map(f => `<button class="chip ${f === cur ? 'on' : ''}" data-f="${f}">${f} Hz</button>`).join('')}</div></div>
    <p class="muted">Gilt für alle Takte dieser Schaltung. Ohne Automatik schaltest du den Takt mit „Takt“ von Hand weiter.</p></div>`);
  const apply = () => { commitQuiet(); updateFreqLabel(); };
  $('#frAuto').onchange = e => { for (const c of clocks) c.attrs.runRealTime = e.target.checked; apply(); };
  $('#sheet').querySelector('.chips').onclick = e => {
    const f = +e.target.dataset.f; if (!f) return;
    for (const c of clocks) { c.attrs.Frequency = f; c.attrs.runRealTime = true; }
    $('#frAuto').checked = true;
    $('#sheet').querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', +b.dataset.f === f));
    apply();
  };
}
// Änderung speichern, ohne die laufende Simulation neu aufzubauen
function commitQuiet() {
  history = history.slice(0, hIdx + 1); history.push(snapshot()); hIdx = history.length - 1; autosave();
}
function updateFreqLabel() {
  const clocks = circuit.comps.filter(c => c.type === 'Clock');
  const auto = clocks.filter(c => attrsOf(c).runRealTime);
  $('#freqLabel').textContent = !clocks.length ? 'Takt' : auto.length ? (attrsOf(auto[0]).Frequency || 1) + ' Hz' : 'Hand';
  $('#btnFreq').hidden = !clocks.length;
}

function askValue(c) {
  const a = attrsOf(c), st = editor.sim.st(c), m = mask(a.Bits);
  openDialog(`<div class="dialog"><h2>Wert für ${esc(a.Label || 'Eingang')} <button class="close">✕</button></h2>
    <p style="margin-top:0;color:#6b7280">${a.Bits} Bit · 0 bis ${m} · auch 0x… (hex) oder 0b… (binär)</p>
    <input type="text" inputmode="numeric" id="valIn" value="${st.value}">
    <div class="numpad">${[7, 8, 9, '←', 4, 5, 6, '+1', 1, 2, 3, '−1', '0', 'x', 'b', 'OK'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div></div>`);
  const inp = $('#valIn');
  const ok = () => { const v = parseNum(inp.value); if (v == null) return toast('Ungültige Zahl', true); st.value = (v & m) >>> 0; editor.sim.update(c); recordSample(); checkOsc(); editor.redraw(); closeDialog(); };
  $('#sheet').querySelector('.numpad').onclick = e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'OK') return ok();
    if (k === '←') inp.value = inp.value.slice(0, -1);
    else if (k === '+1' || k === '−1') inp.value = String(((parseNum(inp.value) || 0) + (k === '+1' ? 1 : m)) & m);
    else if (k === 'x' || k === 'b') inp.value = '0' + k;
    else inp.value = (inp.value === '0' ? '' : inp.value) + k;
  };
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
}

// ---------- Messgraph ----------
function renderGraph() { if (graphOpen) recorder.render($('#graphCanvas')); }
function toggleGraph(open = !graphOpen) {
  graphOpen = open;
  document.body.classList.toggle('graph-open', open);
  $('#btnGraph').classList.toggle('on', open);
  requestAnimationFrame(() => { editor.resize(); renderGraph(); });
}
new ResizeObserver(() => renderGraph()).observe($('#graphCanvas'));

// ---------- Dialoge ----------
function openDialog(html, wide = false) {
  $('#sheet').innerHTML = html;
  $('#sheet').classList.toggle('wide', wide);
  $('#modal').classList.remove('hidden');
  $('#sheet').onclick = null;
  $('#sheet').querySelectorAll('.close').forEach(b => (b.onclick = closeDialog));
}
function closeDialog() { $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeDialog(); });

function inputDialog(title, value, okLabel, onOk) {
  openDialog(`<div class="dialog"><h2>${esc(title)} <button class="close">✕</button></h2>
    <div class="field"><input type="text" id="dlgIn" value="${esc(value)}"></div>
    <div class="row"><button class="btn primary" id="dlgOk">${esc(okLabel)}</button></div></div>`);
  const i = $('#dlgIn'); i.focus(); i.select();
  const ok = () => { if (onOk(i.value) !== false) closeDialog(); };
  $('#dlgOk').onclick = ok; i.onkeydown = e => { if (e.key === 'Enter') ok(); };
}
function confirmDialog(text, okLabel, onOk) {
  openDialog(`<div class="dialog"><h2>Bitte bestätigen <button class="close">✕</button></h2><p style="font-size:15px">${text}</p>
    <div class="row"><button class="btn red" id="cfOk">${esc(okLabel)}</button><button class="btn" id="cfNo">Abbrechen</button></div></div>`);
  $('#cfOk').onclick = () => { closeDialog(); onOk(); };
  $('#cfNo').onclick = closeDialog;
}

// Schaltungen des Projekts
function showDocs() {
  const rows = [...library.keys()].map(n => {
    const users = usersOf(n);
    return `<div class="doc-row ${n === current ? 'cur' : ''}">
      <div class="doc-name"><b>${esc(n)}</b>${n === current ? ' <span class="badge">geöffnet</span>' : ''}
        <small>${library.get(n).comps.length} Bauteile${users.length ? ' · Baustein in: ' + users.map(esc).join(', ') : ''}</small></div>
      <div class="doc-btns">${n !== current ? `<button class="btn" data-open="${esc(n)}">Öffnen</button>` : ''}
        <button class="btn" data-ren="${esc(n)}">Umbenennen</button><button class="btn red" data-del="${esc(n)}">Löschen</button></div></div>`;
  }).join('');
  openDialog(`<div class="dialog"><h2>Schaltungen im Projekt <button class="close">✕</button></h2>
    <p class="muted">Jede Schaltung kann in den anderen als <b>Baustein</b> eingesetzt werden (Palette links, „Eigene Bausteine“). Die Anschlüsse des Bausteins sind die beschrifteten Ein- und Ausgänge.</p>
    <div class="doc-list">${rows}</div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="docNew">＋ Neue Schaltung</button></div></div>`);
  $('#sheet').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'docNew') { closeDialog(); addDoc('Schaltung', new Circuit()); toast('Neue Schaltung angelegt – die anderen findest du jetzt links als Baustein.'); }
    if (b.dataset.open) { closeDialog(); setCurrent(b.dataset.open); }
    if (b.dataset.ren) { const old = b.dataset.ren; inputDialog('Schaltung umbenennen', old, 'Umbenennen', v => renameDoc(old, v)); }
    if (b.dataset.del) {
      const n = b.dataset.del, users = usersOf(n);
      confirmDialog(`„${esc(n)}“ wirklich löschen?${users.length ? `<br><b>Achtung:</b> Sie wird als Baustein benutzt in ${users.map(esc).join(', ')}.` : ''}`, 'Löschen', () => {
        library.delete(n); touchLibrary();
        if (!library.size) library.set('Schaltung', new Circuit());
        if (n === current) setCurrent(library.keys().next().value); else { autosave(); buildPalette(); }
        showDocs();
      });
    }
  };
}

function showMenu() {
  const ex = EXAMPLES.map((e, i) => `<button class="menu-item" data-ex="${i}"><span class="ico">⚡</span><span><b>${e.name}</b><small>${e.desc}</small></span></button>`).join('');
  openDialog(`<div class="dialog"><h2>Datei <button class="close">✕</button></h2>
    <div class="menu-list">
      <button class="menu-item" data-a="new"><span class="ico">＋</span><span><b>Neue Schaltung</b><small>Im selben Projekt – andere bleiben als Bausteine</small></span></button>
      <button class="menu-item" data-a="docs"><span class="ico">🗂</span><span><b>Schaltungen im Projekt</b><small>Wechseln, umbenennen, löschen</small></span></button>
      <button class="menu-item" data-a="open"><span class="ico">📂</span><span><b>Öffnen …</b><small>.dig- oder .zip-Dateien (auch mehrere)</small></span></button>
      <button class="menu-item" data-a="save"><span class="ico">💾</span><span><b>Speichern …</b><small>Als .dig sichern oder teilen</small></span></button>
      <button class="menu-item" data-a="formula"><span class="ico">ƒ</span><span><b>Schaltung aus Formel</b><small>Booleschen Ausdruck eingeben</small></span></button>
      <button class="menu-item" data-a="png"><span class="ico">🖼</span><span><b>Als Bild</b><small>PNG der aktuellen Ansicht</small></span></button>
      <button class="menu-item" data-a="newproj"><span class="ico">🗑</span><span><b>Neues Projekt</b><small>Alle Schaltungen schließen</small></span></button>
    </div>
    <h3>Beispiele</h3><div class="menu-list">${ex}</div>
    <h3>Einstellungen</h3>
    <div class="row"><span style="font-size:15px">Schaltzeichen:</span>
      <div class="chips"><button class="chip ${settings.shapes !== 'ieee' ? 'on' : ''}" data-shape="iec">DIN / IEC (&amp;, ≥1)</button><button class="chip ${settings.shapes === 'ieee' ? 'on' : ''}" data-shape="ieee">IEEE (amerikanisch)</button></div></div>
    <h3>Hilfe</h3><div class="menu-list"><button class="menu-item" data-a="help"><span class="ico">？</span><span><b>Bedienung</b><small>So funktioniert's auf dem iPad</small></span></button></div>
  </div>`);
  $('#sheet').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ex) { loadExample(EXAMPLES[+b.dataset.ex]); closeDialog(); }
    if (b.dataset.shape) { settings.shapes = b.dataset.shape; saveSettings(); buildPalette(); editor.invalidate(); showMenu(); }
    switch (b.dataset.a) {
      case 'new': closeDialog(); addDoc('Schaltung', new Circuit()); break;
      case 'docs': showDocs(); break;
      case 'open': closeDialog(); $('#fileInput').click(); break;
      case 'save': showSave(); break;
      case 'formula': showFormula(); break;
      case 'png': exportPng(); closeDialog(); break;
      case 'newproj': confirmDialog('Alle Schaltungen dieses Projekts schließen? Nicht gespeicherte Arbeit geht verloren.', 'Neues Projekt', () => {
        library.clear(); library.set('Schaltung', new Circuit()); touchLibrary(); setCurrent('Schaltung');
      }); break;
      case 'help': showHelp(); break;
    }
  };
}
function loadExample(ex) {
  if (ex.docs) {
    const docs = Object.fromEntries(Object.entries(ex.docs).map(([n, j]) => [n, Circuit.fromJSON(j)]));
    const map = addDocsRenaming(docs);
    setCurrent(map[ex.main]);
  } else addDoc(ex.name, Circuit.fromJSON(ex.circuit));
}

// ---------- Speichern / Öffnen ----------
function filesFor(names) {
  return names.map(n => new File([writeDig(library.get(n))], n + '.dig', { type: 'application/xml' }));
}
function showSave() {
  const deps = [...dependencies(current)];
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.dig', { type: 'application/xml' })] }));
  openDialog(`<div class="dialog"><h2>Speichern <button class="close">✕</button></h2>
    <div class="field"><label>Name der Schaltung</label><input type="text" id="saveName" value="${esc(current)}"></div>
    <div class="field"><label>Umfang</label><div class="chips">
      <button class="chip on" data-scope="cur">Diese Schaltung${deps.length ? ` + ${deps.length} Baustein${deps.length > 1 ? 'e' : ''}` : ''}</button>
      ${library.size > 1 ? `<button class="chip" data-scope="all">Ganzes Projekt (${library.size} Schaltungen)</button>` : ''}</div></div>
    <p class="muted" id="saveInfo"></p>
    <div class="row">${canShare ? '<button class="btn primary" id="doShare">Teilen / In „Dateien“ sichern</button>' : ''}<button class="btn ${canShare ? '' : 'primary'}" id="doDownload">Herunterladen</button></div></div>`);
  let scope = 'cur';
  const names = () => (scope === 'all' ? [...library.keys()] : [current, ...deps]);
  const info = () => {
    const n = names();
    $('#saveInfo').innerHTML = n.length > 1
      ? `Es werden ${n.length} .dig-Dateien gespeichert (beim Herunterladen als ZIP gebündelt). Sie lassen sich auch im Desktop-Programm <i>Digital</i> öffnen, wenn sie im selben Ordner liegen.`
      : 'Die Datei hat das Format von <i>Digital</i> und lässt sich auch im Desktop-Programm öffnen.';
  };
  info();
  $('#sheet').querySelectorAll('[data-scope]').forEach(b => (b.onclick = () => {
    scope = b.dataset.scope; $('#sheet').querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b)); info();
  }));
  const applyName = () => { const v = cleanName($('#saveName').value); if (v && v !== current) return renameDoc(current, v); return true; };
  $('#doDownload').onclick = () => {
    if (!applyName()) return;
    const files = filesFor(names());
    if (files.length === 1) download(files[0]);
    else download(new File([writeZip(names().map(n => ({ name: n + '.dig', data: writeDig(library.get(n)) })))], current + '.zip', { type: 'application/zip' }));
    closeDialog();
  };
  const sh = $('#doShare');
  if (sh) sh.onclick = async () => {
    if (!applyName()) return;
    try { await navigator.share({ files: filesFor(names()), title: current }); closeDialog(); }
    catch (e) { if (e.name !== 'AbortError') toast('Teilen nicht möglich: ' + e.message, true); }
  };
}
function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportPng() {
  const sel = new Set(editor.sel); editor.sel.clear(); editor.render();
  editor.cv.toBlob(b => { download(new File([b], current + '.png', { type: 'image/png' })); editor.sel = sel; editor.redraw(); });
}

$('#fileInput').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  try {
    const texts = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) for (const z of await readZip(await f.arrayBuffer())) { if (/\.dig$/i.test(z.name)) texts.push({ name: subName(z.name), text: z.text }); }
      else texts.push({ name: cleanName(f.name.replace(/\.(json)$/i, '')), text: await f.text() });
    }
    if (!texts.length) throw new Error('Keine .dig-Datei gefunden.');
    const loaded = {}, unknown = new Set();
    for (const { name, text } of texts) {
      if (text.trim().startsWith('{')) { const j = JSON.parse(text); loaded[name] = Circuit.fromJSON(j.circuit || j); continue; }
      const r = parseDig(text); loaded[name] = r.circuit; r.unknown.forEach(u => unknown.add(u));
    }
    // gleichnamige Schaltungen werden ersetzt (neuere Version)
    for (const [n, c] of Object.entries(loaded)) library.set(n, c);
    touchLibrary();
    const names = Object.keys(loaded);
    const main = names.find(n => !names.some(m => m !== n && loaded[m].comps.some(k => k.type === 'Sub' && k.sub === n))) || names[0];
    const missing = new Set();
    for (const c of Object.values(loaded)) for (const k of c.comps) if (k.type === 'Sub' && !library.has(k.sub)) missing.add(k.sub);
    setCurrent(main);
    if (missing.size) toast('Es fehlen Bausteine: ' + [...missing].join(', ') + ' – bitte die .dig-Dateien mit auswählen.', true, 7000);
    else if (unknown.size) toast('Noch nicht unterstützt: ' + [...unknown].join(', '), true, 6000);
    else if (names.length > 1) toast(`${names.length} Schaltungen geladen.`);
  } catch (err) { console.error(err); toast(err.message || 'Datei konnte nicht gelesen werden.', true, 4000); }
});

// ---------- Wahrheitstabelle, KV, Synthese ----------
const GATE_TYPES = ['And', 'Or', 'Not', 'NAnd', 'NOr', 'XOr', 'XNOr'];
let tableAllGates = false;
const exprHTML = e => toHTML(termsToAST(e.terms, e.vars.length, e.vars));
const exprText = e => toText(termsToAST(e.terms, e.vars.length, e.vars));

function showTable() {
  let t;
  try { t = truthTable(circuit, { allGates: tableAllGates }); } catch (e) { toast(e.message, true); return; }
  const cols = [
    ...t.inputs.map(c => ({ ...c, kind: 'in' })),
    ...t.steps.map((c, j) => ({ ...c, kind: 'step', first: j === 0 })),
    ...t.outputs.map((c, j) => ({ ...c, kind: 'out', first: j === 0 })),
  ];
  const head = cols.map(c => `<th class="${c.kind} ${c.first ? 'sepcol' : ''}">${esc(c.name)}${c.auto ? '<sup>*</sup>' : ''}</th>`).join('');
  const cell = (v, c) => `<td class="${c.kind} ${c.first ? 'sepcol' : ''} ${c.bits === 1 ? (v ? 'one' : 'zero') : ''}">${v == null ? 'Z' : formatValue(v, c.bits)}</td>`;
  const body = t.rows.map(r => '<tr>' + [...r.ins, ...r.steps, ...r.outs].map((v, i) => cell(v, cols[i])).join('') + '</tr>').join('');
  const exprList = list => list.map(e => `<div class="expr"><b>${esc(e.name)}</b> = ${exprHTML(e)}</div>`).join('');
  const expr = t.expressions?.length ? '<h3>Disjunktive Minimalform (DMF)</h3>' + exprList(t.expressions)
    + (t.stepExpressions?.length ? '<details class="steps-dmf"><summary>DMF der Zwischenschritte</summary>' + exprList(t.stepExpressions) + '</details>' : '') : '';
  const hasGates = circuit.comps.some(c => GATE_TYPES.includes(c.type));
  const kvOk = t.expressions?.some(e => e.vars.length >= 2 && e.vars.length <= 4);
  openDialog(`<div class="dialog"><h2>Wahrheitstabelle <button class="close">✕</button></h2>
    ${t.sequential ? '<div class="note">Die Schaltung enthält Speicherglieder oder Takte. Die Tabelle zeigt nur das Verhalten ausgehend vom aktuellen Zustand.</div>' : ''}
    ${t.oscillating ? '<div class="note">Die Schaltung schwingt – die Werte sind nicht zuverlässig.</div>' : ''}
    ${hasGates ? `<label class="switch tt-switch"><span>Alle Gatter als Zwischenschritte zeigen</span><input type="checkbox" id="ttAll" ${tableAllGates ? 'checked' : ''}></label>` : ''}
    <div class="tt-wrap"><table class="tt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="tt-hint">${t.steps.length ? '<span class="legend step"></span> Zwischenschritte' + (t.steps.some(s => s.auto) ? ' (* = automatisch benannt, von links nach rechts)' : '') + ' · ' : ''}Tipp: Gib einem Gatter eine <b>Beschriftung</b> (z. B. Z1), dann erscheint es hier als Zwischenschritt.</p>
    ${expr}
    <div class="row" style="margin-top:14px"><button class="btn" id="copyCsv">Als Tabelle kopieren</button>${kvOk ? '<button class="btn" id="showKV">KV-Diagramm</button>' : ''}${t.expressions?.length ? '<button class="btn" id="buildDMF">Schaltung aus DMF erzeugen</button>' : ''}</div></div>`, true);
  const all = $('#ttAll');
  if (all) all.onchange = () => { tableAllGates = all.checked; showTable(); };
  $('#copyCsv').onclick = async () => {
    const lines = [cols.map(x => x.name).join('\t'), ...t.rows.map(r => [...r.ins, ...r.steps, ...r.outs].map(v => v ?? 'Z').join('\t'))];
    if (t.expressions) lines.push('', ...t.expressions.map(e => e.name + ' = ' + exprText(e)));
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Kopiert – kann in Numbers/Excel eingefügt werden.'); } catch { toast('Kopieren nicht möglich', true); }
  };
  const kv = $('#showKV'); if (kv) kv.onclick = () => showKV(t);
  const bd = $('#buildDMF'); if (bd) bd.onclick = () => buildFromDMF(t);
}

function showKV(t) {
  const blocks = [...t.expressions, ...(t.stepExpressions || [])].filter(e => e.vars.length >= 2 && e.vars.length <= 4).map(e => {
    const terms = termsToAST(e.terms, e.vars.length, e.vars);
    const prods = terms.op === 'or' ? terms.args : [terms];
    const chips = e.terms.length && e.ones.length < 2 ** e.vars.length
      ? prods.map((p, k) => `<span class="term" style="border-color:${KV_COLORS[k % KV_COLORS.length]};color:${KV_COLORS[k % KV_COLORS.length]}">${toHTML(p, 2)}</span>`).join('<span class="or"> ∨ </span>')
      : toHTML(terms);
    return `<div class="kv-block"><h4>${esc(e.name)}</h4>${kvSVG(e)}<div class="expr">${esc(e.name)} = ${chips}</div></div>`;
  }).join('');
  openDialog(`<div class="dialog"><h2>KV-Diagramme <button class="close">✕</button></h2>
    <p class="muted">Die farbigen Blöcke sind die Primimplikanten der disjunktiven Minimalform. Kleine Zahlen = Zeilennummer in der Wahrheitstabelle.</p>
    <div class="kv-grid">${blocks}</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="kvBack">← Zur Tabelle</button></div></div>`, true);
  $('#kvBack').onclick = showTable;
}

function buildFromDMF(t) {
  const defs = t.expressions.map(e => ({ name: e.name, ast: termsToAST(e.terms, e.vars.length, e.vars) }));
  closeDialog();
  const n = addDoc(current + ' (DMF)', buildCircuit(defs));
  toast(`Neue Schaltung „${n}“ aus der DMF erzeugt.`);
}

function showFormula(preset = '') {
  openDialog(`<div class="dialog"><h2>Schaltung aus Formel <button class="close">✕</button></h2>
    <div class="field"><label>Ausdrücke (eine Gleichung pro Zeile)</label>
      <textarea id="fIn" class="mono" rows="4" placeholder="Y = A ∧ ¬B ∨ ¬A ∧ B">${esc(preset)}</textarea></div>
    <div class="keys">${['∧', '∨', '¬', '⊕', '(', ')', '='].map(k => `<button class="chip" data-k="${k}">${k}</button>`).join('')}</div>
    <p class="muted">Erlaubt: ∧ &amp; * (und), ∨ | + (oder), ¬ ! / oder nachgestelltes ' (nicht), ⊕ ^ (xor), Klammern, 0 und 1.</p>
    <div id="fPrev" class="expr-preview"></div>
    <div class="row"><button class="btn primary" id="fBuild">Schaltung erzeugen</button></div></div>`);
  const ta = $('#fIn');
  const prev = () => {
    try { const defs = parseEquations(ta.value); $('#fPrev').innerHTML = defs.map(d => `<div class="expr"><b>${esc(d.name)}</b> = ${toHTML(d.ast)}</div>`).join(''); }
    catch (e) { $('#fPrev').innerHTML = ta.value.trim() ? `<div class="err">${esc(e.message)}</div>` : ''; }
  };
  ta.oninput = prev; prev();
  $('#sheet').querySelector('.keys').onclick = e => {
    const k = e.target.dataset.k; if (!k) return;
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
    const ins = k === '=' ? ' = ' : k;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + ins.length; ta.focus(); prev();
  };
  $('#fBuild').onclick = () => {
    let defs;
    try { defs = parseEquations(ta.value); } catch (e) { toast(e.message, true); return; }
    closeDialog();
    const n = addDoc(defs.map(d => d.name).join(', ') + ' (Formel)', buildCircuit(defs));
    toast(`Schaltung „${n}“ erzeugt.`);
  };
}

// ---------- Testfälle ----------
function runAllTests(only) {
  const tests = only || circuit.comps.filter(c => c.type === 'Testcase');
  if (!tests.length) { toast('Die Schaltung enthält keinen Testfall. Füge einen aus „Sonstiges“ hinzu.'); return; }
  const blocks = tests.map((tc, k) => {
    const name = attrsOf(tc).Label || 'Testfall ' + (k + 1);
    let r;
    try { r = runTest(circuit, tc); } catch (e) { tc._result = 'fail'; return `<div class="test-block fail"><h4>✗ ${esc(name)}</h4><div class="err">${esc(e.message)}</div></div>`; }
    const ok = r.passed === r.results.length;
    tc._result = ok ? 'ok' : 'fail';
    const head = r.cols.map(c => `<th class="${c.input ? 'in' : 'out'}">${esc(c.n)}</th>`).join('');
    const rows = r.results.map(x => `<tr class="${x.ok ? '' : 'bad'}">${r.cols.map((c, i) => {
      const exp = x.expected[i], act = x.actual[i];
      const f = v => (v === 'X' || v === 'C' || v === 'Z' ? v : v == null ? 'Z' : formatValue(v, c.bits));
      const wrong = !c.input && exp !== 'X' && !(exp === 'Z' ? act == null : act === exp);
      return `<td class="${wrong ? 'wrong' : ''}">${wrong ? `<s>${f(exp)}</s> ${f(act)}` : f(c.input ? exp : (exp === 'X' ? act : exp))}</td>`;
    }).join('')}<td class="res">${x.ok ? '✓' : '✗'}</td></tr>`).join('');
    return `<div class="test-block ${ok ? 'ok' : 'fail'}"><h4>${ok ? '✓' : '✗'} ${esc(name)} – ${r.passed} von ${r.results.length} Zeilen bestanden</h4>
      <div class="tt-wrap"><table class="tt test"><thead><tr>${head}<th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  editor.redraw();
  openDialog(`<div class="dialog"><h2>Testergebnis <button class="close">✕</button></h2>
    <p class="muted">Falsche Werte sind rot: <s>erwartet</s> tatsächlich.</p>${blocks}</div>`, true);
}

function showHelp() {
  openDialog(`<div class="dialog help"><h2>Bedienung <button class="close">✕</button></h2>
  <ul>
    <li><b>Bauteil einfügen:</b> in der linken Leiste antippen (erscheint in der Mitte) oder seitlich auf die Fläche ziehen.</li>
    <li><b>Verschieben:</b> Bauteil mit dem Finger oder Stift ziehen. Angeschlossene Leitungen gehen mit.</li>
    <li><b>Leitung zeichnen:</b> an einem Anschlusspunkt (blau = Eingang, rot = Ausgang) oder an einer bestehenden Leitung beginnen und ziehen.</li>
    <li><b>Leitung auswählen:</b> kurz antippen. Eine ausgewählte Leitung lässt sich verschieben.</li>
    <li><b>Mehrere auswählen:</b> „Auswahl“ einschalten und ein Rechteck aufziehen.</li>
    <li><b>Ansicht:</b> mit einem Finger auf freier Fläche verschieben, mit zwei Fingern zoomen.</li>
    <li><b>Simulation:</b> „Start“ tippen. Schalter antippen, Taster gedrückt halten. Hellgrün = 1, dunkelgrün = 0, blau = nicht verbunden, rot = Fehler. „Messgraph“ zeigt den zeitlichen Verlauf.</li>
    <li><b>Wahrheitstabelle:</b> „Tabelle“ zeigt alle Eingangskombinationen, die DMF und das KV-Diagramm. Beschriftete Gatter erscheinen als Zwischenschritte.</li>
    <li><b>Bausteine:</b> Tippe oben auf den Schaltungsnamen, um weitere Schaltungen im Projekt anzulegen. Jede davon kann links unter „Eigene Bausteine“ in andere Schaltungen eingesetzt werden. Ihre Anschlüsse sind die beschrifteten Ein- und Ausgänge.</li>
    <li><b>Testfälle:</b> Bauteil „Testfall“ (Sonstiges) einfügen, Testdaten eintragen, „Test“ tippen.</li>
    <li><b>Speichern:</b> Die Arbeit wird automatisch im Browser gesichert. Über „Datei → Speichern“ entstehen .dig-Dateien, die auch das Desktop-Programm <i>Digital</i> öffnet.</li>
  </ul>
  <p class="muted">Tipp: Über „Teilen → Zum Home-Bildschirm“ in Safari wird die App wie eine normale App gestartet und funktioniert auch offline.</p></div>`);
}

// ---------- Oberfläche ----------
function updateUI() {
  if (!circuit) return;
  $('#btnUndo').disabled = hIdx <= 0;
  $('#btnRedo').disabled = hIdx >= history.length - 1;
  const has = editor.sel.size > 0;
  $('#btnDelete').disabled = !has; $('#btnDup').disabled = !has;
  $('#btnRotate').disabled = ![...editor.sel].some(x => x.type);
  $('#fileName').textContent = current;
  $('#docCount').textContent = library.size > 1 ? `${library.size} Schaltungen` : 'Projekt';
  $('#btnBack').hidden = !navStack.length;
  if (navStack.length) $('#backLabel').textContent = navStack[navStack.length - 1];
  $('#btnTest').hidden = !circuit.comps.some(c => c.type === 'Testcase');
  $('#hint').classList.toggle('hidden', circuit.comps.length > 0 || circuit.wires.length > 0);
}

$('#btnMenu').onclick = showMenu;
$('#btnDocs').onclick = showDocs;
$('#btnBack').onclick = () => { const n = navStack.pop(); if (n && library.has(n)) setCurrent(n, { keepNav: true }); };
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnDelete').onclick = deleteSel;
$('#btnRotate').onclick = rotateSel;
$('#btnDup').onclick = duplicateSel;
$('#btnRect').onclick = () => { editor.rectMode = !editor.rectMode; $('#btnRect').classList.toggle('on', editor.rectMode); };
$('#btnSim').onclick = () => (editor.sim ? stopSim() : startSim());
$('#btnStep').onclick = stepClock;
$('#btnFreq').onclick = showFreq;
$('#btnTable').onclick = showTable;
$('#btnTest').onclick = () => runAllTests();
$('#btnGraph').onclick = () => toggleGraph();
$('#graphClear').onclick = () => { if (editor.sim) { recorder.reset(circuit); recorder.sample(editor.sim); renderGraph(); } };
$('#graphClose').onclick = () => toggleGraph(false);
$('#zoomIn').onclick = () => editor.zoomBy(1.25);
$('#zoomOut').onclick = () => editor.zoomBy(0.8);
$('#zoomFit').onclick = () => editor.fit();
$('#btnExample').onclick = () => loadExample(EXAMPLES[0]);

window.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); showSave(); }
  else if (editor.sim) { if (e.key === ' ') { e.preventDefault(); stopSim(); } else if (e.key.toLowerCase() === 'c') stepClock(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (e.key.toLowerCase() === 'r') rotateSel();
  else if (e.key === 'Escape') { editor.sel.clear(); renderProps(); editor.redraw(); closeDialog(); }
  else if (e.key === ' ') { e.preventDefault(); startSim(); }
});

// ---------- Start ----------
(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved?.v === 2 && saved.docs) {
      for (const [n, j] of Object.entries(saved.docs)) library.set(n, Circuit.fromJSON(j));
      touchLibrary();
      if (library.size) return setCurrent(library.has(saved.current) ? saved.current : library.keys().next().value);
    } else if (saved?.circuit) {
      library.set(cleanName(saved.name) || 'Schaltung', Circuit.fromJSON(saved.circuit)); touchLibrary();
      return setCurrent(library.keys().next().value);
    }
  } catch (e) { console.error(e); }
  library.clear(); library.set('Schaltung', new Circuit()); touchLibrary();
  setCurrent('Schaltung', { fit: false });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });

// zum Testen
window.__app = { editor, get circuit() { return circuit; }, get current() { return current; }, library, setCurrent, addDoc, loadExample, parseDig, writeDig, startSim, stopSim, Circuit, recorder, runAllTests, showTable, showKV, showFormula, toggleGraph };
