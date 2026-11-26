// Speicher wie in Digital: ROM, RAM-Varianten, EEPROM, Registersatz, Lookup-Tabelle.
// Inhalte (Attribut "Data") im Format von Digital: Hex-Werte mit Komma, "n*wert" für Wiederholungen.
import { S, v0, range, P, generic, drawGenericBox, invSet, applyInv } from './base.js';

const MEM = 'Speicher';

export function parseData(str) {
  const out = [];
  for (let tok of String(str || '').split(/[,\s]+/)) {
    tok = tok.trim(); if (!tok) continue;
    const m = tok.match(/^(\d+)\*([0-9a-fA-F]+)$/);
    if (m) { const v = parseInt(m[2], 16); for (let i = 0; i < +m[1]; i++) out.push(v); }
    else { const v = parseInt(tok, 16); out.push(Number.isNaN(v) ? 0 : v); }
  }
  return out;
}
export function formatData(arr) {
  let n = arr.length; while (n > 0 && !arr[n - 1]) n--;
  const parts = []; let len = 0, line = [];
  for (let i = 0; i < n;) {
    let j = i; while (j < n && arr[j] === arr[i]) j++;
    const cnt = j - i, hex = (arr[i] || 0).toString(16);
    const chunk = cnt < 4 ? Array(cnt).fill(hex) : [cnt + '*' + hex];
    for (const c of chunk) { line.push(c); len += c.length + 1; if (len > 60) { parts.push(line.join(',')); line = []; len = 0; } }
    i = j;
  }
  if (line.length) parts.push(line.join(','));
  return parts.join(',\n');
}

const addrProp = { key: 'AddrBits', label: 'Adressbits', type: 'int', min: 1, max: 20 };
const dataProp = { key: 'Data', label: 'Inhalt', type: 'data' };
const progProp = { key: 'isProgramMemory', label: 'Programmspeicher', type: 'bool', hint: 'Für den Testbefehl „program“: hier wird das Programm abgelegt.' };
const pin = (n, bits, extra = {}) => ({ n, bits, ...extra });
const word = (st, addr) => (addr == null || addr >= st.mem.length ? 0 : v0(st.mem[addr]));

// Grundgerüst: generische Form; "bidi" = Datenanschluss, der auch gelesen wird
function memory(type, name, { ins, outs, bidi, width = 3, defaults = {}, props = [], hasData = false, step }) {
  return {
    type, name, cat: MEM, memory: true, hasData,
    defaults: { Label: '', Bits: 8, AddrBits: 4, intFormat: 'hex', isProgramMemory: false, ...(hasData ? { Data: '' } : {}), ...defaults },
    props: [P.label, P.bits, addrProp, ...(hasData ? [dataProp] : []), { ...P.format, options: [['hex', 'Hexadezimal'], ['def', 'Dezimal'], ['bin', 'Binär']] }, ...props, progProp],
    geo(a) {
      const iv = ins(a), ov = outs(a);
      const g = generic({ ins: iv, outs: ov, width, invIn: invSet(a, iv.map(p => p.n)) });
      // bidirektionaler Anschluss: zusätzlich als Eingang an derselben Stelle (zuletzt in der Eingangsliste)
      if (bidi) { const o = g.pins.find(p => p.out && p.n === bidi); g.pins.push({ ...o, out: false, hidden: true }); }
      g.size = 2 ** a.AddrBits;
      return g;
    },
    init(st, a) {
      st.mem = hasData ? parseData(a.Data) : [];
      st.c = 0; st.addr = 0; st.out = null;
    },
    eval(insV, st, a, g) { return step(applyInv(insV, g), st, a); },
    interactive: true,
    tap() { return 'showMemory'; },
    draw(r, c, a, g) {
      drawGenericBox(r, g, a, { title: name });
      r.text(S * g.width / 2, g.yb - 16, `${2 ** a.AddrBits}×${a.Bits}`, 0, 0, 9, 'name');
    },
  };
}

const ROM = memory('ROM', 'ROM', {
  hasData: true,
  ins: a => [pin('A', a.AddrBits), pin('sel', 1)], outs: a => [pin('D', a.Bits)],
  step(i, st) { return [i[1] ? word(st, i[0]) : null]; },
});
const ROMDualPort = memory('ROMDualPort', 'ROM (2 Ports)', {
  hasData: true,
  ins: a => [pin('A1', a.AddrBits), pin('s1', 1), pin('A2', a.AddrBits), pin('s2', 1)], outs: a => [pin('D1', a.Bits), pin('D2', a.Bits)],
  step(i, st) { return [i[1] ? word(st, i[0]) : null, i[3] ? word(st, i[2]) : null]; },
});

// RAM mit getrenntem Dateneingang: Schreiben bei steigender Taktflanke (str), Lesen mit ld
function ramDual(i, st, din) {
  const [A, , str, C, ld] = i;
  const clk = v0(C);
  const doStr = clk && !st.c && v0(str);
  if (v0(ld) || doStr) st.addr = v0(A);
  if (doStr) st.mem[st.addr] = v0(din);
  st.c = clk;
  return [v0(ld) ? word(st, st.addr) : null];
}
const RAMDualPort = memory('RAMDualPort', 'RAM (getrennte Ports)', {
  ins: a => [pin('A', a.AddrBits), pin('Din', a.Bits), pin('str', 1), pin('C', 1, { clock: true }), pin('ld', 1)], outs: a => [pin('D', a.Bits)],
  step(i, st) { return ramDual(i, st, i[1]); },
});
const EEPROMDualPort = memory('EEPROMDualPort', 'EEPROM (getrennte Ports)', {
  hasData: true,
  ins: a => [pin('A', a.AddrBits), pin('Din', a.Bits), pin('str', 1), pin('C', 1, { clock: true }), pin('ld', 1)], outs: a => [pin('D', a.Bits)],
  step(i, st) { const r = ramDual(i, st, i[1]); st.dirty = true; return r; },
});
const RAMSinglePort = memory('RAMSinglePort', 'RAM (ein Datenanschluss)', {
  bidi: 'D',
  ins: a => [pin('A', a.AddrBits), pin('str', 1), pin('C', 1, { clock: true }), pin('ld', 1)], outs: a => [pin('D', a.Bits)],
  // Eingänge: A, str, C, ld, D (gelesen)
  step(i, st) { return ramDual([i[0], null, i[1], i[2], i[3]], st, i[4]); },
});
const RAMSinglePortSel = memory('RAMSinglePortSel', 'RAM (CS, WE, OE)', {
  bidi: 'D', defaults: { inverterConfig: [] }, props: [P.invert],
  ins: a => [pin('A', a.AddrBits), pin('CS', 1), pin('WE', 1), pin('OE', 1)], outs: a => [pin('D', a.Bits)],
  step(i, st) {
    const [A, CS, WE, OE, D] = i;
    if (v0(CS)) { st.addr = v0(A); st.oe = v0(OE); st.we = v0(WE); if (st.we) st.mem[st.addr] = v0(D); }
    return [v0(CS) && st.oe && !st.we ? word(st, st.addr) : null];
  },
});
const RAMDualAccess = memory('RAMDualAccess', 'RAM (zwei Lesezugriffe)', {
  ins: a => [pin('str', 1), pin('C', 1, { clock: true }), pin('ld', 1), pin('1A', a.AddrBits), pin('1Din', a.Bits), pin('2A', a.AddrBits)],
  outs: a => [pin('1D', a.Bits), pin('2D', a.Bits)],
  step(i, st) {
    const [str, C, ld, A1, Din, A2] = i;
    const [d1] = ramDual([A1, null, str, C, ld], st, Din);
    return [d1, word(st, v0(A2))];
  },
});
const RAMAsync = memory('RAMAsync', 'RAM (asynchron)', {
  defaults: { inverterConfig: [] }, props: [P.invert],
  ins: a => [pin('A', a.AddrBits), pin('D', a.Bits), pin('we', 1)], outs: a => [pin('Q', a.Bits)],
  step(i, st) {
    const A = v0(i[0]);
    if (v0(i[2])) st.mem[A] = v0(i[1]);
    return [word(st, A)];
  },
});
const BlockRAMDualPort = memory('BlockRAMDualPort', 'Block-RAM', {
  ins: a => [pin('A', a.AddrBits), pin('Din', a.Bits), pin('str', 1), pin('C', 1, { clock: true })], outs: a => [pin('D', a.Bits)],
  step(i, st) {
    const clk = v0(i[3]);
    if (clk && !st.c) { const A = v0(i[0]); st.out = word(st, A); if (v0(i[2])) st.mem[A] = v0(i[1]); }
    st.c = clk;
    return [st.out ?? 0];
  },
});
const EEPROM = memory('EEPROM', 'EEPROM', {
  hasData: true, bidi: 'D', defaults: { inverterConfig: [] }, props: [P.invert],
  ins: a => [pin('A', a.AddrBits), pin('CS', 1), pin('WE', 1, { clock: true }), pin('OE', 1)], outs: a => [pin('D', a.Bits)],
  step(i, st) {
    const [A, CS, WE, OE, D] = i;
    if (v0(CS)) { st.raddr = v0(A); st.oe = v0(OE); }
    st.we = v0(WE);
    const write = v0(CS) && st.we;
    if (write && !st.lastW) st.waddr = v0(A);
    if (!write && st.lastW) { st.mem[st.waddr] = v0(D); st.dirty = true; }
    st.lastW = write;
    return [v0(CS) && st.oe && !st.we ? word(st, st.raddr) : null];
  },
});
const RegisterFile = memory('RegisterFile', 'Registersatz', {
  width: 4, defaults: { AddrBits: 2 },
  ins: a => [pin('Din', a.Bits), pin('we', 1), pin('Rw', a.AddrBits), pin('C', 1, { clock: true }), pin('Ra', a.AddrBits), pin('Rb', a.AddrBits)],
  outs: a => [pin('Da', a.Bits), pin('Db', a.Bits)],
  step(i, st) {
    const [Din, we, Rw, C, Ra, Rb] = i;
    const clk = v0(C);
    if (clk && !st.c && v0(we)) st.mem[v0(Rw)] = v0(Din);
    st.c = clk;
    return [word(st, v0(Ra)), word(st, v0(Rb))];
  },
});

// Lookup-Tabelle: Eingänge 0..n-1 (je 1 Bit) bilden die Adresse
const LookUpTable = {
  type: 'LookUpTable', name: 'Lookup-Tabelle', cat: MEM, memory: true, hasData: true,
  defaults: { Label: '', Bits: 1, Inputs: 2, Data: '', intFormat: 'hex' },
  props: [P.label, P.bits, { key: 'Inputs', label: 'Anzahl Eingänge', type: 'int', min: 1, max: 12 }, dataProp],
  geo(a) {
    const g = generic({ ins: range(a.Inputs).map(i => pin(String(i), 1)), outs: [pin('out', a.Bits)], width: 3 });
    g.size = 2 ** a.Inputs;
    return g;
  },
  init(st, a) { st.mem = parseData(a.Data); },
  eval(i, st) { let addr = 0; i.forEach((x, k) => { if (x > 0) addr += 2 ** k; }); return [word(st, addr)]; },
  interactive: true, tap() { return 'showMemory'; },
  draw(r, c, a, g) { drawGenericBox(r, g, a, { title: 'LUT' }); },
};

export const MEM_DEFS = [ROM, ROMDualPort, RAMDualPort, RAMSinglePort, RAMSinglePortSel, RAMDualAccess, RAMAsync, BlockRAMDualPort, EEPROM, EEPROMDualPort, RegisterFile, LookUpTable];
