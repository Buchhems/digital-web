// Lesen und Schreiben des .dig-Formats von "Digital"
import { Circuit } from './circuit.js';
import { DEF } from './components.js';

const TYPES = {
  Inputs: 'int', Bits: 'int', 'Selector Bits': 'int', Frequency: 'int', splitterSpreading: 'int',
  Value: 'long',
  wideShape: 'boolean', flipSelPos: 'boolean', runRealTime: 'boolean', withEnable: 'boolean', ActiveLow: 'boolean',
  Label: 'string', NetName: 'string', Description: 'string', 'Input Splitting': 'string', 'Output Splitting': 'string',
  Color: 'awt-color', intFormat: 'intFormat', inverterConfig: 'inverterConfig', InDefault: 'value',
};

export function parseDig(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Die Datei ist keine gültige .dig-Datei.');
  const root = doc.documentElement;
  if (root.nodeName !== 'circuit') throw new Error('Die Datei ist keine Digital-Schaltung.');
  const c = new Circuit();
  const ser = new XMLSerializer();
  const unknown = new Set();
  const topAttr = [...root.children].find(e => e.nodeName === 'attributes');
  if (topAttr && topAttr.children.length) c.digAttributes = ser.serializeToString(topAttr);

  const ve = [...root.children].find(e => e.nodeName === 'visualElements');
  for (const el of ve ? [...ve.children] : []) {
    const name = el.querySelector(':scope > elementName')?.textContent?.trim();
    const pos = el.querySelector(':scope > pos');
    const x = +pos?.getAttribute('x') || 0, y = +pos?.getAttribute('y') || 0;
    const attrs = {}, raw = [];
    let rotation = 0;
    const ea = el.querySelector(':scope > elementAttributes');
    for (const entry of ea ? [...ea.children] : []) {
      const [k, v] = entry.children;
      if (!k || !v) continue;
      const key = k.textContent;
      if (key === 'rotation') { rotation = +v.getAttribute('rotation') || 0; continue; }
      const val = readValue(v);
      if (val === undefined || !(key in TYPES)) { raw.push(ser.serializeToString(entry)); continue; }
      attrs[key] = val;
    }
    let type = name;
    if (!DEF[name]) { unknown.add(name); type = 'Unknown'; attrs.elementName = name; }
    const comp = c.addComp(type, x, y, attrs, rotation);
    if (raw.length) comp.raw = raw;
  }
  const wires = [...root.children].find(e => e.nodeName === 'wires');
  for (const w of wires ? [...wires.children] : []) {
    const p1 = w.querySelector('p1'), p2 = w.querySelector('p2');
    if (p1 && p2) c.addWire(+p1.getAttribute('x'), +p1.getAttribute('y'), +p2.getAttribute('x'), +p2.getAttribute('y'));
  }
  return { circuit: c, unknown: [...unknown] };
}

function readValue(v) {
  switch (v.nodeName) {
    case 'int': case 'long': return Number(v.textContent);
    case 'boolean': return v.textContent.trim() === 'true';
    case 'string': return v.textContent;
    case 'intFormat': return v.textContent.trim();
    case 'awt-color': {
      const g = n => +(v.querySelector(n)?.textContent || 0);
      return { r: g('red'), g: g('green'), b: g('blue') };
    }
    case 'inverterConfig': return [...v.children].map(s => s.textContent);
    case 'value': return Number(v.getAttribute('v') || 0);
    default: return undefined;
  }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeValue(key, val) {
  const t = TYPES[key];
  switch (t) {
    case 'int': case 'long': return `<${t}>${Math.round(val)}</${t}>`;
    case 'boolean': return `<boolean>${val ? 'true' : 'false'}</boolean>`;
    case 'string': return `<string>${esc(val)}</string>`;
    case 'intFormat': return `<intFormat>${esc(val)}</intFormat>`;
    case 'awt-color': return `<awt-color>\n          <red>${val.r}</red>\n          <green>${val.g}</green>\n          <blue>${val.b}</blue>\n          <alpha>255</alpha>\n        </awt-color>`;
    case 'inverterConfig': return `<inverterConfig>${val.map(s => `<string>${esc(s)}</string>`).join('')}</inverterConfig>`;
    case 'value': return `<value v="${Math.round(val)}" z="false"/>`;
    default: return null;
  }
}

export function writeDig(circuit) {
  const L = ['<?xml version="1.0" encoding="utf-8"?>', '<circuit>', '  <version>2</version>'];
  L.push(circuit.digAttributes ? '  ' + circuit.digAttributes : '  <attributes/>');
  L.push('  <visualElements>');
  for (const c of circuit.comps) {
    const def = DEF[c.type];
    const name = c.type === 'Unknown' ? c.attrs.elementName : c.type;
    L.push('    <visualElement>', `      <elementName>${esc(name)}</elementName>`);
    const entries = [];
    if (c.rot) entries.push(`      <entry>\n        <string>rotation</string>\n        <rotation rotation="${c.rot}"/>\n      </entry>`);
    // Alle Attribute (inkl. Standardwerte) schreiben – unsere Standardwerte weichen teils von Digital ab
    const all = { ...def.defaults, ...(c.attrs || {}) };
    for (const [k, v] of Object.entries(all)) {
      if (k === 'elementName') continue;
      if (k === 'inverterConfig' && (!v || !v.length)) continue;
      const xml = writeValue(k, v);
      if (xml) entries.push(`      <entry>\n        <string>${esc(k)}</string>\n        ${xml}\n      </entry>`);
    }
    for (const r of c.raw || []) entries.push('      ' + r);
    L.push(entries.length ? '      <elementAttributes>\n' + entries.join('\n') + '\n      </elementAttributes>' : '      <elementAttributes/>');
    L.push(`      <pos x="${Math.round(c.x)}" y="${Math.round(c.y)}"/>`, '    </visualElement>');
  }
  L.push('  </visualElements>', '  <wires>');
  for (const w of circuit.wires) L.push('    <wire>', `      <p1 x="${w.x1}" y="${w.y1}"/>`, `      <p2 x="${w.x2}" y="${w.y2}"/>`, '    </wire>');
  L.push('  </wires>', '  <measurementOrdering/>', '</circuit>', '');
  return L.join('\n');
}

