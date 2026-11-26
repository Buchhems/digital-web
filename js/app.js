import { DEF, DEFS, CATEGORIES, attrsOf, geoOf, settings, mask, formatValue, pinsWorld } from './components.js';
import { Circuit } from './circuit.js';
import { Sim } from './sim.js';
import { Editor, drawPreview } from './editor.js';
import { parseDig, writeDig } from './dig.js';
import { truthTable } from './analysis.js';
import { EXAMPLES } from './examples.js';

const $ = s => document.querySelector(s);
const STORE = 'digitalweb.v1';

// ---------- Zustand ----------
let circuit = new Circuit();
let fileName = 'Schaltung';
let history = [], hIdx = -1;
let clockTimer = null;

const editor = new Editor($('#canvas'), {
  onChange: commit,
  onSelect: renderProps,
  askValue: c => askValue(c),
  onSimChange: () => {},
});

// ---------- Einstellungen ----------
try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE + '.settings') || '{}')); } catch { }
const saveSettings = () => localStorage.setItem(STORE + '.settings', JSON.stringify(settings));

// ---------- Verlauf / Speicherung ----------
function snapshot() { return JSON.stringify(circuit.toJSON()); }
function commit() {
  history = history.slice(0, hIdx + 1);
  history.push(snapshot());
  if (history.length > 150) history.shift();
  hIdx = history.length - 1;
  autosave();
  updateUI();
  editor.invalidate();
}
function loadSnapshot(s) { circuit = Circuit.fromJSON(JSON.parse(s)); editor.setCircuit(circuit); autosave(); updateUI(); }
function undo() { if (hIdx > 0) { hIdx--; loadSnapshot(history[hIdx]); } }
function redo() { if (hIdx < history.length - 1) { hIdx++; loadSnapshot(history[hIdx]); } }
function autosave() {
  try { localStorage.setItem(STORE, JSON.stringify({ name: fileName, circuit: circuit.toJSON() })); } catch { }
}
function setCircuit(c, name, fit = true) {
  stopSim();
  circuit = c; fileName = name || fileName;
  editor.setCircuit(c);
  history = [snapshot()]; hIdx = 0;
  autosave(); updateUI();
  if (fit) requestAnimationFrame(() => editor.fit());
}

// ---------- Toast ----------
let toastT;
function toast(msg, error = false, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), ms);
}

// ---------- Palette ----------
function buildPalette() {
  const pal = $('#palette'); pal.innerHTML = '';
  for (const cat of CATEGORIES) {
    const h = document.createElement('h3'); h.textContent = cat; pal.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'tiles'; pal.appendChild(grid);
    for (const d of DEFS.filter(d => d.cat === cat)) {
      const t = document.createElement('div'); t.className = 'tile'; t.dataset.type = d.type;
      const cv = document.createElement('canvas'); const sp = document.createElement('span'); sp.textContent = d.name;
      t.append(cv, sp); grid.appendChild(t);
      setupTileDrag(t, d.type);
    }
  }
  requestAnimationFrame(() => document.querySelectorAll('.tile').forEach(t => drawPreview(t.querySelector('canvas'), t.dataset.type)));
}
function setupTileDrag(tile, type) {
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
      drawPreview(ghost.querySelector('canvas'), type);
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
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        place(type, editor.toWorld(e.clientX - r.left, e.clientY - r.top));
      }
    } else {
      // Mitte des sichtbaren Bereichs – das Eigenschaften-Panel öffnet sich gleich rechts
      const panelOpen = $('#props').classList.contains('open');
      const pw = panelOpen ? 0 : Math.min(272, editor.w * 0.3);
      place(type, editor.toWorld((editor.w - pw) / 2, editor.h / 2));
    }
  };
  tile.addEventListener('pointerup', e => end(e));
  tile.addEventListener('pointercancel', e => end(e, true));
}
function place(type, p) {
  let x = Math.round(p.x / 20) * 20, y = Math.round(p.y / 20) * 20;
  // nicht genau auf ein vorhandenes Bauteil legen
  while (circuit.comps.some(c => c.x === x && c.y === y)) { x += 40; y += 40; }
  const c = circuit.addComp(type, x, y, {});
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
    inner.innerHTML = `<h2>${def.name}</h2><div class="sub">${c.type === 'Unknown' ? 'Wird noch nicht unterstützt – bleibt beim Speichern erhalten.' : def.cat}</div>`;
    for (const p of def.props) inner.appendChild(field(c, p, a));
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
    inp.onchange = () => { const v = parseNum(inp.value); if (v != null) apply(v); else inp.value = val; };
    f.appendChild(st);
  } else if (p.type === 'text' || p.type === 'textarea') {
    const i = document.createElement(p.type === 'text' ? 'input' : 'textarea');
    if (p.type === 'text') i.type = 'text';
    i.value = val ?? ''; i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
    i.oninput = () => set(i.value, false);
    i.onchange = () => commit();
    f.appendChild(i);
    if (p.hint) f.insertAdjacentHTML('beforeend', `<div class="hint">${p.hint}</div>`);
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
    if (it.type) { const c = circuit.addComp(it.type, it.x + 40, it.y + 40, JSON.parse(JSON.stringify(it.attrs)), it.rot); if (it.raw) c.raw = [...it.raw]; ns.add(c); }
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
  let last = performance.now();
  const acc = new Map();
  clockTimer = setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    let changed = false;
    for (const c of circuit.comps) {
      if (c.type !== 'Clock') continue;
      const a = attrsOf(c);
      if (!a.runRealTime) continue;
      const half = 1 / (2 * Math.max(0.1, a.Frequency || 1));
      let t = (acc.get(c.id) || 0) + dt;
      while (t >= half) { t -= half; sim.st(c).value ^= 1; sim.update(c); changed = true; }
      acc.set(c.id, t);
    }
    if (changed) { checkOsc(); editor.redraw(); }
  }, 16);
  editor.redraw();
}
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
  checkOsc(); editor.redraw();
}

function askValue(c) {
  const a = attrsOf(c), st = editor.sim.st(c), m = mask(a.Bits);
  openDialog(`<div class="dialog"><h2>Wert für ${a.Label || 'Eingang'} <button class="close">✕</button></h2>
    <p style="margin-top:0;color:#6b7280">${a.Bits} Bit · 0 bis ${m} · auch 0x… (hex) oder 0b… (binär)</p>
    <input type="text" inputmode="numeric" id="valIn" value="${st.value}">
    <div class="numpad">${[7, 8, 9, '←', 4, 5, 6, '+1', 1, 2, 3, '−1', '0', 'x', 'b', 'OK'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div></div>`);
  const inp = $('#valIn');
  const ok = () => { const v = parseNum(inp.value); if (v == null) return toast('Ungültige Zahl', true); st.value = (v & m) >>> 0; editor.sim.update(c); checkOsc(); editor.redraw(); closeDialog(); };
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

// ---------- Dialoge ----------
function openDialog(html) {
  $('#sheet').innerHTML = html;
  $('#modal').classList.remove('hidden');
  $('#sheet').querySelectorAll('.close').forEach(b => (b.onclick = closeDialog));
}
function closeDialog() { $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeDialog(); });

function showMenu() {
  const ex = EXAMPLES.map((e, i) => `<button class="menu-item" data-ex="${i}"><span class="ico">⚡</span><span><b>${e.name}</b><small>${e.desc}</small></span></button>`).join('');
  openDialog(`<div class="dialog"><h2>Datei <button class="close">✕</button></h2>
    <div class="menu-list">
      <button class="menu-item" data-a="new"><span class="ico">＋</span><span><b>Neu</b><small>Leere Schaltung</small></span></button>
      <button class="menu-item" data-a="open"><span class="ico">📂</span><span><b>Öffnen …</b><small>.dig-Datei (auch vom Desktop-Digital)</small></span></button>
      <button class="menu-item" data-a="save"><span class="ico">💾</span><span><b>Speichern …</b><small>Als .dig-Datei sichern oder teilen</small></span></button>
      <button class="menu-item" data-a="png"><span class="ico">🖼</span><span><b>Als Bild</b><small>PNG der aktuellen Ansicht</small></span></button>
    </div>
    <h3>Beispiele</h3><div class="menu-list">${ex}</div>
    <h3>Einstellungen</h3>
    <div class="row"><span style="font-size:15px">Schaltzeichen:</span>
      <div class="chips"><button class="chip ${settings.shapes !== 'ieee' ? 'on' : ''}" data-shape="iec">DIN / IEC (&amp;, ≥1)</button><button class="chip ${settings.shapes === 'ieee' ? 'on' : ''}" data-shape="ieee">IEEE (amerikanisch)</button></div></div>
    <h3>Hilfe</h3><div class="menu-list"><button class="menu-item" data-a="help"><span class="ico">？</span><span><b>Bedienung</b><small>So funktioniert's auf dem iPad</small></span></button></div>
  </div>`);
  $('#sheet').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ex) { const ex = EXAMPLES[+b.dataset.ex]; setCircuit(Circuit.fromJSON(ex.circuit), ex.name); closeDialog(); }
    if (b.dataset.shape) { settings.shapes = b.dataset.shape; saveSettings(); buildPalette(); editor.invalidate(); showMenu(); }
    switch (b.dataset.a) {
      case 'new': if (circuit.comps.length && !confirm('Aktuelle Schaltung verwerfen?')) return; setCircuit(new Circuit(), 'Schaltung'); closeDialog(); break;
      case 'open': closeDialog(); $('#fileInput').click(); break;
      case 'save': showSave(); break;
      case 'png': exportPng(); closeDialog(); break;
      case 'help': showHelp(); break;
    }
  };
}

function showSave() {
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.dig', { type: 'application/xml' })] }));
  openDialog(`<div class="dialog"><h2>Speichern <button class="close">✕</button></h2>
    <div class="field"><label>Dateiname</label><input type="text" id="saveName" value="${fileName.replace(/"/g, '')}"></div>
    <p style="color:#6b7280;font-size:14px;margin-top:-4px">Die Datei hat das Format von <i>Digital</i> und lässt sich auch im Desktop-Programm öffnen.</p>
    <div class="row">${canShare ? '<button class="btn primary" id="doShare">Teilen / In „Dateien“ sichern</button>' : ''}<button class="btn ${canShare ? '' : 'primary'}" id="doDownload">Herunterladen</button></div></div>`);
  const getFile = () => {
    let n = $('#saveName').value.trim() || 'Schaltung';
    n = n.replace(/\.dig$/i, '');
    fileName = n; autosave(); updateUI();
    return new File([writeDig(circuit)], n + '.dig', { type: 'application/xml' });
  };
  $('#doDownload').onclick = () => { download(getFile()); closeDialog(); };
  const sh = $('#doShare');
  if (sh) sh.onclick = async () => { try { await navigator.share({ files: [getFile()], title: fileName }); closeDialog(); } catch (e) { if (e.name !== 'AbortError') toast('Teilen nicht möglich: ' + e.message, true); } };
}
function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportPng() {
  const sel = new Set(editor.sel); editor.sel.clear(); editor.render();
  editor.cv.toBlob(b => { download(new File([b], fileName + '.png', { type: 'image/png' })); editor.sel = sel; editor.redraw(); });
}

$('#fileInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    let c;
    if (text.trim().startsWith('{')) c = Circuit.fromJSON(JSON.parse(text).circuit || JSON.parse(text));
    else {
      const r = parseDig(text); c = r.circuit;
      if (r.unknown.length) toast('Noch nicht unterstützt: ' + r.unknown.join(', '), true, 6000);
    }
    setCircuit(c, f.name.replace(/\.(dig|json)$/i, ''));
  } catch (err) { console.error(err); toast(err.message || 'Datei konnte nicht gelesen werden.', true, 4000); }
});

function showTable() {
  let t;
  try { t = truthTable(circuit); } catch (e) { toast(e.message, true); return; }
  const head = t.inputs.map(i => `<th>${i.name}</th>`).join('') + t.outputs.map((o, j) => `<th class="${j ? '' : 'sepcol'}">${o.name}</th>`).join('');
  const cell = (v, bits, cls = '') => `<td class="${cls} ${bits === 1 ? (v ? 'one' : 'zero') : ''}">${v == null ? 'Z' : formatValue(v, bits)}</td>`;
  const body = t.rows.map(r => '<tr>' + r.ins.map((v, i) => cell(v, t.inputs[i].bits)).join('') + r.outs.map((v, j) => cell(v, t.outputs[j].bits, j ? '' : 'sepcol')).join('') + '</tr>').join('');
  const expr = t.expressions?.length ? '<h3>Minimierte Ausdrücke (DNF)</h3>' + t.expressions.map(e => `<div class="expr"><b>${e.name}</b> = ${e.dnf}</div>`).join('') : '';
  openDialog(`<div class="dialog"><h2>Wahrheitstabelle <button class="close">✕</button></h2>
    ${t.sequential ? '<div class="note">Die Schaltung enthält Speicherglieder oder Takte. Die Tabelle zeigt nur das Verhalten ausgehend vom aktuellen Zustand.</div>' : ''}
    ${t.oscillating ? '<div class="note">Die Schaltung schwingt – die Werte sind nicht zuverlässig.</div>' : ''}
    <div class="tt-wrap"><table class="tt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${expr}
    <div class="row" style="margin-top:14px"><button class="btn" id="copyCsv">Als Tabelle kopieren</button></div></div>`);
  $('#copyCsv').onclick = async () => {
    const lines = [[...t.inputs, ...t.outputs].map(x => x.name).join('\t'), ...t.rows.map(r => [...r.ins, ...r.outs].map(v => v ?? 'Z').join('\t'))];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Kopiert – kann in Numbers/Excel eingefügt werden.'); } catch { toast('Kopieren nicht möglich', true); }
  };
}

function showHelp() {
  openDialog(`<div class="dialog help"><h2>Bedienung <button class="close">✕</button></h2>
  <ul>
    <li><b>Bauteil einfügen:</b> in der linken Leiste antippen (erscheint in der Mitte) oder seitlich auf die Fläche ziehen.</li>
    <li><b>Verschieben:</b> Bauteil mit dem Finger oder Stift ziehen. Angeschlossene Leitungen gehen mit.</li>
    <li><b>Leitung zeichnen:</b> an einem Anschlusspunkt (blau = Eingang, rot = Ausgang) oder an einer bestehenden Leitung beginnen und ziehen. Die Leitung knickt rechtwinklig ab.</li>
    <li><b>Leitung auswählen:</b> kurz antippen. Eine ausgewählte Leitung lässt sich verschieben.</li>
    <li><b>Mehrere auswählen:</b> „Auswahl“ einschalten und ein Rechteck aufziehen.</li>
    <li><b>Ansicht:</b> mit einem Finger auf freier Fläche verschieben, mit zwei Fingern zoomen.</li>
    <li><b>Eigenschaften</b> (Beschriftung, Anzahl Eingänge, Bitbreite …) erscheinen rechts, sobald ein Bauteil ausgewählt ist.</li>
    <li><b>Simulation:</b> „Start“ tippen. Eingänge antippen zum Umschalten, Taster gedrückt halten. Grün hell = 1, grün dunkel = 0, blau = nicht verbunden, rot = Fehler.</li>
    <li><b>Wahrheitstabelle:</b> „Tabelle“ erzeugt die Tabelle aller Eingangskombinationen samt minimierter Formel.</li>
    <li><b>Speichern:</b> Die Schaltung wird automatisch im Browser gesichert. Über „Datei → Speichern“ entsteht eine .dig-Datei, die auch das Desktop-Programm <i>Digital</i> öffnet.</li>
  </ul>
  <p style="color:#6b7280;font-size:13px">Tipp: Über „Teilen → Zum Home-Bildschirm“ in Safari wird die App wie eine normale App gestartet und funktioniert auch offline.</p></div>`);
}

// ---------- Oberfläche ----------
function updateUI() {
  $('#btnUndo').disabled = hIdx <= 0;
  $('#btnRedo').disabled = hIdx >= history.length - 1;
  const has = editor.sel.size > 0;
  $('#btnDelete').disabled = !has; $('#btnDup').disabled = !has;
  $('#btnRotate').disabled = ![...editor.sel].some(x => x.type);
  $('#fileName').textContent = fileName;
  $('#hint').classList.toggle('hidden', circuit.comps.length > 0 || circuit.wires.length > 0);
}

$('#btnMenu').onclick = showMenu;
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnDelete').onclick = deleteSel;
$('#btnRotate').onclick = rotateSel;
$('#btnDup').onclick = duplicateSel;
$('#btnRect').onclick = () => { editor.rectMode = !editor.rectMode; $('#btnRect').classList.toggle('on', editor.rectMode); };
$('#btnSim').onclick = () => (editor.sim ? stopSim() : startSim());
$('#btnStep').onclick = stepClock;
$('#btnTable').onclick = showTable;
$('#zoomIn').onclick = () => editor.zoomBy(1.25);
$('#zoomOut').onclick = () => editor.zoomBy(0.8);
$('#zoomFit').onclick = () => editor.fit();
$('#btnExample').onclick = () => { const ex = EXAMPLES[0]; setCircuit(Circuit.fromJSON(ex.circuit), ex.name); };

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
buildPalette();
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved?.circuit) setCircuit(Circuit.fromJSON(saved.circuit), saved.name || 'Schaltung');
  else setCircuit(new Circuit(), 'Schaltung', false);
} catch { setCircuit(new Circuit(), 'Schaltung', false); }

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });

// zum Testen
window.__app = { editor, get circuit() { return circuit; }, setCircuit, parseDig, writeDig, startSim, stopSim, Circuit };
