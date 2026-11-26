import { DEF, DEFS, CATEGORIES, attrsOf, geoOf, settings, mask, formatValue, subInterface, pinsWorld, boundsWorld } from './components.js';
import { parseData, formatData } from './comp-mem.js';
import { touchGenerics } from './generics.js';
import { Circuit } from './circuit.js';
import { Sim } from './sim.js';
import { Editor, drawPreview } from './editor.js';
import { parseDig, writeDig, subName } from './dig.js';
import { truthTable, columnExpr } from './analysis.js';
import { stateAnalysis, stateDiagramSVG } from './seq.js';
import { FsmEditor } from './fsmeditor.js';
import { kvSVG, KV_COLORS } from './kv.js';
import { parseEquations, buildCircuit, toHTML, toText, termsToAST, OV } from './synth.js';
import { Recorder } from './graph.js';
import { runTest } from './testcase.js';
import { writeZip, readZip } from './zip.js';
import { library, sysLib, touchLibrary, usesCircuit, dependencies, getCircuit, isSystem, libIndex, loadMissing } from './lib.js';
import { EXAMPLES } from './examples.js';
import { makeModule as moduleFromSelection, route as routeWire } from './module.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STORE = 'digitalweb.v1';
const VERSION = 'Version 12 · 26.11.2026';

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
  tapAction: (act, c) => {
    if (act === 'showMemory') showMemory(c, true);
    else if (act === 'showView') showLiveView(c);
    else if (act === 'keyboard') showKeyboard(c);
    else if (act === 'rotate') showRotate(c);
    else if (act === 'showGraph') toggleGraph(true);
    else if (act === 'resume') { editor.sim.paused = false; editor.sim.update(c); toast('Simulation läuft weiter.'); updateFreqLabel(); }
  },
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
  refreshPanel();
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
    localStorage.setItem(STORE, JSON.stringify({ v: 3, current, docs }));
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
  if (panelOpen()) { fillAnswers.clear(); showTable.combinational = false; panelFn ? panelFn(true) : closePanel(); }
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
    for (const k of c.comps) if (k.type === 'Custom' && map[k.sub]) k.sub = map[k.sub];
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
  for (const c of library.values()) for (const k of c.comps) if (k.type === 'Custom' && k.sub === old) k.sub = nu;
  if (current === old) current = nu;
  navStack = navStack.map(n => (n === old ? nu : n));
  touchLibrary(); autosave(); buildPalette(); updateUI(); editor.invalidate();
  return true;
}
function usersOf(name) { return [...library.keys()].filter(n => n !== name && library.get(n).comps.some(k => k.type === 'Custom' && k.sub === name)); }

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
// Palette: Suche, „Zuletzt benutzt“ und einklappbare Kategorien (Zustand wird gemerkt)
const PAL_KEY = STORE + '.palette';
const CLOSED_DEFAULT = ['Arithmetik', 'Speicher', 'Leitungen', 'Schalter & Transistoren', 'Anzeigen & Terminal', 'Simulation', 'Sonstiges'];
let palState = { closed: CLOSED_DEFAULT, recent: [] };
try { palState = { ...palState, ...JSON.parse(localStorage.getItem(PAL_KEY) || '{}') }; } catch { }
const savePal = () => { try { localStorage.setItem(PAL_KEY, JSON.stringify(palState)); } catch { } };
let palQuery = '';

function buildPalette() {
  const pal = $('#palette');
  tileRO.disconnect();
  pal.innerHTML = '';
  // Suchfeld bleibt oben stehen
  const search = document.createElement('div'); search.className = 'pal-search';
  search.innerHTML = '<input type="search" placeholder="Bauteil suchen …" autocomplete="off" spellcheck="false" aria-label="Bauteil suchen">';
  pal.appendChild(search);
  const inp = search.firstChild; inp.value = palQuery;
  inp.oninput = () => { palQuery = inp.value; filterPalette(); };
  const section = (key, title, items, extra, collapsible = true) => {
    const sec = document.createElement('section'); sec.className = 'pal-sec'; sec.dataset.key = key;
    if (collapsible && palState.closed.includes(key)) sec.classList.add('closed');
    const h = document.createElement('h3');
    h.innerHTML = `<span>${esc(title)}</span>${collapsible ? `<small>${items.length}</small><i class="chev"></i>` : ''}`;
    if (collapsible) {
      h.className = 'toggle'; h.setAttribute('role', 'button');
      h.onclick = () => {
        const closed = sec.classList.toggle('closed');
        palState.closed = closed ? [...new Set([...palState.closed, key])] : palState.closed.filter(k => k !== key);
        savePal();
      };
    }
    sec.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'tiles'; sec.appendChild(grid);
    for (const it of items) {
      const t = document.createElement('div'); t.className = 'tile'; t.dataset.type = it.type;
      t.dataset.search = (it.name + ' ' + it.type + ' ' + (it.sub || '')).toLowerCase();
      if (it.sub) t.dataset.sub = it.sub;
      const cv = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = it.name;
      t.append(cv, sp); grid.appendChild(t);
      setupTileDrag(t, it.type, it.sub);
      tileRO.observe(cv);
    }
    if (extra) sec.insertAdjacentHTML('beforeend', extra);
    pal.appendChild(sec);
  };
  const subs = [...library.keys()].filter(n => n !== current && !usesCircuit(n, current) && (() => { const i = subInterface(library.get(n)); return i.ins.length + i.outs.length > 0; })());
  section('own', 'Eigene Bausteine', subs.map(n => ({ type: 'Custom', sub: n, name: n })),
    subs.length ? '' : '<p class="pal-hint">Weitere Schaltungen des Projekts erscheinen hier als Bausteine (oben auf den Schaltungsnamen tippen).</p>', false);
  const recent = palState.recent.filter(t => DEF[t]?.cat);
  if (recent.length) section('recent', 'Zuletzt benutzt', recent.map(t => DEFS.find(d => d.type === t)), '', false);
  for (const cat of CATEGORIES) section(cat, cat, DEFS.filter(d => d.cat === cat));
  // 74xx-Bibliothek (aus Digital)
  const lib = document.createElement('section'); lib.className = 'pal-sec'; lib.dataset.key = 'chips';
  lib.innerHTML = '<h3><span>74xx-Bibliothek</span></h3>';
  const b = document.createElement('button'); b.className = 'btn lib-btn'; b.innerHTML = '<b>74xx-Chips</b><small>über 100 Bausteine aus Digital</small>';
  b.onclick = showChipLibrary; lib.appendChild(b); pal.appendChild(lib);
  pal.insertAdjacentHTML('beforeend', '<p class="pal-empty" hidden>Kein Bauteil gefunden.</p>');
  filterPalette();
}
// Suche: passende Kacheln zeigen (auch in eingeklappten Kategorien), „Zuletzt benutzt“ ausblenden
function filterPalette() {
  const pal = $('#palette'), q = palQuery.trim().toLowerCase();
  pal.classList.toggle('searching', !!q);
  let any = false;
  for (const sec of pal.querySelectorAll('.pal-sec')) {
    let n = 0;
    for (const t of sec.querySelectorAll('.tile')) { const hit = !q || t.dataset.search.includes(q); t.hidden = !hit; if (hit) n++; }
    const hide = q && (sec.dataset.key === 'recent' || (sec.dataset.key === 'chips' ? !'74xx chips bibliothek'.includes(q) && !/^74/.test(q) : !n));
    sec.hidden = !!hide; if (!hide) any = true;
  }
  pal.querySelector('.pal-empty').hidden = any;
}
function noteRecent(type) {
  if (!DEF[type]?.cat) return;
  const next = [type, ...palState.recent.filter(t => t !== type)].slice(0, 6);
  // nur neu aufbauen, wenn sich die Auswahl ändert (Reihenfolge allein genügt nicht)
  const changed = next.length !== palState.recent.length || next.some(t => !palState.recent.includes(t));
  palState.recent = next; savePal();
  if (changed) { const pal = $('#palette'), top = pal.scrollTop; buildPalette(); pal.scrollTop = top; }
}

// ---------- 74xx-Bibliothek ----------
const parseLib = text => parseDig(text).circuit;
async function ensureChips(circuits) {
  const r = await loadMissing(circuits, parseLib);
  if (r.loaded.length) { editor.invalidate(); renderProps(); }
  return r;
}
const GROUPS = { basic: 'Gatter', arithmetic: 'Arithmetik & Vergleich', flipflops: 'Flipflops & Latches', counter: 'Zähler', 'shift register': 'Schieberegister', plexers: 'Multiplexer & Decoder', driver: 'Treiber', display: 'Anzeige-Decoder', memory: 'Speicher' };
async function showChipLibrary() {
  const idx = (await libIndex()).filter(e => !e.internal);
  const render = q => {
    q = q.trim().toLowerCase();
    const hit = e => !q || e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q);
    const groups = [...new Set(idx.map(e => e.group))];
    return groups.map(g => {
      const items = idx.filter(e => e.group === g && hit(e));
      if (!items.length) return '';
      return `<h3>${esc(GROUPS[g] || g)}</h3><div class="chip-list">${items.map(e => `<button class="chip-item" data-chip="${esc(e.name)}"><b>${esc(e.name)}</b><small>${esc(e.desc)}</small></button>`).join('')}</div>`;
    }).join('') || '<p class="muted">Nichts gefunden.</p>';
  };
  openDialog(`<div class="dialog"><h2>74xx-Bibliothek <button class="close">✕</button></h2>
    <div class="field"><input type="text" id="chipSearch" placeholder="Suchen, z. B. 74595 oder Zähler" autocomplete="off" spellcheck="false"></div>
    <div id="chipResults">${render('')}</div>
    <p class="muted" style="margin-top:14px">Die Chips stammen aus der Bibliothek von <i>Digital</i> (H. Neemann, GPL-3.0) und werden als DIL-Gehäuse mit Pin-Nummern dargestellt. VCC und GND müssen nicht angeschlossen werden.</p></div>`, true);
  $('#chipSearch').oninput = e => { $('#chipResults').innerHTML = render(e.target.value); };
  $('#sheet').onclick = async e => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    const name = b.dataset.chip;
    b.disabled = true;
    const tmp = { comps: [{ type: 'Custom', sub: name }] };
    const r = await ensureChips([tmp]);
    if (!getCircuit(name)) { toast(`„${name}“ konnte nicht geladen werden.`, true); b.disabled = false; return; }
    closeDialog();
    const panelOpen = $('#props').classList.contains('open');
    const pw = panelOpen ? 0 : Math.min(272, editor.w * 0.3);
    place('Custom', editor.toWorld((editor.w - pw) / 2, editor.h / 3), name);
    if (r.notFound.length) toast('Fehlende Teile: ' + r.notFound.join(', '), true);
  };
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
  noteRecent(type);
  const c = circuit.addComp(type, 0, 0, JSON.parse(JSON.stringify(DEF[type].initial || {})));
  if (sub) c.sub = sub;
  // freien Platz nahe der gewünschten Stelle suchen (nichts überdecken, keine Leitung berühren)
  const x0 = Math.round(p.x / 20) * 20, y0 = Math.round(p.y / 20) * 20;
  const others = circuit.comps.filter(k => k !== c).map(k => boundsWorld(k));
  const free = (x, y) => {
    c.x = x; c.y = y;
    const b = boundsWorld(c), m = 20;
    if (others.some(o => o.x0 < b.x1 + m && o.x1 > b.x0 - m && o.y0 < b.y1 + m && o.y1 > b.y0 - m)) return false;
    const inside = (px, py) => px >= b.x0 - m && px <= b.x1 + m && py >= b.y0 - m && py <= b.y1 + m;
    return !circuit.wires.some(w => inside(w.x1, w.y1) || inside(w.x2, w.y2) || (w.x1 === w.x2 ? w.x1 >= b.x0 - m && w.x1 <= b.x1 + m && Math.min(w.y1, w.y2) <= b.y1 && Math.max(w.y1, w.y2) >= b.y0 : w.y1 >= b.y0 - m && w.y1 <= b.y1 + m && Math.min(w.x1, w.x2) <= b.x1 && Math.max(w.x1, w.x2) >= b.x0));
  };
  let found = false;
  for (let r = 0; r <= 25 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++)
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x0 + dx * 40, y0 + dy * 40)) found = true;
  if (!found) { c.x = x0; c.y = y0; }
  // falls außerhalb des sichtbaren Bereichs (ohne Eigenschaften-Feld): Ansicht verschieben
  const b = boundsWorld(c), v = editor.view, pw = $('#props').offsetWidth || 0;
  const sx0 = b.x0 * v.s + v.ox, sx1 = b.x1 * v.s + v.ox, sy0 = b.y0 * v.s + v.oy, sy1 = b.y1 * v.s + v.oy;
  const W = editor.w - pw, H = editor.h, pad = 30;
  if (sx0 < pad || sy0 < pad || sx1 > W - pad || sy1 > H - pad) {
    v.ox += W / 2 - (sx0 + sx1) / 2; v.oy += H / 2 - (sy0 + sy1) / 2;
  }
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
    if (nc) {
      const b = document.createElement('button'); b.className = 'btn primary wide'; b.textContent = 'Als Baustein zusammenfassen';
      b.onclick = makeModule;
      inner.appendChild(b);
      inner.insertAdjacentHTML('beforeend', '<div class="hint" style="margin-top:6px">Die Auswahl wird in einen eigenen Baustein verschoben. Leitungen nach außen werden zu seinen Ein- und Ausgängen.</div>');
    }
  } else {
    const c = sel[0], def = DEF[c.type], a = attrsOf(c);
    const subtitle = c.type === 'Unknown' ? 'Wird noch nicht unterstützt – bleibt beim Speichern erhalten.'
      : c.type === 'Custom' ? (isSystem(c.sub) ? esc(getCircuit(c.sub)?.top?.Description || '74xx-Bibliothek') : 'Baustein „' + esc(c.sub) + '“') : def.cat;
    inner.innerHTML = `<h2>${c.type === 'Custom' ? esc(c.sub) : def.name}</h2><div class="sub">${subtitle}</div>`;
    for (const p of def.props) inner.appendChild(field(c, p, a));
    // generische Schaltungen: Code am Bauteil bzw. Parameter am generischen Baustein / Testfall
    const subGen = c.type === 'Custom' && getCircuit(c.sub)?.top?.isGeneric;
    if (subGen) inner.appendChild(field(c, DEF.Custom.genericProp, a));
    else if (circuit.top?.isGeneric && !['GenericInitCode', 'GenericCode'].includes(c.type))
      inner.appendChild(field(c, c.type === 'Testcase' ? { key: 'generic', label: 'Parameter für diesen Test', type: 'textarea', mono: true, hint: 'z. B. bits := 4; – leer = Standardwerte' }
        : { key: 'generic', label: 'Generischer Code', type: 'textarea', mono: true, hint: 'z. B. this.Bits = args.bits;' }, a));
    if (c.type === 'Custom' && library.has(c.sub)) {
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
  } else if (p.type === 'data') {
    const n = parseData(val).length;
    const b = document.createElement('button'); b.className = 'btn wide'; b.textContent = 'Inhalt bearbeiten …';
    b.onclick = () => showMemory(c, false);
    f.insertAdjacentHTML('beforeend', `<div class="hint" style="margin:0 0 6px">${n ? n + ' Werte gespeichert' : 'leer (alles 0)'}</div>`);
    f.appendChild(b);
  } else if (p.type === 'invert') {
    const chips = document.createElement('div'); chips.className = 'chips';
    const cur = new Set(val || []);
    const gates = /^(And|Or|NAnd|NOr|XOr|XNOr)$/.test(c.type);
    const names = gates ? Array.from({ length: a.Inputs }, (_, k) => 'In_' + (k + 1)) : geoOf(c).pins.filter(q => !q.out && !q.hidden).map(q => q.n);
    for (const n of names) {
      const b = document.createElement('button'); b.className = 'chip' + (cur.has(n) ? ' on' : ''); b.textContent = gates ? n.slice(3) : n;
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

// ---------- Bausteine (Module) ----------
function makeModule() {
  const sel = new Set(editor.sel);
  inputDialog('Name des neuen Bausteins', uniqueName('Baustein'), 'Baustein erstellen', v => {
    const name = cleanName(v);
    if (!name) { toast('Bitte einen Namen eingeben.', true); return false; }
    if (getCircuit(name)) { toast(`„${name}“ gibt es schon.`, true); return false; }
    try {
      const r = moduleFromSelection(circuit, sel, name);
      editor.sel.clear(); editor.sel.add(r.instance);
      commit(); buildPalette(); renderProps();
      toast(`Baustein „${name}“ erstellt: Eingänge ${r.inputs.join(', ') || '–'}, Ausgänge ${r.outputs.join(', ') || '–'}.`, false, 5000);
    } catch (e) { toast(e.message, true, 4000); return false; }
  });
}

// Ändert sich die Lage der Anschlüsse eines Bausteins, ziehen Leitungen und angedockte Tunnel/Ein-Ausgänge mit
const ONE_PIN = new Set(['Tunnel', 'In', 'Out', 'Clock', 'Const', 'Ground', 'VDD', 'Probe', 'LED', 'Button', 'PullUp', 'PullDown']);
function changeModule(name, mutate) {
  const snap = [];
  for (const circ of library.values()) for (const inst of circ.comps.filter(k => k.type === 'Custom' && k.sub === name)) snap.push({ circ, inst, pins: pinsWorld(inst) });
  mutate(); touchLibrary();
  for (const { circ, inst, pins } of snap) {
    const np = pinsWorld(inst);
    const moves = pins.map((op, i) => ({ op, q: np[i] })).filter(m => m.q && (m.q.x !== m.op.x || m.q.y !== m.op.y));
    const movedComps = new Set(), movedEnds = new Set();
    for (const { op, q } of moves) {
      for (const w of [...circ.wires]) for (const e of [1, 2]) {
        const k = w.id + ':' + e;
        if (movedEnds.has(k) || w['x' + e] !== op.x || w['y' + e] !== op.y) continue;
        w['x' + e] = q.x; w['y' + e] = q.y; movedEnds.add(k);
        // schräg geworden? -> kollisionsfrei rechtwinklig neu führen (sonst schräg lassen)
        const f = e === 1 ? 2 : 1;
        if (w['x' + f] !== q.x && w['y' + f] !== q.y) {
          const a = [w['x' + f], w['y' + f]];
          circ.wires = circ.wires.filter(z => z !== w);
          const path = routeWire(circ, a, [q.x, q.y], new Set([inst]));
          if (path) for (let i = 1; i < path.length; i++) { const nw = circ.addWire(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]); if (nw) { movedEnds.add(nw.id + ':1'); movedEnds.add(nw.id + ':2'); } }
          else circ.wires.push(w);
        }
      }
      for (const k of circ.comps) {
        if (k === inst || movedComps.has(k) || !ONE_PIN.has(k.type)) continue;
        const kp = pinsWorld(k)[0];
        if (kp && kp.x === op.x && kp.y === op.y) { k.x += q.x - op.x; k.y += q.y - op.y; movedComps.add(k); }
      }
    }
    circ.cleanup();
  }
}

function showModuleSettings(name = current) {
  const c = library.get(name); if (!c) return;
  const top = c.top || (c.top = {});
  const ports = c.comps.filter(k => ['In', 'Clock', 'Out'].includes(k.type));
  const render = () => {
    const dil = top.shapeType === 'DIL';
    const rows = ports.map((k, i) => `<tr><td><b>${esc(attrsOf(k).Label || '?')}</b></td><td>${k.type === 'Out' ? 'Ausgang' : 'Eingang'}</td>
      ${dil ? `<td><input type="text" inputmode="numeric" class="pin-in" data-i="${i}" value="${esc(attrsOf(k).pinNumber || '')}" placeholder="auto"></td>` : ''}</tr>`).join('');
    openDialog(`<div class="dialog"><h2>„${esc(name)}“ als Baustein <button class="close">✕</button></h2>
      <div class="mod-grid"><div>
      <div class="field"><label>Beschreibung</label><input type="text" id="mDesc" value="${esc(top.Description || '')}" placeholder="z. B. Halbaddierer"></div>
      <div class="field"><label>Form</label><div class="chips">${[['DEFAULT', 'Rechteck'], ['DIL', 'DIL-Chip (wie 74xx)'], ['LAYOUT', 'Anschlüsse wie in der Schaltung'], ['MINIMIZED', 'Verkleinerte Schaltung']].map(([k, l]) => `<button class="chip ${(top.shapeType || 'DEFAULT') === k ? 'on' : ''}" data-shape="${k}">${l}</button>`).join('')}</div>
        <div class="hint">„Anschlüsse wie in der Schaltung“: Ein- und Ausgänge erscheinen auf der Seite, zu der sie in der Schaltung zeigen (Drehung).</div></div>
      <label class="switch"><span>Generische Schaltung (mit Parametern, z. B. Bitbreite)</span><input type="checkbox" id="mGen" ${top.isGeneric ? 'checked' : ''}></label>
      ${top.isGeneric ? '<div class="hint" style="margin-bottom:10px">Jedes Bauteil der Schaltung bekommt ein Feld „Generischer Code“ (z. B. <code>this.Bits = args.bits;</code>). Standardwerte legt das Bauteil „Generische Initialisierung“ fest (Sonstiges), beim Einsetzen gibst du die Parameter am Baustein an (z. B. <code>bits := 8;</code>).</div>' : ''}
      <div class="field"><label>Breite</label><div class="stepper"><button data-w="-1">−</button><input type="text" value="${top.Width ?? 3}" readonly><button data-w="1">+</button></div></div>
      ${dil ? `<div class="field"><label>Anzahl Pins</label><div class="stepper"><button data-pc="-2">−</button><input type="text" value="${top.pinCount || 'auto'}" readonly><button data-pc="2">+</button></div></div>` : ''}
      <div class="field"><label>Anschlüsse</label>
        ${ports.length ? `<table class="tt ports"><thead><tr><th>Name</th><th>Art</th>${dil ? '<th>Pin</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Lege in der Schaltung Ein- und Ausgänge mit Beschriftung an – sie werden zu den Anschlüssen.</p>'}
        <div class="hint">Die Reihenfolge entspricht der Reihenfolge, in der die Ein-/Ausgänge angelegt wurden.</div></div>
      </div><div class="mod-preview"><label>Vorschau</label><canvas id="mPrev"></canvas></div></div>
      <div class="row"><button class="btn primary" id="mDone">Fertig</button></div></div>`, true);
    requestAnimationFrame(() => { const cv = $('#mPrev'); if (cv) drawPreview(cv, 'Custom', {}, name); });
    const sh = $('#sheet');
    const changed = fn => { changeModule(name, fn); autosave(); editor.invalidate(); refreshPanel(); render(); };
    $('#mDesc').onchange = e => { top.Description = e.target.value; autosave(); };
    $('#mGen').onchange = e => changed(() => { top.isGeneric = e.target.checked; touchGenerics(); if (e.target.checked && !c.comps.some(k => k.type === 'GenericInitCode')) toast('Füge noch das Bauteil „Generische Initialisierung“ (Sonstiges) mit Standardwerten hinzu.', false, 5000); });
    sh.querySelectorAll('[data-shape]').forEach(b => (b.onclick = () => changed(() => { top.shapeType = b.dataset.shape; })));
    sh.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => changed(() => { top.Width = Math.max(2, Math.min(10, (top.Width ?? 3) + +b.dataset.w)); })));
    sh.querySelectorAll('[data-pc]').forEach(b => (b.onclick = () => changed(() => { const n = (top.pinCount || 0) + +b.dataset.pc; top.pinCount = n < 4 ? 0 : Math.min(48, n); })));
    sh.querySelectorAll('.pin-in').forEach(inp => (inp.onchange = () => {
      const k = ports[+inp.dataset.i]; const v = inp.value.trim();
      changed(() => { k.attrs.pinNumber = /^\d+$/.test(v) ? v : ''; });
      const nums = ports.map(p => attrsOf(p).pinNumber).filter(Boolean);
      if (new Set(nums).size !== nums.length) toast('Eine Pin-Nummer ist doppelt vergeben.', true);
    }));
    $('#mDone').onclick = () => { closeDialog(); if (name === current) commit(); buildPalette(); };
  };
  render();
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
      if (sim.paused) continue;
      const f = Math.max(0.1, a.Frequency || 1), half = 1 / (2 * f);
      let t = (acc.get(c.id) || 0) + dt, n = 0;
      // schnelle Takte: höchstens ~12 ms Rechenzeit pro Durchlauf, Messgraph nur gelegentlich
      while (t >= half) {
        t -= half; sim.st(c).value ^= 1; sim.update(c); changed = true;
        if (f <= 200 || ++n % Math.ceil(f / 100) === 0) recorder.sample(sim);
        if (sim.stopRequested || sim.breakHit || performance.now() - now > 12) { t = 0; break; }
      }
      acc.set(c.id, t);
    }
    if (changed) { checkOsc(); editor.redraw(); renderGraph(); }
  }, 16);
  editor.redraw(); updateUI(); updateFreqLabel();
}
function recordSample() { if (editor.sim && recorder.sample(editor.sim)) renderGraph(); }
function checkOsc() {
  const sim = editor.sim; if (!sim) return;
  if (sim.oscillating) { toast('Die Schaltung schwingt (instabile Rückkopplung) – Simulation gestoppt.', true, 5000); stopSim(); return; }
  if (sim.stopRequested) { toast('Die Simulation wurde durch das Stopp-Element beendet.', false, 4000); stopSim(); return; }
  const brk = sim.breakHit;
  if (brk && !sim.paused) { sim.paused = true; toast(`Haltepunkt${attrsOf(brk).Label ? ' „' + attrsOf(brk).Label + '“' : ''} erreicht – der Takt hält an. Zum Fortsetzen den Haltepunkt antippen.`, false, 5000); updateFreqLabel(); }
}
function stopSim() {
  if (!editor.sim) return;
  clearInterval(clockTimer); clockTimer = null;
  // beschriebene EEPROMs behalten ihren Inhalt (wie in Digital)
  let kept = false;
  for (const c of circuit.comps) {
    const st = editor.sim.st(c);
    if (DEF[c.type]?.hasData && st?.dirty) { c.attrs.Data = formatData(st.mem); kept = true; }
  }
  if (kept) commit();
  if ($('#memView')) closeDialog();
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

const FREQS = [1, 2, 5, 10, 20, 50, 1000, 100000];
const fLabel = f => (f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz');
function showFreq() {
  const clocks = circuit.comps.filter(c => c.type === 'Clock');
  if (!clocks.length) return toast('Die Schaltung hat keinen Takt-Eingang.');
  const cur = attrsOf(clocks[0]).Frequency || 1, auto = clocks.some(c => attrsOf(c).runRealTime);
  openDialog(`<div class="dialog"><h2>Takt <button class="close">✕</button></h2>
    <label class="switch"><span>Takt läuft automatisch</span><input type="checkbox" id="frAuto" ${auto ? 'checked' : ''}></label>
    <div class="field" style="margin-top:12px"><label>Frequenz</label><div class="chips">${FREQS.map(f => `<button class="chip ${f === cur ? 'on' : ''}" data-f="${f}">${f === 100000 ? 'max.' : fLabel(f)}</button>`).join('')}</div></div>
    <p class="muted">Gilt für alle Takte dieser Schaltung. „max.“ rechnet so schnell wie möglich (z. B. für Grafik oder VGA). Ohne Automatik schaltest du den Takt mit „Takt“ von Hand weiter.</p></div>`);
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
  const f = auto.length ? attrsOf(auto[0]).Frequency || 1 : 0;
  $('#freqLabel').textContent = !clocks.length ? 'Takt' : editor.sim?.paused ? 'Pause' : auto.length ? (f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz') : 'Hand';
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

// ---------- Anzeigen während der Simulation ----------
function showLiveView(c) {
  const def = DEF[c.type], a = attrsOf(c), st = editor.sim?.st(c); if (!st || !def.view) return;
  openDialog(`<div class="dialog" id="liveView"><h2>${esc(a.Label || def.name)} <button class="close">✕</button></h2><div id="liveBody" class="live-body"></div></div>`, true);
  const body = $('#liveBody');
  const draw = () => { if (!$('#liveView') || !editor.sim) return clearInterval(t); def.view(body, st, a); };
  const t = setInterval(draw, 150); draw();
}
function showKeyboard(c) {
  const a = attrsOf(c), st = editor.sim?.st(c); if (!st) return;
  openDialog(`<div class="dialog"><h2>Tastatur${a.Label ? ' ' + esc(a.Label) : ''} <button class="close">✕</button></h2>
    <p style="margin-top:0;color:#6b7280">Getippte Zeichen kommen in den Puffer. Die Schaltung liest sie mit en = 1 und einer Taktflanke an C.</p>
    <input type="text" id="kbIn" placeholder="hier tippen …" autocapitalize="off" autocomplete="off" spellcheck="false">
    <div class="row" style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="kbEnter">Zeilenende ↵</button><button class="btn" id="kbClear">Puffer leeren</button></div>
    <p>Puffer: <code id="kbBuf"></code></p></div>`);
  const show = () => { $('#kbBuf').textContent = JSON.stringify(st.buf).slice(1, -1) || '(leer)'; };
  const add = s => { st.buf += s; editor.sim.update(c); recordSample(); checkOsc(); editor.redraw(); show(); };
  const inp = $('#kbIn');
  inp.oninput = () => { if (inp.value) { add(inp.value); inp.value = ''; } };
  inp.onkeydown = e => { if (e.key === 'Enter') { add('\n'); e.preventDefault(); } };
  $('#kbEnter').onclick = () => add('\n');
  $('#kbClear').onclick = () => { st.buf = ''; editor.sim.update(c); editor.redraw(); show(); };
  show(); inp.focus();
}
function showRotate(c) {
  const st = editor.sim?.st(c); if (!st) return;
  openDialog(`<div class="dialog"><h2>Drehgeber <button class="close">✕</button></h2>
    <div class="row" style="display:flex;gap:12px;justify-content:center"><button class="btn big" id="rotL">⟲ links</button><button class="btn big" id="rotR">rechts ⟳</button></div></div>`);
  const turn = d => { st.pos += d; editor.sim.update(c); recordSample(); checkOsc(); editor.redraw(); };
  $('#rotL').onclick = () => turn(-1); $('#rotR').onclick = () => turn(1);
}

// ---------- Speicherinhalt (ROM/RAM/EEPROM/LUT) ----------
function showMemory(c, live) {
  const a = attrsOf(c), g = geoOf(c), def = DEF[c.type];
  const size = g.size || 16, bits = a.Bits || 8, m = mask(bits);
  const st = live ? editor.sim?.st(c) : null;
  if (live && !st) return;
  const data = live ? st.mem : parseData(a.Data);
  let fmt = a.intFormat === 'def' ? 'def' : a.intFormat === 'bin' ? 'bin' : 'hex';
  const per = fmt === 'bin' ? 4 : 8, pageSize = 256;
  let page = 0;
  const hexW = Math.ceil(bits / 4), addrW = Math.max(1, Math.ceil(Math.log2(size) / 4));
  const show = v => (fmt === 'hex' ? (v || 0).toString(16).toUpperCase().padStart(hexW, '0') : fmt === 'bin' ? (v || 0).toString(2).padStart(bits, '0') : String(v || 0));
  const parseCell = s => { s = s.trim(); if (!s) return 0; return fmt === 'hex' ? parseInt(s, 16) : fmt === 'bin' ? parseInt(s, 2) : parseNum(s); };
  const title = (a.Label ? a.Label + ' – ' : '') + def.name;
  openDialog(`<div class="dialog mem" id="memView"><h2>${esc(title)} <button class="close">✕</button></h2>
    <p style="margin-top:0;color:#6b7280">${size} Wörter × ${bits} Bit${live ? ' · aktueller Inhalt während der Simulation' : ''}. Werte antippen und ändern.</p>
    <div class="chips" id="memFmt">${[['hex', 'Hex'], ['def', 'Dezimal'], ['bin', 'Binär']].map(([k, l]) => `<button class="chip${k === fmt ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="mem-grid" id="memGrid"></div>
    <div class="mem-pages" id="memPages"></div>
    ${live ? '' : `<div class="row" style="margin-top:10px;gap:8px;display:flex;flex-wrap:wrap">
      <button class="btn" id="memImport">Datei laden (.hex/.bin/.txt)</button><button class="btn" id="memExport">Als Text speichern</button>
      <button class="btn red" id="memClear">Alles löschen</button><button class="btn primary" id="memOk" style="margin-left:auto">Übernehmen</button></div>`}
    </div>`);
  const render = () => {
    const grid = $('#memGrid'); if (!grid) return;
    const start = page * pageSize, end = Math.min(size, start + pageSize);
    let h = '<table><tbody>';
    for (let r = start; r < end; r += per) {
      h += `<tr><th>${r.toString(16).toUpperCase().padStart(addrW, '0')}</th>`;
      for (let k = r; k < Math.min(end, r + per); k++) h += `<td><input data-i="${k}" value="${show(data[k])}" inputmode="${fmt === 'def' ? 'numeric' : 'text'}" autocapitalize="off" spellcheck="false"></td>`;
      h += '</tr>';
    }
    grid.innerHTML = h + '</tbody></table>';
    const pages = Math.ceil(size / pageSize);
    $('#memPages').innerHTML = pages > 1 ? Array.from({ length: Math.min(pages, 64) }, (_, i) => `<button class="chip${i === page ? ' on' : ''}" data-p="${i}">${(i * pageSize).toString(16).toUpperCase()}</button>`).join('') + (pages > 64 ? ' …' : '') : '';
  };
  render();
  $('#memPages').onclick = e => { if (e.target.dataset.p) { page = +e.target.dataset.p; render(); } };
  $('#memFmt').onclick = e => { const f = e.target.dataset.f; if (!f) return; fmt = f; $('#memFmt').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.f === f)); render(); };
  $('#memGrid').addEventListener('change', e => {
    const i = +e.target.dataset.i; const v = parseCell(e.target.value);
    if (v == null || Number.isNaN(v)) { e.target.value = show(data[i]); return toast('Ungültiger Wert', true); }
    data[i] = v % (m + 1); e.target.value = show(data[i]);
    if (live) { if (def.hasData) st.dirty = true; editor.sim.update(c); recordSample(); editor.redraw(); }
  });
  if (live) {
    // während der Simulation regelmäßig auffrischen (nicht das Feld, das gerade bearbeitet wird)
    const t = setInterval(() => {
      if (!$('#memView') || !editor.sim) return clearInterval(t);
      $('#memGrid').querySelectorAll('input').forEach(inp => { if (inp !== document.activeElement) { const v = show(data[+inp.dataset.i]); if (inp.value !== v) inp.value = v; } });
    }, 250);
    return;
  }
  $('#memOk').onclick = () => { c.attrs.Data = formatData(data); commit(); renderProps(); closeDialog(); };
  $('#memClear').onclick = () => { data.length = 0; render(); };
  $('#memExport').onclick = () => download(new File(['v2.0 raw\n' + Array.from({ length: Math.max(1, data.length) }, (_, i) => (data[i] || 0).toString(16)).join('\n') + '\n'], (a.Label || c.type) + '.hex', { type: 'text/plain' }));
  $('#memImport').onclick = () => {
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.hex,.bin,.txt,.dat,.ihex';
    fi.onchange = async () => {
      const f = fi.files[0]; if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer());
      const vals = importMemory(f.name, buf, bits);
      data.length = 0; vals.slice(0, size).forEach((v, i) => (data[i] = v % (m + 1)));
      render(); toast(`${Math.min(vals.length, size)} Werte geladen.`);
    };
    fi.click();
  };
}
// Speicherdateien: Intel-HEX, Logisim "v2.0 raw", Text mit Hex-Werten oder Binärdaten
function importMemory(name, buf, bits) {
  const text = new TextDecoder().decode(buf);
  const out = [];
  const bytesPerWord = Math.ceil(bits / 8);
  if (/^\s*:[0-9A-Fa-f]{10}/.test(text)) {
    const bytes = []; let base = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(':')) continue;
      const n = parseInt(line.substr(1, 2), 16), addr = parseInt(line.substr(3, 4), 16), type = parseInt(line.substr(7, 2), 16);
      if (type === 0) for (let i = 0; i < n; i++) bytes[base + addr + i] = parseInt(line.substr(9 + 2 * i, 2), 16);
      else if (type === 2) base = parseInt(line.substr(9, 4), 16) * 16;
      else if (type === 4) base = parseInt(line.substr(9, 4), 16) * 65536;
    }
    for (let i = 0; i < bytes.length; i += bytesPerWord) { let v = 0; for (let k = 0; k < bytesPerWord; k++) v += (bytes[i + k] || 0) * 256 ** k; out.push(v); }
    return out;
  }
  const printable = buf.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127));
  if (printable && !/\.bin$/i.test(name)) {
    for (let line of text.split(/\r?\n/)) {
      line = line.replace(/#.*/, '').trim();
      if (!line || /^v2\.0/i.test(line)) continue;
      for (const tok of line.split(/[\s,;]+/)) {
        if (!tok) continue;
        const mm = tok.match(/^(\d+)\*([0-9a-fA-F]+)$/);
        if (mm) for (let i = 0; i < +mm[1]; i++) out.push(parseInt(mm[2], 16));
        else out.push(parseInt(tok.replace(/^0x/i, ''), 16) || 0);
      }
    }
    return out;
  }
  for (let i = 0; i < buf.length; i += bytesPerWord) { let v = 0; for (let k = 0; k < bytesPerWord; k++) v += (buf[i + k] || 0) * 256 ** k; out.push(v); }
  return out;
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

// Angedocktes Panel neben der Schaltung (Wahrheitstabelle, Schaltwerk-Analyse)
let panelFn = null;
function openPanel(html, fn) {
  const p = $('#tablePanel');
  const wasOpen = p.classList.contains('open');
  const scroll = p.scrollTop;
  p.innerHTML = html;
  p.classList.add('open');
  panelFn = fn;
  p.querySelectorAll('.close').forEach(b => (b.onclick = closePanel));
  if (wasOpen) p.scrollTop = scroll;
  else requestAnimationFrame(() => { editor.resize(); editor.fit(); });
  return p;
}
function closePanel() {
  const p = $('#tablePanel');
  if (!p.classList.contains('open')) return;
  p.classList.remove('open'); p.innerHTML = ''; panelFn = null;
  requestAnimationFrame(() => { editor.resize(); editor.fit(); });
}
const panelOpen = () => $('#tablePanel').classList.contains('open');
// nach Änderungen an der Schaltung neu berechnen (nicht im Übungsmodus, damit Eingaben bleiben)
function refreshPanel() { if (panelOpen() && panelFn && !tableFill) panelFn(true); }

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
        <button class="btn" data-look="${esc(n)}">Aussehen</button><button class="btn" data-ren="${esc(n)}">Umbenennen</button><button class="btn red" data-del="${esc(n)}">Löschen</button></div></div>`;
  }).join('');
  openDialog(`<div class="dialog"><h2>Schaltungen im Projekt <button class="close">✕</button></h2>
    <p class="muted">Jede Schaltung kann in den anderen als <b>Baustein</b> eingesetzt werden (Palette links, „Eigene Bausteine“). Die Anschlüsse des Bausteins sind die beschrifteten Ein- und Ausgänge.</p>
    <div class="doc-list">${rows}</div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="docNew">＋ Neue Schaltung</button></div></div>`);
  $('#sheet').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'docNew') { closeDialog(); addDoc('Schaltung', new Circuit()); toast('Neue Schaltung angelegt – die anderen findest du jetzt links als Baustein.'); }
    if (b.dataset.open) { closeDialog(); setCurrent(b.dataset.open); }
    if (b.dataset.look) showModuleSettings(b.dataset.look);
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
  const item = (a, ico, title, sub) => `<button class="menu-item" data-a="${a}"><span class="ico">${ico}</span><span><b>${title}</b><small>${sub}</small></span></button>`;
  const ex = EXAMPLES.map((e, i) => `<button class="menu-item" data-ex="${i}"><span class="ico">⚡</span><span><b>${e.name}</b><small>${e.desc}</small></span></button>`).join('');
  openDialog(`<div class="dialog menu"><h2>Menü <button class="close">✕</button></h2>
    <h3>Datei</h3><div class="menu-list">
      ${item('open', '📂', 'Öffnen …', '.dig- oder .zip-Dateien, auch mehrere')}
      ${item('save', '💾', 'Speichern …', 'Als .dig sichern oder teilen')}
    </div>
    <h3>Exportieren</h3><div class="menu-list">
      ${item('png', '🖼', 'Als Bild', 'PNG der aktuellen Ansicht')}
      ${item('hdl', '⌨', 'Als Verilog / VHDL', 'Hardwarebeschreibung der Schaltung')}
    </div>
    <h3>Projekt <span class="h3-sub">„${esc(current)}“ · ${library.size} Schaltung${library.size > 1 ? 'en' : ''}</span></h3><div class="menu-list">
      ${item('new', '＋', 'Neue Schaltung', 'Im Projekt – nutzbar als Baustein')}
      ${item('modlook', '⬚', 'Aussehen als Baustein', 'Rechteck oder DIL-Chip, Pins, Breite')}
      ${item('docs', '🗂', 'Schaltungen verwalten', 'Wechseln, umbenennen, löschen')}
      ${item('newproj', '🗑', 'Neues Projekt', 'Alle Schaltungen schließen')}
    </div>
    <h3>Schaltung erzeugen aus …</h3><div class="menu-list">
      ${item('formula', 'ƒ', 'Formel', 'Booleschen Ausdruck eingeben')}
      ${item('ttedit', '▦', 'Wahrheitstabelle', 'Werte eintragen, auch X')}
      ${item('fsm', '⟳', 'Automat', 'Zustandsdiagramm zeichnen')}
    </div>
    <h3>Beispiele</h3><div class="menu-list">${ex}</div>
    <h3>Einstellungen &amp; Hilfe</h3>
    <div class="row" style="margin-bottom:10px"><span style="font-size:15px">Schaltzeichen:</span>
      <div class="chips"><button class="chip ${settings.shapes !== 'ieee' ? 'on' : ''}" data-shape="iec">DIN / IEC (&amp;, ≥1)</button><button class="chip ${settings.shapes === 'ieee' ? 'on' : ''}" data-shape="ieee">IEEE (amerikanisch)</button></div></div>
    <div class="menu-list">${item('help', '？', 'Bedienung', "So funktioniert's auf dem iPad")}</div>
    <p class="muted" style="margin-top:16px">Digital Web · ${VERSION}</p>
  </div>`);
  $('#sheet').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ex) { loadExample(EXAMPLES[+b.dataset.ex]); closeDialog(); }
    if (b.dataset.shape) { settings.shapes = b.dataset.shape; saveSettings(); buildPalette(); editor.invalidate(); showMenu(); }
    switch (b.dataset.a) {
      case 'new': closeDialog(); addDoc('Schaltung', new Circuit()); break;
      case 'docs': showDocs(); break;
      case 'modlook': showModuleSettings(); break;
      case 'open': closeDialog(); $('#fileInput').click(); break;
      case 'save': showSave(); break;
      case 'formula': showFormula(); break;
      case 'ttedit': showTTEditor(); break;
      case 'fsm': closeDialog(); openFsm(); break;
      case 'png': exportPng(); closeDialog(); break;
      case 'hdl': closeDialog(); showHdl(); break;
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
// Verilog / VHDL anzeigen, kopieren, speichern
async function showHdl(lang = 'verilog') {
  const { toVerilog, toVHDL } = await import('./hdl.js');
  let text, err = null;
  try { text = lang === 'verilog' ? toVerilog(circuit, current) : toVHDL(circuit, current); } catch (e) { err = e.message; }
  openDialog(`<div class="dialog"><h2>Hardwarebeschreibung <button class="close">✕</button></h2>
    <div class="chips" id="hdlLang"><button class="chip ${lang === 'verilog' ? 'on' : ''}" data-l="verilog">Verilog</button><button class="chip ${lang === 'vhdl' ? 'on' : ''}" data-l="vhdl">VHDL</button></div>
    ${err ? `<div class="note">${esc(err)}</div>` : `<pre class="hdl">${esc(text)}</pre>
    <div class="row" style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="hdlCopy">Kopieren</button><button class="btn primary" id="hdlSave">Speichern (.${lang === 'verilog' ? 'v' : 'vhd'})</button></div>`}
    <p class="muted">Bausteine werden aufgelöst (eine flache Beschreibung). Schalter, Transistoren und Anzeigen-Geräte haben keine Entsprechung.</p></div>`, true);
  $('#hdlLang').onclick = e => { const l = e.target.dataset.l; if (l && l !== lang) showHdl(l); };
  if (err) return;
  $('#hdlCopy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Kopiert.'); } catch { toast('Kopieren nicht möglich', true); } };
  $('#hdlSave').onclick = () => download(new File([text], current.replace(/[^\w-]+/g, '_') + (lang === 'verilog' ? '.v' : '.vhd'), { type: 'text/plain' }));
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
    const main = names.find(n => !names.some(m => m !== n && loaded[m].comps.some(k => k.type === 'Custom' && k.sub === n))) || names[0];
    // Bausteine aus der 74xx-Bibliothek nachladen
    await ensureChips(Object.values(loaded));
    const missing = new Set();
    for (const c of Object.values(loaded)) for (const k of c.comps) if (k.type === 'Custom' && !getCircuit(k.sub)) missing.add(k.sub);
    for (const c of sysLib.values()) for (const k of c.comps) if (k.type === 'Unknown') unknown.add(k.attrs.elementName);
    setCurrent(main);
    if (missing.size) toast('Es fehlen Bausteine: ' + [...missing].join(', ') + ' – bitte die .dig-Dateien mit auswählen.', true, 7000);
    else if (unknown.size) toast('Noch nicht unterstützt: ' + [...unknown].join(', '), true, 6000);
    else if (names.length > 1) toast(`${names.length} Schaltungen geladen.`);
  } catch (err) { console.error(err); toast(err.message || 'Datei konnte nicht gelesen werden.', true, 4000); }
});

// ---------- Wahrheitstabelle, KV, Synthese ----------
const GATE_TYPES = ['And', 'Or', 'Not', 'NAnd', 'NOr', 'XOr', 'XNOr'];
let tableAllGates = false;
let tableFill = false;              // Übungsmodus: Ausgänge selbst ausfüllen
let fillAnswers = new Map();
const exprHTML = e => toHTML(termsToAST(e.terms, e.vars.length, e.vars));
const exprText = e => toText(termsToAST(e.terms, e.vars.length, e.vars));

const panelMsg = (title, msg) => openPanel(`<div class="dialog"><h2>${title} <button class="close">✕</button></h2><p class="muted">${esc(msg)}</p></div>`, showTable);
function showTable(refresh = false) {
  const seq = circuit.comps.some(c => ['D_FF', 'JK_FF', 'T_FF', 'RS_FF'].includes(c.type));
  if (seq && !showTable.combinational) return showStateAnalysis(refresh);
  if (!seq) showTable.combinational = false;
  let t;
  try { t = truthTable(circuit, { allGates: tableAllGates }); } catch (e) { if (refresh || panelOpen()) panelMsg('Wahrheitstabelle', e.message); else toast(e.message, true); return; }
  const cols = [
    ...t.inputs.map(c => ({ ...c, kind: 'in' })),
    ...t.steps.map((c, j) => ({ ...c, kind: 'step', first: j === 0 })),
    ...t.outputs.map((c, j) => ({ ...c, kind: 'out', first: j === 0 })),
  ];
  const head = cols.map(c => `<th class="${c.kind} ${c.first ? 'sepcol' : ''}">${esc(c.name)}${c.auto ? '<sup>*</sup>' : ''}</th>`).join('');
  const cell = (v, c, r, i) => {
    if (tableFill && c.kind !== 'in') {
      const key = r + ':' + i, a = fillAnswers.get(key);
      return `<td class="${c.kind} ${c.first ? 'sepcol' : ''}"><button class="cellbtn" data-cell="${key}" data-bits="${c.bits}">${a ?? ''}</button></td>`;
    }
    return `<td class="${c.kind} ${c.first ? 'sepcol' : ''} ${c.bits === 1 ? (v ? 'one' : 'zero') : ''}">${v == null ? 'Z' : formatValue(v, c.bits)}</td>`;
  };
  const all = r => [...r.ins, ...r.steps, ...r.outs];
  const body = t.rows.map((r, ri) => '<tr>' + all(r).map((v, i) => cell(v, cols[i], ri, i)).join('') + '</tr>').join('');
  const exprList = list => list.map(e => `<div class="expr"><b>${esc(e.name)}</b> = ${exprHTML(e)}</div>`).join('');
  const expr = !tableFill && t.expressions?.length ? '<h3>Disjunktive Minimalform (DMF)</h3>' + exprList(t.expressions)
    + (t.stepExpressions?.length ? '<details class="steps-dmf"><summary>DMF der Zwischenschritte</summary>' + exprList(t.stepExpressions) + '</details>' : '') : '';
  const hasGates = circuit.comps.some(c => GATE_TYPES.includes(c.type) || c.type === 'Custom');
  const kvOk = !tableFill && t.expressions?.some(e => e.vars.length >= 2 && e.vars.length <= 4);
  const root = openPanel(`<div class="dialog"><h2>Wahrheitstabelle <button class="close">✕</button></h2>
    ${t.sequential ? '<div class="note">Die Schaltung enthält Speicherglieder oder Takte. Die Tabelle zeigt nur das Verhalten ausgehend vom aktuellen Zustand.</div>' : ''}
    ${t.oscillating ? '<div class="note">Die Schaltung schwingt – die Werte sind nicht zuverlässig.</div>' : ''}
    <div class="tt-switches">
    ${hasGates ? `<label class="switch tt-switch"><span>Alle Gatter und Bausteine als Zwischenschritte</span><input type="checkbox" id="ttAll" ${tableAllGates ? 'checked' : ''}></label>` : ''}
    <label class="switch tt-switch"><span>Übung: selbst ausfüllen</span><input type="checkbox" id="ttFill" ${tableFill ? 'checked' : ''}></label></div>
    ${tableFill ? '<p class="muted">Lies die Schaltung ab und tippe in die leeren Felder (0 → 1 → leer). Dann „Prüfen“.</p>' : ''}
    <div class="tt-wrap"><table class="tt ${tableFill ? 'fill' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="tt-hint">${t.steps.length ? '<span class="legend step"></span> Zwischenschritte' + (t.steps.some(s => s.auto) ? ' (* = automatisch benannt, von links nach rechts)' : '') + ' · ' : ''}Tipp: Gib einem Gatter oder Baustein eine <b>Beschriftung</b> (z. B. Z1 oder HA1), dann erscheint es hier als Zwischenschritt.</p>
    ${expr}
    <div class="row" style="margin-top:14px">${tableFill ? '<button class="btn primary" id="ttCheck">Prüfen</button><button class="btn" id="ttReset">Leeren</button><span id="ttScore" class="score"></span>' : `<button class="btn" id="copyCsv">Als Tabelle kopieren</button>${kvOk ? '<button class="btn" id="showKV">KV-Diagramm</button>' : ''}${t.expressions?.length ? '<button class="btn" id="buildDMF">Schaltung aus DMF erzeugen</button>' : ''}`}</div></div>`, showTable);
  const allSw = $('#ttAll');
  if (allSw) allSw.onchange = () => { tableAllGates = allSw.checked; fillAnswers.clear(); showTable(); };
  $('#ttFill').onchange = e => { tableFill = e.target.checked; fillAnswers.clear(); showTable(); };
  if (tableFill) {
    root.querySelector('table').onclick = e => {
      const b = e.target.closest('.cellbtn'); if (!b) return;
      const cur = fillAnswers.get(b.dataset.cell);
      const bits = +b.dataset.bits;
      let v;
      if (bits === 1) v = cur === undefined ? '0' : cur === '0' ? '1' : undefined;
      else { const n = prompt('Wert eingeben:', cur ?? ''); v = n === null || n === '' ? undefined : n.trim(); }
      if (v === undefined) fillAnswers.delete(b.dataset.cell); else fillAnswers.set(b.dataset.cell, v);
      b.textContent = v ?? ''; b.classList.remove('right', 'wrong');
    };
    $('#ttCheck').onclick = () => {
      let right = 0, total = 0;
      root.querySelectorAll('.cellbtn').forEach(b => {
        const [ri, ci] = b.dataset.cell.split(':').map(Number);
        const v = all(t.rows[ri])[ci], c = cols[ci];
        const exp = v == null ? 'Z' : formatValue(v, c.bits);
        const a = fillAnswers.get(b.dataset.cell);
        const ok = a !== undefined && (a === exp || parseNum(a) === v);
        total++; if (ok) right++;
        b.classList.toggle('right', ok); b.classList.toggle('wrong', !ok);
      });
      $('#ttScore').textContent = `${right} von ${total} richtig` + (right === total ? ' 🎉' : '');
    };
    $('#ttReset').onclick = () => { fillAnswers.clear(); showTable(); };
    return;
  }
  $('#copyCsv').onclick = async () => {
    const lines = [cols.map(x => x.name).join('\t'), ...t.rows.map(r => all(r).map(v => v ?? 'Z').join('\t'))];
    if (t.expressions) lines.push('', ...t.expressions.map(e => e.name + ' = ' + exprText(e)));
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Kopiert – kann in Numbers/Excel eingefügt werden.'); } catch { toast('Kopieren nicht möglich', true); }
  };
  const kv = $('#showKV'); if (kv) kv.onclick = () => showKV([...t.expressions, ...(t.stepExpressions || [])], showTable);
  const bd = $('#buildDMF'); if (bd) bd.onclick = () => buildFromDMF(t);
}

function showKV(exprs, back) {
  const blocks = exprs.filter(e => e.vars.length >= 2 && e.vars.length <= 4).map(e => {
    const terms = termsToAST(e.terms, e.vars.length, e.vars);
    const prods = terms.op === 'or' ? terms.args : [terms];
    const chips = e.terms.length && e.terms[0].m !== 2 ** e.vars.length - 1
      ? prods.map((p, k) => `<span class="term" style="border-color:${KV_COLORS[k % KV_COLORS.length]};color:${KV_COLORS[k % KV_COLORS.length]}">${toHTML(p, 2)}</span>`).join('<span class="or"> ∨ </span>')
      : toHTML(terms);
    return `<div class="kv-block"><h4>${esc(e.name)}</h4>${kvSVG(e)}<div class="expr">${esc(e.name)} = ${chips}</div></div>`;
  }).join('');
  openDialog(`<div class="dialog"><h2>KV-Diagramme <button class="close">✕</button></h2>
    <p class="muted">Die farbigen Blöcke sind die Primimplikanten der disjunktiven Minimalform. X = beliebig (don't care). Kleine Zahlen = Zeilennummer in der Wahrheitstabelle.</p>
    <div class="kv-grid">${blocks || '<p class="muted">KV-Diagramme gibt es für 2 bis 4 Eingänge.</p>'}</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="kvBack">← Zurück</button></div></div>`, true);
  $('#kvBack').onclick = () => { closeDialog(); back(); };
}

// ---------- Wahrheitstabelle selbst eingeben ----------
const tt = { n: 3, ins: 'A B C', outs: 'Y', vals: {} };
const LETTERS = 'ABCDEF';
function ttNames(str, n, fallback) {
  const a = String(str).split(/[\s,;]+/).filter(x => /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*$/.test(x));
  return Array.from({ length: n }, (_, i) => a[i] || fallback(i));
}
function showTTEditor() {
  const n = tt.n, ins = ttNames(tt.ins, n, i => LETTERS[i]);
  const outs = ttNames(tt.outs, Math.max(1, Math.min(4, String(tt.outs).split(/[\s,;]+/).filter(Boolean).length || 1)), i => 'Y' + (i ? i + 1 : ''));
  for (const o of outs) { if (!tt.vals[o] || tt.vals[o].length !== 2 ** n) tt.vals[o] = Array(2 ** n).fill(0); }
  const exprs = outs.map(o => columnExpr(o, ins, tt.vals[o]));
  const head = ins.map(x => `<th>${esc(x)}</th>`).join('') + outs.map((o, j) => `<th class="${j ? '' : 'sepcol'}">${esc(o)}</th>`).join('');
  const body = Array.from({ length: 2 ** n }, (_, r) => '<tr>' + ins.map((_, i) => `<td>${(r >> (n - 1 - i)) & 1}</td>`).join('')
    + outs.map((o, j) => { const v = tt.vals[o][r]; return `<td class="${j ? '' : 'sepcol'}"><button class="cellbtn val ${v === 'X' ? 'x' : v ? 'one' : ''}" data-o="${esc(o)}" data-r="${r}">${v}</button></td>`; }).join('') + '</tr>').join('');
  openDialog(`<div class="dialog"><h2>Wahrheitstabelle eingeben <button class="close">✕</button></h2>
    <div class="tt-setup">
      <div class="field"><label>Anzahl Eingänge</label><div class="stepper"><button data-n="-1">−</button><input type="text" value="${n}" readonly><button data-n="1">+</button></div></div>
      <div class="field"><label>Namen der Eingänge</label><input type="text" id="ttIns" value="${esc(ins.join(' '))}" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label>Namen der Ausgänge (bis 4)</label><input type="text" id="ttOuts" value="${esc(outs.join(' '))}" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
    </div>
    <p class="muted">Ausgangswerte antippen: 0 → 1 → X (beliebig / don't care) → 0.</p>
    <div class="tt-wrap"><table class="tt edit"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <h3>Disjunktive Minimalform (DMF)</h3><div id="ttExpr">${exprs.map(e => `<div class="expr"><b>${esc(e.name)}</b> = ${exprHTML(e)}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px">${n >= 2 && n <= 4 ? '<button class="btn" id="ttKV">KV-Diagramm</button>' : ''}<button class="btn primary" id="ttBuild">Schaltung erzeugen</button><button class="btn" id="ttClear">Alle auf 0</button></div></div>`, true);
  const sh = $('#sheet');
  sh.querySelectorAll('[data-n]').forEach(b => (b.onclick = () => { tt.n = Math.max(1, Math.min(6, tt.n + +b.dataset.n)); tt.ins = ttNames(tt.ins, tt.n, i => LETTERS[i]).join(' '); showTTEditor(); }));
  $('#ttIns').onchange = e => { tt.ins = e.target.value; showTTEditor(); };
  $('#ttOuts').onchange = e => { tt.outs = e.target.value; showTTEditor(); };
  sh.querySelector('table').onclick = e => {
    const b = e.target.closest('.cellbtn'); if (!b) return;
    const arr = tt.vals[b.dataset.o], r = +b.dataset.r;
    arr[r] = arr[r] === 0 ? 1 : arr[r] === 1 ? 'X' : 0;
    b.textContent = arr[r]; b.className = 'cellbtn val ' + (arr[r] === 'X' ? 'x' : arr[r] ? 'one' : '');
    $('#ttExpr').innerHTML = outs.map(o => columnExpr(o, ins, tt.vals[o])).map(e => `<div class="expr"><b>${esc(e.name)}</b> = ${exprHTML(e)}</div>`).join('');
  };
  const kv = $('#ttKV'); if (kv) kv.onclick = () => showKV(outs.map(o => columnExpr(o, ins, tt.vals[o])), showTTEditor);
  $('#ttClear').onclick = () => { for (const o of outs) tt.vals[o] = Array(2 ** n).fill(0); showTTEditor(); };
  $('#ttBuild').onclick = () => {
    const defs = outs.map(o => { const e = columnExpr(o, ins, tt.vals[o]); return { name: o, ast: termsToAST(e.terms, n, ins) }; });
    closeDialog();
    const name = addDoc(outs.join(', ') + ' (Tabelle)', buildCircuit(defs));
    toast(`Schaltung „${name}“ aus der Tabelle erzeugt.`);
  };
}

// ---------- Schaltwerk-Analyse ----------
function showStateAnalysis(refresh = false) {
  let a;
  try { a = stateAnalysis(circuit); } catch (e) { if (refresh || panelOpen()) openPanel(`<div class="dialog"><h2>Schaltwerk-Analyse <button class="close">✕</button></h2><p class="muted">${esc(e.message)}</p></div>`, showStateAnalysis); else toast(e.message, true, 4000); return; }
  const k = a.states.length, code = v => v.toString(2).padStart(k, '0');
  const head = a.states.map(q => `<th class="step">${esc(q)}</th>`).join('') + a.inputs.map(x => `<th>${esc(x)}</th>`).join('')
    + a.states.map((q, i) => `<th class="step ${i ? '' : 'sepcol'}">${esc(q)}⁺</th>`).join('')
    + a.ffInputs.map((x, i) => `<th class="exc ${i ? '' : 'sepcol'}">${esc(x)}</th>`).join('')
    + a.outputs.map((o, i) => `<th class="${i ? '' : 'sepcol'}">${esc(o)}</th>`).join('');
  const td = (v, cls = '') => `<td class="${cls} ${v ? 'one' : 'zero'}">${v}</td>`;
  const body = a.rows.map(r => '<tr>' + r.stateBits.map(b => td(b, 'step')).join('') + r.inBits.map(b => td(b)).join('')
    + r.nextBits.map((b, i) => td(b, 'step ' + (i ? '' : 'sepcol'))).join('') + r.exc.map((b, i) => td(b, 'exc ' + (i ? '' : 'sepcol'))).join('')
    + r.outs.map((b, i) => td(b, i ? '' : 'sepcol')).join('') + '</tr>').join('');
  // Zustandsdiagramm
  const nodes = Array.from({ length: 2 ** k }, (_, st) => {
    const r = a.rows.find(x => x.state === st);
    return { id: st, label: code(st), sub: a.moore && a.outputs.length ? a.outputs.map((o, j) => r.outs[j]).join('') : '', initial: st === 0 };
  });
  const edges = a.rows.map(r => ({ from: r.state, to: r.next, label: (a.inputs.length ? r.inBits.join('') : '') + (!a.moore && a.outputs.length ? '/' + r.outs.join('') : '') }));
  const legend = `Zustand: ${a.states.map(esc).join('')}${a.moore && a.outputs.length ? ' · im Kreis unten: ' + a.outputs.map(esc).join('') : ''}${a.inputs.length ? ' · Pfeile: ' + a.inputs.map(esc).join('') + (!a.moore && a.outputs.length ? ' / ' + a.outputs.map(esc).join('') : '') : ''}`;
  const eq = list => list.map(e => `<div class="expr"><b>${esc(e.name)}</b> = ${exprHTML(e)}</div>`).join('');
  openPanel(`<div class="dialog"><h2>Schaltwerk-Analyse <button class="close">✕</button></h2>
    <p class="muted">${a.moore ? 'Moore-Automat' : a.outputs.length ? 'Mealy-Automat' : 'Automat'} mit ${k} Flipflop${k > 1 ? 's' : ''} (${2 ** k} Zustände). Spalten: Zustand · Eingänge · Folgezustand (⁺) · <span class="legend exc"></span> Ansteuerung der Flipflops · Ausgänge.</p>
    <div class="tt-wrap"><table class="tt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <h3>Zustandsdiagramm</h3><p class="muted">${legend}</p><div class="diagram">${stateDiagramSVG(nodes, edges)}</div>
    <h3>Folgezustände (DMF)</h3>${eq(a.eqs.next)}
    <h3>Ansteuergleichungen</h3>${eq(a.eqs.exc)}
    ${a.outputs.length ? '<h3>Ausgänge</h3>' + eq(a.eqs.outs) : ''}
    <div class="row" style="margin-top:14px"><button class="btn" id="saComb">Kombinatorische Tabelle</button></div></div>`, showStateAnalysis);
  $('#saComb').onclick = () => { showTable.combinational = true; showTable(); };
}

// ---------- Automaten-Editor ----------
let fsmEditor = null;
function openFsm() {
  if (!fsmEditor) fsmEditor = new FsmEditor({
    toast, openDialog, closeDialog,
    onBuild: c => { const n = addDoc('Automat', c); toast(`Schaltung „${n}“ erzeugt – mit „Start“ und „Takt“ ausprobieren.`, false, 4500); },
  });
  stopSim();
  fsmEditor.open();
}

function buildFromDMF(t) {
  closePanel();
  const defs = t.expressions.map(e => ({ name: e.name, ast: termsToAST(e.terms, e.vars.length, e.vars) }));
  closeDialog();
  const n = addDoc(current + ' (DMF)', buildCircuit(defs));
  toast(`Neue Schaltung „${n}“ aus der DMF erzeugt.`);
}

// Überstrich setzen/entfernen: markierter Bereich, sonst Variable oder Klammer direkt vor dem Cursor
function toggleOverline(ta) {
  const v = ta.value;
  let s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? s;
  if (s === e) {
    let i = s;
    while (i > 0 && v[i - 1] === OV) i--;
    if (i > 0 && v[i - 1] === ')') {
      let depth = 0, j = i - 1;
      for (; j >= 0; j--) { if (v[j] === ')') depth++; else if (v[j] === '(') { depth--; if (!depth) break; } }
      if (j < 0) return false;
      s = j; e = i;
    } else {
      let j = i;
      while (j > 0 && /[A-Za-z0-9ÄÖÜäöüß_\u0305]/.test(v[j - 1])) j--;
      if (j === i) return false;
      s = j; e = i;
    }
    while (e < v.length && v[e] === OV) e++;
  }
  const part = v.slice(s, e);
  const chars = [...part.replace(/\u0305/g, '').replace(/\s+/g, '')];
  const allOver = chars.length && [...part.replace(/\s+/g, '')].filter(ch => ch !== OV).length * 2 === [...part.replace(/\s+/g, '')].length;
  const out = allOver ? chars.join('') : chars.map(ch => ch + OV).join('');
  ta.value = v.slice(0, s) + out + v.slice(e);
  ta.selectionStart = ta.selectionEnd = s + out.length;
  return true;
}

function showFormula(preset = '') {
  openDialog(`<div class="dialog"><h2>Schaltung aus Formel <button class="close">✕</button></h2>
    <div class="field"><label>Ausdrücke (eine Gleichung pro Zeile)</label>
      <textarea id="fIn" class="formula" rows="3" placeholder="Y = A ∧ B${OV} ∨ A${OV} ∧ B" autocapitalize="characters" autocomplete="off" spellcheck="false">${esc(preset)}</textarea></div>
    <div class="keys"><button class="chip ov-key" data-k="ov" title="Überstrich (Negation)"><span class="ov">&nbsp;A&nbsp;</span> Strich</button>${['∧', '∨', '⊕', '(', ')', '='].map(k => `<button class="chip" data-k="${k}">${k}</button>`).join('')}</div>
    <p class="muted"><b>Negieren:</b> Variable oder Klammerausdruck markieren – oder direkt dahinter tippen – und „Strich“ drücken. Nochmal drücken entfernt den Strich.<br>
    Auch per Tastatur möglich: ∧ &amp; * (und), ∨ | + (oder), ⊕ ^ (xor), ¬ ! / (nicht).</p>
    <div id="fPrev" class="expr-preview"></div>
    <div class="row"><button class="btn primary" id="fBuild">Schaltung erzeugen</button></div></div>`);
  const ta = $('#fIn');
  const prev = () => {
    try { const defs = parseEquations(ta.value); $('#fPrev').innerHTML = defs.map(d => `<div class="expr"><b>${esc(d.name)}</b> = ${toHTML(d.ast)}</div>`).join(''); }
    catch (e) { $('#fPrev').innerHTML = ta.value.trim() ? `<div class="err">${esc(e.message)}</div>` : ''; }
  };
  ta.oninput = prev; prev();
  // Tasten sollen den Fokus (und die Markierung) im Textfeld nicht wegnehmen
  $('#sheet').querySelector('.keys').addEventListener('pointerdown', e => e.preventDefault());
  $('#sheet').querySelector('.keys').onclick = e => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    if (k === 'ov') { if (!toggleOverline(ta)) toast('Erst eine Variable tippen oder einen Bereich markieren.'); }
    else {
      const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
      const ins = k === '=' ? ' = ' : k === '(' || k === ')' ? k : ' ' + k + ' ';
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + ins.length;
    }
    ta.focus(); prev();
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
    <li><b>Bausteine (Module):</b> Jede Schaltung im Projekt kann links unter „Eigene Bausteine“ in andere Schaltungen eingesetzt werden; ihre Anschlüsse sind die beschrifteten Ein- und Ausgänge. Am schnellsten geht es so: Teil der Schaltung mit „Auswahl“ markieren → rechts „Als Baustein zusammenfassen“. Unter „Menü → Aussehen als Baustein“ wählst du Rechteck oder DIL-Chip und die Pin-Nummern.</li>
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
$('#btnTable').onclick = () => (panelOpen() ? closePanel() : showTable());
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

// Speicherstände bis Version 7 nutzten andere Standardwerte – fehlende Werte ergänzen
function migrateV2(j) {
  const OLD = {
    Clock: { Label: 'C', runRealTime: true }, Tunnel: { NetName: 'T' }, Splitter: { 'Input Splitting': '4', 'Output Splitting': '1,1,1,1' },
    Counter: { Bits: 4 }, Register: { Bits: 8 }, Text: { Description: 'Text' }, Testcase: { Testdata: 'A B Y\n0 0 0\n0 1 0\n1 0 0\n1 1 1' },
  };
  for (const k of j.comps || []) {
    const o = OLD[k.type]; if (o) k.attrs = { ...o, ...k.attrs };
    // 7-Segment-Hex: Anschlüsse liegen jetzt wie in Digital 20 weiter rechts -> Anzeige verschieben
    if (k.type === 'Seven-Seg-Hex') { const [dx, dy] = [[-20, 0], [0, 20], [20, 0], [0, -20]][(k.rot || 0) & 3]; k.x += dx; k.y += dy; }
    if (k.type === 'Button' && k.attrs?.ActiveLow != null) { k.attrs.activeLow = k.attrs.ActiveLow; delete k.attrs.ActiveLow; }
  }
  return j;
}

// Komparator: Ausgänge waren bis Version 7 in der Reihenfolge =, >, < – jetzt wie in Digital >, =, <
function migrateComparators(c) {
  for (const k of c.comps.filter(k => k.type === 'Comparator')) {
    const outs = pinsWorld(k).filter(p => p.out);   // neue Lage: [>, =, <]
    const A = outs[0], B = outs[1];                 // alte Bedeutung: A war "=", B war ">"
    for (const w of c.wires) for (const e of [1, 2]) {
      if (w['x' + e] === A.x && w['y' + e] === A.y) { w['x' + e] = B.x; w['y' + e] = B.y; w._sw = 1; }
      else if (w['x' + e] === B.x && w['y' + e] === B.y && !w._sw) { w['x' + e] = A.x; w['y' + e] = A.y; }
    }
    for (const w of c.wires) delete w._sw;
  }
}

// ---------- Start ----------
(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if ((saved?.v === 2 || saved?.v === 3) && saved.docs) {
      for (const [n, j] of Object.entries(saved.docs)) {
        const c = Circuit.fromJSON(saved.v === 2 ? migrateV2(j) : j);
        if (saved.v === 2) migrateComparators(c);
        library.set(n, c);
      }
      touchLibrary();
      ensureChips([...library.values()]).then(() => { buildPalette(); editor.invalidate(); refreshPanel(); });
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
window.__app = { showModuleSettings, renderProps, showMemory, showHdl, getLib: () => import('./lib.js'), showTTEditor, showStateAnalysis, openFsm, get fsmEditor() { return fsmEditor; }, editor, get circuit() { return circuit; }, get current() { return current; }, library, setCurrent, addDoc, loadExample, parseDig, writeDig, startSim, stopSim, Circuit, recorder, runAllTests, showTable, showKV, showFormula, toggleGraph };
