// Export als Verilog bzw. VHDL. Die Schaltung wird dafür (inkl. Bausteinen) zu einer
// flachen Netzliste aufgelöst; jedes Bauteil wird in eine Zuweisung bzw. einen Prozess übersetzt.
import { buildNets } from './circuit.js';
import { attrsOf, geoOf, DEF } from './components.js';
import { parseData } from './comp-mem.js';
import { parseSplitPorts } from './components.js';

const ident = (s, used) => {
  let n = String(s || '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^([^A-Za-z])/, 's_$1') || 's';
  if (/^(input|output|wire|reg|module|end|begin|always|assign|in|out|signal|entity|is|port|process|if|then|else|case|when|others|and|or|not|xor|nand|nor|xnor|downto|to|of|type|range|for|loop|integer|bit)$/i.test(n)) n += '_s';
  let k = n, i = 1; while (used.has(k.toLowerCase())) k = n + '_' + i++;
  used.add(k.toLowerCase()); return k;
};

// gemeinsame Vorbereitung: Netze, Anschlüsse, Namen
function prepare(circuit, name) {
  const { nets, compPins, comps, problems } = buildNets(circuit);
  if (problems.length) throw new Error(problems[0]);
  const bad = nets.find(n => n.error === 'bits'); if (bad) throw new Error('Bitbreiten passen nicht zusammen.');
  const used = new Set();
  const mod = ident(name, used);
  const netName = new Map(), ports = [];
  const unsupported = new Set();
  for (const c of comps) {
    const a = attrsOf(c), cp = compPins.get(c.id);
    if ((c.type === 'In' || c.type === 'Clock') && !String(c.id).includes('/')) {
      const n = ident(a.Label || (c.type === 'Clock' ? 'C' : 'in'), used);
      ports.push({ dir: 'in', name: n, bits: nets[cp.outs[0]].bits });
      netName.set(cp.outs[0], n);
    }
  }
  for (const c of comps) {
    const a = attrsOf(c), cp = compPins.get(c.id);
    if ((c.type === 'Out' || c.type === 'LED') && !String(c.id).includes('/')) ports.push({ dir: 'out', name: ident(a.Label || 'out', used), bits: nets[cp.ins[0]].bits, net: cp.ins[0] });
    // Anzeigen werden zu Ausgängen (je Anschluss einer)
    if (DISPLAYS.has(c.type)) {
      const g = geoOf(c);
      g.pins.filter(p => !p.out).forEach((p, k) => ports.push({ dir: 'out', name: ident((a.Label || c.type.replace(/\W/g, '')) + '_' + p.n, used), bits: nets[cp.ins[k]].bits, net: cp.ins[k] }));
    }
  }
  nets.forEach((n, i) => { if (!netName.has(i)) netName.set(i, ident('s' + i, used)); });
  return { nets, compPins, comps, mod, ports, netName, unsupported, used };
}
const inv = (c, a, g, i) => g.pins[i]?.inv;
const DISPLAYS = new Set(['Seven-Seg', 'Seven-Seg-Hex', 'RGBLED', 'PolarityAwareLED', 'LightBulb', 'LedMatrix']);
const width = b => (b > 1 ? `[${b - 1}:0] ` : '');

// ---------- Verilog ----------
export function toVerilog(circuit, name = 'circuit') {
  const P = prepare(circuit, name);
  const { nets, compPins, comps, netName, ports, unsupported } = P;
  const decl = [], body = [];
  const regs = new Set();
  const N = i => (i == null ? "1'b0" : netName.get(i));
  for (const [i] of nets.entries()) if (!ports.some(p => p.dir === 'in' && p.name === netName.get(i))) decl.push(`  wire ${width(nets[i].bits)}${netName.get(i)};`);
  let rc = 0;
  const reg = (bits, init = 0) => { const r = 'r' + rc++; decl.push(`  reg ${width(bits)}${r} = ${init};`); regs.add(r); return r; };
  for (const c of comps) {
    const a = attrsOf(c), g = geoOf(c), cp = compPins.get(c.id);
    const I = k => { const n = cp.ins[k]; const s = N(n); return inv(c, a, g, k) ? `(~${s})` : s; };
    const O = k => N(cp.outs[k]);
    const bits = k => nets[cp.outs[k]]?.bits || 1;
    const nIn = cp.ins.length;
    const gate = (op, neg) => body.push(`  assign ${O(0)} = ${neg ? '~(' : ''}${Array.from({ length: nIn }, (_, k) => I(k)).join(` ${op} `)}${neg ? ')' : ''};`);
    switch (c.type) {
      case 'In': case 'Clock': if (String(c.id).includes('/')) break; break;
      case 'Out': case 'LED': case 'Tunnel': case 'Probe': case 'Text': case 'Testcase': case 'Rectangle': case 'Data': case 'PowerSupply': case 'PullUp': case 'PullDown': case 'GenericInitCode': case 'GenericCode': break;
      case 'Seven-Seg': case 'Seven-Seg-Hex': case 'RGBLED': case 'PolarityAwareLED': case 'LightBulb': case 'LedMatrix': break;
      case 'And': gate('&'); break; case 'Or': gate('|'); break; case 'XOr': gate('^'); break;
      case 'NAnd': gate('&', true); break; case 'NOr': gate('|', true); break; case 'XNOr': gate('^', true); break;
      case 'Not': body.push(`  assign ${O(0)} = ~${I(0)};`); break;
      case 'Const': body.push(`  assign ${O(0)} = ${bits(0)}'d${a.Value >>> 0};`); break;
      case 'Ground': body.push(`  assign ${O(0)} = 0;`); break;
      case 'VDD': body.push(`  assign ${O(0)} = {${bits(0)}{1'b1}};`); break;
      case 'Delay': body.push(`  assign ${O(0)} = ${I(0)};`); break;
      case 'Splitter': {
        const ins = parseSplitPorts(a['Input Splitting']), outs = parseSplitPorts(a['Output Splitting']);
        const total = Math.max(...ins.map(p => p.lo + p.bits));
        const all = `w_split${c.id.toString().replace(/\W/g, '_')}`;
        decl.push(`  wire [${total - 1}:0] ${all};`);
        ins.forEach((p, k) => body.push(`  assign ${all}[${p.lo + p.bits - 1}:${p.lo}] = ${I(k)};`));
        outs.forEach((p, k) => body.push(`  assign ${O(k)} = ${all}[${p.lo + p.bits - 1}:${p.lo}];`));
        break;
      }
      case 'Driver': body.push(`  assign ${O(0)} = ${I(1)} ? ${a.invertDriverOutput ? '~' : ''}${I(0)} : ${bits(0)}'bz;`); break;
      case 'DriverInvSel': body.push(`  assign ${O(0)} = ${I(1)} ? ${bits(0)}'bz : ${a.invertDriverOutput ? '~' : ''}${I(0)};`); break;
      case 'Multiplexer': {
        const n = nIn - 1;
        body.push(`  assign ${O(0)} = ${Array.from({ length: n }, (_, k) => k).reverse().reduce((acc, k) => (acc == null ? I(k + 1) : `(${I(0)} == ${k}) ? ${I(k + 1)} : ${acc}`), null)};`);
        break;
      }
      case 'Demultiplexer': cp.outs.forEach((_, k) => body.push(`  assign ${O(k)} = (${I(0)} == ${k}) ? ${I(1)} : ${(a.Default || 0)};`)); break;
      case 'Decoder': cp.outs.forEach((_, k) => body.push(`  assign ${O(k)} = (${I(0)} == ${k}) ? 1'b1 : 1'b0;`)); break;
      case 'BitSelector': body.push(`  assign ${O(0)} = ${I(1)}[${I(0)}];`); break;
      case 'PriorityEncoder': {
        let e = '0', any = [];
        for (let k = 0; k < nIn; k++) { e = `${I(k)} ? ${k} : (${e})`; any.push(I(k)); }
        body.push(`  assign ${O(0)} = ${e};`, `  assign ${O(1)} = ${any.join(' | ')};`);
        break;
      }
      case 'Add': body.push(`  assign {${O(1)}, ${O(0)}} = ${I(0)} + ${I(1)} + ${I(2)};`); break;
      case 'Sub': body.push(`  assign {${O(1)}, ${O(0)}} = {1'b0, ${I(0)}} - {1'b0, ${I(1)}} - ${I(2)};`); break;
      case 'Mul': body.push(a.Signed ? `  assign ${O(0)} = $signed(${I(0)}) * $signed(${I(1)});` : `  assign ${O(0)} = ${I(0)} * ${I(1)};`); break;
      case 'Div': body.push(`  assign ${O(0)} = ${I(1)} == 0 ? ${I(0)} : ${a.Signed ? `$signed(${I(0)}) / $signed(${I(1)})` : `${I(0)} / ${I(1)}`};`, `  assign ${O(1)} = ${I(1)} == 0 ? 0 : ${a.Signed ? `$signed(${I(0)}) % $signed(${I(1)})` : `${I(0)} % ${I(1)}`};`); break;
      case 'Neg': body.push(`  assign ${O(0)} = -${I(0)};`); break;
      case 'Comparator': {
        const [x, y] = a.Signed ? [`$signed(${I(0)})`, `$signed(${I(1)})`] : [I(0), I(1)];
        body.push(`  assign ${O(0)} = ${x} > ${y};`, `  assign ${O(1)} = ${x} == ${y};`, `  assign ${O(2)} = ${x} < ${y};`);
        break;
      }
      case 'BitExtender': body.push(`  assign ${O(0)} = {{${a.outputBits - a.inputBits}{${I(0)}[${a.inputBits - 1}]}}, ${I(0)}};`); break;
      case 'BitCount': body.push(`  assign ${O(0)} = ${Array.from({ length: nets[cp.ins[0]].bits }, (_, k) => `${I(0)}[${k}]`).join(' + ') || '0'};`); break;
      case 'BarrelShifter': {
        const op = a.direction === 'right' ? (a.barrelShifterMode === 'arithmetic' ? '>>>' : '>>') : '<<';
        if (a.barrelShifterMode === 'rotate') { const b = bits(0); body.push(`  assign ${O(0)} = ${a.direction === 'right' ? `(${I(0)} >> ${I(1)}) | (${I(0)} << (${b} - ${I(1)}))` : `(${I(0)} << ${I(1)}) | (${I(0)} >> (${b} - ${I(1)}))`};`); }
        else body.push(`  assign ${O(0)} = ${a.barrelShifterMode === 'arithmetic' ? `$signed(${I(0)}) ${op} ${I(1)}` : `${I(0)} ${op} ${I(1)}`};`);
        break;
      }
      case 'D_FF': case 'D_FF_AS': case 'T_FF': case 'JK_FF': case 'JK_FF_AS': case 'RS_FF': {
        const names = g.pins.filter(p => !p.out).map(p => p.n);
        const pin = n => I(names.indexOf(n));
        const b = bits(0), r = reg(b, a.Default || 0);
        let next;
        if (c.type.startsWith('D_FF')) next = `${r} <= ${pin('D')};`;
        else if (c.type === 'T_FF') next = names.includes('T') ? `if (${pin('T')}) ${r} <= ~${r};` : `${r} <= ~${r};`;
        else if (c.type === 'RS_FF') next = `case ({${pin('S')}, ${pin('R')}}) 2'b10: ${r} <= 1; 2'b01: ${r} <= 0; default: ; endcase`;
        else next = `case ({${pin('J')}, ${pin('K')}}) 2'b10: ${r} <= 1; 2'b01: ${r} <= 0; 2'b11: ${r} <= ~${r}; default: ; endcase`;
        if (names.includes('Set')) body.push(`  always @(posedge ${pin('C')} or posedge ${pin('Set')} or posedge ${pin('Clr')})`, `    if (${pin('Set')}) ${r} <= {${b}{1'b1}}; else if (${pin('Clr')}) ${r} <= 0; else ${next}`);
        else body.push(`  always @(posedge ${pin('C')}) ${next}`);
        body.push(`  assign ${O(0)} = ${r};`, `  assign ${O(1)} = ~${r};`);
        break;
      }
      case 'RS_FF_AS': { const r = reg(1, a.Default || 0); body.push(`  always @(*) if (${I(0)} && !${I(1)}) ${r} = 1; else if (${I(1)} && !${I(0)}) ${r} = 0;`, `  assign ${O(0)} = ${r};`, `  assign ${O(1)} = ~${r};`); break; }
      case 'Register': { const r = reg(bits(0)); body.push(`  always @(posedge ${I(1)}) if (${I(2)}) ${r} <= ${I(0)};`, `  assign ${O(0)} = ${r};`); break; }
      case 'Counter': {
        const b = bits(0), r = reg(b);
        body.push(`  always @(posedge ${I(1)}) if (${I(2)}) ${r} <= 0; else if (${I(0)}) ${r} <= ${r} + 1;`, `  assign ${O(0)} = ${r};`, `  assign ${O(1)} = ${I(0)} && (${r} == {${b}{1'b1}});`);
        break;
      }
      case 'CounterPreset': {
        const b = bits(0), r = reg(b), max = a.maxValue ? a.maxValue : `{${b}{1'b1}}`;
        body.push(`  always @(posedge ${I(1)}) begin`, `    if (${I(0)}) ${r} <= ${I(2)} ? (${r} == 0 ? ${max} : ${r} - 1) : (${r} == ${max} ? 0 : ${r} + 1);`, `    if (${I(5)}) ${r} <= 0; else if (${I(4)}) ${r} <= ${I(3)};`, '  end',
          `  assign ${O(0)} = ${r};`, `  assign ${O(1)} = ${I(0)} && (${I(2)} ? ${r} == 0 : ${r} == ${max});`);
        break;
      }
      case 'ROM': case 'LookUpTable': {
        const data = parseData(a.Data), b = bits(0), m = 'rom' + rc++;
        const size = g.size;
        decl.push(`  reg ${width(b)}${m} [0:${size - 1}];`, `  initial begin`, ...data.map((v, k) => `    ${m}[${k}] = ${v};`), ...(data.length < size ? [`    // übrige Adressen: 0`] : []), '  end');
        if (data.length < size) decl.splice(decl.length - 1, 0, `    for (integer i = ${data.length}; i < ${size}; i = i + 1) ${m}[i] = 0;`);
        if (c.type === 'ROM') body.push(`  assign ${O(0)} = ${I(1)} ? ${m}[${I(0)}] : ${b}'bz;`);
        else body.push(`  assign ${O(0)} = ${m}[{${Array.from({ length: nIn }, (_, k) => I(nIn - 1 - k)).join(', ')}}];`);
        break;
      }
      case 'RAMDualPort': {
        const b = bits(0), m = 'ram' + rc++;
        decl.push(`  reg ${width(b)}${m} [0:${g.size - 1}];`);
        body.push(`  always @(posedge ${I(3)}) if (${I(2)}) ${m}[${I(0)}] <= ${I(1)};`, `  assign ${O(0)} = ${I(4)} ? ${m}[${I(0)}] : ${b}'bz;`);
        break;
      }
      case 'RAMAsync': {
        const b = bits(0), m = 'ram' + rc++;
        decl.push(`  reg ${width(b)}${m} [0:${g.size - 1}];`);
        body.push(`  always @(*) if (${I(2)}) ${m}[${I(0)}] = ${I(1)};`, `  assign ${O(0)} = ${m}[${I(0)}];`);
        break;
      }
      case 'RegisterFile': {
        const b = bits(0), m = 'regs' + rc++;
        decl.push(`  reg ${width(b)}${m} [0:${g.size - 1}];`);
        body.push(`  always @(posedge ${I(3)}) if (${I(1)}) ${m}[${I(2)}] <= ${I(0)};`, `  assign ${O(0)} = ${m}[${I(4)}];`, `  assign ${O(1)} = ${m}[${I(5)}];`);
        break;
      }
      default: unsupported.add(DEF[c.type]?.name || c.type);
    }
  }
  if (unsupported.size) throw new Error('Diese Bauteile lassen sich nicht als HDL ausgeben: ' + [...unsupported].join(', '));
  for (const p of ports) if (p.dir === 'out') body.push(`  assign ${p.name} = ${netName.get(p.net)};`);
  const head = ports.map(p => `  ${p.dir === 'in' ? 'input' : 'output'} ${width(p.bits)}${p.name}`).join(',\n');
  return `// Erzeugt mit Digital (Web) – ${new Date().toISOString().slice(0, 10)}\nmodule ${P.mod} (\n${head}\n);\n${decl.join('\n')}\n\n${body.join('\n')}\nendmodule\n`;
}

// ---------- VHDL ----------
export function toVHDL(circuit, name = 'circuit') {
  const P = prepare(circuit, name);
  const { nets, compPins, comps, netName, ports, unsupported } = P;
  const T = b => (b > 1 ? `std_logic_vector(${b - 1} downto 0)` : 'std_logic');
  const decl = [], body = [];
  const N = i => netName.get(i);
  const isIn = i => ports.some(p => p.dir === 'in' && p.name === netName.get(i));
  for (const [i] of nets.entries()) if (!isIn(i)) decl.push(`  signal ${N(i)}: ${T(nets[i].bits)};`);
  let rc = 0;
  const lit = (v, b) => (b > 1 ? `"${(v >>> 0).toString(2).padStart(b, '0').slice(-b)}"` : `'${v & 1}'`);
  const U = (s, b) => (b > 1 ? `unsigned(${s})` : `unsigned'(0 => ${s})`);
  for (const c of comps) {
    const a = attrsOf(c), g = geoOf(c), cp = compPins.get(c.id);
    const inB = k => nets[cp.ins[k]]?.bits || 1, outB = k => nets[cp.outs[k]]?.bits || 1;
    const I = k => (inv(c, a, g, k) ? `(not ${N(cp.ins[k])})` : N(cp.ins[k]));
    const O = k => N(cp.outs[k]);
    const nIn = cp.ins.length;
    const gate = (op, neg) => body.push(`  ${O(0)} <= ${neg ? 'not (' : ''}${Array.from({ length: nIn }, (_, k) => I(k)).join(` ${op} `)}${neg ? ')' : ''};`);
    const toInt = k => `to_integer(${U(I(k), inB(k))})`;
    switch (c.type) {
      case 'In': case 'Clock': case 'Out': case 'LED': case 'Tunnel': case 'Probe': case 'Text': case 'Testcase': case 'Rectangle': case 'Data': case 'PowerSupply': case 'PullUp': case 'PullDown': case 'GenericInitCode': case 'GenericCode': break;
      case 'Seven-Seg': case 'Seven-Seg-Hex': case 'RGBLED': case 'PolarityAwareLED': case 'LightBulb': case 'LedMatrix': break;
      case 'And': gate('and'); break; case 'Or': gate('or'); break; case 'XOr': gate('xor'); break;
      case 'NAnd': gate('and', true); break; case 'NOr': gate('or', true); break; case 'XNOr': gate('xor', true); break;
      case 'Not': body.push(`  ${O(0)} <= not ${I(0)};`); break;
      case 'Const': body.push(`  ${O(0)} <= ${lit(a.Value, outB(0))};`); break;
      case 'Ground': body.push(`  ${O(0)} <= ${outB(0) > 1 ? '(others => \'0\')' : "'0'"};`); break;
      case 'VDD': body.push(`  ${O(0)} <= ${outB(0) > 1 ? '(others => \'1\')' : "'1'"};`); break;
      case 'Delay': body.push(`  ${O(0)} <= ${I(0)};`); break;
      case 'Splitter': {
        const ins = parseSplitPorts(a['Input Splitting']), outs = parseSplitPorts(a['Output Splitting']);
        const total = Math.max(...ins.map(p => p.lo + p.bits)), all = 'split' + rc++;
        decl.push(`  signal ${all}: std_logic_vector(${total - 1} downto 0);`);
        ins.forEach((p, k) => body.push(`  ${all}(${p.bits > 1 ? `${p.lo + p.bits - 1} downto ${p.lo}` : p.lo}) <= ${I(k)};`));
        outs.forEach((p, k) => body.push(`  ${O(k)} <= ${all}(${p.bits > 1 ? `${p.lo + p.bits - 1} downto ${p.lo}` : p.lo});`));
        break;
      }
      case 'Driver': case 'DriverInvSel': {
        const on = c.type === 'Driver' ? "'1'" : "'0'", z = outB(0) > 1 ? "(others => 'Z')" : "'Z'";
        body.push(`  ${O(0)} <= ${a.invertDriverOutput ? 'not ' : ''}${I(0)} when ${I(1)} = ${on} else ${z};`);
        break;
      }
      case 'Multiplexer': body.push(`  with ${toInt(0)} select ${O(0)} <=`, ...Array.from({ length: nIn - 1 }, (_, k) => `    ${I(k + 1)} when ${k},`), `    ${I(nIn - 1)} when others;`); break;
      case 'Decoder': cp.outs.forEach((_, k) => body.push(`  ${O(k)} <= '1' when ${toInt(0)} = ${k} else '0';`)); break;
      case 'Demultiplexer': cp.outs.forEach((_, k) => body.push(`  ${O(k)} <= ${I(1)} when ${toInt(0)} = ${k} else ${lit(a.Default || 0, outB(k))};`)); break;
      case 'Add': {
        const b = outB(0), t = 'sum' + rc++;
        decl.push(`  signal ${t}: unsigned(${b} downto 0);`);
        body.push(`  ${t} <= ('0' & ${U(I(0), b)}) + ('0' & ${U(I(1), b)}) + ${U(I(2), 1)};`, b === 1 ? `  ${O(0)} <= ${t}(0);` : `  ${O(0)} <= std_logic_vector(${t}(${b - 1} downto 0));`, `  ${O(1)} <= ${t}(${b});`);
        break;
      }
      case 'Comparator': {
        const f = a.Signed ? (s, b) => `signed(${s})` : (s, b) => U(s, b);
        const [x, y] = [f(I(0), inB(0)), f(I(1), inB(1))];
        body.push(`  ${O(0)} <= '1' when ${x} > ${y} else '0';`, `  ${O(1)} <= '1' when ${x} = ${y} else '0';`, `  ${O(2)} <= '1' when ${x} < ${y} else '0';`);
        break;
      }
      case 'D_FF': case 'T_FF': case 'JK_FF': case 'RS_FF': case 'D_FF_AS': case 'JK_FF_AS': {
        const names = g.pins.filter(p => !p.out).map(p => p.n);
        const pin = n => I(names.indexOf(n));
        const b = outB(0), r = 'q' + rc++;
        decl.push(`  signal ${r}: ${T(b)} := ${lit(a.Default || 0, b)};`);
        let next;
        if (c.type.startsWith('D_FF')) next = `${r} <= ${pin('D')};`;
        else if (c.type === 'T_FF') next = names.includes('T') ? `if ${pin('T')} = '1' then ${r} <= not ${r}; end if;` : `${r} <= not ${r};`;
        else if (c.type === 'RS_FF') next = `if ${pin('S')} = '1' and ${pin('R')} = '0' then ${r} <= '1'; elsif ${pin('S')} = '0' and ${pin('R')} = '1' then ${r} <= '0'; end if;`;
        else next = `if ${pin('J')} = '1' and ${pin('K')} = '1' then ${r} <= not ${r}; elsif ${pin('J')} = '1' then ${r} <= '1'; elsif ${pin('K')} = '1' then ${r} <= '0'; end if;`;
        if (names.includes('Set')) body.push(`  process(${pin('C')}, ${pin('Set')}, ${pin('Clr')}) begin`, `    if ${pin('Set')} = '1' then ${r} <= ${b > 1 ? "(others => '1')" : "'1'"}; elsif ${pin('Clr')} = '1' then ${r} <= ${b > 1 ? "(others => '0')" : "'0'"}; elsif rising_edge(${pin('C')}) then ${next} end if;`, '  end process;');
        else body.push(`  process(${pin('C')}) begin`, `    if rising_edge(${pin('C')}) then ${next} end if;`, '  end process;');
        body.push(`  ${O(0)} <= ${r};`, `  ${O(1)} <= not ${r};`);
        break;
      }
      case 'Register': {
        const b = outB(0), r = 'q' + rc++;
        decl.push(`  signal ${r}: ${T(b)} := ${lit(0, b)};`);
        body.push(`  process(${I(1)}) begin`, `    if rising_edge(${I(1)}) then if ${I(2)} = '1' then ${r} <= ${I(0)}; end if; end if;`, '  end process;', `  ${O(0)} <= ${r};`);
        break;
      }
      case 'Counter': {
        const b = outB(0), r = 'cnt' + rc++;
        decl.push(`  signal ${r}: unsigned(${b - 1} downto 0) := (others => '0');`);
        body.push(`  process(${I(1)}) begin`, `    if rising_edge(${I(1)}) then`, `      if ${I(2)} = '1' then ${r} <= (others => '0'); elsif ${I(0)} = '1' then ${r} <= ${r} + 1; end if;`, '    end if;', '  end process;',
          b === 1 ? `  ${O(0)} <= ${r}(0);` : `  ${O(0)} <= std_logic_vector(${r});`, `  ${O(1)} <= '1' when ${I(0)} = '1' and ${r} = (${r}'range => '1') else '0';`);
        break;
      }
      default: unsupported.add(DEF[c.type]?.name || c.type);
    }
  }
  if (unsupported.size) throw new Error('Diese Bauteile lassen sich (noch) nicht als VHDL ausgeben: ' + [...unsupported].join(', ') + '. Verilog unterstützt mehr Bauteile.');
  for (const p of ports) if (p.dir === 'out') body.push(`  ${p.name} <= ${netName.get(p.net)};`);
  const head = ports.map(p => `    ${p.name}: ${p.dir} ${T(p.bits)}`).join(';\n');
  return `-- Erzeugt mit Digital (Web) – ${new Date().toISOString().slice(0, 10)}\nlibrary ieee;\nuse ieee.std_logic_1164.all;\nuse ieee.numeric_std.all;\n\nentity ${P.mod} is\n  port (\n${head}\n  );\nend ${P.mod};\n\narchitecture Behavioral of ${P.mod} is\n${decl.join('\n')}\nbegin\n${body.join('\n')}\nend Behavioral;\n`;
}
